import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Locator, Page, TestInfo } from "@playwright/test";
import type { RowDataPacket } from "mysql2/promise";
import { test, expect } from "../e2e/fixtures/base-test";
import {
  fixtureFlight,
  ownedBooking,
  rpc,
  sqlRows,
} from "../e2e/fixtures/hardening";
import type { Ui05ProviderSnapshot } from "../e2e/fixtures/ui05-stripe-provider";
import { disposableDatabaseUrl } from "../e2e/disposable-database";
import { login } from "../e2e/fixtures/test-helpers";
import {
  offerDigest,
  type OfferPayload,
} from "../server/services/retail-offer.service";

// Run with playwright.ui05.config.ts. This exercises the real built React app,
// tRPC HTTP routes, MySQL transactions, Stripe SDK transport and signed webhook.
// Only the external payment provider is an owned loopback HTTP fixture; no card
// network, Stripe sandbox, bank settlement or external ticket reissue is proven.
// Public payer URLs contain bearer tokens, so never record browser traces/video.
test.use({ trace: "off", video: "off", screenshot: "off" });
const journeyOwners = new Set<number>();
test.beforeEach(async ({ page }) => {
  disposableDatabaseUrl();
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  const authService = process.env.AUTH_SERVICE_URL;
  if (!authService) throw new Error("Owned UI-05 auth service is required");
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(
    new URL(authService).hostname
  );
  const customer = {
    name: "UI05 Retail Customer",
    email: `ui05.${randomUUID()}@example.com`,
    password: "Ui05Password123!",
  };
  // Use the actual registration contract and browser password login. Sharing
  // one customer across all five payment journeys exhausts the legitimate
  // per-user financial-write quota and couples otherwise independent tests.
  // The auth service serves only callers holding the shared credential.
  const serviceToken = process.env.AUTH_SERVICE_TOKEN;
  if (!serviceToken)
    throw new Error("Owned UI-05 auth service credential is required");
  const registration = await page.request.post(`${authService}/auth/register`, {
    data: customer,
    headers: { "X-Auth-Service-Token": serviceToken },
  });
  expect(registration.ok(), "Actual customer registration must succeed").toBe(
    true
  );
  expect(await registration.json()).toMatchObject({ success: true });
  await login(page, customer.email, customer.password);
  const client = rpc(page);
  const owner = await client.auth.me.query();
  if (!owner) throw new Error("Authenticated UI-05 owner missing");
  expect(owner).toMatchObject({ role: "user", tenantId: null });
  expect(
    journeyOwners.has(owner.id),
    "Every journey needs a distinct owner"
  ).toBe(false);
  journeyOwners.add(owner.id);
  const consent = await client.consent.getMyConsent.query();
  if (consent.needsReconsent)
    await client.consent.updateConsent.mutate({
      expectedRevision: consent.consent?.id ?? null,
      consentVersion: consent.currentVersion,
      essential: true,
      analytics: false,
      marketing: false,
      preferences: false,
    });
});

