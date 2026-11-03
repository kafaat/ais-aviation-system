import type { APIRequestContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { fixtureFlight, rpc, sqlRows } from "./fixtures/hardening";

async function deliverSyntheticEvent(
  request: APIRequestContext,
  type: string,
  object: Record<string, unknown>,
  id = "evt_agency_" + randomUUID()
) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    throw new Error("A disposable Stripe webhook signing secret is required");
  const payload = JSON.stringify({ id, type, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(timestamp + "." + payload)
    .digest("hex");
  const received = await request.post("/api/stripe/webhook", {
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=" + timestamp + ",v1=" + signature,
    },
    data: payload,
  });
  expect(received.status()).toBe(200);
  return id;
}

// Registration returns credentials. Keep them outside test artifacts.
const creditTest = test.extend({
  trace: "off",
  video: "off",
  screenshot: "off",
});

creditTest(
  "one agency credit line admits one concurrent invoice and reconciles cancellation and actual funding",
  async ({ page, trace, video, screenshot }) => {
    expect({ trace, video, screenshot }).toEqual({
      trace: "off",
      video: "off",
      screenshot: "off",
    });
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    const client = rpc(page);
    await useBrowserSession(page, "reporting");
    const owner = await client.auth.me.query();
    if (!owner) throw new Error("Missing customer");
    const flightId = await fixtureFlight(owner.tenantId);
    const ref = randomUUID().slice(0, 12);
    const agencyName = "Credit fixture " + ref;
    const email = "credit-" + ref + "@example.test";
    await useBrowserSession(page, "admin");
    const { agent, credentials } = await client.travelAgent.register.mutate({
      ownerUserId: owner.id,
      agencyName,
      iataNumber: ref,
      contactName: "Agent",
      email,
      phone: "+966500000000",
    });
    const agencyId = agent.id;
    const bookingInput = () => ({
      agencyId,
      flightId,
      cabinClass: "economy" as const,
      idempotencyKey: randomUUID(),
      contactEmail: email,
      contactPhone: "+966500000000",
      passengers: [
        { firstName: "Agency", lastName: "Passenger", type: "adult" as const },
      ],
    });
    await useBrowserSession(page, "reporting");
    const baseline =
      await client.agentPortal.createBooking.mutate(bookingInput());
    const dashboard = () =>
      client.agentPortal.dashboard.query({ agencyId, page: 1 });
    const before = await dashboard();
    expect(before.credit).toMatchObject({
      limitMinor: null,
      outstandingMinor: 0,
    });
    const amount = before.bookings.find(
      row => row.bookingId === baseline.bookingId
    )!.totalAmount;
    expect(amount).toBeGreaterThan(0);
    const limit = amount + Math.floor(amount / 2);
    const reason = "Approved test terms";
    const terms = {
      agencyId,
      expectedTermsId: null,
      limitMinor: limit,
      reason,
    };
    await expect(
      client.travelAgent.approveCredit.mutate(terms)
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await useBrowserSession(page, "admin");
    await page.goto("/admin/travel-agents");
    await page
      .getByRole("row")
      .filter({ hasText: agencyName })
      .getByTitle("View Statistics")
      .click();
    const approval = page.getByRole("region", { name: "Agency credit" });
    await approval
      .getByLabel("New credit limit (SAR)")
      .fill((limit / 100).toFixed(2));
    await approval.getByLabel("Approval reason").fill(reason);
    await approval.getByRole("button", { name: "Approve limit" }).click();
    await expect(approval).toContainText("Outstanding invoices");
    const approved = await client.travelAgent.creditBalance.query({ agencyId });
    expect(approved).toMatchObject({ limitMinor: limit, outstandingMinor: 0 });
    expect(await client.travelAgent.approveCredit.mutate(terms)).toEqual(
      approved
    );
    await useBrowserSession(page, "regular");
    await expect(dashboard()).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await useBrowserSession(page, "reporting");
    const commands = [bookingInput(), bookingInput()];
    const attempts = await Promise.allSettled(
      commands.map(command =>
        rpc(page).agentPortal.createBooking.mutate(command)
      )
    );
    const win = attempts.findIndex(x => x.status === "fulfilled");
    expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(attempts[1 - win]).toMatchObject({
      status: "rejected",
      reason: { data: { code: "PRECONDITION_FAILED" } },
    });
    const winner = attempts[win];
    if (winner.status !== "fulfilled")
      throw new Error("Expected one successful credit allocation");
    const replay = await client.agentPortal.createBooking.mutate(commands[win]);
    expect(replay).toEqual(winner.value);
    const posted = await dashboard();
    expect(posted.total).toBe(2); // One baseline sale and exactly one new credit invoice.
    const invoice = posted.bookings.find(
      row => row.bookingId === replay.bookingId
    )!;
    expect(invoice).toMatchObject({
      status: "pending",
      paymentStatus: "pending",
    });
    expect(posted.credit).toMatchObject({
      outstandingMinor: invoice.totalAmount,
      availableMinor: limit - invoice.totalAmount,
    });
    expect(
      await sqlRows(
        "SELECT bookingId FROM agency_credit_obligations WHERE termsId=?",
        [approved.termsId!]
      )
    ).toEqual([{ bookingId: replay.bookingId }]);
    expect(
      await sqlRows("SELECT id FROM financial_ledger WHERE bookingId=?", [
        replay.bookingId,
      ])
    ).toHaveLength(0);
    await page.goto("/agent");
    await page
      .getByLabel("Agency", { exact: true })
      .selectOption(String(agencyId));
    await expect(page.getByLabel("Agency credit")).toContainText(
      "Outstanding invoices"
    );
    await client.bookings.cancel.mutate({ bookingId: replay.bookingId });
    expect((await dashboard()).credit).toMatchObject({
      outstandingMinor: 0,
      availableMinor: limit,
    });
    const second = await client.agentPortal.createBooking.mutate(
      commands[1 - win]
    );
    const outstanding = (await dashboard()).credit.outstandingMinor;
    expect(outstanding).toBeGreaterThan(0);
    await client.wallet.balance.query();
    await sqlRows("UPDATE wallets SET balance=balance+? WHERE userId=?", [
      outstanding,
      owner.id,
    ]);
    await client.wallet.pay.mutate({
      bookingId: second.bookingId,
      expectedAmount: outstanding,
    });
    expect((await dashboard()).credit).toMatchObject({
      outstandingMinor: 0,
      availableMinor: limit,
    });
    expect(
      await sqlRows(
        "SELECT id FROM financial_ledger WHERE bookingId=? AND type='charge'",
        [second.bookingId]
      )
    ).toHaveLength(1);
    expect(
      await client.agentPortal.createBooking.mutate(commands[1 - win])
    ).toEqual(second);
    await useBrowserSession(page, "admin");
    expect(await client.travelAgent.creditBalance.query({ agencyId })).toEqual(
      approved
    );
    // Unlike the wallet sale, this invoice has a provider receipt. Deliver
    // signed synthetic events through the real local webhook boundary.
    const credentialSale = (booking = bookingInput()) =>
      client.travelAgent.createBooking.mutate({ credentials, booking });
    const originalCommand = bookingInput();
    const third = await credentialSale(originalCommand);
    expect(await credentialSale(originalCommand)).toEqual(third);
    const balance = () => client.travelAgent.creditBalance.query({ agencyId });
    const thirdAmount = (await balance()).outstandingMinor;
    expect(thirdAmount).toBeGreaterThan(0);
    const intent = "pi_agency_" + ref;
    await deliverSyntheticEvent(page.request, "payment_intent.succeeded", {
      id: intent,
      status: "succeeded",
      currency: "sar",
      amount_received: thirdAmount,
      metadata: {
        type: "booking",
        bookingId: String(third.bookingId),
        userId: String(owner.id),
      },
    });
    expect(await balance()).toMatchObject({
      outstandingMinor: 0,
      availableMinor: limit,
      settlementReview: false,
    });

    await useBrowserSession(page, "ops");
    const successor = await client.auth.me.query();
    if (
      !successor ||
      successor.id === owner.id ||
      successor.tenantId !== owner.tenantId
    )
      throw new Error("Expected another account in the same airline");
    await useBrowserSession(page, "admin");
    const transfer = () =>
      client.travelAgent.assignOwner.mutate({
        agentId: agencyId,
        ownerUserId: successor.id,
      });
    const dispute = (
      id: string,
      action: "funds_withdrawn" | "funds_reinstated",
      eventId?: string
    ) =>
      deliverSyntheticEvent(
        page.request,
        "charge.dispute." + action,
        {
          id,
          payment_intent: intent,
          charge: "ch_agency_" + ref,
          amount: thirdAmount,
          currency: "sar",
          status: action === "funds_withdrawn" ? "under_review" : "won",
          reason: "fraudulent",
        },
        eventId
      );
    const original = "dp_agency_" + ref;
    const event = await dispute(original, "funds_withdrawn");
    await dispute(original, "funds_withdrawn", event);
    expect(await balance()).toMatchObject({
      outstandingMinor: 0,
      availableMinor: 0,
      settlementReview: true,
    });
    await expect(credentialSale()).rejects.toMatchObject({
      data: { code: "PRECONDITION_FAILED" },
    });
    const disable = () =>
      client.travelAgent.approveCredit.mutate({
        ...terms,
        expectedTermsId: approved.termsId,
        limitMinor: null,
        reason: "End original agreement",
      });
    await expect(disable()).rejects.toMatchObject({
      data: { code: "PRECONDITION_FAILED" },
    });
    await expect(transfer()).rejects.toMatchObject({
      data: { code: "PRECONDITION_FAILED" },
    });
    await dispute(original, "funds_reinstated");
    expect(await balance()).toEqual(approved);
    const disabled = await disable();
    await transfer();
    await expect(credentialSale(originalCommand)).rejects.toMatchObject({
      data: { code: "CONFLICT" },
    });
    // A later withdrawal against the former owner's funded invoice freezes
    // new credit but does not present the former owner's invoice as new debt.
    const later = "dp_later_" + ref;
    await dispute(later, "funds_withdrawn");
    const newTerms = {
      ...terms,
      expectedTermsId: disabled.termsId,
      reason: "Approve successor",
    };
    await expect(
      client.travelAgent.approveCredit.mutate(newTerms)
    ).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
    await useBrowserSession(page, "reporting");
    await expect(dashboard()).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await useBrowserSession(page, "ops");
    expect((await dashboard()).credit).toMatchObject({
      settlementReview: true,
      outstandingMinor: 0,
      limitMinor: null,
    });
    await dispute(later, "funds_reinstated");
    await useBrowserSession(page, "admin");
    expect(
      await client.travelAgent.approveCredit.mutate(newTerms)
    ).toMatchObject({
      outstandingMinor: 0,
      availableMinor: limit,
      settlementReview: false,
    });
  }
);
