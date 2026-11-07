import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  airports,
  bookingModifications,
  bookings,
  bookingSegments,
  flights,
  orderServiceRefunds,
  paymentReceipts,
} from "../../drizzle/schema";
import { revalidationReceipt } from "./ticket-revalidation.service";
import { getDb } from "../db";
import {
  bookingDistributionContext,
  capabilitySummaryOutput,
  resolveCapabilitySummary,
} from "./ndc-capability-matrix";
import { logServicingAccessDenied } from "./audit.service";
import type { SettlementTx } from "./booking-settlement.service";
import { servicingQuoteVersion } from "./order-servicing.service";

const flight = z.object({
  flightId: z.number().int(),
  flightNumber: z.string(),
  originId: z.number().int(),
  destinationId: z.number().int(),
  origin: z.string(),
  destination: z.string(),
  originTimezone: z.string().nullable(),
  departureTime: z.date(),
});
const retainedSeats = z.object({
  seats: z.array(
    z.object({ seatNumber: z.string(), amount: z.number().int().nonnegative() })
  ),
  retainedAmount: z.number().int().nonnegative(),
});
const quoteMetadata = z.object({
  expiresAt: z.iso.datetime(),
  termsHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  seatExchange: retainedSeats.optional(),
  revalidation: revalidationReceipt.optional(),
});
export const exchangeContextOutput = z.object({
  /** Which servicing actions the booking's distribution combination allows. */
  capabilities: capabilitySummaryOutput,
  sectors: z.array(flight.extend({ status: z.string() })),
  latest: z
    .object({
      modificationId: z.number().int(),
      status: z.enum(["pending", "approved", "completed", "rejected"]),
      checkoutStarted: z.boolean(),
      reviewRequired: z.boolean(),
      receiptId: z.string().nullable(),
      revalidation: revalidationReceipt.nullable().optional(),
      refundStatus: z.enum(["processing", "completed", "review"]).nullable(),
      originalFlight: flight.nullable(),
      replacementFlight: flight.nullable(),
      originalAmount: z.number().int(),
      newAmount: z.number().int(),
      modificationFee: z.number().int(),
      priceDifference: z.number().int(),
      totalCost: z.number().int(),
      currency: z.literal("SAR"),
      /** Digest of the quoted amounts; consent must name it to execute. */
      quoteVersion: z.string().nullable(),
      expiresAt: z.date().nullable(),
      seatExchange: retainedSeats.nullable(),
    })
    .nullable(),
});

/** Read the current order and servicing receipt together after a lost response. */
export async function getExchangeContext(
  bookingId: number,
  userId: number,
  tenantId: number | null
) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  try {
    return await db.transaction(tx => read(tx));
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND")
      logServicingAccessDenied({
        userId,
        tenantId,
        bookingId,
        action: "order.servicing.context",
      });
    throw error;
  }
  async function read(tx: SettlementTx) {
    const [booking] = await tx
      .select({ flightId: bookings.flightId, status: bookings.status })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.userId, userId),
          isNull(bookings.deletedAt),
          tenantId === null ? undefined : eq(bookings.tenantId, tenantId)
        )
      )
      .limit(1);
    if (!booking)
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    const segments = await tx
      .select({
        flightId: bookingSegments.flightId,
        status: bookingSegments.status,
      })
      .from(bookingSegments)
      .where(eq(bookingSegments.bookingId, bookingId))
      .orderBy(asc(bookingSegments.segmentOrder));
    const itinerary = segments.length ? segments : [booking];
    const [change] = await tx
      .select()
      .from(bookingModifications)
      .where(
        and(
          eq(bookingModifications.bookingId, bookingId),
          eq(bookingModifications.userId, userId)
        )
      )
      .orderBy(
        desc(sql`${bookingModifications.status} = 'pending'`),
        desc(bookingModifications.id)
      )
      .limit(1);
    const ids = itinerary.map(s => s.flightId);
    if (change?.originalFlightId) ids.push(change.originalFlightId);
    if (change?.newFlightId) ids.push(change.newFlightId);
    const rows = await tx
      .select({
        flightId: flights.id,
        flightNumber: flights.flightNumber,
        originId: flights.originId,
        destinationId: flights.destinationId,
        origin: airports.code,
        destination: sql<string>`dest.code`,
        originTimezone: airports.timezone,
        departureTime: flights.departureTime,
      })
      .from(flights)
      .innerJoin(airports, eq(flights.originId, airports.id))
      .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
      .where(inArray(flights.id, ids));
    const byId = new Map(rows.map(r => [r.flightId, r]));
    const sectors = itinerary.map(leg => {
      const row = byId.get(leg.flightId);
      if (!row)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Itinerary flight unavailable",
        });
      return { ...row, status: leg.status };
    });
    const capabilities = await resolveCapabilitySummary(
      tx,
      await bookingDistributionContext(tx, {
        id: bookingId,
        flightId: booking.flightId,
      })
    );
    if (!change) return { capabilities, sectors, latest: null };
    const payload = quoteMetadata.safeParse(change.servicingPayload);
    const [collectionReview] = await tx
      .select({ id: paymentReceipts.targetId })
      .from(paymentReceipts)
      .where(
        and(
          eq(paymentReceipts.bookingId, bookingId),
          eq(paymentReceipts.kind, "modification"),
          eq(paymentReceipts.targetId, change.id),
          inArray(paymentReceipts.settlementStatus, [
            "review_required",
            "review_refunded",
          ])
        )
      )
      .limit(1);
    const refunds = await tx
      .select({ status: orderServiceRefunds.status })
      .from(orderServiceRefunds)
      .where(
        and(
          eq(orderServiceRefunds.bookingId, bookingId),
          eq(orderServiceRefunds.modificationId, change.id)
        )
      );
    let refundStatus: "completed" | "review" | "processing" | null = null;
    if (refunds.length)
      refundStatus = refunds.every(r => r.status === "succeeded")
        ? "completed"
        : refunds.some(
              r => r.status === "review_required" || r.status === "failed"
            )
          ? "review"
          : "processing";
    return {
      capabilities,
      sectors,
      latest: {
        modificationId: change.id,
        status: change.status,
        checkoutStarted: Boolean(change.checkoutRequestId),
        reviewRequired:
          Boolean(collectionReview) ||
          !payload.success ||
          change.modificationType === "add_services",
        receiptId: change.executionEventId,
        revalidation: payload.success
          ? (payload.data.revalidation ?? null)
          : null,
        refundStatus,
        originalFlight: byId.get(change.originalFlightId ?? 0) ?? null,
        replacementFlight: byId.get(change.newFlightId ?? 0) ?? null,
        originalAmount: change.originalAmount,
        newAmount: change.newAmount,
        priceDifference: change.priceDifference,
        modificationFee: change.modificationFee,
        totalCost: change.totalCost,
        currency: "SAR" as const,
        quoteVersion:
          payload.success && payload.data.termsHash
            ? servicingQuoteVersion(change) === payload.data.termsHash
              ? payload.data.termsHash
              : null
            : null,
        expiresAt: payload.success ? new Date(payload.data.expiresAt) : null,
        seatExchange: payload.success
          ? (payload.data.seatExchange ?? null)
          : null,
      },
    };
  }
}
