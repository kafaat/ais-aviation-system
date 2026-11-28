import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { bookings, users } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

const unavailable = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

/** A shared current read blocks tenant reassignment until creation or replay
 * commits, while allowing independent purchases by the same customer. It also
 * composes with the agency owner's existing shared account lock: a caller-
 * supplied transaction never exempts a purchaser from this check. */
export async function lockCreationPurchaser(tx: SettlementTx, userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw unavailable();
  const [purchaser] = await tx
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("share");
  if (!purchaser) throw unavailable();
  return purchaser.tenantId;
}

export function assertCreationTenant(
  resourceTenantId: number | null,
  purchaserTenantId: number | null,
  requestTenantId: number | null | undefined
) {
  if (
    (purchaserTenantId != null && resourceTenantId !== purchaserTenantId) ||
    (requestTenantId != null && resourceTenantId !== requestTenantId)
  )
    throw unavailable();
}

/** A cached command's booking remains the authority even if its flight's
 * present metadata changes. This read is inside the current-user lock and does
 * not acquire a booking lock after the user, avoiding the inverse lock order. */
export async function assertCreatedBookingPurchaser(
  tx: SettlementTx,
  bookingId: number,
  input: { userId: number; tenantId?: number | null },
  purchaserTenantId: number | null
) {
  const [booking] = await tx
    .select({ userId: bookings.userId, tenantId: bookings.tenantId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking || booking.userId !== input.userId) throw unavailable();
  assertCreationTenant(booking.tenantId, purchaserTenantId, input.tenantId);
}
