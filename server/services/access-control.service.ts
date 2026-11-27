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
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import {
  bookings,
  users,
  paymentSplits,
  passengers,
  bookingModifications,
} from "../../drizzle/schema";
import { isAdmin } from "./rbac.service";

import type { SettlementTx } from "./booking-settlement.service";

/** Personal accounts without an assigned airline retain purchaser-only access. */
export function purchaserBookingCondition(
  userId: number,
  tenantId: number | null | undefined
): SQL {
  const owner = eq(bookings.userId, userId);
  return tenantId == null
    ? owner
    : sql`(${owner} and ${eq(bookings.tenantId, tenantId)})`;
}

export const purchaserScope = (tenantId: number | null | undefined) =>
  tenantId == null ? undefined : { tenantId };

/** Called under the booking lock. Serialize reassignment with purchaser and
 * delegated corporate actions. Unassigned customers retain owner-only access. */
export async function lockBookingUserTenants(
  tx: SettlementTx,
  bookingTenantId: number | null,
  userIds: readonly number[],
  requestTenantId?: number | null
) {
  const ids = [...new Set(userIds)];
  const actors = await tx
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(inArray(users.id, ids))
    .orderBy(asc(users.id))
    .for("update");
  if (
    actors.length !== ids.length ||
    actors.some(
      actor =>
        actor.tenantId != null &&
        (actor.tenantId !== bookingTenantId ||
          (requestTenantId !== undefined && actor.tenantId !== requestTenantId))
    )
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Owned booking not found",
    });
}

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
 * is an admin). A booking that does not exist and a booking that belongs to a
 * different user or tenant are answered alike with NOT_FOUND (owner decision of
 * 2026-11-14, scenario S-28), so a caller cannot probe for other people's rows.
 *
 * @returns the booking's owner userId (useful for downstream logic)
 */
export async function assertBookingOwnership(
  bookingId: number,
  userId: number,
  userRole?: string,
  scope?: { tenantId: number | null }
): Promise<number> {
  const db = await getDbOrThrow();

  const [booking] = await db
    .select({ userId: bookings.userId, tenantId: bookings.tenantId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  if (booking.userId !== userId && !(userRole && isAdmin(userRole))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  if (scope) assertTenant(booking.tenantId, scope.tenantId, userRole);

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
  userRole?: string,
  scope?: { tenantId: number | null }
): Promise<number> {
  const db = await getDbOrThrow();

  const [row] = await db
    .select({
      bookingId: paymentSplits.bookingId,
      ownerId: bookings.userId,
      tenantId: bookings.tenantId,
    })
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
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Payment split not found",
    });
  }

  if (scope) assertTenant(row.tenantId, scope.tenantId, userRole);
  return row.bookingId;
}

/**
 * Assert that a passenger exists and belongs to a booking owned by the caller
 * (or the caller is an admin).
 * When scope is supplied, both passenger and booking must belong to that tenant.
 * Unassigned records fail closed; the existing platform-admin override applies.
 *
 * @returns the bookingId the passenger is attached to
 */
export async function assertPassengerOwnership(
  passengerId: number,
  userId: number,
  userRole?: string,
  scope?: { tenantId: number | null }
): Promise<number> {
  const db = await getDbOrThrow();

  const [row] = await db
    .select({
      bookingId: passengers.bookingId,
      ownerId: bookings.userId,
      passengerTenantId: passengers.tenantId,
      bookingTenantId: bookings.tenantId,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(eq(passengers.id, passengerId))
    .limit(1);

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Passenger not found" });
  }

  if (row.ownerId !== userId && !(userRole && isAdmin(userRole))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Passenger not found" });
  }

  if (scope) {
    assertTenant(row.passengerTenantId, scope.tenantId, userRole);
    assertTenant(row.bookingTenantId, scope.tenantId, userRole);
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
  userRole?: string,
  scope?: { tenantId: number | null }
): Promise<void> {
  const db = await getDbOrThrow();

  const [modification] = await db
    .select({
      userId: bookingModifications.userId,
      ownerId: bookings.userId,
      tenantId: bookings.tenantId,
    })
    .from(bookingModifications)
    .innerJoin(bookings, eq(bookings.id, bookingModifications.bookingId))
    .where(eq(bookingModifications.id, modificationId))
    .limit(1);

  if (!modification) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Modification request not found",
    });
  }

  if (
    !(userRole && isAdmin(userRole)) &&
    (modification.userId !== userId ||
      modification.ownerId !== userId ||
      (scope?.tenantId != null && modification.tenantId !== scope.tenantId))
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Modification request not found",
    });
  }
}

/**
 * Assert that a resource belonging to `resourceTenantId` may be accessed by a
 * caller scoped to `ctxTenantId`. This is the tenant-isolation counterpart to
 * the per-user ownership checks above: it prevents one airline's users from
 * touching another airline's data.
 *
 * Rules:
 *  - Admins (isAdmin(role)) bypass — platform support can cross tenants.
 *  - Unassigned resources require platform administration or explicit migration tooling.
 *  - Otherwise the caller's tenant must match the resource's tenant; a caller
 *    with no tenant context is rejected.
 */
export function assertTenant(
  resourceTenantId: number | null | undefined,
  ctxTenantId: number | null | undefined,
  userRole?: string
): void {
  if (userRole && isAdmin(userRole)) return;
  if (resourceTenantId == null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Resource tenant required",
    });
  }
  if (ctxTenantId == null || ctxTenantId !== resourceTenantId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Resource not found",
    });
  }
}

/**
 * Convenience boolean check (does not throw) for places that need conditional
 * logic rather than an exception.
 */
export async function isBookingOwnedBy(
  bookingId: number,
  userId: number,
  tenantId?: number | null
): Promise<boolean> {
  const db = await getDbOrThrow();
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.userId, userId),
        tenantId == null ? undefined : eq(bookings.tenantId, tenantId)
      )
    )
    .limit(1);
  return !!booking;
}
