import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { bookings, flights, ticketCoupons } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  type EvidenceEnvelope,
  persistAviationEvidence,
  verifyAviationSource,
} from "./aviation-evidence.service";

export const couponUpliftPayload = z.strictObject({
  couponId: z.number().int().positive(),
  bookingId: z.number().int().positive(),
  passengerId: z.number().int().positive(),
});

/** Inbound operator attestation for one completed carriage; a boarding scan
 * or a flight's scheduled time alone cannot establish passenger uplift. */
export async function ingestCouponUplift(
  e: EvidenceEnvelope,
  signature: string
) {
  if (process.env.NODE_ENV === "production")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Production uplift acceptance is pending",
    });
  const source = verifyAviationSource(e, signature, "coupon_uplift");
  const payload = couponUpliftPayload.parse(e.payload);
  if (!source.tenantId || e.kind !== "coupon_uplift" || !e.flightId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Scoped coupon uplift required",
    });
  const flightId = e.flightId,
    tenantId = source.tenantId;
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return await db.transaction(async tx => {
    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(eq(bookings.id, payload.bookingId), eq(bookings.tenantId, tenantId))
      )
      .for("update");
    const [row] = await tx
      .select({ coupon: ticketCoupons, flight: flights })
      .from(ticketCoupons)
      .innerJoin(flights, eq(flights.id, ticketCoupons.flightId))
      .where(
        and(
          eq(ticketCoupons.id, payload.couponId),
          eq(ticketCoupons.bookingId, payload.bookingId),
          eq(ticketCoupons.passengerId, payload.passengerId),
          eq(ticketCoupons.flightId, flightId),
          eq(flights.tenantId, tenantId)
        )
      )
      .for("update");
    if (
      !booking ||
      !row ||
      !source.airlineIds?.includes(row.flight.airlineId) ||
      row.flight.status !== "completed" ||
      row.flight.departureTime.getTime() > Date.parse(e.observedAt) ||
      row.coupon.createdAt.getTime() > Date.parse(e.observedAt)
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Uplift must match an issued coupon on a completed operator flight",
      });
    const receipt = await persistAviationEvidence(tx, e, source);
    if (receipt.duplicate && row.coupon.status === "F") return receipt;
    if (row.coupon.status !== "C" || receipt.duplicate)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Only a checked-in coupon can accept a new uplift receipt",
      });
    await tx
      .update(ticketCoupons)
      .set({ status: "F" })
      .where(eq(ticketCoupons.id, payload.couponId));
    return receipt;
  });
}
