import { calculateModificationFee } from "./modification-fee";
import { allocateProportional } from "./seat-economics.service";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, getFlightById } from "../db";
import {
  bookings,
  bookingSegments,
  bookingModifications,
  bookingAncillaries,
  flights,
  inventoryLocks,
  ndcOrders,
  passengers,
  seatInventory,
  retailOffers,
  type Booking,
} from "../../drizzle/schema";
import { lockRetailOffer, consumeRetailOffer } from "./retail-offer.service";
import { createInventoryLock } from "./inventory-lock.service";
import {
  reserveSeats,
  restoreSeats,
  assertNoCollectionReview,
  type SettlementTx,
} from "./booking-settlement.service";
import {
  calculateRequestHash,
  withTransactionalIdempotency,
} from "./idempotency-v2.service";
import {
  quoteInvoiceAncillary,
  insertInvoiceAncillary,
  storedJson,
} from "./booking-invoice.service";
import { assertTenantOperational } from "./tenant.service";
import { recordEvent } from "./outbox.service";
import { planOrderRefund } from "./order-refunds.service";

const ancillaryInput = z.object({
  ancillaryServiceId: z.number().int().positive(),
  passengerId: z.number().int().positive().optional(),
  flightId: z.number().int().positive().optional(),
  quantity: z.number().int().min(1).max(10),
});
export const paidServiceInput = z
  .object({
    bookingId: z.number().int().positive(),
    idempotencyKey: z.string().min(8).max(128),
    offerIds: z.array(z.string().uuid()).min(1).max(6).optional(),
    ancillaries: z.array(ancillaryInput).min(1).max(20).optional(),
  })
  .refine(
    i => Boolean(i.offerIds) !== Boolean(i.ancillaries),
    "Choose an itinerary exchange or additional services"
  );
