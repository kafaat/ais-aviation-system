import { matchesPaidSeatProduct } from "../../shared/paid-seat";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ancillaryServices,
  bookingAncillaries,
  bookingSegments,
  bookingRefundPlans,
  paymentReceipts,
  outbox,
  passengers,
  seatInventory,
  type Booking,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { assertBookingCapability } from "./ndc-capability-matrix";

const positive = z.number().int().positive();
const paidSeatBinding = z.object({
  seatId: positive,
  flightId: positive,
  seatNumber: z.string().min(1),
  fundingEventId: z.string().uuid().nullable(),
});
type Binding = z.infer<typeof paidSeatBinding>;
type Ancillary = typeof bookingAncillaries.$inferSelect;
type Seat = typeof seatInventory.$inferSelect;

const blocked = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });

export const seatExchangeSchema = z.object({
  retainedAmount: z.number().int().nonnegative(),
  seats: z.array(
    z.object({
      ancillaryId: positive,
      passengerId: positive,
      fromFlightId: positive,
      toFlightId: positive,
      fromSeatId: positive,
      toSeatId: positive,
      seatNumber: z.string(),
      amount: positive,
    })
  ),
});

function getBinding(ancillary: Ancillary): Binding | undefined {
  if (!ancillary.metadata) return;
  let metadata;
  try {
    metadata = JSON.parse(ancillary.metadata);
  } catch {
    return;
  }
  if (!metadata?.paidSeat) return;
  return paidSeatBinding.parse(metadata.paidSeat);
}

function activeItems(tx: SettlementTx, bookingId: number) {
  return tx
    .select()
    .from(bookingAncillaries)
    .where(
      and(
        eq(bookingAncillaries.bookingId, bookingId),
        eq(bookingAncillaries.status, "active")
      )
    )
    .orderBy(asc(bookingAncillaries.id))
    .for("update");
}

/** Historical baggage could be assigned for fulfillment while its price was spread across legs. */
export function allocatedAncillarySegmentId(item: Ancillary) {
  if (!item.metadata) return;
  let metadata;
  try {
    metadata = JSON.parse(item.metadata);
  } catch {
    return;
  }
  if (
    !(
      metadata?.source === "initial_booking" ||
      metadata?.segmentAllocated === true ||
      getBinding(item)
    )
  )
    return;
  if (!item.segmentId || item.scopeState !== "specific_segment")
    throw blocked("Ancillary segment allocation requires reconciliation");
  return item.segmentId;
}

export async function allocatedAncillaryFeesBySegment(
  tx: SettlementTx,
  bookingId: number
) {
  const fees = new Map<number, number>();
  for (const item of await activeItems(tx, bookingId)) {
    const segmentId = allocatedAncillarySegmentId(item);
    if (segmentId !== undefined)
      fees.set(segmentId, (fees.get(segmentId) ?? 0) + item.totalPrice);
  }
  return fees;
}

async function claimSeat(
  tx: SettlementTx,
  target: Seat,
  bookingId: number,
  passengerId: number,
  status: "occupied" | "held"
) {
  const [result] = await tx
    .update(seatInventory)
    .set({ status, bookingId, passengerId, assignedAt: new Date() })
    .where(
      and(
        eq(seatInventory.id, target.id),
        eq(seatInventory.status, "available"),
        isNull(seatInventory.bookingId),
        isNull(seatInventory.passengerId)
      )
    );
  if (result.affectedRows !== 1)
    throw blocked("Selected seat is no longer available");
}

/** Called while the owner's editable invoice and flight are locked. The server constructs the binding. */
export async function holdInvoiceSeat(
  tx: SettlementTx,
  booking: Booking,
  passengerId: number,
  flightId: number,
  seatNumber: string,
  serviceCode: string,
  price: number
) {
  const seats = await tx
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, seatNumber)
      )
    )
    .for("update");
  const seat = seats[0];
  if (
    seats.length !== 1 ||
    !matchesPaidSeatProduct(serviceCode, seat) ||
    price <= 0 ||
    seat.seatPrice !== price ||
    seat.cabinClass !== booking.cabinClass
  )
    throw blocked(
      "No matching paid seat for the selected service, fare and cabin"
    );
  const existing = await tx
    .select({ id: seatInventory.id })
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.passengerId, passengerId)
      )
    )
    .limit(1)
    .for("update");
  if (existing.length)
    throw blocked("Passenger already has a seat on this flight");
  await claimSeat(tx, seat, booking.id, passengerId, "held");
  return {
    seatId: seat.id,
    flightId,
    seatNumber: seat.seatNumber,
    fundingEventId: null,
  };
}

