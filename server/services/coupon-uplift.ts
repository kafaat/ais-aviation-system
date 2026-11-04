import { and, eq, inArray } from "drizzle-orm";
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

const handlerDocument = z.strictObject({
  ticketNumber: z.string().regex(/^\d{13}$/),
  couponNumber: z.number().int().positive(),
});

const upliftReference = z.union([couponUpliftPayload, handlerDocument]);

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
  const ref = upliftReference.parse(e.payload);
  const byDocument = "ticketNumber" in ref;
  const source = verifyAviationSource(
    e,
    signature,
    byDocument ? "handler_etl" : "coupon_uplift"
  );
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
    const couponMatch = and(
      eq(ticketCoupons.flightId, flightId),
      byDocument
        ? and(
            eq(ticketCoupons.ticketNumber, ref.ticketNumber),
            eq(ticketCoupons.couponNumber, ref.couponNumber)
          )
        : and(
            eq(ticketCoupons.id, ref.couponId),
            eq(ticketCoupons.passengerId, ref.passengerId)
          )
    );
    // Lock the booking before its coupon, in the same order as cancellation.
    const bookingMatch = byDocument
      ? inArray(
          bookings.id,
          tx
            .select({ id: ticketCoupons.bookingId })
            .from(ticketCoupons)
            .where(couponMatch)
        )
      : eq(bookings.id, ref.bookingId);
    const [booking] = await tx
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(and(bookingMatch, eq(bookings.tenantId, tenantId)))
      .for("update");
    if (!booking)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Coupon not eligible for this source",
      });
    const [row] = await tx
      .select({ coupon: ticketCoupons, flight: flights })
      .from(ticketCoupons)
      .innerJoin(flights, eq(flights.id, ticketCoupons.flightId))
      .where(
        and(
          couponMatch,
          eq(ticketCoupons.bookingId, booking.id),
          eq(flights.tenantId, tenantId)
        )
      )
      .for("update");
    if (
      !row ||
      !source.airlineIds?.includes(row.flight.airlineId) ||
      ((byDocument || source.airportIds !== undefined) &&
        !source.airportIds?.includes(row.flight.originId)) ||
      row.flight.status !== "completed" ||
      row.flight.departureTime.getTime() > Date.parse(e.observedAt) ||
      row.coupon.createdAt.getTime() > Date.parse(e.observedAt)
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Uplift must match an issued coupon on a completed operator flight",
      });
    // Keep the original signed payload and attach AIS's financial mapping separately.
    const snapshot = byDocument
      ? {
          at: new Date(),
          payload: {
            bookingId: booking.id,
            passengerId: row.coupon.passengerId,
            couponId: row.coupon.id,
            originId: row.flight.originId,
          },
        }
      : undefined;
    const receipt = await persistAviationEvidence(tx, e, source, snapshot);
    if (receipt.duplicate && row.coupon.status === "F") return receipt;
    if (
      booking.status === "cancelled" ||
      row.coupon.status !== "C" ||
      receipt.duplicate
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Only a checked-in coupon can accept a new uplift receipt",
      });
    await tx
      .update(ticketCoupons)
      .set({ status: "F" })
      .where(eq(ticketCoupons.id, row.coupon.id));
    return receipt;
  });
}
