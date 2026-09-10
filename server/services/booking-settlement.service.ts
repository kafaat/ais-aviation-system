import { countActiveHolds } from "./inventory-capacity.service";
import { and, eq, asc, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookings,
  flights,
  inventoryLocks,
  bookingStatusHistory,
  paymentReceipts,
  bookingSegments,
  seatHolds,
  type Booking,
} from "../../drizzle/schema";
import type { getDb } from "../db";
import { recordEvent } from "./outbox.service";

export type SettlementTx = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Expected business rejection, distinct from a database/outbox failure. */
export class InventoryUnavailableError extends Error {}
export class BookingNotPendingError extends Error {}

export async function assertNoCollectionReview(
  tx: SettlementTx,
  bookingId: number
) {
  const [pending] = await tx
    .select({ id: paymentReceipts.paymentIntentId })
    .from(paymentReceipts)
    .where(
      and(
        eq(paymentReceipts.bookingId, bookingId),
        eq(paymentReceipts.settlementStatus, "review_required")
      )
    )
    .limit(1);
  if (pending)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A collected payment is awaiting review. Contact support before paying again.",
    });
}

/** Caller holds the booking row lock; flight locking also serializes new holds. */
export async function confirmFundedBooking(
  tx: SettlementTx,
  booking: Booking,
  paymentIntentId?: string
) {
  // A rejected later leg must undo earlier leg reservations before the outer
  // payment transaction records the collected funds for operator review.
  return tx.transaction(inner =>
    applyFundedBooking(inner, booking, paymentIntentId)
  );
}

async function applyFundedBooking(
  tx: SettlementTx,
  booking: Booking,
  paymentIntentId?: string
) {
  if (booking.paymentStatus === "paid" && booking.seatsReserved) return;
  if (booking.status !== "pending")
    throw new BookingNotPendingError("Booking is not awaiting settlement");
  const segments = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(asc(bookingSegments.flightId))
    .for("update");
  // Historical channel bookings may reserve only the primary leg. Never mark
  // unreserved connecting legs as reserved merely because the booking flag is set.
  const legs = segments.length
    ? segments
    : [
        {
          flightId: booking.flightId,
          inventoryLockId: booking.inventoryLockId,
          seatsReserved: booking.seatsReserved,
        },
      ];
  const legacyPrimaryReserved =
    booking.seatsReserved &&
    segments.length > 0 &&
    !segments.some(segment => segment.seatsReserved);
  for (const segment of legs) {
    if (
      segment.seatsReserved ||
      (legacyPrimaryReserved && segment.flightId === booking.flightId)
    )
      continue;
    await reserveSeats(
      tx,
      segment.flightId,
      booking.cabinClass,
      booking.numberOfPassengers,
      segment.inventoryLockId
    );
  }
  if (segments.length)
    await tx
      .update(bookingSegments)
      .set({ status: "confirmed", seatsReserved: true })
      .where(eq(bookingSegments.bookingId, booking.id));
  await tx
    .update(bookings)
    .set({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
      ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, booking.id));
  const holdIds = [
    ...new Set(
      [booking.inventoryLockId, ...segments.map(s => s.inventoryLockId)].filter(
        (id): id is number => id != null
      )
    ),
  ];
  if (holdIds.length) {
    await tx
      .update(inventoryLocks)
      .set({ status: "converted", releasedAt: new Date() })
      .where(
        and(
          inArray(inventoryLocks.id, holdIds),
          eq(inventoryLocks.status, "active")
        )
      );
    await tx
      .update(seatHolds)
      .set({ status: "converted", bookingId: booking.id })
      .where(
        and(
          inArray(seatHolds.inventoryLockId, holdIds),
          eq(seatHolds.status, "active")
        )
      );
  }
  await tx.insert(bookingStatusHistory).values({
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    previousStatus: booking.status,
    newStatus: "confirmed",
    transitionReason: "Verified funds settled with inventory",
    changedBy: null,
  });
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "booking.confirmed",
    payload: { bookingId: booking.id },
  });
}