const minor = (amount: number) => (amount / 100).toFixed(2);
async function providerOrigin() {
  const file = process.env.AIS_UI05_PROVIDER_FILE;
  if (!file) throw new Error("Dedicated UI-05 provider configuration required");
  const { origin } = JSON.parse(await readFile(file, "utf8")) as {
    origin: string;
  };
  expect(new URL(origin).hostname).toBe("127.0.0.1");
  return origin;
}
async function providerState(page: Page): Promise<Ui05ProviderSnapshot> {
  const response = await page.request.get(
    `${await providerOrigin()}/__fixture/state`
  );
  expect(response.status()).toBe(200);
  return response.json();
}
test.afterEach(async ({ page }) => {
  expect((await providerState(page)).unexpected).toEqual([]);
});
async function evidence(info: TestInfo, data: unknown) {
  await info.attach("ui05-native-financial-receipt", {
    body: JSON.stringify(
      {
        boundary:
          "Actual Chromium + API + MySQL; controlled local HTTP payment provider",
        externalProviderCertification: false,
        ...(data as Record<string, unknown>),
      },
      null,
      2
    ),
    contentType: "application/json",
  });
}
function bookingCard(page: Page, reference: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(reference, { exact: true }) });
}
async function cancelDialog(page: Page, reference: string, track = false) {
  await page.goto("/my-bookings");
  await bookingCard(page, reference)
    .getByRole("button", {
      name: track ? "View cancellation" : "Cancel",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Cancel booking" });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function displayedDefinition(
  dialog: Locator,
  label: string,
  value: string
) {
  await expect(
    dialog
      .getByText(label, { exact: true })
      .locator("xpath=following-sibling::dd[1]")
  ).toHaveText(value);
}
async function completePayment(
  page: Page,
  expected: {
    bookingId: number;
    amount: number;
    type: "booking" | "modification" | "split_payment";
    modificationId?: number;
    splitId?: number;
  }
) {
  const origin = await providerOrigin();
  await expect(page).toHaveURL(
    url => url.origin === origin && url.pathname.startsWith("/checkout/cs_")
  );
  await expect(
    page.getByRole("heading", { name: "Local simulated payment" })
  ).toBeVisible();
  await expect(
    page.getByText(`${minor(expected.amount)} SAR`, { exact: true })
  ).toBeVisible();
  const sessionId = new URL(page.url()).pathname.split("/").at(-1)!;
  const created = (await providerState(page)).sessions.find(
    s => s.id === sessionId
  );
  expect(created).toMatchObject({
    amount_total: expected.amount,
    payment_status: "unpaid",
    payment_intent: null,
    metadata: {
      type: expected.type,
      bookingId: String(expected.bookingId),
      ...(expected.modificationId
        ? { modificationId: String(expected.modificationId) }
        : {}),
      ...(expected.splitId ? { splitId: String(expected.splitId) } : {}),
    },
  });
  expect(created?.metadata.checkoutRequestId).toBeTruthy();
  await page
    .getByRole("button", { name: "Complete simulated payment" })
    .click();
  await expect(page).toHaveURL(
    url => url.origin === (process.env.E2E_BASE_URL || "http://localhost:3000")
  );
  const state = await providerState(page);
  const paid = state.sessions.find(s => s.id === sessionId)!;
  expect(paid.payment_status).toBe("paid");
  expect(paid.payment_intent).toMatch(/^pi_ui05_/);
  const delivery = state.webhooks.find(w => w.sessionId === sessionId)!;
  expect(delivery.httpStatus).toBe(200);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT processed, error FROM stripe_events WHERE id=?",
      [delivery.eventId]
    )
  ).toEqual([{ processed: 1, error: null }]);
  const receipts = await sqlRows<RowDataPacket>(
    "SELECT paymentIntentId, kind, bookingId, targetId, amount, currency, refundedAmount, settlementStatus FROM payment_receipts WHERE paymentIntentId=?",
    [paid.payment_intent!]
  );
  expect(receipts).toEqual([
    {
      paymentIntentId: paid.payment_intent,
      kind: expected.type,
      bookingId: expected.bookingId,
      targetId:
        expected.modificationId ?? expected.splitId ?? expected.bookingId,
      amount: expected.amount,
      currency: "SAR",
      refundedAmount: 0,
      settlementStatus: "applied",
    },
  ]);
  return {
    ...paid,
    payment_intent: paid.payment_intent!,
    eventId: delivery.eventId,
  };
}
async function cashBooking(page: Page) {
  const owned = await ownedBooking(page, false, undefined, null);
  await page.goto(`/checkout/${owned.booking.bookingId}`);
  await page
    .getByRole("button", { name: "Continue payment", exact: true })
    .click();
  const paid = await completePayment(page, {
    type: "booking",
    bookingId: owned.booking.bookingId,
    amount: owned.booking.totalAmount,
  });
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT status, paymentStatus, seatsReserved FROM bookings WHERE id=?",
      [owned.booking.bookingId]
    )
  ).toEqual([{ status: "confirmed", paymentStatus: "paid", seatsReserved: 1 }]);
  return { ...owned, paid, client: rpc(page) };
}

