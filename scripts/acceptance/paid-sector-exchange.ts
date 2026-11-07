import assert from "node:assert/strict";
import { provisionRbd } from "../db/provision-rbd";
import type { Request, Response } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import { bspReportingRouter } from "../../server/routers/bsp-reporting";
import { ancillaryRouter } from "../../server/routers/ancillary";
import { bookingsRouter } from "../../server/routers/bookings";
import { priceQuoteRouter } from "../../server/routers/price-quote";
import { multiCityRouter } from "../../server/routers/multi-city";
import { aiChatRouter } from "../../server/routers/ai-chat";
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
  const localDepartureDay = new Date(Date.now() + 10 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const midnightAtOrigin = new Date(localDepartureDay + "T00:00:00+03:00");
  const when = (h: number) =>
    new Date(midnightAtOrigin.getTime() + (h * 60 + 15) * 60_000);
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
  // Only the affected second sector uses a class bucket; the anchor stays cabin-only.
  const [rbd] = await db
    .insert(s.fareClasses)
    .values({
      airlineId: id,
      code: "Q",
      name: "Synthetic exchange Q",
      cabinClass: "economy",
    })
    .$returningId();
  const allocation = {
    reference: "synthetic-sector-allocation",
    tenantId: id,
    airlineId: id,
    rows: [old, replacement].map(flightId => ({
      flightId,
      fareClassId: rbd.id,
      cabin: "economy",
      expectedCabinAvailable: 10,
      capacity: 1,
      availableSeats: 1,
    })),
  };
  const preview = await provisionRbd(db, allocation);
  assert.deepEqual(
    preview.rows.map(row => row.action),
    ["would_create", "would_create"]
  );
  await assert.rejects(provisionRbd(db, allocation, "bad-digest"), /digest/);
  await provisionRbd(db, allocation, preview.digest);
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
  const sale = multiCityRouter.createCaller(ctx);
  const search = await sale.search({
    segments: [
      { originId: id, destinationId: id + 1, departureDate: midnightAtOrigin },
      {
        originId: id + 1,
        destinationId: id + 2,
        departureDate: midnightAtOrigin,
      },
    ],
  });
  assert(search[0].flights.some(f => f.id === first));
  assert(search[1].flights.some(f => f.id === old));
  const segments = [
    { flightId: first, departureDate: when(0) },
    { flightId: old, departureDate: when(4), fareClassCode: "Q" },
  ];
  const cabinClass = "economy" as const;
  const passengers = [
    { type: "adult" as const, firstName: "Synthetic", lastName: "Exchange" },
  ];
  const [rule] = await db
    .insert(s.fareRules)
    .values({
      fareClassId: rbd.id,
      airlineId: id,
      ruleName: "Adult Q eligibility",
      ruleCategory: "eligibility",
      conditions: JSON.stringify({ passengerTypes: ["adult"] }),
      validFrom: new Date(),
      active: true,
    })
    .$returningId();
  const quotes = priceQuoteRouter.createCaller(ctx);
  const direct = { flightId: old, cabinClass, fareClassCode: "Q" };
  const originalOffer = await quotes.createOffer({
    ...direct,
    passengerTypes: ["adult"],
  });
  await assert.rejects(
    quotes.createOffer({ ...direct, passengerTypes: ["child"] }),
    /Passenger type is ineligible/
  );
  await assert.rejects(
    sale.calculatePrice({
      segments: segments.map(s => ({ ...s, cabinClass })),
      passengerCount: 1,
      passengerTypes: ["child"],
    }),
    /Passenger type is ineligible/
  );
  // A formerly eligible passenger must request a new offer even if the
  // revised rule happens to permit that passenger too.
  await db
    .update(s.fareRules)
    .set({
      conditions: JSON.stringify({ passengerTypes: ["adult", "infant"] }),
    })
    .where(eq(s.fareRules.id, rule.id));
  await assert.rejects(
    bookingsRouter.createCaller(ctx).create({
      ...direct,
      offerId: originalOffer.offerId,
      passengers,
      sessionId: "changed-rbd-terms",
    }),
    /Fare conditions changed/
  );
  const [offered] = await db
    .select()
    .from(s.retailOffers)
    .where(eq(s.retailOffers.id, originalOffer.offerId));
  assert.equal(offered.consumedBookingId, null);
  const price = await sale.calculatePrice({
    segments: segments.map(s => ({ ...s, cabinClass })),
    passengerCount: 1,
    passengerTypes: ["adult"],
  });
  const command = {
    segments,
    cabinClass,
    passengers,
    sessionId: "two-sector-passenger-save",
    checkoutContractVersion: 1 as const,
    expectedTotalMinor: price.totalPrice,
  };
  // Change the actual inventory price after shopping, then restore the synthetic
  // fixture so the original reviewed offer can be accepted later in this test.
  await db
    .update(s.flights)
    .set({ economyPrice: 20000 })
    .where(eq(s.flights.id, first));
  await assert.rejects(sale.create(command), { code: "CONFLICT" });
  await db
    .update(s.flights)
    .set({ economyPrice: 10000 })
    .where(eq(s.flights.id, first));
  await assert.rejects(
    sale.create({ ...command, checkoutContractVersion: 2 as 1 }),
    { code: "BAD_REQUEST" }
  );
  await assert.rejects(
    sale.create({ ...command, cabinClass: "premium_economy" as "economy" }),
    { code: "BAD_REQUEST" }
  );

  const created = await sale.create(command);
  // The client lost the successful create response. The same immutable command
  // must recover both persisted segments and the original passenger, even if
  // the last Q seat is held and a new quote can no longer be produced.
  assert.deepEqual(await sale.create(command), created);
  const { bookingId } = created;
  const savedPassengers = await db
    .select()
    .from(s.passengers)
    .where(eq(s.passengers.bookingId, bookingId));
  assert.equal(savedPassengers.length, 1);
  const passengerId = savedPassengers[0].id;
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
  const fundedMinor = created.totalAmount + purchase.totalPrice;
  await deliverPayment("evt_sector_original", originalIntent, fundedMinor, {
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
  const { revenueAccountingRouter } =
    await import("../../server/routers/revenue-accounting");
  const revenueReview = revenueAccountingRouter.createCaller({
    ...ctx,
    user: { ...ctx.user, role: "finance" },
  });
  const review = () =>
    revenueReview.couponMonthReview({
      bookingId,
      month: new Date().toISOString().slice(0, 7),
    });
  const beforeExchange = await review();
  assert.deepEqual(beforeExchange.issues, []);
  assert.equal(beforeExchange.cashNetThroughCutoffMinor, fundedMinor);
  assert.equal(beforeExchange.transportRecognizedThroughCutoffMinor, 0);
  assert((beforeExchange.transportDeferredMinor ?? 0) > 0);
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
  assert.equal(quote.originalAmount, fundedMinor);
  assert.equal(quote.currency, "SAR");
  assert(quote.seatExchange);
  assert.equal(quote.seatExchange.retainedAmount, 2000);
  assert.equal(quote.seatExchange.seats[0].ancillaryId, purchase.id);
  assert(quote.totalCost > 0);
  assert(quote.quoteVersion);
  const checkoutRequest = {
    bookingId,
    modificationId: quote.modificationId,
    consent: {
      quoteVersion: quote.quoteVersion,
      totalCost: quote.totalCost,
      currency: "SAR" as const,
    },
  };
  // Consent for a different amount or version never reaches the provider.
  await assert.rejects(
    paymentsRouter.createCaller(ctx).createModificationCheckout({
      ...checkoutRequest,
      consent: { ...checkoutRequest.consent, totalCost: quote.totalCost + 1 },
    }),
    /Quote changed/
  );
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
  assert.equal(finalLegs[1].fareClassId, rbd.id);
  const buckets = await db
    .select()
    .from(s.flightFareClassInventory)
    .where(eq(s.flightFareClassInventory.fareClassId, rbd.id))
    .orderBy(asc(s.flightFareClassInventory.flightId));
  assert.deepEqual(
    buckets.map(b => [b.flightId, b.availableSeats]),
    [
      [old, 1],
      [replacement, 0],
    ]
  );
  const provisionReplay = await provisionRbd(db, allocation, preview.digest);
  assert.deepEqual(
    provisionReplay.rows.map(row => [row.action, row.availableSeats]),
    [
      ["unchanged", 1],
      ["unchanged", 0],
    ]
  );
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
      { op: "charge", minor: fundedMinor, intent: originalIntent },
      { op: "charge", minor: quote.totalCost, intent },
    ]
  );
  assert.equal(quote.newAmount, fundedMinor + quote.totalCost);
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
  const familyChat = aiChatRouter.createCaller({
    ...ctx,
    user: otherUser,
    tenantId: foreignTenant.id,
  });
  const conversation = await familyChat.startConversation({});
  const referrals = await familyChat.sendMessage({
    conversationId: conversation.conversationId,
    message: "Change my return flight for PNR " + created.pnr,
  });
  assert(Array.isArray(referrals.exchangeBookings));
  assert(
    !referrals.exchangeBookings.some(
      b => b.id === bookingId || b.bookingReference === created.bookingReference
    )
  );
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
  const recorded = await db
    .select()
    .from(s.bookingFareComponents)
    .where(eq(s.bookingFareComponents.bookingId, bookingId));
  const retired = recorded.filter(r => r.flightId === old);
  const replacementRows = recorded.filter(r => r.flightId === replacement);
  assert(retired.length > 0 && replacementRows.length > 0);
  const firstReplacementTime = Math.min(
    ...replacementRows.map(r => r.createdAt.getTime())
  );
  for (const line of retired)
    assert(
      line.reversedAt && line.reversedAt.getTime() <= firstReplacementTime,
      "Reversal must be recorded by the time the replacement is created"
    );
  const active = recorded.filter(r => !r.reversedAt);
  assert.equal(
    active.reduce((sum, r) => sum + r.amount, 0),
    quote.newAmount
  );
  assert(active.every(r => r.flightId === first || r.flightId === replacement));
  const close = await review();
  assert.equal(
    close.coupons.find(c => c.flightId === first)?.baseFareMinor,
    beforeExchange.coupons.find(c => c.flightId === first)?.baseFareMinor
  );
  assert(close.coupons.some(c => c.flightId === first && c.status === "O"));
  assert(
    close.coupons.some(c => c.flightId === replacement && c.status === "O")
  );
  assert.deepEqual(close.issues, []);
  assert.equal(close.cashNetThroughCutoffMinor, fundedMinor + quote.totalCost);
  assert.equal(close.transportRecognizedThroughCutoffMinor, 0);
  const unused = close.coupons.filter(c => c.status === "O");
  assert.equal(unused.length, 2);
  assert(unused.every(c => c.baseFareMinor !== null && c.baseFareMinor > 0));
  assert.equal(
    close.transportDeferredMinor,
    unused.reduce((sum, c) => sum + (c.baseFareMinor ?? 0), 0)
  );

  return {
    twoSectorDeferredTransportMinor: close.transportDeferredMinor,
    foreignTenantLedgerIdentityHidden: true,
    foreignFamilyBookingHiddenFromAssistant: true,
    savedPassengerCountAfterRetry: savedPassengers.length,
    originDepartureDay: localDepartureDay,
    priceDriftRejected: true,
    unsupportedCheckoutVersionRejected: true,
    unsupportedCabinRejectedBeforeWrite: true,
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
