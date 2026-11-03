import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { expect, test } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { fixtureFlight, rpc, sqlRows } from "./fixtures/hardening";

// Agency credentials are issued once by the registration API.
test.use({ trace: "off", video: "off", screenshot: "off" });

test("admin approves a funded agency commission once and cannot record an unverified payout", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await useBrowserSession(page, "regular");
  const api = rpc(page);
  const owner = await api.auth.me.query();
  if (!owner) throw new Error("Missing agency owner session");

  await useBrowserSession(page, "admin");
  const suffix = randomUUID().slice(0, 12);
  const email = `commission-${suffix}@example.com`;
  const { agent, credentials } = await api.travelAgent.register.mutate({
    ownerUserId: owner.id,
    agencyName: `Commission ${suffix}`,
    iataNumber: suffix,
    contactName: "Commission Reviewer",
    email,
    phone: "+966500000000",
    commissionRate: 5,
  });

  await useBrowserSession(page, "regular");
  const flightId = await fixtureFlight();
  const createSale = (firstName: string) =>
    api.travelAgent.createBooking.mutate({
      credentials,
      booking: {
        flightId,
        cabinClass: "economy",
        idempotencyKey: randomUUID(),
        contactEmail: email,
        contactPhone: "+966500000000",
        passengers: [{ type: "adult", firstName, lastName: "Commission" }],
      },
    });
  const funded = await createSale("Funded");
  const unpaid = await createSale("Unpaid");
  const commissionRows = () =>
    sqlRows<RowDataPacket>(
      "SELECT id, bookingId, bookingAmount, commissionAmount, commissionStatus, commissionPaidAt FROM agent_bookings WHERE agentId = ? ORDER BY bookingId",
      [agent.id]
    );
  const [fundedRow, unpaidRow] = await commissionRows();
  expect(fundedRow).toMatchObject({
    bookingId: funded.bookingId,
    commissionStatus: "pending",
  });
  expect(unpaidRow).toMatchObject({
    bookingId: unpaid.bookingId,
    commissionStatus: "pending",
  });
  expect(fundedRow.commissionAmount).toBeGreaterThan(0);
  await sqlRows<RowDataPacket>(
    "INSERT INTO user_credits (userId, amount, source) VALUES (?, ?, 'promo')",
    [owner.id, fundedRow.bookingAmount]
  );
  await api.vouchers.useCredits.mutate({
    bookingId: funded.bookingId,
    amount: fundedRow.bookingAmount,
  });

  await useBrowserSession(page, "admin");
  await page.goto("/admin/travel-agents");
  const review = page.getByRole("tab", { name: /Commission review/ });
  await review.click();
  const reviewRow = (reference: string) =>
    page
      .getByRole("row")
      .filter({ has: page.getByText(reference, { exact: true }) });
  const row = reviewRow(funded.bookingReference);
  const approve = row.getByRole("button", { name: "Approve", exact: true });
  await expect(approve).toBeVisible();
  await expect(reviewRow(unpaid.bookingReference)).toHaveCount(0);
  await expect(
    api.travelAgent.updateCommissionStatus.mutate({
      id: unpaidRow.id,
      status: "approved",
    })
  ).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });

  await approve.click();
  const approved = row.getByText("Approved — awaiting payout evidence", {
    exact: true,
  });
  await expect(approved).toBeVisible();
  await expect(
    api.travelAgent.updateCommissionStatus.mutate({
      id: fundedRow.id,
      status: "approved",
    })
  ).resolves.toEqual({ success: true });
  await expect(
    api.travelAgent.updateCommissionStatus.mutate({
      id: fundedRow.id,
      status: "paid",
    })
  ).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });

  await page.reload();
  await review.click();
  await expect(approved).toBeVisible();
  await expect(
    row.getByRole("button", { name: /approve|mark paid/i })
  ).toHaveCount(0);
  expect(await commissionRows()).toEqual([
    { ...fundedRow, commissionStatus: "approved", commissionPaidAt: null },
    { ...unpaidRow, commissionStatus: "pending", commissionPaidAt: null },
  ]);
});
