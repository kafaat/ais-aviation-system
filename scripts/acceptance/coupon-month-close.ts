import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import { settleVerifiedPayment } from "../../server/services/payment-settlement.service";
import { readTicketDocument } from "../../server/services/ticket-documents.service";
import { bookingsRouter } from "../../server/routers/bookings";
import { ndcRouter } from "../../server/routers/ndc";
import { aviationIntegrationsRouter } from "../../server/routers/aviation-integrations";
import { revenueAccountingRouter } from "../../server/routers/revenue-accounting";
import { calculateRequestHash } from "../../server/services/idempotency-v2.service";
import { postLoyaltyAllocation } from "../../server/services/loyalty-liability-ledger.service";
import { reviewCouponMonth } from "../../server/services/coupon-month-review";

export async function verifyCouponMonthClose(
  db: SettlementTx,
  ctx: TrpcContext,
  tenantId: number
) {
  assert(ctx.user);
  const now = new Date(),
    month = now.toISOString().slice(0, 7);
  const afterClose = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 1)
  );
  const before = new Date(now.getTime() - 3600_000);
  const [flight] = await db.insert(s.flights).values({
    flightNumber: "ZY9100",
    airlineId: tenantId,
    tenantId,
    originId: tenantId,
    destinationId: tenantId + 1,
    departureTime: before,
    arrivalTime: before,
    status: "completed",
    economySeats: 2,
    businessSeats: 0,
    economyPrice: 10000,
    businessPrice: 20000,
    economyAvailable: 0,
    businessAvailable: 0,
  });
  const flightId = flight.insertId;
  const [booking] = await db.insert(s.bookings).values({
    tenantId,
    userId: ctx.user.id,
    flightId,
    bookingReference: "MTH001",
    pnr: "MTH001",
    cabinClass: "economy",
    numberOfPassengers: 2,
    status: "confirmed",
    paymentStatus: "paid",
    totalAmount: 15000,
  });
  const bookingId = booking.insertId;
  const inserted = await db
    .insert(s.passengers)
    .values(
      ["Alpha", "Beta"].map(lastName => ({
        tenantId,
        bookingId,
        firstName: "Synthetic",
        lastName,
      }))
    )
    .$returningId();
  const [p1, p2] = inserted.map(p => p.id);
  const docs = await db
    .insert(s.ticketCoupons)
    .values([
      {
        bookingId,
        flightId,
        passengerId: p1,
        ticketNumber: "0000000099001",
        couponNumber: 1,
        status: "C",
      },
      {
        bookingId,
        flightId,
        passengerId: p2,
        ticketNumber: "0000000099002",
        couponNumber: 1,
        status: "O",
      },
    ])
    .$returningId();
  await db.insert(s.financialLedger).values({
    bookingId,
    userId: ctx.user.id,
    type: "charge",
    amount: "150.00",
  });
  await db.insert(s.bookingFareComponents).values(
    [
      { passengerId: p1, amount: 6000 },
      { passengerId: p2, amount: 9000 },
    ].map(p => ({
      ...p,
      tenantId,
      bookingId,
      flightId,
      componentType: "base_fare" as const,
      source: "retail_offer" as const,
    }))
  );
  const finance = revenueAccountingRouter.createCaller({
    ...ctx,
    user: { ...ctx.user, role: "finance" },
  });
  const beforeUplift = await finance.couponMonthReview({ bookingId, month });
  assert.deepEqual(beforeUplift.issues, []);
  assert.equal(beforeUplift.transportDeferredMinor, 15000);
  assert.equal(beforeUplift.transportRecognizedThroughCutoffMinor, 0);
  const original = process.env.AVIATION_SOURCE_REGISTRY,
    keyName = "AIS_TEST_UPLIFT_SIGNATURE_KEY";
  const oldKey = process.env[keyName];
  const key = "local-only-synthetic-coupon-uplift-secret";
  try {
    process.env[keyName] = key;
    process.env.AVIATION_SOURCE_REGISTRY = JSON.stringify([
      {
        sourceId: "fixture-uplift",
        tenantId,
        airlineIds: [tenantId],
        capabilities: ["coupon_uplift"],
        secretEnv: keyName,
        validUntil: afterClose.toISOString(),
      },
    ]);
    const e = {
      sourceId: "fixture-uplift",
      eventId: "MTH001-1",
      kind: "coupon_uplift",
      flightId,
      issuedAt: new Date().toISOString(),
      observedAt: new Date().toISOString(),
      payload: { bookingId, passengerId: p1, couponId: docs[0].id },
    };
    const caller = aviationIntegrationsRouter.createCaller(ctx);
    const sign = (x: typeof e) =>
      createHmac("sha256", key).update(calculateRequestHash(x)).digest("hex");
    const first = await caller.ingestCouponUplift({
      envelope: e,
      signature: sign(e),
    });
    assert.equal(first.duplicate, false);
    const again = await caller.ingestCouponUplift({
      envelope: e,
      signature: sign(e),
    });
    assert.deepEqual(again, { ...first, duplicate: true });
    const changed = { ...e, eventId: e.eventId + "-2" };
    await assert.rejects(
      caller.ingestCouponUplift({
        envelope: changed,
        signature: sign(changed),
      }),
      { code: "CONFLICT" }
    );
    const closed = await reviewCouponMonth(
      { bookingId, month },
      tenantId,
      afterClose
    );
    assert.deepEqual(closed.issues, []);
    assert.equal(closed.closedMonth, true);
    assert.equal(closed.cashNetThroughCutoffMinor, 15000);
    assert.equal(closed.transportRecognizedThroughCutoffMinor, 6000);
    assert.equal(closed.transportRecognizedInMonthMinor, 6000);
    assert.equal(closed.transportDeferredMinor, 9000);
    // A booking-level SSP allocation does not determine how to split the
    // loyalty amount between this used coupon and an unused one.
    const allocation = await postLoyaltyAllocation(db, {
      tenantId,
      bookingId,
      userId: ctx.user.id,
      transactionPriceMinor: 15000,
      awardedMiles: 100,
      travelStandalonePriceMinor: 15000,
      occurredAt: now,
      settlementReferences: ["synthetic-close"],
      policy: {
        id: 1,
        tenantId,
        version: "synthetic-close-v1",
        status: "approved",
        expiryMode: "none",
        expiryMonths: null,
        mileStandaloneValueMinor: 2,
        expectedBreakageBasisPoints: 0,
        currency: "SAR",
        effectiveAt: before,
        approvedBy: ctx.user.id,
        approvedAt: before,
      },
    });
    const mixed = await reviewCouponMonth(
      { bookingId, month },
      tenantId,
      afterClose
    );
    assert.equal(
      mixed.loyaltyDeferredMinor,
      allocation.deferredAmountAfterMinor
    );
    assert(mixed.issues.includes("coupon_loyalty_allocation_unmapped"));
    assert.equal(mixed.transportRecognizedThroughCutoffMinor, null);
    // With missing component rows no value is ever imputed from gross cash.
    await db
      .delete(s.bookingFareComponents)
      .where(eq(s.bookingFareComponents.bookingId, bookingId));
    const legacy = await reviewCouponMonth(
      { bookingId, month },
      tenantId,
      afterClose
    );
    assert(legacy.issues.includes("missing_or_ambiguous_coupon_fare"));
    assert.equal(legacy.transportDeferredMinor, null);
    // This is a paid booking with evidence that one passenger has already
    // flown. A later sector is still reserved, so the booking stays confirmed.
    const later = new Date(now.getTime() + 72 * 3600_000);
    const [{ id: returnFlightId }] = await db
      .insert(s.flights)
      .values({
        flightNumber: "ZY778",
        airlineId: tenantId,
        tenantId,
        originId: tenantId + 1,
        destinationId: tenantId,
        departureTime: later,
        arrivalTime: new Date(later.getTime() + 3600_000),
        status: "scheduled",
        economySeats: 4,
        economyAvailable: 2,
        businessSeats: 0,
        businessAvailable: 0,
        economyPrice: 10000,
        businessPrice: 20000,
      })
      .$returningId();
    await db.insert(s.bookingSegments).values([
      {
        bookingId,
        flightId,
        segmentOrder: 1,
        departureDate: before,
        seatsReserved: true,
        status: "completed",
      },
      {
        bookingId,
        flightId: returnFlightId,
        segmentOrder: 2,
        departureDate: later,
        seatsReserved: true,
        status: "confirmed",
      },
    ]);
    const orderId = "synthetic-flown-cancel";
    await db.insert(s.ndcOrders).values({
      orderId,
      offerId: "synthetic-flown-offer",
      bookingId,
      airlineId: tenantId,
      passengers: "[]",
      contactInfo: "{}",
      totalAmount: 15000,
      status: "confirmed",
      orderPayload: '{"ndcVersion":"21.3"}',
    });
    const state = async () => ({
      coupons: await db
        .select()
        .from(s.ticketCoupons)
        .where(eq(s.ticketCoupons.bookingId, bookingId))
        .orderBy(s.ticketCoupons.id),
      segments: await db
        .select()
        .from(s.bookingSegments)
        .where(eq(s.bookingSegments.bookingId, bookingId))
        .orderBy(s.bookingSegments.segmentOrder),
      flights: await db
        .select()
        .from(s.flights)
        .where(inArray(s.flights.id, [flightId, returnFlightId]))
        .orderBy(s.flights.id),
      booking: await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, bookingId)),
      order: await db
        .select()
        .from(s.ndcOrders)
        .where(eq(s.ndcOrders.orderId, orderId)),
      cancellations: await db
        .select()
        .from(s.outbox)
        .where(
          and(
            eq(s.outbox.aggregateType, "booking"),
            eq(s.outbox.aggregateId, String(bookingId)),
            eq(s.outbox.eventType, "booking.cancelled")
          )
        ),
    });
    const beforeCancel = await state();
    const sale = bookingsRouter.createCaller(ctx);
    const expected = { code: "PRECONDITION_FAILED", message: /flown coupon/ };
    await assert.rejects(sale.cancel({ bookingId }), expected);
    await assert.rejects(
      ndcRouter
        .createCaller(ctx)
        .cancelOrder({ orderId, reason: "Passenger requested cancellation" }),
      expected
    );
    assert.deepEqual(await state(), beforeCancel);
    const unused = await sale.create({
      flightId: returnFlightId,
      cabinClass: "economy",
      sessionId: "unused-coupon-cancel-control",
      passengers: [
        { firstName: "Synthetic", lastName: "Control", type: "adult" },
      ],
    });
    await db.transaction(tx =>
      settleVerifiedPayment(tx, {
        paymentIntentId: "pi_synthetic_unused_coupon_control",
        amount: unused.totalAmount,
        currency: "sar",
        metadata: {
          bookingId: String(unused.bookingId),
          userId: String(ctx.user!.id),
        },
        eventId: "evt_synthetic_unused_coupon_control",
      })
    );
    const [unusedPax] = await sale.getPassengers({
      bookingId: unused.bookingId,
    });
    await readTicketDocument(unused.bookingId, unusedPax.id, ctx.user.id);
    assert.equal(
      (await sale.cancel({ bookingId: unused.bookingId })).success,
      true
    );
    const [voided] = await db
      .select({ status: s.ticketCoupons.status })
      .from(s.ticketCoupons)
      .where(eq(s.ticketCoupons.bookingId, unused.bookingId));
    assert.equal(voided.status, "V");
    return {
      signedUpliftId: first.evidenceId,
      voluntaryCancellation: {
        rejectedChannels: ["booking", "ndc"],
        unchangedFlownAndRemainingSectors: true,
        unusedControlCancelled: true,
      },
      syntheticClosedMonth: month,
      cashMinor: 15000,
      carriageRecognizedMinor: 6000,
      unusedDeferredMinor: 9000,
      unmappedLoyaltyBlocked: true,
      legacyGrossNotImputed: true,
    };
  } finally {
    if (original === undefined) delete process.env.AVIATION_SOURCE_REGISTRY;
    else process.env.AVIATION_SOURCE_REGISTRY = original;
    if (oldKey === undefined) delete process.env[keyName];
    else process.env[keyName] = oldKey;
  }
}
