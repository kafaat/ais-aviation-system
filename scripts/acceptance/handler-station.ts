import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mock } from "node:test";
import { and, eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import { operationalMessageRoutes } from "../../drizzle/operations-schema";
import type { TrpcContext } from "../../server/_core/context";
import { aviationIntegrationsRouter } from "../../server/routers/aviation-integrations";
import { bookingsRouter } from "../../server/routers/bookings";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import { reviewCouponMonth } from "../../server/services/coupon-month-review";
import { calculateRequestHash } from "../../server/services/idempotency-v2.service";
import { settleVerifiedPayment } from "../../server/services/payment-settlement.service";
import {
  changeSeat,
  checkIn,
  selectSeat,
} from "../../server/services/seat-map.service";
import { readTicketDocument } from "../../server/services/ticket-documents.service";
import {
  generateOperationalDraft,
  parseOperationalDraft,
} from "../../server/services/operational-messaging.service";
import {
  claimDueTransmission,
  createTransmissionDraft,
  queueTransmission,
  recordTransportResult,
} from "../../server/services/aviation-message-transmission.service";

export async function verifyHandlerStation(
  db: SettlementTx,
  ctx: TrpcContext,
  tenantId: number
) {
  assert(ctx.user);
  const userId = ctx.user.id;
  // Route acceptance uses SQL second precision, so avoid rounding into the future.
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const departure = new Date(now.getTime() + 72 * 3600_000);
  const [created] = await db.insert(s.flights).values({
    flightNumber: "ZY917",
    tenantId,
    airlineId: tenantId,
    originId: tenantId,
    destinationId: tenantId + 1,
    departureTime: departure,
    arrivalTime: new Date(+departure + 3600_000),
    status: "scheduled",
    aircraftType: "A320",
    economySeats: 4,
    economyAvailable: 4,
    businessSeats: 0,
    businessAvailable: 0,
    economyPrice: 10000,
    businessPrice: 20000,
  });
  const flightId = created.insertId;
  await db.insert(s.seatInventory).values(
    ["A", "B"].map(column => ({
      flightId,
      seatMapId: tenantId,
      seatNumber: "1" + column,
      row: 1,
      column,
      cabinClass: "economy" as const,
      seatType: "window" as const,
      seatPrice: 0,
    }))
  );
  const sale = bookingsRouter.createCaller(ctx);
  async function traveler(lastName: string) {
    const booking = await sale.create({
      flightId,
      cabinClass: "economy",
      sessionId: "handler-" + lastName,
      passengers: [{ firstName: "Synthetic", lastName, type: "adult" }],
    });
    await db.transaction(tx =>
      settleVerifiedPayment(tx, {
        paymentIntentId: "pi_handler_" + lastName,
        eventId: "evt_handler_" + lastName,
        amount: booking.totalAmount,
        currency: "sar",
        metadata: {
          bookingId: String(booking.bookingId),
          userId: String(userId),
        },
      })
    );
    const [pax] = await sale.getPassengers({ bookingId: booking.bookingId });
    await readTicketDocument(booking.bookingId, pax.id, userId);
    const [coupon] = await db
      .select()
      .from(s.ticketCoupons)
      .where(eq(s.ticketCoupons.bookingId, booking.bookingId));
    return {
      booking,
      pax,
      coupon,
      manifest: {
        recordLocator: booking.pnr,
        surname: pax.lastName.toUpperCase(),
        givenName: pax.firstName.toUpperCase(),
      },
    };
  }
  const kept = await traveler("Keep");
  const removed = await traveler("Remove");
  const common = {
    flightNumber: "ZY917",
    flightDate: departure.toISOString().slice(0, 10),
    origin: "ZZA",
    destination: "ZZB",
  };
  const route = {
    stationCode: "ZZA",
    originAddress: "ZZBZYXX",
    destinationAddress: "ZZAGHXX",
    transportProfile: "synthetic-handler-v1",
    enabled: true,
    acceptedAt: now.toISOString(),
  };
  // Claim the real AIS outbox locally. Only this fixture supplies a handler receipt.
  async function deliver(type: "PNL" | "ADL", payload: unknown) {
    const [r] = await db.insert(operationalMessageRoutes).values({
      ...route,
      tenantId,
      messageType: type,
      acceptedBy: userId,
      acceptedAt: now,
    });
    const draft = generateOperationalDraft({
      messageType: type,
      route,
      payload,
    });
    const { transmissionId } = await createTransmissionDraft({
      tenantId,
      flightId,
      routeId: r.insertId,
      messageType: type,
      messageContent: draft.messageContent,
      idempotencyKey: "handler-pilot:" + type,
    });
    await queueTransmission({ transmissionId, tenantId });
    const delivery = await claimDueTransmission();
    assert(delivery && delivery.transmissionId === transmissionId);
    const parsed = parseOperationalDraft(delivery.messageContent);
    assert.equal(parsed.destinationAddress, route.destinationAddress);
    assert.equal(parsed.messageDigest, draft.messageDigest);
    const receipt = await recordTransportResult({
      transmissionId,
      leaseKey: delivery.leaseKey,
      providerMessageId: "fixture-" + type + "-" + transmissionId,
    });
    assert.equal(receipt.status, "sent");
    return parsed;
  }
  const envBefore = {
    AIS_TYPE_B_TRANSPORT_ENABLED: process.env.AIS_TYPE_B_TRANSPORT_ENABLED,
    AVIATION_SOURCE_REGISTRY: process.env.AVIATION_SOURCE_REGISTRY,
    AIS_HANDLER_PILOT_KEY: process.env.AIS_HANDLER_PILOT_KEY,
  };
  const source = {
    sourceId: "synthetic-station",
    tenantId,
    airlineIds: [tenantId],
    airportIds: [tenantId],
    capabilities: ["handler_etl"],
    secretEnv: "AIS_HANDLER_PILOT_KEY",
    validUntil: new Date(+departure + 48 * 3600_000).toISOString(),
  };
  const secret = "synthetic-station-only-disposable-acceptance";
  const caller = aviationIntegrationsRouter.createCaller(ctx);
  try {
    process.env.AIS_TYPE_B_TRANSPORT_ENABLED = "true";
    process.env.AIS_HANDLER_PILOT_KEY = secret;
    await selectSeat(flightId, "1A", kept.booking.bookingId, kept.pax.id);
    const pnl = await deliver("PNL", {
      ...common,
      passengers: [{ ...kept.manifest, seatNumber: "1A" }, removed.manifest],
    });
    assert.deepEqual(pnl.lines.slice(1), [
      `-${kept.booking.pnr}.KEEP/SYNTHETIC`,
      ".SEAT/1A",
      `-${removed.booking.pnr}.REMOVE/SYNTHETIC`,
    ]);
    const seat = await changeSeat(
      flightId,
      "1A",
      "1B",
      kept.booking.bookingId,
      kept.pax.id
    );
    assert(
      (await sale.cancel({ bookingId: removed.booking.bookingId })).success
    );
    const adl = await deliver("ADL", {
      ...common,
      changes: [
        { ...kept.manifest, action: "CHG", seatNumber: seat.seatNumber },
        { ...removed.manifest, action: "DEL" },
      ],
    });
    assert.deepEqual(adl.lines.slice(1), [
      `CHG ${kept.booking.pnr}.KEEP/SYNTHETIC`,
      ".SEAT/1B",
      `DEL ${removed.booking.pnr}.REMOVE/SYNTHETIC`,
    ]);
    // Keep the same flight date in both messages and the receipt.
    mock.timers.enable({ apis: ["Date"], now: +departure - 12 * 3600_000 });
    await checkIn(flightId, kept.booking.bookingId, kept.pax.id, "1B");
    mock.timers.setTime(+departure + 3 * 3600_000);
    const observedAt = new Date(+departure + 2 * 3600_000);
    await db
      .update(s.flights)
      .set({ status: "completed" })
      .where(eq(s.flights.id, flightId));
    const signed = (coupon: typeof kept.coupon, eventId: string) => {
      const envelope = {
        sourceId: source.sourceId,
        eventId,
        kind: "coupon_uplift",
        flightId,
        issuedAt: new Date().toISOString(),
        observedAt: observedAt.toISOString(),
        payload: {
          ticketNumber: coupon.ticketNumber,
          couponNumber: coupon.couponNumber,
        },
      };
      return {
        envelope,
        signature: createHmac("sha256", secret)
          .update(calculateRequestHash(envelope))
          .digest("hex"),
      };
    };
    for (const airportIds of [undefined, [], [tenantId + 1]]) {
      process.env.AVIATION_SOURCE_REGISTRY = JSON.stringify([
        { ...source, airportIds },
      ]);
      await assert.rejects(
        caller.ingestCouponUplift(signed(kept.coupon, "pilot-kept")),
        { code: "PRECONDITION_FAILED" }
      );
    }
    process.env.AVIATION_SOURCE_REGISTRY = JSON.stringify([source]);
    await assert.rejects(
      caller.ingestCouponUplift(signed(removed.coupon, "pilot-removed")),
      { code: "CONFLICT" }
    );
    const replies = await Promise.all(
      [1, 2].map(() =>
        caller.ingestCouponUplift(signed(kept.coupon, "pilot-kept"))
      )
    );
    assert.equal(replies[0].evidenceId, replies[1].evidenceId);
    assert.equal(replies.filter(x => !x.duplicate).length, 1);
    const { evidenceId } = replies[0];
    const firstReceivedAt = new Date();
    mock.timers.setTime(Date.now() + 3600_000);
    const delayed = await caller.ingestCouponUplift(
      signed(kept.coupon, "pilot-kept")
    );
    assert.deepEqual(delayed, { evidenceId, duplicate: true });
    await assert.rejects(
      caller.ingestCouponUplift(signed(removed.coupon, "pilot-kept")),
      { code: "CONFLICT" }
    );
    await assert.rejects(
      caller.ingestCouponUplift(signed(kept.coupon, "pilot-new-event")),
      { code: "CONFLICT" }
    );
    const proofs = await db
      .select()
      .from(s.aviationEvidence)
      .where(eq(s.aviationEvidence.sourceId, source.sourceId));
    assert.deepEqual(
      proofs.map(p => p.id),
      [evidenceId]
    );
    assert.deepEqual(proofs[0].payload, {
      ticketNumber: kept.coupon.ticketNumber,
      couponNumber: kept.coupon.couponNumber,
    });
    assert.deepEqual(proofs[0].ingestSnapshot, {
      bookingId: kept.booking.bookingId,
      passengerId: kept.pax.id,
      couponId: kept.coupon.id,
      originId: tenantId,
    });
    assert(proofs[0].receivedAt <= firstReceivedAt);
    assert(proofs[0].ingestSnapshotAt);
    assert(proofs[0].ingestSnapshotAt <= firstReceivedAt);
    const events = await db
      .select()
      .from(s.outbox)
      .where(
        and(
          eq(s.outbox.aggregateType, "aviationEvidence"),
          eq(s.outbox.aggregateId, String(evidenceId)),
          eq(s.outbox.eventType, "aviation.coupon_uplift")
        )
      );
    assert.equal(events.length, 1);
    const [voided] = await db
      .select()
      .from(s.ticketCoupons)
      .where(eq(s.ticketCoupons.id, removed.coupon.id));
    assert.equal(voided.status, "V");
    const month = new Date().toISOString().slice(0, 7);
    const review = await reviewCouponMonth(
      { bookingId: kept.booking.bookingId, month },
      tenantId,
      new Date(Date.now() + 1000)
    );
    const flown = review.coupons.find(c => c.couponId === kept.coupon.id);
    assert.equal(flown?.status, "F");
    assert.equal(flown.upliftEvidenceId, evidenceId);
    assert.deepEqual(review.issues, []);
    assert.equal(
      review.transportRecognizedThroughCutoffMinor,
      flown.baseFareMinor
    );
    assert((flown.baseFareMinor ?? 0) > 0);
    return {
      pnlDigest: pnl.messageDigest,
      adlDigest: adl.messageDigest,
      evidenceId,
      couponId: flown.couponId,
      recognizedMinor: flown.baseFareMinor,
      voidedCouponStatus: voided.status,
      concurrentDeliveries: replies.length,
      delayedRetryDuplicate: delayed.duplicate,
      committedEvents: events.length,
      externalHandlerCalls: 0,
    };
  } finally {
    mock.timers.reset();
    for (const [name, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