export async function removeInvoiceSeat(tx: SettlementTx, item: Ancillary) {
  const binding = getBinding(item);
  if (!binding) return;
  if (!item.passengerId || !item.segmentId || binding.fundingEventId)
    throw blocked("Paid seat requires servicing");
  const [result] = await tx
    .update(seatInventory)
    .set({
      status: "available",
      bookingId: null,
      passengerId: null,
      assignedAt: null,
    })
    .where(
      and(
        eq(seatInventory.id, binding.seatId),
        eq(seatInventory.bookingId, item.bookingId),
        eq(seatInventory.passengerId, item.passengerId),
        eq(seatInventory.status, "held")
      )
    );
  if (result.affectedRows !== 1) {
    // An expiry sweep may already have released and reassigned an unpaid hold.
    // Remove only this invoice line; never release the new occupant's seat.
    const [current] = await tx
      .select()
      .from(seatInventory)
      .where(eq(seatInventory.id, binding.seatId))
      .for("update");
    if (
      current?.bookingId === item.bookingId &&
      current.passengerId === item.passengerId
    )
      throw blocked("Seat allocation changed before removal");
  }
  return item.segmentId;
}

export async function fundInvoiceSeats(
  tx: SettlementTx,
  bookingId: number,
  confirmationEventId: string
) {
  for (const item of await activeItems(tx, bookingId)) {
    const binding = getBinding(item);
    if (!binding) continue;
    if (!item.passengerId || !item.segmentId || binding.fundingEventId)
      throw blocked("Invalid seat invoice binding");
    const [claim] = await tx
      .update(seatInventory)
      .set({ status: "occupied" })
      .where(
        and(
          eq(seatInventory.id, binding.seatId),
          eq(seatInventory.bookingId, bookingId),
          eq(seatInventory.passengerId, item.passengerId),
          eq(seatInventory.status, "held")
        )
      );
    if (claim.affectedRows !== 1)
      throw blocked("Paid seat hold unavailable at settlement");
    await tx
      .update(bookingAncillaries)
      .set({
        fundedAt: new Date(),
        metadata: JSON.stringify({
          paidSeat: { ...binding, fundingEventId: confirmationEventId },
        }),
      })
      .where(eq(bookingAncillaries.id, item.id));
  }
}

