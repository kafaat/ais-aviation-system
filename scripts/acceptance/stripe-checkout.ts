/** Explicit provider acceptance; uses only a disposable database and Stripe test-mode money. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import {
  sandboxConfigurationIssues,
  verifyCapturedTestPayment,
} from "./stripe-sandbox-contract.ts";

const reportPath = process.argv[2];
assert(reportPath, "Pass an acceptance evidence JSON path");
const checks: string[] = [];
const evidence = {
  sourceSha: process.env.GITHUB_SHA ?? null,
  generatedAt: new Date().toISOString(),
  runId: randomUUID(),
  result: "BLOCKED" as "BLOCKED" | "NOT_RUN" | "RUNNING" | "PASS" | "FAIL",
  passed: false,
  phase: "preflight",
  prerequisites: sandboxConfigurationIssues(process.env),
  checks,
  providerObjects: [] as { kind: string; id: string }[],
  failureClass: null as string | null,
  scope:
    "Stripe test-mode checkout creation/expiry; directly retrieved card captures for two shares of a frozen invoice; partial and full original-payer refunds; idempotent capture replay and simulated lost refund acknowledgement recovered from real provider history",
  notExercised: [
    "exchange_quoting",
    "hosted_checkout_completion",
    "provider_webhook_delivery",
    "3ds",
    "chargeback",
    "production",
  ],
};
async function saveEvidence() {
  await writeFile(reportPath, JSON.stringify(evidence, null, 2), {
    mode: 0o600,
  });
}
async function remember(kind: string, id: string) {
  if (!evidence.providerObjects.some(o => o.kind === kind && o.id === id))
    evidence.providerObjects.push({ kind, id });
  await saveEvidence();
}
let closeDatabase: (() => Promise<void>) | undefined;
async function run() {
  await saveEvidence();
  if (evidence.prerequisites.length) {
    console.error(evidence.prerequisites.join("; "));
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--preflight")) {
    evidence.result = "NOT_RUN";
    return;
  }
  evidence.result = "RUNNING";
  evidence.phase = "database_setup";
  const { eq, and } = await import("drizzle-orm");
  const schema = await import("../../drizzle/schema");
  const { getDb, closePool } = await import("../../server/db");
  closeDatabase = closePool;
  const { stripe } = await import("../../server/stripe");
  const { createBookingCheckout, expireBookingCheckout } =
    await import("../../server/services/booking-checkout.service");
  const { reserveSplitCheckout } =
    await import("../../server/services/split-checkout.service");
  const { settleVerifiedPayment } =
    await import("../../server/services/payment-settlement.service");
  const {
    planOrderRefund,
    processPendingOrderRefunds,
    recordVerifiedOrderRefund,
  } = await import("../../server/services/order-refunds.service");
  const {
    requestFlightCancellation,
    processFlightCancellations,
    getFlightCancellationStatus,
  } = await import("../../server/services/flight-cancellation.service");
  const database = getDb();
  assert(database);
  const db = database;
  const id = 993001;
  for (const table of [
    schema.users,
    schema.bookings,
    schema.bookingCheckoutRequests,
  ])
    assert.equal(
      (await db.select().from(table).limit(1)).length,
      0,
      "Use an empty disposable acceptance database"
    );
  await db
    .insert(schema.users)
    .values({ id, openId: `stripe-acceptance-${randomUUID()}`, role: "user" });
  await db
    .insert(schema.airlines)
    .values({ id, code: "ZT", name: "Synthetic acceptance" });
  await db.insert(schema.airports).values([
    { id, code: "ZTA", name: "Synthetic A", city: "Test", country: "Test" },
    {
      id: id + 1,
      code: "ZTB",
      name: "Synthetic B",
      city: "Test",
      country: "Test",
    },
  ]);
  await db.insert(schema.flights).values({
    id,
    airlineId: id,
    flightNumber: "ZT100",
    originId: id,
    destinationId: id + 1,
    departureTime: new Date(Date.now() + 30 * 86400000),
    arrivalTime: new Date(Date.now() + 30 * 86400000 + 7200000),
    economyAvailable: 10,
    economySeats: 100,
    businessSeats: 10,
    businessAvailable: 10,
    economyPrice: 10000,
    businessPrice: 20000,
  });
  const [created] = await db.insert(schema.bookings).values({
    userId: id,
    flightId: id,
    bookingReference: "STEST1",
    pnr: "STEST2",
    totalAmount: 10000,
    numberOfPassengers: 1,
    cabinClass: "economy",
    status: "pending",
  });
  const bookingId = created.insertId;
  const owner = {
    bookingId,
    userId: id,
    appBaseUrl: "https://example.invalid",
  };
  evidence.phase = "checkout_session";
  const first = await createBookingCheckout(owner);
  await remember("checkout_session", first.sessionId);
  const [claim] = await db
    .select()
    .from(schema.bookingCheckoutRequests)
    .where(eq(schema.bookingCheckoutRequests.bookingId, bookingId));
  const session = await stripe.checkout.sessions.retrieve(first.sessionId);
  assert.equal(session.livemode, false);
  assert.equal(session.amount_total, 10000);
  assert.equal(session.currency, "sar");
  assert.equal(session.metadata?.checkoutRequestId, claim.requestId);
  assert.equal(session.metadata?.invoiceHash, claim.invoiceHash);
  checks.push(
    "Stripe test session binds stored invoice amount currency owner and request identity"
  );
  const retry = await createBookingCheckout(owner);
  assert.deepEqual(retry, first);
  checks.push("Retry returns the existing provider session");
  await assert.rejects(createBookingCheckout({ ...owner, userId: id + 1 }));
  checks.push("Foreign user cannot recover a checkout session");
  await expireBookingCheckout(bookingId, id);
  const expired = await stripe.checkout.sessions.retrieve(first.sessionId);
  assert.equal(expired.status, "expired");
  assert.equal(expired.payment_status, "unpaid");
  assert.equal(
    (
      await db
        .select()
        .from(schema.bookingCheckoutRequests)
        .where(eq(schema.bookingCheckoutRequests.bookingId, bookingId))
    )[0].status,
    "expired"
  );
  checks.push("Provider-confirmed unpaid expiry unlocks the durable claim");

  evidence.phase = "split_invoice_capture";
  const [splitBookingRow] = await db.insert(schema.bookings).values({
    userId: id,
    flightId: id,
    bookingReference: "STEST3",
    pnr: "STEST4",
    totalAmount: 10000,
    numberOfPassengers: 1,
    cabinClass: "economy",
    status: "pending",
  });
  const splitBookingId = splitBookingRow.insertId;
  const splitTokens = [
    randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
  ];
  await db.insert(schema.paymentSplits).values(
    splitTokens.map((token, i) => ({
      bookingId: splitBookingId,
      payerEmail: `payer${i + 1}@example.invalid`,
      payerName: `Synthetic payer ${i + 1}`,
      amount: i === 0 ? 4000 : 6000,
      percentage: i === 0 ? "40" : "60",
      paymentToken: token,
      status: "pending" as const,
    }))
  );
  const intents: string[] = [];
  const requestOptions = { timeout: 15000, maxNetworkRetries: 0 };
  for (const [index, token] of splitTokens.entries()) {
    // This is the capture/settlement adapter contract, not a hosted Checkout completion.
    const claim = await reserveSplitCheckout(token);
    const request = JSON.parse(
      claim.requestPayload
    ) as Stripe.Checkout.SessionCreateParams;
    const amount = request.line_items?.[0].price_data?.unit_amount;
    assert(typeof amount === "number");
    const metadata: Record<string, string> = {};
    assert(request.metadata);
    for (const [key, value] of Object.entries(request.metadata)) {
      assert(typeof value === "string");
      metadata[key] = value;
    }
    const params: Stripe.PaymentIntentCreateParams = {
      amount,
      currency: "sar",
      metadata,
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      confirm: true,
    };
    const options = {
      ...requestOptions,
      idempotencyKey: `sandbox-capture:${evidence.runId}:${claim.splitId}`,
    };
    const payment = await stripe.paymentIntents.create(params, options);
    await remember("payment_intent", payment.id);
    const replay = await stripe.paymentIntents.create(params, options);
    assert.equal(
      replay.id,
      payment.id,
      "Provider created another charge on identical retry"
    );
    const retrieved = await stripe.paymentIntents.retrieve(
      payment.id,
      {},
      requestOptions
    );
    const verified = verifyCapturedTestPayment(retrieved, { amount, metadata });
    await db.transaction(tx => settleVerifiedPayment(tx, verified));
    await db.transaction(tx => settleVerifiedPayment(tx, verified));
    intents.push(payment.id);
    const [current] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, splitBookingId));
    assert.equal(current.paymentStatus, index === 0 ? "pending" : "paid");
    assert.equal(current.seatsReserved, index !== 0);
  }
  const receipts = () =>
    db
      .select()
      .from(schema.paymentReceipts)
      .where(eq(schema.paymentReceipts.bookingId, splitBookingId));
  assert.equal((await receipts()).length, 2);
  const [fundedFlight] = await db
    .select()
    .from(schema.flights)
    .where(eq(schema.flights.id, id));
  assert.equal(fundedFlight.economyAvailable, 9);
  checks.push(
    "Two real test captures settle the frozen split invoices once and reserve seats only after full funding"
  );

  // Seed the completed exchange input; this scope tests the real refund adapter, not exchange quoting.
  evidence.phase = "partial_original_payer_refund";
  await db.transaction(async tx => {
    const [funded] = await tx
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, splitBookingId))
      .for("update");
    const [modification] = await tx.insert(schema.bookingModifications).values({
      bookingId: splitBookingId,
      userId: id,
      modificationType: "change_flight",
      originalFlightId: id,
      newFlightId: id,
      originalAmount: 10000,
      newAmount: 7500,
      priceDifference: -2500,
      totalCost: -2500,
      status: "completed",
      reason: "Synthetic exchange refund acceptance",
    });
    await planOrderRefund(tx, funded, modification.insertId, 2500);
    await tx
      .update(schema.bookings)
      .set({ totalAmount: 7500 })
      .where(eq(schema.bookings.id, splitBookingId));
  });
  const [lostAcknowledgement] = await db
    .select()
    .from(schema.orderServiceRefunds)
    .where(eq(schema.orderServiceRefunds.bookingId, splitBookingId))
    .orderBy(schema.orderServiceRefunds.paymentIntentId);
  assert(lostAcknowledgement);
  const externalRefund = await stripe.refunds.create(
    {
      payment_intent: lostAcknowledgement.paymentIntentId,
      amount: lostAcknowledgement.amount,
      metadata: {
        orderServiceRefundId: lostAcknowledgement.id,
        modificationId: String(lostAcknowledgement.modificationId),
      },
    },
    {
      ...requestOptions,
      idempotencyKey: `order-refund:${lostAcknowledgement.id}`,
    }
  );
  await remember("refund", externalRefund.id);
  // Intentionally withhold the local acknowledgement. The normal worker must recover it from Stripe history.
  await processPendingOrderRefunds();
  async function verifyRefunds() {
    for (let attempt = 0; attempt < 6; attempt++) {
      const items = await db
        .select()
        .from(schema.orderServiceRefunds)
        .where(eq(schema.orderServiceRefunds.bookingId, splitBookingId));
      for (const item of items) {
        assert(
          item.refundId,
          `Refund request has no provider acknowledgement: ${item.id}`
        );
        const refund = await stripe.refunds.retrieve(
          item.refundId,
          {},
          requestOptions
        );
        await remember("refund", refund.id);
        await db.transaction(tx =>
          recordVerifiedOrderRefund(
            tx,
            refund,
            `sandbox_direct_refund:${refund.id}`
          )
        );
        await db.transaction(tx =>
          recordVerifiedOrderRefund(
            tx,
            refund,
            `sandbox_direct_refund_replay:${refund.id}`
          )
        );
      }
      const refreshed = await db
        .select()
        .from(schema.orderServiceRefunds)
        .where(eq(schema.orderServiceRefunds.bookingId, splitBookingId));
      if (refreshed.every(i => i.status === "succeeded")) return;
      assert(
        !refreshed.some(
          i => i.status === "failed" || i.status === "review_required"
        ),
        "Provider refund requires review"
      );
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(
      "Provider refund has not reached a successful terminal state"
    );
  }
  await verifyRefunds();
  const partial = await receipts();
  assert.deepEqual(
    partial.map(r => r.refundedAmount).sort((a, b) => a - b),
    [1000, 1500]
  );
  const [recovered] = await db
    .select()
    .from(schema.orderServiceRefunds)
    .where(eq(schema.orderServiceRefunds.id, lostAcknowledgement.id));
  assert.equal(recovered.refundId, externalRefund.id);
  checks.push(
    "Partial refunds return 1000/1500 minor units to original 4000/6000 payers; real history recovers a simulated lost acknowledgement"
  );

  evidence.phase = "full_original_payer_refund";
  await requestFlightCancellation({
    flightId: id,
    actorId: id,
    reason: "Synthetic sandbox cancellation acceptance",
  });
  await processFlightCancellations();
  await verifyRefunds();
  await processFlightCancellations();
  await processFlightCancellations();
  const finished = await receipts();
  assert(finished.every(r => r.refundedAmount === r.amount));
  assert.equal(
    finished.reduce((n, r) => n + r.refundedAmount, 0),
    10000
  );
  assert.equal((await getFlightCancellationStatus(id)).refundedBookings, 1);
  const [cancelled] = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.id, splitBookingId));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.paymentStatus, "refunded");
  const [restoredFlight] = await db
    .select()
    .from(schema.flights)
    .where(eq(schema.flights.id, id));
  assert.equal(restoredFlight.economyAvailable, 10);
  const refundLedger = await db
    .select()
    .from(schema.financialLedger)
    .where(
      and(
        eq(schema.financialLedger.bookingId, splitBookingId),
        // Collection and refund entries are separate immutable facts.
        eq(schema.financialLedger.description, "Verified refund delta")
      )
    );
  assert.equal(refundLedger.length, 4);
  for (const intent of intents) {
    const actual = await stripe.refunds.list(
      { payment_intent: intent, limit: 100 },
      requestOptions
    );
    assert.equal(actual.has_more, false);
    assert.equal(
      actual.data.length,
      2,
      "Retry created duplicate original-payer refunds"
    );
    assert(actual.data.every(r => r.status === "succeeded"));
  }
  checks.push(
    "Flight cancellation refunds the remaining 7500 minor units; retries create no extra refunds or ledger entries and release the seat once"
  );
  evidence.result = "PASS";
  evidence.passed = true;
  evidence.phase = "complete";
}
try {
  await run();
} catch (error) {
  evidence.result = "FAIL";
  evidence.failureClass = error instanceof Error ? error.name : "UnknownError";
  process.exitCode = 1;
  // Provider errors may carry request or customer details; retain only safe identities and the failed phase.
  console.error(
    `Stripe sandbox acceptance failed during ${evidence.phase}; inspect the redacted evidence and provider request history.`
  );
} finally {
  try {
    await saveEvidence();
    console.info(JSON.stringify(evidence));
  } finally {
    if (closeDatabase) {
      await closeDatabase();
      const { cacheService } =
        await import("../../server/services/cache.service");
      const { redisCacheService } =
        await import("../../server/services/redis-cache.service");
      await Promise.all([
        cacheService.disconnect(),
        redisCacheService.shutdown(),
      ]);
    }
  }
}