export async function reserveSeats(
  tx: SettlementTx,
  flightId: number,
  cabin: "economy" | "business",
  count: number,
  ownLockId?: number | null
) {
  const [flight] = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1)
    .for("update");
  if (!flight || !["scheduled", "delayed"].includes(flight.status))
    throw new InventoryUnavailableError("Flight is unavailable");
  const heldSeats = await countActiveHolds(tx, flightId, cabin, ownLockId);
  const column =
    cabin === "business" ? flights.businessAvailable : flights.economyAvailable;
  const available =
    cabin === "business" ? flight.businessAvailable : flight.economyAvailable;
  if (available - heldSeats < count)
    throw new InventoryUnavailableError(
      `Insufficient ${cabin} inventory for booking`
    );
  const [updated] = await tx
    .update(flights)
    .set(
      cabin === "business"
        ? { businessAvailable: sql`${column} - ${count}` }
        : { economyAvailable: sql`${column} - ${count}` }
    )
    .where(and(eq(flights.id, flightId), sql`${column} >= ${count}`));
  if (updated.affectedRows !== 1)
    throw new InventoryUnavailableError(
      `Insufficient ${cabin} inventory for booking`
    );
}

export async function releaseBookingSeats(tx: SettlementTx, booking: Booking) {
  if (!booking.seatsReserved) return;
  const segments = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(asc(bookingSegments.flightId))
    .for("update");
  const reserved = segments.filter(s => s.seatsReserved);
  // Pre-upgrade bookings only reserved their primary flight. Never invent
  // restoration of seats that those historical segments did not reserve.
  for (const segment of reserved.length
    ? reserved
    : [{ flightId: booking.flightId }]) {
    await restoreSeats(
      tx,
      segment.flightId,
      booking.cabinClass,
      booking.numberOfPassengers
    );
  }
  if (segments.length)
    await tx
      .update(bookingSegments)
      .set({ seatsReserved: false })
      .where(eq(bookingSegments.bookingId, booking.id));
  await tx
    .update(bookings)
    .set({ seatsReserved: false })
    .where(eq(bookings.id, booking.id));
}

export async function restoreSeats(
  tx: SettlementTx,
  flightId: number,
  cabin: "economy" | "business",
  count: number
) {
  await tx
    .update(flights)
    .set(
      cabin === "business"
        ? { businessAvailable: sql`${flights.businessAvailable} + ${count}` }
        : { economyAvailable: sql`${flights.economyAvailable} + ${count}` }
    )
    .where(eq(flights.id, flightId));
}

/** Caller holds the booking lock. All cancellation paths share this command. */
export async function cancelBookingResources(
  tx: SettlementTx,
  booking: Booking,
  reason: string,
  actorId: number | null = null
) {
  if (booking.status === "cancelled") return;
  if (booking.status === "completed")
    throw new BookingNotPendingError("Completed booking cannot be cancelled");
  await assertNoCollectionReview(tx, booking.id);
  await releaseBookingSeats(tx, booking);
  const segments = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id));
  const holdIds = [
    ...new Set(
      [booking.inventoryLockId, ...segments.map(s => s.inventoryLockId)].filter(
        (id): id is number => id != null
      )
    ),
  ];
  if (holdIds.length) {
    await tx
      .update(inventoryLocks)
      .set({ status: "released", releasedAt: new Date() })
      .where(
        and(
          inArray(inventoryLocks.id, holdIds),
          eq(inventoryLocks.status, "active")
        )
      );
    await tx
      .update(seatHolds)
      .set({ status: "released" })
      .where(
        and(
          inArray(seatHolds.inventoryLockId, holdIds),
          eq(seatHolds.status, "active")
        )
      );
  }
  await tx
    .update(bookingSegments)
    .set({ status: "cancelled" })
    .where(eq(bookingSegments.bookingId, booking.id));
  await tx
    .update(bookings)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(bookings.id, booking.id));
  await tx.insert(bookingStatusHistory).values({
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    previousStatus: booking.status,
    newStatus: "cancelled",
    transitionReason: reason,
    changedBy: actorId,
  });
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "booking.cancelled",
    payload: { bookingId: booking.id, reason, actorId },
  });
}
