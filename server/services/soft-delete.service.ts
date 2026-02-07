import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { bookings, flights, airports, passengers } from "../../drizzle/schema";
import { eq, desc, and, isNotNull, sql, count } from "drizzle-orm";

/**
 * Soft delete a booking (set deletedAt timestamp)
 */
export async function softDeleteBooking(
  bookingId: number,
  userId: number,
  isAdmin: boolean
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  if (!isAdmin && booking.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }

  // Only allow soft delete for cancelled bookings (users) or any status (admin)
  if (!isAdmin && booking.status !== "cancelled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only cancelled bookings can be deleted",
    });
  }

  await db
    .update(bookings)
    .set({ deletedAt: new Date() })
    .where(eq(bookings.id, bookingId));

  return { success: true, bookingId };
}

/**
 * Restore a soft-deleted booking (admin only)
 */
export async function restoreBooking(bookingId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  if (!booking.deletedAt) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Booking is not deleted",
    });
  }

  await db
    .update(bookings)
    .set({ deletedAt: null })
    .where(eq(bookings.id, bookingId));

  return { success: true, bookingId };
}

/**
 * Get all soft-deleted bookings (admin only)
 */
export async function getDeletedBookings(
  filters: {
    limit?: number;
    offset?: number;
  } = {}
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const result = await db
    .select({
      id: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      status: bookings.status,
      totalAmount: bookings.totalAmount,
      paymentStatus: bookings.paymentStatus,
      cabinClass: bookings.cabinClass,
      numberOfPassengers: bookings.numberOfPassengers,
      deletedAt: bookings.deletedAt,
      createdAt: bookings.createdAt,
      userId: bookings.userId,
      flightNumber: flights.flightNumber,
      origin: airports.code,
      destination: sql<string>`dest.code`,
      departureTime: flights.departureTime,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(isNotNull(bookings.deletedAt))
    .orderBy(desc(bookings.deletedAt))
    .limit(filters.limit || 50)
    .offset(filters.offset || 0);

  return result;
}

/**
 * Get count of deleted bookings
 */
export async function getDeletedBookingsCount() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [result] = await db
    .select({ count: count() })
    .from(bookings)
    .where(isNotNull(bookings.deletedAt));

  return result.count;
}

/**
 * Permanently delete old soft-deleted bookings (admin cleanup)
 * Only deletes bookings that have been soft-deleted for more than the retention period
 */
export async function purgeDeletedBookings(retentionDays: number = 90) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  // First delete associated passengers
  const deletedBookingIds = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        isNotNull(bookings.deletedAt),
        sql`${bookings.deletedAt} < ${cutoffDate}`
      )
    );

  if (deletedBookingIds.length === 0) {
    return { purgedCount: 0 };
  }

  const ids = deletedBookingIds.map(b => b.id);

  for (const id of ids) {
    await db.delete(passengers).where(eq(passengers.bookingId, id));
  }

  // Then delete the bookings
  await db
    .delete(bookings)
    .where(
      and(
        isNotNull(bookings.deletedAt),
        sql`${bookings.deletedAt} < ${cutoffDate}`
      )
    );

  return { purgedCount: ids.length };
}