async function fareOnlyBooking(page: Page) {
  const client = rpc(page);
  const user = await client.auth.me.query();
  if (!user) throw new Error("Authenticated owner missing");
  const flightId = await fixtureFlight(user.tenantId);
  const existingCodes = await sqlRows<RowDataPacket & { code: string }>(
    "SELECT c.code FROM fare_classes c JOIN flights f ON f.airlineId=c.airlineId WHERE f.id=?",
    [flightId]
  );
  const code = Array.from(
    { length: 36 },
    (_, index) => `Q${index.toString(36).toUpperCase()}`
  ).find(candidate => !existingCodes.some(row => row.code === candidate));
  if (!code) throw new Error("No isolated fixture fare code is available");
  const name = `UI05 fare-only ${randomUUID()}`;
  await sqlRows<RowDataPacket>(
    "INSERT INTO fare_classes (airlineId,code,name,cabinClass,refundable) SELECT airlineId,?,?,'economy',0 FROM flights WHERE id=?",
    [code, name, flightId]
  );
  const [fare] = await sqlRows<RowDataPacket & { id: number }>(
    "SELECT id FROM fare_classes WHERE name=?",
    [name]
  );
  if (!fare) throw new Error("Synthetic fare class missing");
  await sqlRows<RowDataPacket>(
    "INSERT INTO flight_fare_class_inventory (flightId,fareClassId,capacity,availableSeats) VALUES (?,?,10,10)",
    [flightId, fare.id]
  );
  // A deliberately synthetic offer is the input to the actual booking API.
  // Its fare-only price and explicit zero tax/fee lines exist before the booking
  // or checkout. No existing offer, invoice component or collected amount is
  // changed. This exercises cancellation, not real tax-policy certification.
  const offerId = randomUUID();
  const totalAmount = 10000;
  const payload: OfferPayload = {
    version: 1,
    currency: "SAR",
    amountUnit: "minor",
    scope: "airfare",
    fareClassId: fare.id,
    revalidationTerms: {
      code,
      family: null,
      changeable: true,
      changeFee: 0,
    },
    fareLines: [
      {
        type: "adult",
        baseFare: totalAmount,
        tax: 0,
        bookingFee: 0,
        total: totalAmount,
      },
    ],
    passengerTypes: ["adult"],
    policy: {
      name: "ui05:synthetic-fare-only:v1",
      fareMultiplier: 1,
      taxRate: 0,
    },
    baseAmount: totalAmount,
    taxesAndFees: 0,
    totalAmount,
  };
  const digest = offerDigest(payload);
  await sqlRows<RowDataPacket>(
    "INSERT INTO retail_offers (id,flightId,tenantId,userId,channel,cabinClass,payload,digest,totalAmount,expiresAt) SELECT ?,id,tenantId,?,'direct','economy',?,?,?,UTC_TIMESTAMP()+INTERVAL 5 MINUTE FROM flights WHERE id=?",
    [offerId, user.id, JSON.stringify(payload), digest, totalAmount, flightId]
  );
  const booking = await client.bookings.create.mutate({
    flightId,
    cabinClass: "economy",
    fareClassCode: code,
    offerId,
    sessionId: randomUUID(),
    idempotencyKey: randomUUID(),
    passengers: [
      { firstName: "Synthetic", lastName: "FareOnly", type: "adult" },
    ],
  });
  expect(booking.totalAmount).toBe(totalAmount);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT status,paymentStatus,stripePaymentIntentId FROM bookings WHERE id=?",
      [booking.bookingId]
    )
  ).toEqual([
    {
      status: "pending",
      paymentStatus: "pending",
      stripePaymentIntentId: null,
    },
  ]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT paymentIntentId FROM payment_receipts WHERE bookingId=?",
      [booking.bookingId]
    )
  ).toEqual([]);
  const components = await sqlRows<RowDataPacket>(
    "SELECT componentType,amount,currency,policyVersion,sourceReference FROM booking_fare_components WHERE bookingId=? ORDER BY id",
    [booking.bookingId]
  );
  const source = {
    currency: "SAR",
    policyVersion: payload.policy.name,
    sourceReference: offerId,
  };
  expect(components).toEqual([
    { ...source, componentType: "base_fare", amount: totalAmount },
    { ...source, componentType: "tax", amount: 0 },
    { ...source, componentType: "booking_fee", amount: 0 },
  ]);
  return {
    booking,
    flightId,
    fareClassId: fare.id,
    fixture: {
      offerId,
      digest,
      policy: payload.policy,
      componentsBeforePayment: components,
    },
  };
}

