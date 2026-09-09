import { and, eq, gt, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookings,
  flights,
  inventoryLocks,
  bookingStatusHistory,
  paymentReceipts,
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
  if (booking.paymentStatus === "paid" && booking.seatsReserved) return;
  if (booking.status !== "pending")
    throw new BookingNotPendingError("Booking is not awaiting settlement");
  await reserveSeats(
    tx,
    booking.flightId,
    booking.cabinClass,
    booking.numberOfPassengers,
    booking.inventoryLockId
  );
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
  if (booking.inventoryLockId)
    await tx
      .update(inventoryLocks)
      .set({ status: "converted", releasedAt: new Date() })
      .where(eq(inventoryLocks.id, booking.inventoryLockId));
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
  const [holds] = await tx
    .select({
      count: sql<number>`COALESCE(SUM(${inventoryLocks.numberOfSeats}), 0)`,
    })
    .from(inventoryLocks)
    .where(
      and(
        eq(inventoryLocks.flightId, flightId),
        eq(inventoryLocks.cabinClass, cabin),
        eq(inventoryLocks.status, "active"),
        gt(inventoryLocks.expiresAt, new Date()),
        ownLockId ? ne(inventoryLocks.id, ownLockId) : undefined
      )
    );
  const column =
    cabin === "business" ? flights.businessAvailable : flights.economyAvailable;
  const available =
    cabin === "business" ? flight.businessAvailable : flight.economyAvailable;
  if (available - Number(holds?.count || 0) < count)
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
  await restoreSeats(
    tx,
    booking.flightId,
    booking.cabinClass,
    booking.numberOfPassengers
  );
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