/** Inspect funded, passenger-scoped seat entitlements under the booking lock, without moving any seats or money. */
export async function quoteSeatExchange(
  tx: SettlementTx,
  booking: Booking,
  oldFlightIds: number[],
  newFlightIds: number[],
  newCabin: Booking["cabinClass"]
) {
  const plan: z.infer<typeof seatExchangeSchema> = {
    retainedAmount: 0,
    seats: [],
  };
  let seatMoveAllowed = false;
  const items = await activeItems(tx, booking.id);
  const assigned = await tx
    .select()
    .from(seatInventory)
    .where(eq(seatInventory.bookingId, booking.id))
    .for("update");
  for (const item of items) {
    const binding = getBinding(item);
    if (
      !binding?.fundingEventId ||
      !item.fundedAt ||
      !item.passengerId ||
      !item.segmentId ||
      item.scopeState !== "specific_segment" ||
      item.quantity !== 1 ||
      item.totalPrice !== item.unitPrice ||
      item.totalPrice <= 0 ||
      oldFlightIds.length !== newFlightIds.length ||
      booking.cabinClass !== newCabin
    )
      throw blocked(
        "Existing ancillary fulfillment must be reconciled before itinerary exchange"
      );
    const [svc] = await tx
      .select()
      .from(ancillaryServices)
      .where(eq(ancillaryServices.id, item.ancillaryServiceId));
    const [pax] = await tx
      .select()
      .from(passengers)
      .where(
        and(
          eq(passengers.id, item.passengerId),
          eq(passengers.bookingId, booking.id)
        )
      );
    const [receipt] = await tx
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.eventId, binding.fundingEventId),
          eq(outbox.aggregateId, String(booking.id)),
          eq(outbox.aggregateType, "booking"),
          eq(outbox.eventType, "booking.confirmed")
        )
      );
    const [leg] = await tx
      .select()
      .from(bookingSegments)
      .where(
        and(
          eq(bookingSegments.id, item.segmentId),
          eq(bookingSegments.bookingId, booking.id)
        )
      );
    const source = assigned.find(s => s.id === binding.seatId);
    const i = oldFlightIds.indexOf(binding.flightId);
    if (
      !receipt ||
      !pax ||
      pax.tenantId !== booking.tenantId ||
      svc?.category !== "seat" ||
      !leg ||
      leg.flightId !== binding.flightId ||
      i < 0 ||
      !source ||
      source.passengerId !== pax.id ||
      source.flightId !== leg.flightId ||
      source.status !== "occupied" ||
      source.seatNumber !== binding.seatNumber ||
      source.cabinClass !== newCabin ||
      source.seatPrice !== item.totalPrice ||
      plan.seats.some(s => s.fromSeatId === source.id)
    )
      throw blocked("Paid seat allocation needs reconciliation");
    const to = newFlightIds[i];
    let target = source;
    if (to !== source.flightId) {
      // Moving a paid seat is a distinct capability from the exchange itself.
      if (!seatMoveAllowed) {
        await assertBookingCapability(tx, booking, "seat_move");
        seatMoveAllowed = true;
      }
      const matches = await tx
        .select()
        .from(seatInventory)
        .where(
          and(
            eq(seatInventory.flightId, to),
            eq(seatInventory.seatNumber, source.seatNumber)
          )
        )
        .for("update");
      target = matches[0];
      if (
        matches.length !== 1 ||
        !target ||
        target.status !== "available" ||
        target.bookingId !== null ||
        target.passengerId !== null ||
        target.cabinClass !== source.cabinClass ||
        target.seatPrice !== source.seatPrice ||
        target.seatType !== source.seatType ||
        target.priceTier !== source.priceTier ||
        target.hasExtraLegroom !== source.hasExtraLegroom ||
        target.hasPowerOutlet !== source.hasPowerOutlet ||
        target.isReclinable !== source.isReclinable ||
        target.nearLavatory !== source.nearLavatory ||
        target.nearGalley !== source.nearGalley
      )
        throw blocked(
          "Equivalent paid seat unavailable; operator review is required before collection"
        );
    }
    plan.retainedAmount += item.totalPrice;
    plan.seats.push({
      ancillaryId: item.id,
      passengerId: pax.id,
      fromFlightId: source.flightId,
      toFlightId: to,
      fromSeatId: source.id,
      toSeatId: target.id,
      seatNumber: source.seatNumber,
      amount: item.totalPrice,
    });
  }
  if (plan.seats.length) {
    const [reversal] = await tx
      .select({ id: paymentReceipts.paymentIntentId })
      .from(paymentReceipts)
      .where(
        and(
          eq(paymentReceipts.bookingId, booking.id),
          inArray(paymentReceipts.kind, ["booking", "split_payment"]),
          gt(paymentReceipts.refundedAmount, 0)
        )
      )
      .limit(1)
      .for("update");
    const [cancellation] = await tx
      .select({ id: bookingRefundPlans.id })
      .from(bookingRefundPlans)
      .where(eq(bookingRefundPlans.bookingId, booking.id))
      .limit(1)
      .for("update");
    if (reversal || cancellation)
      throw blocked(
        "Verify seat funding allocation after a booking refund before exchange"
      );
  }
  if (
    assigned.some(
      s => s.seatPrice > 0 && !plan.seats.some(x => x.fromSeatId === s.id)
    )
  )
    throw blocked("Paid seat has no matching funding evidence");
  return plan;
}

export async function transferExchangeSeats(
  tx: SettlementTx,
  booking: Booking,
  plan: z.infer<typeof seatExchangeSchema>
) {
  for (const seat of plan.seats) {
    if (seat.fromSeatId === seat.toSeatId) continue;
    const [item] = await tx
      .select()
      .from(bookingAncillaries)
      .where(
        and(
          eq(bookingAncillaries.id, seat.ancillaryId),
          eq(bookingAncillaries.bookingId, booking.id)
        )
      )
      .for("update");
    const binding = item && getBinding(item);
    if (!binding?.fundingEventId || binding.seatId !== seat.fromSeatId)
      throw blocked("Paid seat entitlement changed");
    const [target] = await tx
      .select()
      .from(seatInventory)
      .where(eq(seatInventory.id, seat.toSeatId))
      .for("update");
    if (!target || target.flightId !== seat.toFlightId)
      throw blocked("Replacement seat unavailable");
    await claimSeat(tx, target, booking.id, seat.passengerId, "occupied");
    const [release] = await tx
      .update(seatInventory)
      .set({
        status: "available",
        bookingId: null,
        passengerId: null,
        assignedAt: null,
        checkedInAt: null,
        boardingPassIssued: false,
        checkInNonce: null,
        boardingGroup: null,
        boardingSequence: null,
      })
      .where(
        and(
          eq(seatInventory.id, seat.fromSeatId),
          eq(seatInventory.bookingId, booking.id),
          eq(seatInventory.passengerId, seat.passengerId),
          eq(seatInventory.status, "occupied")
        )
      );
    if (release.affectedRows !== 1) throw blocked("Original paid seat changed");
    await tx
      .update(bookingAncillaries)
      .set({
        metadata: JSON.stringify({
          paidSeat: {
            ...binding,
            seatId: target.id,
            flightId: target.flightId,
          },
        }),
      })
      .where(eq(bookingAncillaries.id, item.id));
  }
}