test("a paid modification fulfills through the real webhook and displays its single operation receipt", async ({
  page,
}, info) => {
  const { booking, flightId } = await ownedBooking(page, true, undefined, null);
  const client = rpc(page);
  const user = await client.auth.me.query();
  if (!user) throw new Error("Authenticated owner missing");
  const replacementId = await fixtureFlight(user.tenantId, 3);
  await sqlRows<RowDataPacket>(
    "UPDATE flights SET economyPrice=15000 WHERE id=?",
    [replacementId]
  );
  const replacement = await client.flights.getById.query({ id: replacementId });
  if (!replacement) throw new Error("Replacement fixture missing");
  await page.goto(`/my-bookings?exchange=${booking.bookingId}`);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("New departure date")
    .fill(replacement.departureTime.toISOString().slice(0, 10));
  await dialog
    .getByRole("button", { name: new RegExp(replacement.flightNumber) })
    .click();
  await dialog
    .getByRole("button", { name: "Quote change", exact: true })
    .click();
  const accept = dialog.getByRole("button", {
    name: "Accept this quote",
    exact: true,
  });
  await expect(accept).toBeDisabled();
  const quote = (
    await client.modifications.exchangeContext.query({
      bookingId: booking.bookingId,
    })
  ).latest;
  if (!quote) throw new Error("Actual modification quote missing");
  expect(quote.status).toBe("pending");
  expect(quote.totalCost).toBeGreaterThan(0);
  await dialog
    .getByLabel("I accept this itinerary change", { exact: false })
    .check();
  await accept.click();
  const paid = await completePayment(page, {
    type: "modification",
    bookingId: booking.bookingId,
    amount: quote.totalCost,
    modificationId: quote.modificationId,
  });
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Exchange completed"
  );
  const completed = (
    await client.modifications.exchangeContext.query({
      bookingId: booking.bookingId,
    })
  ).latest;
  expect(completed?.status).toBe("completed");
  expect(completed?.receiptId).toBeTruthy();
  await expect(
    page.getByRole("dialog").getByText(completed!.receiptId!, { exact: true })
  ).toBeVisible();
  async function persisted() {
    return {
      booking: await sqlRows<RowDataPacket>(
        "SELECT flightId, totalAmount, status, seatsReserved FROM bookings WHERE id=?",
        [booking.bookingId]
      ),
      flights: await sqlRows<RowDataPacket>(
        "SELECT id, economyAvailable FROM flights WHERE id IN (?, ?) ORDER BY id",
        [flightId, replacementId]
      ),
      changes: await sqlRows<RowDataPacket>(
        "SELECT id, status, paymentStatus, executionEventId, stripePaymentIntentId FROM booking_modifications WHERE bookingId=?",
        [booking.bookingId]
      ),
      charges: await sqlRows<RowDataPacket>(
        "SELECT id, amount, stripePaymentIntentId FROM financial_ledger WHERE bookingId=? AND stripePaymentIntentId=? AND type='charge'",
        [booking.bookingId, paid.payment_intent]
      ),
      applied: await sqlRows<RowDataPacket>(
        "SELECT eventId FROM outbox WHERE aggregateType='booking' AND aggregateId=? AND eventType='order.servicing_applied'",
        [String(booking.bookingId)]
      ),
    };
  }
  const after = await persisted();
  expect(after.booking).toEqual([
    {
      flightId: replacementId,
      totalAmount: quote.newAmount,
      status: "confirmed",
      seatsReserved: 1,
    },
  ]);
  expect(after.flights).toEqual([
    { id: flightId, economyAvailable: 10 },
    { id: replacementId, economyAvailable: 9 },
  ]);
  expect(after.changes).toEqual([
    {
      id: quote.modificationId,
      status: "completed",
      paymentStatus: "paid",
      executionEventId: completed!.receiptId,
      stripePaymentIntentId: paid.payment_intent,
    },
  ]);
  expect(after.charges).toHaveLength(1);
  expect(after.charges[0].amount).toBe(minor(quote.totalCost));
  expect(after.applied).toEqual([{ eventId: completed!.receiptId }]);
  const replay = await page.request.post(
    `${await providerOrigin()}/__fixture/replay/${paid.id}`
  );
  expect(replay.status()).toBe(200);
  await page.reload();
  // MyBookings consumes ?exchange on first open; reopen through the real action.
  await bookingCard(page, booking.bookingReference)
    .getByRole("button", { name: "Modify", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText(completed!.receiptId!, { exact: true })
  ).toBeVisible();
  expect(await persisted()).toEqual(after);
  await evidence(info, {
    bookingId: booking.bookingId,
    quote,
    completed,
    paid,
    persisted: after,
  });
});

