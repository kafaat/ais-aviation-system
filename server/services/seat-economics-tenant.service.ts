import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { bookings } from "../../drizzle/schema";
import { getDb } from "../db";
import { getBookingSeatEconomics } from "./seat-economics.service";
import { tenantCondition } from "./tenant-scope.service";

/**
 * Tenant-safe entry point for per-booking seat economics.
 *
 * The booking must belong to the authenticated tenant before any financial
 * detail is computed. Missing tenant context fails closed in tenantCondition.
 */
export async function getTenantBookingSeatEconomics(
  bookingId: number,
  tenantId: number | null | undefined,
  opts: { paymentFeeRate?: number; paymentFeeFixed?: number } = {}
) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [ownedBooking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, bookingId),
        tenantCondition(bookings.tenantId, tenantId)
      )
    )
    .limit(1);

  if (!ownedBooking) {
    // Do not disclose whether a booking exists in another tenant.
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  return getBookingSeatEconomics(ownedBooking.id, opts);
}
