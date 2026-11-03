import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import { bspReportingRouter } from "../../server/routers/bsp-reporting";
import { ancillaryRouter } from "../../server/routers/ancillary";
import { eticketRouter } from "../../server/routers/eticket";
import { modificationsRouter } from "../../server/routers/modifications";
import { paymentsRouter } from "../../server/routers/payments";
import { stripe } from "../../server/stripe";

/** Synthetic signed provider delivery through the production verification and settlement path. */
async function deliverPayment(
  eventId: string,
  intentId: string,
  amount: number,
  metadata: Record<string, string>
) {
  const { handleStripeWebhook } = await import("../../server/webhooks/stripe");
  const payload = JSON.stringify({
    id: eventId,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: intentId,
        status: "succeeded",
        currency: "sar",
        amount_received: amount,
        metadata,
      },
    },
  });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  assert(secret);
  const req = {
    body: Buffer.from(payload),
    headers: {
      "stripe-signature": stripe.webhooks.generateTestHeaderString({
        payload,
        secret,
      }),
    },
  } as unknown as Request;
  let code = 200;
  let body: unknown;
  const res = {
    status(value: number) {
      code = value;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as Response;
  await handleStripeWebhook(req, res);
  assert.equal(code, 200, JSON.stringify(body));
}

export async function verifyPaidSectorExchange(
  db: SettlementTx,
  ctx: TrpcContext,
  id: number
) {
  assert(ctx.user && ctx.tenantId === id);
  const userId = ctx.user.id;
  const [first, old, replacement] = [id + 185, id + 186, id + 187];
  const bookingId = id + 195;
  const passengerId = id + 196;
  const now = Date.now();
  const when = (h: number) => new Date(now + (240 + h) * 3600000);
  await db.insert(s.flights).values(
    [first, old, replacement].map((flightId, i) => ({
      id: flightId,
      tenantId: id,
      airlineId: id,
      flightNumber: `ZY7${i}8`,
      originId: i ? id + 1 : id,
      destinationId: i ? id + 2 : id + 1,
      departureTime: when(4 * i),
      arrivalTime: when(4 * i + 1),
      economyPrice: i === 2 ? 30000 : 10000,
      businessPrice: 60000,
      economySeats: 10,
      economyAvailable: 10,
      businessSeats: 2,
      businessAvailable: 2,
      aircraftType: "A320",
    }))
  );
  await db.insert(s.seatInventory).values(
    [old, replacement].map(flightId => ({
      flightId,
      seatMapId: id,
      seatNumber: "12A",
      row: 12,
      column: "A",
      cabinClass: "economy" as const,
      seatType: "window" as const,
      priceTier: "extra_legroom" as const,
      hasExtraLegroom: true,
      seatPrice: 2000,
    }))
  );
  await db.insert(s.bookings).values({
    id: bookingId,
    tenantId: id,
    userId,
    flightId: first,
    bookingReference: "SECX01",
    pnr: "SECX01",
    status: "pending",
    paymentStatus: "pending",
    seatsReserved: false,
    cabinClass: "economy",
    numberOfPassengers: 1,
    totalAmount: 20000,
  });
  await db.insert(s.passengers).values({
    id: passengerId,
    bookingId,
    tenantId: id,
    firstName: "Synthetic",
    lastName: "Exchange",
  });
  await db.insert(s.bookingSegments).values(
    [first, old].map((flightId, i) => ({
      bookingId,
      flightId,
      segmentOrder: i + 1,
      segmentAmount: 10000,
      status: "pending" as const,
      seatsReserved: false,
      departureDate: when(i * 4),
    }))
  );
  const [service] = await db
    .insert(s.ancillaryServices)
    .values({
      code: "SEAT_EXTRA_LEG",
      category: "seat",
      name: "Extra legroom",
      currency: "SAR",
      price: 2000,
    })
    .$returningId();
  const seats = ancillaryRouter.createCaller(ctx);
  const seatRequest = {
    bookingId,
    passengerId,
    ancillaryServiceId: service.id,
    flightId: old,
    seatNumber: "12A",
    quantity: 1,
    idempotencyKey: "paid-seat-sector-two",
  };
  const purchase = await seats.addToBooking(seatRequest);
  assert.equal(purchase.totalPrice, 2000);
  const originalIntent = "pi_sector_original";
  await deliverPayment("evt_sector_original", originalIntent, 22000, {
    type: "booking",
    bookingId: String(bookingId),
    userId: String(userId),
  });
  const ticketing = eticketRouter.createCaller(ctx);
  const document = await ticketing.generateETicket({ bookingId, passengerId });
  const coupons = () =>
    db
      .select()
      .from(s.ticketCoupons)
      .where(eq(s.ticketCoupons.bookingId, bookingId))
      .orderBy(asc(s.ticketCoupons.couponNumber));
  const legs = () =>
    db
      .select()
      .from(s.bookingSegments)
      .where(eq(s.bookingSegments.bookingId, bookingId))
      .orderBy(asc(s.bookingSegments.segmentOrder));
  const [firstCoupon, oldCoupon] = await coupons();
  assert.equal(oldCoupon.flightId, old);
  const originalLegs = await legs();
  const [beforeSeat] = await db
    .select()
    .from(s.bookingAncillaries)
    .where(eq(s.bookingAncillaries.id, purchase.id));
  const fundingEventId = JSON.parse(beforeSeat.metadata ?? "{}").paidSeat
    ?.fundingEventId;
  assert.equal(typeof fundingEventId, "string");
  assert(beforeSeat.fundedAt);
  assert.equal(beforeSeat.segmentId, originalLegs[1].id);
  const request = {
    bookingId,
    replaceFlightId: old,
    newFlightId: replacement,
    idempotencyKey: "paid-seat-second-leg-exchange",
  };
  const changes = modificationsRouter.createCaller(ctx);
  const quote = await changes.requestChangeDate(request);
  assert.equal(
    (await changes.requestChangeDate(request)).modificationId,
    quote.modificationId
  );
  assert.equal(quote.originalAmount, 22000);
  assert.equal(quote.currency, "SAR");
  assert(quote.seatExchange);
  assert.equal(quote.seatExchange.retainedAmount, 2000);
  assert.equal(quote.seatExchange.seats[0].ancillaryId, purchase.id);
  assert(quote.totalCost > 0);
  const checkoutRequest = { bookingId, modificationId: quote.modificationId };
  const checkout = paymentsRouter.createCaller(ctx);
  const provider = new Map<string, Stripe.Checkout.SessionCreateParams>();
  const originalCreate = stripe.checkout.sessions.create;
  let attempts = 0;
  const session = {
    id: "cs_sector_delta",
    url: "https://checkout.example.invalid/sector-delta",
  };
  // The provider saved this session before its first response was lost. Model its documented idempotent replay.
  stripe.checkout.sessions.create = (async (
    params: Stripe.Checkout.SessionCreateParams,
    opts: Stripe.RequestOptions
  ) => {
    const key = opts.idempotencyKey;
    assert(key);
    attempts++;
    const previous = provider.get(key);
    if (previous) assert.deepEqual(params, previous);
    provider.set(key, params);
    if (attempts === 1)
      throw new Error("Synthetic lost checkout acknowledgement");
    return session;
  }) as typeof stripe.checkout.sessions.create;
  try {
    await assert.rejects(
      checkout.createModificationCheckout(checkoutRequest),
      /lost checkout acknowledgement/
    );
    assert.equal(
      (await changes.getDetails({ modificationId: quote.modificationId }))
        .status,
      "pending"
    );
    assert.equal(
      (await checkout.createModificationCheckout(checkoutRequest)).sessionId,
      session.id
    );
    assert.equal(
      (await checkout.createModificationCheckout(checkoutRequest)).sessionId,
      session.id
    );
  } finally {
    stripe.checkout.sessions.create = originalCreate;
  }
  assert.equal(provider.size, 1);
  assert.equal(attempts, 2);
  const [remote] = provider.values();
  const amount = remote.line_items?.[0].price_data?.unit_amount;
  assert.equal(amount, quote.totalCost);
  assert(remote.metadata);
  const metadata = Object.fromEntries(
    Object.entries(remote.metadata).map(([key, value]) => [key, String(value)])
  );
  const intent = "pi_sector_delta";
  await deliverPayment("evt_sector_settle", intent, quote.totalCost, metadata);
  await deliverPayment("evt_sector_settle", intent, quote.totalCost, metadata);
  await deliverPayment(
    "evt_sector_settle_redelivered",
    intent,
    quote.totalCost,
    metadata
  );
  const status = await changes.getDetails({
    modificationId: quote.modificationId,
  });
  assert.equal(status.status, "completed");
  assert.equal(status.paymentStatus, "paid");
  assert.equal(
    (await ticketing.generateETicket({ bookingId, passengerId })).ticketNumber,
    document.ticketNumber
  );
  const finalLegs = await legs();
  assert.equal(finalLegs.length, 2);
  assert.deepEqual(finalLegs[0], originalLegs[0]);
  assert.equal(finalLegs[1].flightId, replacement);
  const finalCoupons = await coupons();
  assert.equal(finalCoupons.length, 3);
  assert.deepEqual(finalCoupons[0], firstCoupon);
  assert.equal(finalCoupons[1].id, oldCoupon.id);
  assert.equal(finalCoupons[1].status, "E");
  assert.equal(finalCoupons[2].flightId, replacement);
  assert.equal(finalCoupons[2].status, "O");
  const entitlements = await db
    .select()
    .from(s.bookingAncillaries)
    .where(eq(s.bookingAncillaries.bookingId, bookingId));
  assert.equal(entitlements.length, 1);
  const [entitlement] = entitlements;
  assert.equal(entitlement.id, purchase.id);
  assert.equal(entitlement.segmentId, finalLegs[1].id);
  assert.equal(
    JSON.parse(entitlement.metadata ?? "{}").paidSeat?.fundingEventId,
    fundingEventId
  );
  assert.deepEqual(entitlement.fundedAt, beforeSeat.fundedAt);
  const inventory = await db
    .select()
    .from(s.seatInventory)
    .where(inArray(s.seatInventory.flightId, [old, replacement]))
    .orderBy(asc(s.seatInventory.flightId));
  assert.equal(inventory[0].bookingId, null);
  assert.equal(inventory[0].status, "available");
  assert.equal(inventory[1].bookingId, bookingId);
  assert.equal(inventory[1].passengerId, passengerId);
  const capacity = await db
    .select({ available: s.flights.economyAvailable })
    .from(s.flights)
    .where(inArray(s.flights.id, [first, old, replacement]))
    .orderBy(asc(s.flights.id));
  assert.deepEqual(
    capacity.map(f => f.available),
    [9, 10, 9]
  );
  const ledger = await db
    .select()
    .from(s.financialLedger)
    .where(eq(s.financialLedger.bookingId, bookingId))
    .orderBy(asc(s.financialLedger.id));
  assert.deepEqual(
    ledger.map(l => ({
      op: l.type,
      minor: Math.round(Number(l.amount) * 100),
      intent: l.stripePaymentIntentId,
    })),
    [
      { op: "charge", minor: 22000, intent: originalIntent },
      { op: "charge", minor: quote.totalCost, intent },
    ]
  );
  assert.equal(quote.newAmount, 22000 + quote.totalCost);
  const finance = bspReportingRouter.createCaller({
    ...ctx,
    user: { ...ctx.user, role: "finance" },
  });
  const statement = {
    payout: {
      reference: "po_sector",
      currency: "SAR" as const,
      netMinor: quote.totalCost - 1,
      captureCount: 1,
      captures: [
        { paymentIntentId: intent, grossMinor: quote.totalCost, feeMinor: 1 },
      ],
    },
    bank: {
      statementLineId: "synthetic-statement-line",
      payoutReference: "po_sector",
      currency: "SAR" as const,
      creditedMinor: quote.totalCost - 1,
    },
  };
  await assert.rejects(
    bspReportingRouter.createCaller(ctx).comparePayout(statement)
  );
  const [foreignTenant] = await db
    .insert(s.tenants)
    .values({
      slug: "sector-exchange-other-tenant",
      name: "Unrelated acceptance tenant",
      status: "active",
    })
    .$returningId();
  const [foreignStaff] = await db
    .insert(s.users)
    .values({
      openId: "sector-exchange-unrelated-finance",
      tenantId: foreignTenant.id,
      role: "finance",
    })
    .$returningId();
  const [otherUser] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, foreignStaff.id));
  const foreignFinance = bspReportingRouter.createCaller({
    ...ctx,
    user: otherUser,
    tenantId: foreignTenant.id,
  });
  const foreignComparison = await foreignFinance.comparePayout(statement);
  assert.equal(foreignComparison.matched, false);
  assert.equal(foreignComparison.lines.length, 1);
  assert.equal(foreignComparison.lines[0].bookingId, null);
  assert.equal(foreignComparison.lines[0].modificationId, null);
  assert.equal(foreignComparison.lines[0].ledgerEntryId, null);
  assert.equal(foreignComparison.lines[0].collectionState, null);
  const comparison = await finance.comparePayout(statement);
  assert.equal(comparison.basis, "operator_supplied_statements");
  assert.equal(comparison.matched, true);
  assert.equal(comparison.lines[0].ledgerEntryId, ledger[1].id);
  assert.equal(comparison.lines[0].modificationId, quote.modificationId);
  for (const bank of [
    { ...statement.bank, payoutReference: "wrong-payout" },
    { ...statement.bank, creditedMinor: quote.totalCost },
  ]) {
    assert.equal(
      (await finance.comparePayout({ ...statement, bank })).matched,
      false
    );
  }
  return {
    foreignTenantLedgerIdentityHidden: true,
    syntheticPayoutComparison: {
      reference: comparison.payoutReference,
      statementLineId: comparison.statementLineId,
      matched: comparison.matched,
      netMinor: comparison.calculatedNetMinor,
    },
    bookingId,
    modificationId: quote.modificationId,
    paymentReceiptSource: "synthetic signed webhook",
    providerCheckoutAttempts: attempts,
    distinctProviderSessions: provider.size,
    paymentDeliveries: 3,
    firstCouponUnchanged: true,
    oldCouponStatus: finalCoupons[1].status,
    replacementCouponStatus: finalCoupons[2].status,
    seatRetainedMinor: 2000,
    settledDeltaMinor: quote.totalCost,
    newTotalMinor: quote.newAmount,
    ledgerIds: ledger.map(l => l.id),
    originalLegId: finalLegs[0].id,
    retainedEntitlementId: entitlement.id,
  };
}