test("cash cancellation displays the retained fee and the native refund receipt without losing the dialog", async ({
  page,
}, info) => {
  const { booking, flightId, paid, client } = await cashBooking(page);
  const fee = await client.refunds.calculateCancellationFee.query({
    bookingId: booking.bookingId,
  });
  expect(fee).toMatchObject({
    totalAmount: booking.totalAmount,
    tier: "medium",
    refundPercentage: 50,
  });
  expect(fee.refundAmount).toBe(Math.round(booking.totalAmount / 2));
  expect(fee.cancellationFee + fee.refundAmount).toBe(booking.totalAmount);
  const dialog = await cancelDialog(page, booking.bookingReference);
  await expect(
    dialog.getByText("Cancellation Fee (50%):", { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText(`-${minor(fee.cancellationFee)} SAR`, { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText(`${minor(fee.refundAmount)} SAR`, { exact: true })
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirm Cancellation", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Refund receipt", exact: true })
  ).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("Refund confirmed");
  const refunds = (await providerState(page)).refunds.filter(
    r => r.payment_intent === paid.payment_intent
  );
  expect(refunds).toHaveLength(1);
  const refund = refunds[0];
  expect(refund.amount).toBe(fee.refundAmount);
  await expect(dialog.getByText(refund.id, { exact: true })).toBeVisible();
  await displayedDefinition(
    dialog,
    "Refund Amount:",
    `${minor(fee.refundAmount)} SAR`
  );
  const detail = await client.refunds.getDetails.query({ refundId: refund.id });
  expect(detail).toMatchObject({
    id: refund.id,
    amount: fee.refundAmount,
    status: "succeeded",
  });
  const receipt = await sqlRows<RowDataPacket>(
    "SELECT amount, refundedAmount, settlementStatus FROM payment_receipts WHERE paymentIntentId=?",
    [paid.payment_intent]
  );
  expect(receipt).toEqual([
    {
      amount: booking.totalAmount,
      refundedAmount: fee.refundAmount,
      settlementStatus: "applied",
    },
  ]);
  const posting = await sqlRows<RowDataPacket>(
    "SELECT type, amount FROM financial_ledger WHERE bookingId=? AND type IN ('refund','partial_refund')",
    [booking.bookingId]
  );
  expect(posting).toEqual([
    { type: "partial_refund", amount: minor(fee.refundAmount) },
  ]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT status, seatsReserved FROM bookings WHERE id=?",
      [booking.bookingId]
    )
  ).toEqual([{ status: "cancelled", seatsReserved: 0 }]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT economyAvailable FROM flights WHERE id=?",
      [flightId]
    )
  ).toEqual([{ economyAvailable: 10 }]);
  await dialog
    .getByRole("button", { name: "Close receipt", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await evidence(info, {
    bookingId: booking.bookingId,
    paid,
    fee,
    refund,
    detail,
    receipt,
    posting,
  });
});

test("a fare-only nonrefundable booking requires explicit consent and retains a zero-refund receipt after reload", async ({
  page,
}, info) => {
  const { booking, flightId, fareClassId, fixture } =
    await fareOnlyBooking(page);
  const client = rpc(page);
  await page.goto(`/checkout/${booking.bookingId}`);
  await page
    .getByRole("button", { name: "Continue payment", exact: true })
    .click();
  const paid = await completePayment(page, {
    type: "booking",
    bookingId: booking.bookingId,
    amount: booking.totalAmount,
  });
  const quote = await client.refunds.calculateCancellationFee.query({
    bookingId: booking.bookingId,
  });
  expect(quote).toMatchObject({
    refundAmount: 0,
    cancellationFee: booking.totalAmount,
    policyReason: "nonrefundable_fare",
  });
  const dialog = await cancelDialog(page, booking.bookingReference);
  await expect(
    dialog.getByText("Cancellation without a refund", { exact: true })
  ).toBeVisible();
  const confirm = dialog.getByRole("button", {
    name: "Confirm Cancellation",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await dialog
    .getByRole("checkbox", {
      name: "I understand that I will receive no refund and want to cancel this booking.",
      exact: true,
    })
    .check();
  await confirm.click();
  await expect(
    dialog.getByRole("heading", { name: "Cancellation receipt", exact: true })
  ).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText(
    "Booking cancelled. No refund was issued."
  );
  await displayedDefinition(dialog, "Refund Amount:", "0.00 SAR");
  await displayedDefinition(
    dialog,
    "Retained cancellation fee:",
    `${minor(booking.totalAmount)} SAR`
  );
  const receipt = await client.refunds.cancellationReceipt.query({
    bookingId: booking.bookingId,
  });
  expect(receipt).toMatchObject({
    refundAmount: 0,
    totalAmount: booking.totalAmount,
    cancellationFee: booking.totalAmount,
    status: "cancelled_without_refund",
  });
  await expect(
    dialog.getByText(receipt!.cancellationId, { exact: true })
  ).toBeVisible();
  expect(
    (await providerState(page)).refunds.filter(
      r => r.payment_intent === paid.payment_intent
    )
  ).toEqual([]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT status,paymentStatus,seatsReserved FROM bookings WHERE id=?",
      [booking.bookingId]
    )
  ).toEqual([{ status: "cancelled", paymentStatus: "paid", seatsReserved: 0 }]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT refundedAmount FROM payment_receipts WHERE paymentIntentId=?",
      [paid.payment_intent]
    )
  ).toEqual([{ refundedAmount: 0 }]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT amount FROM financial_ledger WHERE bookingId=? AND type IN ('refund','partial_refund')",
      [booking.bookingId]
    )
  ).toEqual([]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT economyAvailable FROM flights WHERE id=?",
      [flightId]
    )
  ).toEqual([{ economyAvailable: 10 }]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT availableSeats FROM flight_fare_class_inventory WHERE flightId=? AND fareClassId=?",
      [flightId, fareClassId]
    )
  ).toEqual([{ availableSeats: 10 }]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT componentType,amount,currency,policyVersion,sourceReference FROM booking_fare_components WHERE bookingId=? ORDER BY id",
      [booking.bookingId]
    )
  ).toEqual(fixture.componentsBeforePayment);
  await dialog
    .getByRole("button", { name: "Close receipt", exact: true })
    .click();
  const reopened = await cancelDialog(page, booking.bookingReference, true);
  await expect(
    reopened.getByText(receipt!.cancellationId, { exact: true })
  ).toBeVisible();
  await expect(reopened.getByRole("status")).toHaveText(
    "Booking cancelled. No refund was issued."
  );
  await expect(
    reopened.getByRole("button", { name: "Confirm Cancellation", exact: true })
  ).toHaveCount(0);
  expect(
    (await providerState(page)).refunds.filter(
      r => r.payment_intent === paid.payment_intent
    )
  ).toEqual([]);
  await evidence(info, {
    bookingId: booking.bookingId,
    quote,
    receipt,
    paid,
    fixture,
    declaredFareScope:
      "synthetic_fare_only_no_separately_recorded_tax_or_services",
  });
});

