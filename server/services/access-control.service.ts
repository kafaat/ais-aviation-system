/**
 * Access Control Service
 *
 * Centralized ownership / tenant-isolation helpers used by tRPC routers and
 * services to guarantee that an authenticated user can only read or mutate
 * resources that belong to them. Admins (see {@link isAdmin}) bypass the
 * ownership check so they can support any tenant.
 *
 * These helpers exist to prevent IDOR (Insecure Direct Object Reference)
 * vulnerabilities where an endpoint accepts a resource ID from user input and
 * fetches/updates it without confirming the caller owns the underlying booking.
 *
 * Usage:
 * ```ts
 * await assertBookingOwnership(input.bookingId, ctx.user.id, ctx.user.role);
 * ```
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  bookings,
  paymentSplits,
  passengers,
  bookingModifications,
} from "../../drizzle/schema";
import { isAdmin } from "./rbac.service";

async function getDbOrThrow() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }
  return db;
}

/**
 * Assert that the booking exists and is owned by the given user (or the caller
 * is an admin). Throws NOT_FOUND if the booking does not exist and FORBIDDEN if
 * it belongs to a different user.
 *
 * @returns the booking's owner userId (useful for downstream logic)
 */
export async function assertBookingOwnership(
  bookingId: number,
  userId: number,
  userRole?: string
): Promise<number> {
  const db = await getDbOrThrow();

  const [booking] = await db
    .select({ userId: bookings.userId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  if (booking.userId !== userId && !(userRole && isAdmin(userRole))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }

  return booking.userId;
}

/**
 * Assert that a payment split exists and that the caller owns the booking the
 * split belongs to (or is an admin).
 *
 * @returns the bookingId the split is attached to
 */
export async function assertSplitOwnership(
  splitId: number,
  userId: number,
  userRole?: string
): Promise<number> {
  const db = await getDbOrThrow();

  const [row] = await db
    .select({ bookingId: paymentSplits.bookingId, ownerId: bookings.userId })
    .from(paymentSplits)
    .innerJoin(bookings, eq(paymentSplits.bookingId, bookings.id))
    .where(eq(paymentSplits.id, splitId))
    .limit(1);

  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Payment split not found",
    });
  }

  if (row.ownerId !== userId && !(userRole && isAdmin(userRole))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }

  return row.bookingId;
}

/**
 * Assert that a passenger exists and belongs to a booking owned by the caller
 * (or the caller is an admin).
 *
 * @returns the bookingId the passenger is attached to
 */
export async function assertPassengerOwnership(
  passengerId: number,
  userId: number,
  userRole?: string
): Promise<number> {
  const db = await getDbOrThrow();

  const [row] = await db
    .select({ bookingId: passengers.bookingId, ownerId: bookings.userId })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(eq(passengers.id, passengerId))
    .limit(1);

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Passenger not found" });
  }

  if (row.ownerId !== userId && !(userRole && isAdmin(userRole))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }

  return row.bookingId;
}

/**
 * Assert that a booking modification exists and is owned by the caller (or the
 * caller is an admin). Modifications carry their own userId column.
 */
export async function assertModificationOwnership(
  modificationId: number,
  userId: number,
  userRole?: string
): Promise<void> {
  const db = await getDbOrThrow();

  const [modification] = await db
    .select({ userId: bookingModifications.userId })
    .from(bookingModifications)
    .where(eq(bookingModifications.id, modificationId))
    .limit(1);

  if (!modification) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Modification request not found",
    });
  }

  if (modification.userId !== userId && !(userRole && isAdmin(userRole))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
}

/**
 * Convenience boolean check (does not throw) for places that need conditional
 * logic rather than an exception.
 */
export async function isBookingOwnedBy(
  bookingId: number,
  userId: number
): Promise<boolean> {
  const db = await getDbOrThrow();
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)))
    .limit(1);
  return !!booking;
}