const segment = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  amount: z.number().int().nonnegative(),
  holdId: z.number().int().positive().nullable(),
  departureTime: z.iso.datetime(),
  arrivalTime: z.iso.datetime(),
  offerId: z.string().uuid(),
  ndc: z.record(z.string(), z.unknown()),
});
export const planSchema = z.object({
  version: z.literal(1),
  fingerprint: z.string(),
  expiresAt: z.iso.datetime(),
  segments: z.array(segment),
  ancillaries: z.array(
    ancillaryInput.extend({ unitTotal: z.number().int().nonnegative() })
  ),
});
export class OrderServicingUnavailable extends Error {}
const unavailable = (message: string) => new OrderServicingUnavailable(message);
async function itinerary(tx: SettlementTx, booking: Booking) {
  const legs = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(asc(bookingSegments.segmentOrder))
    .for("update");
  return legs.length
    ? legs.map(l => ({
        flightId: l.flightId,
        amount: l.segmentAmount,
        reserved: l.seatsReserved,
        status: l.status,
      }))
    : [
        {
          flightId: booking.flightId,
          amount: booking.totalAmount,
          reserved: booking.seatsReserved,
          status: booking.status,
        },
      ];
}
function fingerprint(
  booking: Booking,
  legs: Awaited<ReturnType<typeof itinerary>>
) {
  return calculateRequestHash({
    flightId: booking.flightId,
    cabinClass: booking.cabinClass,
    totalAmount: booking.totalAmount,
    checkedIn: booking.checkedIn,
    status: booking.status,
    legs,
  });
}
export async function quotePaidOrderService(
  raw: z.infer<typeof paidServiceInput>,
  userId: number,
  tenantId: number | null,
  transaction?: SettlementTx
) {
  const input = paidServiceInput.parse(raw);
  const db = await getDb();
  if (!db) throw new Error("Servicing storage unavailable");
  return withTransactionalIdempotency(
    {
      scope: "order.paid.service",
      key: input.idempotencyKey,
      userId,
      request: input,
      run: async tx => {
        const [booking] = await tx
          .select()
          .from(bookings)
          .where(eq(bookings.id, input.bookingId))
          .for("update");
        if (
          !booking ||
          booking.userId !== userId ||
          (tenantId !== null && booking.tenantId !== tenantId)
        )
          throw unavailable("Owned booking not found");
        await assertTenantOperational(tx, booking.tenantId);
        await assertNoCollectionReview(tx, booking.id);
        if (
          booking.status !== "confirmed" ||
          booking.paymentStatus !== "paid" ||
          !booking.seatsReserved ||
          booking.checkedIn
        )
          throw unavailable(
            "A paid, confirmed booking before check-in is required"
          );
        const [pending] = await tx
          .select()
          .from(bookingModifications)
          .where(
            and(
              eq(bookingModifications.bookingId, booking.id),
              eq(bookingModifications.status, "pending")
            )
          )
          .limit(1);
        if (pending)
          throw unavailable("Resolve the existing servicing request first");
        const old = await itinerary(tx, booking);
        if (old.some(l => !l.reserved || l.status !== "confirmed"))
          throw unavailable(
            "Existing itinerary reservation needs reconciliation"
          );
        const pax = await tx
          .select()
          .from(passengers)
          .where(eq(passengers.bookingId, booking.id))
          .orderBy(asc(passengers.id));
        if (pax.length !== booking.numberOfPassengers)
          throw unavailable("Passenger mapping needs reconciliation");
        const segments: z.infer<typeof segment>[] = [];
        const additions: z.infer<typeof planSchema>["ancillaries"] = [];
        let newAmount = booking.totalAmount;
        let modificationFee = 0;
        let fareDifference = 0;
        const expiry = new Date(Date.now() + 10 * 60000);
        if (input.offerIds) {
          const [active] = await tx
            .select()
            .from(bookingAncillaries)
            .where(
              and(
                eq(bookingAncillaries.bookingId, booking.id),
                eq(bookingAncillaries.status, "active")
              )
            )
            .limit(1);
          if (active)
            throw unavailable(
              "Existing ancillary fulfillment must be reconciled before itinerary exchange"
            );
          const offers = await tx
            .select()
            .from(retailOffers)
            .where(inArray(retailOffers.id, input.offerIds));
          if (
            offers.length !== input.offerIds.length ||
            new Set(offers.map(o => o.flightId)).size !== offers.length ||
            new Set(offers.map(o => o.cabinClass)).size !== 1
          )
            throw unavailable(
              "Distinct flight offers in one cabin are required"
            );
          const heldFlights = new Map<number, typeof flights.$inferSelect>();
          for (const id of [
            ...new Set([
              ...old.map(l => l.flightId),
              ...offers.map(o => o.flightId),
            ]),
          ].sort((a, b) => a - b)) {
            const [flight] = await tx
              .select()
              .from(flights)
              .where(eq(flights.id, id))
              .for("update");
            if (
              !flight ||
              flight.tenantId !== booking.tenantId ||
              flight.departureTime <= new Date()
            )
              throw unavailable("Flight instance is unavailable");
            heldFlights.set(id, flight);
          }
          const original = heldFlights.get(booking.flightId);
          if (!original) throw unavailable("Original flight missing");
          for (const id of input.offerIds) {
            const hint = offers.find(o => o.id === id);
            if (!hint) throw unavailable("Offer missing");
            const offer = await lockRetailOffer(tx, id, {
              flightId: hint.flightId,
              cabinClass: hint.cabinClass,
              tenantId: booking.tenantId,
              userId,
              channel: "direct",
              passengerTypes: pax.map(p => p.type),
            });
            const flight = heldFlights.get(offer.flightId);
            if (!flight || flight.airlineId !== original.airlineId)
              throw unavailable(
                "Cross-airline settlement requires a contracted partner"
              );
            const full = await getFlightById(flight.id);
            if (
              !full ||
              full.departureTime.getTime() !== flight.departureTime.getTime()
            )
              throw unavailable("Schedule changed");
            const unchanged =
              old.some(l => l.flightId === flight.id) &&
              booking.cabinClass === offer.cabinClass;
            const hold = unchanged
              ? null
              : await createInventoryLock(
                  flight.id,
                  booking.numberOfPassengers,
                  offer.cabinClass,
                  `service:${booking.id}:${input.idempotencyKey}`,
                  userId,
                  tx
                );
            segments.push({
              flightId: flight.id,
              cabinClass: offer.cabinClass,
              amount: offer.totalAmount,
              holdId: hold?.lockId ?? null,
              offerId: offer.id,
              departureTime: flight.departureTime.toISOString(),
              arrivalTime: flight.arrivalTime.toISOString(),
              ndc: {
                segmentKey: `SEG${segments.length + 1}`,
                flightId: flight.id,
                flightNumber: flight.flightNumber,
                airlineCode: full.airline.code,
                airlineName: full.airline.name,
                origin: full.origin,
                destination: full.destination,
                departureTime: flight.departureTime.toISOString(),
                arrivalTime: flight.arrivalTime.toISOString(),
                aircraftType: flight.aircraftType,
                cabinClass: offer.cabinClass,
              },
            });
            await consumeRetailOffer(tx, offer, booking.id);
          }
          for (let i = 1; i < segments.length; i++) {
            const a = heldFlights.get(segments[i - 1].flightId);
            const b = heldFlights.get(segments[i].flightId);
            if (
              !a ||
              !b ||
              a.destinationId !== b.originId ||
              b.departureTime.getTime() - a.arrivalTime.getTime() < 45 * 60000
            )
              throw unavailable(
                "Replacement itinerary needs a valid connection of at least 45 minutes"
              );
          }
          const first = heldFlights.get(segments[0].flightId);
          const last = heldFlights.get(segments[segments.length - 1].flightId);
          const oldLast = heldFlights.get(old[old.length - 1].flightId);
          if (
            !first ||
            !last ||
            !oldLast ||
            first.originId !== original.originId ||
            last.destinationId !== oldLast.destinationId
          )
            throw unavailable("Replacement must preserve journey endpoints");
          const fareAmount = segments.reduce((n, s) => n + s.amount, 0);
          fareDifference = fareAmount - booking.totalAmount;
          modificationFee = calculateModificationFee(
            booking.totalAmount,
            original.departureTime
          );
          newAmount = fareAmount + modificationFee;
          const allocations = allocateProportional(
            newAmount,
            segments.map(s => s.amount)
          );
          for (const [i, leg] of segments.entries())
            leg.amount = allocations[i];
        } else
          for (const item of input.ancillaries ?? []) {
            const quote = await quoteInvoiceAncillary(tx, booking, item);
            additions.push({ ...item, unitTotal: quote.totalPrice });
            newAmount += quote.totalPrice;
          }
        if (
          !Number.isSafeInteger(newAmount) ||
          newAmount <= 0 ||
          newAmount > 2147483647
        )
          throw unavailable("Invalid replacement total");
        const plan: z.infer<typeof planSchema> = {
          version: 1,
          fingerprint: fingerprint(booking, old),
          expiresAt: expiry.toISOString(),
          segments,
          ancillaries: additions,
        };
        const [insert] = await tx.insert(bookingModifications).values({
          bookingId: booking.id,
          userId,
          modificationType: segments.length ? "change_flight" : "add_services",
          originalFlightId: booking.flightId,
          originalCabinClass: booking.cabinClass,
          originalAmount: booking.totalAmount,
          newFlightId: segments[0]?.flightId ?? booking.flightId,
          newCabinClass: segments[0]?.cabinClass ?? booking.cabinClass,
          newAmount,
          priceDifference: input.offerIds
            ? fareDifference
            : newAmount - booking.totalAmount,
          modificationFee,
          totalCost: newAmount - booking.totalAmount,
          status: "pending",
          paymentStatus: "pending",
          servicingPayload: plan,
        });
        const modificationId = Number(insert.insertId);
        if (!modificationId)
          throw new Error("Modification identity unavailable");
        await recordEvent(tx, {
          aggregateType: "booking",
          aggregateId: booking.id,
          tenantId: booking.tenantId,
          eventType: "order.servicing_quoted",
          payload: {
            modificationId,
            totalCost: newAmount - booking.totalAmount,
            expiresAt: expiry.toISOString(),
          },
        });
        return {
          bookingId: booking.id,
          modificationId,
          totalCost: newAmount - booking.totalAmount,
          newAmount,
          modificationFee,
          priceDifference: input.offerIds
            ? fareDifference
            : newAmount - booking.totalAmount,
          originalAmount: booking.totalAmount,
          expiresAt: expiry,
          requiresPayment: newAmount > booking.totalAmount,
          refundDue: Math.max(0, booking.totalAmount - newAmount),
        };
      },
    },
    transaction
  );
}
/** Only settlement or the authenticated no-charge confirmation calls this inside a booking transaction. */
export async function applyPaidOrderModification(
  tx: SettlementTx,
  booking: Booking,
  change: typeof bookingModifications.$inferSelect
) {
  const plan = planSchema.parse(change.servicingPayload);
  if (
    booking.paymentStatus !== "paid" ||
    !booking.seatsReserved ||
    booking.checkedIn
  )
    throw unavailable("Booking is no longer serviceable");
  const old = await itinerary(tx, booking);
  if (
    change.status !== "pending" ||
    change.userId !== booking.userId ||
    fingerprint(booking, old) !== plan.fingerprint ||
    Date.parse(plan.expiresAt) <= Date.now()
  )
    throw unavailable("Servicing quote expired or booking changed");
  await assertTenantOperational(tx, booking.tenantId);
  if (plan.segments.length) {
    const cabin = plan.segments[0].cabinClass;
    for (const id of [
      ...new Set([
        ...old.map(l => l.flightId),
        ...plan.segments.map(l => l.flightId),
      ]),
    ].sort((a, b) => a - b)) {
      const [flight] = await tx
        .select()
        .from(flights)
        .where(eq(flights.id, id))
        .for("update");
      const target = plan.segments.find(s => s.flightId === id);
      if (
        !flight ||
        flight.tenantId !== booking.tenantId ||
        flight.departureTime <= new Date() ||
        (target &&
          (flight.departureTime.toISOString() !== target.departureTime ||
            flight.arrivalTime.toISOString() !== target.arrivalTime))
      )
        throw unavailable("Itinerary schedule changed");
    }
    for (const leg of plan.segments) {
      if (
        old.some(l => l.flightId === leg.flightId) &&
        booking.cabinClass === cabin
      )
        continue;
      const [hold] = leg.holdId
        ? await tx
            .select()
            .from(inventoryLocks)
            .where(eq(inventoryLocks.id, leg.holdId))
            .for("update")
        : [];
      if (
        !hold ||
        hold.status !== "active" ||
        hold.expiresAt <= new Date() ||
        hold.userId !== booking.userId ||
        hold.flightId !== leg.flightId ||
        hold.cabinClass !== cabin ||
        hold.numberOfSeats !== booking.numberOfPassengers
      )
        throw unavailable("Replacement capacity hold expired");
      await reserveSeats(
        tx,
        leg.flightId,
        cabin,
        booking.numberOfPassengers,
        hold.id
      );
      await tx
        .update(inventoryLocks)
        .set({ status: "converted", releasedAt: new Date() })
        .where(eq(inventoryLocks.id, hold.id));
    }
    for (const leg of old)
      if (
        !plan.segments.some(s => s.flightId === leg.flightId) ||
        booking.cabinClass !== cabin
      )
        await restoreSeats(
          tx,
          leg.flightId,
          booking.cabinClass,
          booking.numberOfPassengers
        );
    await tx
      .delete(bookingSegments)
      .where(eq(bookingSegments.bookingId, booking.id));
    await tx.insert(bookingSegments).values(
      plan.segments.map((s, i) => ({
        bookingId: booking.id,
        segmentOrder: i + 1,
        flightId: s.flightId,
        inventoryLockId: s.holdId,
        segmentAmount: s.amount,
        departureDate: new Date(s.departureTime),
        seatsReserved: true,
        status: "confirmed" as const,
      }))
    );
    await tx
      .update(seatInventory)
      .set({
        bookingId: null,
        passengerId: null,
        status: "available",
        assignedAt: null,
        checkedInAt: null,
        boardingPassIssued: false,
      })
      .where(
        and(
          eq(seatInventory.bookingId, booking.id),
          inArray(seatInventory.status, ["held", "occupied"])
        )
      );
    await tx
      .update(passengers)
      .set({ seatNumber: null, ticketNumber: null })
      .where(eq(passengers.bookingId, booking.id));
    await tx
      .update(bookings)
      .set({
        flightId: plan.segments[0].flightId,
        cabinClass: cabin,
        inventoryLockId: null,
        totalAmount: change.newAmount,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));
    const orders = await tx
      .select()
      .from(ndcOrders)
      .where(eq(ndcOrders.bookingId, booking.id))
      .for("update");
    for (const order of orders) {
      const payload = storedJson<Record<string, unknown>>(
        order.orderPayload,
        {}
      );
      payload.segments = plan.segments.map(s => s.ndc);
      payload.pricing = { totalAmount: change.newAmount, currency: "SAR" };
      payload.fulfillment = "awaiting_ticket_reissue";
      await tx
        .update(ndcOrders)
        .set({
          status: "confirmed",
          totalAmount: change.newAmount,
          orderPayload: JSON.stringify(payload),
          lastServicingAction: "PaidItineraryExchanged",
          updatedAt: new Date(),
        })
        .where(eq(ndcOrders.id, order.id));
    }
  } else {
    let current = booking;
    for (const item of plan.ancillaries) {
      const quote = await quoteInvoiceAncillary(tx, current, item);
      if (quote.totalPrice !== item.unitTotal)
        throw unavailable("Ancillary catalog changed");
      await insertInvoiceAncillary(tx, current, {
        ...item,
        metadata: {
          fulfillment: "entitlement_created",
          modificationId: change.id,
        },
      });
      current = {
        ...current,
        totalAmount: current.totalAmount + item.unitTotal,
      };
    }
    if (current.totalAmount !== change.newAmount)
      throw unavailable("Servicing invoice mismatch");
  }
  if (change.totalCost < 0)
    await planOrderRefund(tx, booking, change.id, -change.totalCost);
  const receipt = await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "order.servicing_applied",
    payload: {
      modificationId: change.id,
      previousTotal: booking.totalAmount,
      totalAmount: change.newAmount,
      refundDue: Math.max(0, -change.totalCost),
      fulfillment: plan.segments.length
        ? "awaiting_ticket_reissue"
        : "entitlement_created",
    },
  });
  await tx
    .update(bookingModifications)
    .set({
      status: "completed",
      paymentStatus: "paid",
      executionEventId: receipt,
      completedAt: new Date(),
    })
    .where(eq(bookingModifications.id, change.id));
  return { receiptId: receipt, refundDue: Math.max(0, -change.totalCost) };
}
export async function confirmNoChargeService(
  modificationId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Servicing storage unavailable");
  const [hint] = await db
    .select()
    .from(bookingModifications)
    .where(eq(bookingModifications.id, modificationId))
    .limit(1);
  if (!hint || hint.userId !== userId)
    throw unavailable("Owned modification not found");
  return db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, hint.bookingId))
      .for("update");
    const [change] = await tx
      .select()
      .from(bookingModifications)
      .where(eq(bookingModifications.id, modificationId))
      .for("update");
    if (!booking || !change || change.userId !== userId || change.totalCost > 0)
      throw unavailable("Verified payment is required");
    if (change.status === "completed" && change.executionEventId)
      return {
        receiptId: change.executionEventId,
        refundDue: Math.max(0, -change.totalCost),
      };
    return applyPaidOrderModification(tx, booking, change);
  });
}