test("a native nonrefundable departure refuses cancellation without a provider refund or financial effect", async ({
  page,
}, info) => {
  const { booking, flightId, paid, client } = await cashBooking(page);
  // Deliberate fixture state: this funded departure has recorded final DCS
  // closure. A past schedule alone is not authoritative closure. No refund,
  // cancellation, ledger posting or provider response is seeded or substituted.
  await sqlRows<RowDataPacket>(
    "UPDATE flights SET departureTime=UTC_TIMESTAMP() - INTERVAL 2 HOUR, arrivalTime=UTC_TIMESTAMP() - INTERVAL 1 HOUR, dcsClosedAt=UTC_TIMESTAMP() - INTERVAL 2 HOUR WHERE id=?",
    [flightId]
  );
  const check = await client.refunds.checkRefundable.query({
    bookingId: booking.bookingId,
  });
  expect(check.refundable).toBe(false);
  expect(check.reason).toMatch(/depart/i);
  const dialog = await cancelDialog(page, booking.bookingReference);
  await expect(
    dialog.getByText("This booking cannot be cancelled", { exact: true })
  ).toBeVisible();
  await expect(dialog.getByText(check.reason!, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm Cancellation", exact: true })
  ).toHaveCount(0);
  expect(
    (await providerState(page)).refunds.filter(
      r => r.payment_intent === paid.payment_intent
    )
  ).toEqual([]);
  const receipt = await sqlRows<RowDataPacket>(
    "SELECT amount, refundedAmount FROM payment_receipts WHERE paymentIntentId=?",
    [paid.payment_intent]
  );
  expect(receipt).toEqual([{ amount: booking.totalAmount, refundedAmount: 0 }]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT id FROM financial_ledger WHERE bookingId=? AND type IN ('refund','partial_refund')",
      [booking.bookingId]
    )
  ).toEqual([]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT status, paymentStatus, seatsReserved FROM bookings WHERE id=?",
      [booking.bookingId]
    )
  ).toEqual([{ status: "confirmed", paymentStatus: "paid", seatsReserved: 1 }]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT economyAvailable FROM flights WHERE id=?",
      [flightId]
    )
  ).toEqual([{ economyAvailable: 9 }]);
  await evidence(info, {
    bookingId: booking.bookingId,
    fixtureState: "funded departure with explicitly recorded final DCS closure",
    paid,
    check,
    receipt,
  });
});

test("split cancellation fulfills both original payers and preserves fees and operation receipts after reload", async ({
  page,
}, info) => {
  const { booking, flightId } = await ownedBooking(
    page,
    false,
    undefined,
    null
  );
  const client = rpc(page);
  const firstAmount = Math.floor(booking.totalAmount * 0.4);
  const payers = [
    {
      name: "UI05 First payer",
      email: "ui05-first@example.test",
      amount: firstAmount,
    },
    {
      name: "UI05 Second payer",
      email: "ui05-second@example.test",
      amount: booking.totalAmount - firstAmount,
    },
  ];
  const { splitIds } = await client.splitPayments.initiate.mutate({
    bookingId: booking.bookingId,
    expirationDays: 1,
    splits: payers,
  });
  expect(splitIds).toHaveLength(2);
  const paidShares: Awaited<ReturnType<typeof completePayment>>[] = [];
  for (const [index, splitId] of splitIds.entries()) {
    // Only read the native, opaque payer capability; never include it in artifacts.
    const [split] = await sqlRows<RowDataPacket & { paymentToken: string }>(
      "SELECT paymentToken FROM payment_splits WHERE id=? AND bookingId=?",
      [splitId, booking.bookingId]
    );
    await page.goto(`/pay/${split.paymentToken}`);
    await page.getByRole("button", { name: /Pay Now/ }).click();
    paidShares.push(
      await completePayment(page, {
        type: "split_payment",
        bookingId: booking.bookingId,
        splitId,
        amount: payers[index].amount,
      })
    );
    await expect(
      page.getByRole("heading", { name: "Payment Complete!", exact: true })
    ).toBeVisible();
  }
  expect(
    await client.splitPayments.getStatus.query({ bookingId: booking.bookingId })
  ).toMatchObject({ allPaid: true, paidCount: 2 });
  const before = await client.refunds.splitCancellation.query({
    bookingId: booking.bookingId,
  });
  expect(before.splitFunded).toBe(true);
  const quote = before.quote;
  if (!quote) throw new Error("Native split cancellation quote missing");
  expect(quote.refundPercentage).toBe(50);
  expect(quote.refundAmount).toBe(Math.round(booking.totalAmount / 2));
  expect(quote.cancellationFee + quote.refundAmount).toBe(booking.totalAmount);
  expect(quote.items.reduce((sum, item) => sum + item.refundAmount, 0)).toBe(
    quote.refundAmount
  );
  const dialog = await cancelDialog(page, booking.bookingReference);
  await displayedDefinition(
    dialog,
    "Retained cancellation fee:",
    `${minor(quote.cancellationFee)} SAR`
  );
  await displayedDefinition(
    dialog,
    "Refund Amount:",
    `${minor(quote.refundAmount)} SAR`
  );
  for (const item of quote.items) {
    const row = dialog.getByRole("row", { name: new RegExp(item.payerName) });
    await expect(
      row.getByRole("cell", { name: minor(item.paidAmount), exact: true })
    ).toBeVisible();
    await expect(
      row.getByRole("cell", { name: minor(item.refundAmount), exact: true })
    ).toBeVisible();
  }
  await dialog
    .getByRole("button", { name: "Confirm Cancellation", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Booking cancelled; payer refunds are processing."
  );
  const reserved = (
    await client.refunds.splitCancellation.query({
      bookingId: booking.bookingId,
    })
  ).plan;
  if (!reserved) throw new Error("Native split cancellation receipt missing");
  await expect(dialog.getByText(reserved.id, { exact: true })).toBeVisible();
  for (const payer of payers) {
    const row = dialog.getByRole("row", { name: new RegExp(payer.name) });
    const [resumed] = await Promise.all([
      page.waitForResponse(
        response =>
          new URL(response.url()).pathname.includes(
            "/api/trpc/refunds.resumeSplitCancellation"
          ) && response.request().method() === "POST"
      ),
      row.getByRole("button", { name: "Check / resume", exact: true }).click(),
    ]);
    expect(
      resumed.status(),
      "Payer resume must succeed before its UI receipt is expected"
    ).toBe(200);
    await expect(
      row.getByText("Refund confirmed", { exact: true })
    ).toBeVisible();
  }
  await expect(dialog.getByRole("status")).toHaveText(
    "All planned refunds are confirmed. The cancellation fee is retained."
  );
  const completed = (
    await client.refunds.splitCancellation.query({
      bookingId: booking.bookingId,
    })
  ).plan;
  expect(completed).toMatchObject({
    id: reserved.id,
    status: "completed",
    refundAmount: quote.refundAmount,
    cancellationFee: quote.cancellationFee,
  });
  const provider = await providerState(page);
  for (const item of completed!.items) {
    expect(item.status).toBe("succeeded");
    expect(item.refundedAmount).toBe(item.refundAmount);
    const row = dialog.getByRole("row", { name: new RegExp(item.payerName) });
    await expect(row.getByText(item.refundId!, { exact: true })).toBeVisible();
    const paid = paidShares.find(
      s => s.metadata.splitId === String(item.splitId)
    )!;
    const refunds = provider.refunds.filter(
      r => r.payment_intent === paid.payment_intent
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      id: item.refundId,
      amount: item.refundAmount,
      status: "succeeded",
      metadata: { planId: completed!.id, splitId: String(item.splitId) },
    });
  }
  async function persisted() {
    return {
      plans: await sqlRows<RowDataPacket>(
        "SELECT id, status, totalAmount, cancellationFee, refundAmount FROM booking_refund_plans WHERE bookingId=?",
        [booking.bookingId]
      ),
      items: await sqlRows<RowDataPacket>(
        "SELECT splitId, status, refundId, refundAmount FROM booking_refund_items WHERE bookingId=? ORDER BY splitId",
        [booking.bookingId]
      ),
      receipts: await sqlRows<RowDataPacket>(
        "SELECT targetId, amount, refundedAmount, settlementStatus FROM payment_receipts WHERE bookingId=? ORDER BY targetId",
        [booking.bookingId]
      ),
      refunds: await sqlRows<RowDataPacket>(
        "SELECT id, amount, stripePaymentIntentId FROM financial_ledger WHERE bookingId=? AND type IN ('refund','partial_refund') ORDER BY id",
        [booking.bookingId]
      ),
    };
  }
  const after = await persisted();
  expect(after.plans).toEqual([
    {
      id: completed!.id,
      status: "completed",
      totalAmount: booking.totalAmount,
      cancellationFee: quote.cancellationFee,
      refundAmount: quote.refundAmount,
    },
  ]);
  expect(after.items).toEqual(
    completed!.items
      .map(item => ({
        splitId: item.splitId,
        status: "succeeded",
        refundId: item.refundId,
        refundAmount: item.refundAmount,
      }))
      .sort((a, b) => a.splitId - b.splitId)
  );
  expect(after.receipts).toEqual(
    completed!.items
      .map(item => ({
        targetId: item.splitId,
        amount: item.paidAmount,
        refundedAmount: item.refundAmount,
        settlementStatus: "applied",
      }))
      .sort((a, b) => a.targetId - b.targetId)
  );
  expect(after.refunds).toHaveLength(2);
  expect(
    after.refunds.reduce(
      (sum, row) => sum + Math.round(Number(row.amount) * 100),
      0
    )
  ).toBe(quote.refundAmount);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT status, seatsReserved FROM bookings WHERE id=?",
      [booking.bookingId]
    )
  ).toEqual([{ status: "cancelled", seatsReserved: 0 }]);
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT economyAvailable FROM flights WHERE id=?",
      [flightId]
    )
  ).toEqual([{ economyAvailable: 10 }]);
  await page.reload();
  const reopened = await cancelDialog(page, booking.bookingReference, true);
  await expect(
    reopened.getByText(completed!.id, { exact: true })
  ).toBeVisible();
  for (const item of completed!.items)
    await expect(
      reopened.getByText(item.refundId!, { exact: true })
    ).toBeVisible();
  expect(await persisted()).toEqual(after);
  expect(
    (await providerState(page)).refunds.filter(r =>
      paidShares.some(s => s.payment_intent === r.payment_intent)
    )
  ).toHaveLength(2);
  await evidence(info, {
    bookingId: booking.bookingId,
    paidShares,
    quote,
    completed,
    persisted: after,
  });
});
