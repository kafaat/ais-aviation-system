import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  issueEmd,
  getEmd,
  listEmds,
  useEmd,
  voidEmd,
  exchangeEmd,
  refundEmd,
  getEmdsByBooking,
  getEmdStatistics,
} from "../services/emd.service";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// ============================================================================
// Shared Zod Schemas
// ============================================================================

const emdTypeEnum = z.enum(["EMD-S", "EMD-A"]);

const emdStatusEnum = z.enum([
  "issued",
  "used",
  "void",
  "exchanged",
  "refunded",
  "suspended",
]);

const reasonForIssuanceEnum = z.enum([
  "baggage",
  "seat_selection",
  "meal",
  "lounge_access",
  "priority_boarding",
  "insurance",
  "pet_transport",
  "unaccompanied_minor",
  "sport_equipment",
  "upgrade",
  "penalty",
  "residual_value",
  "ground_transport",
  "wifi",
  "entertainment",
  "other",
]);

// ============================================================================
// EMD Router
// ============================================================================

/**
 * Electronic Miscellaneous Document (EMD) Router
 *
 * Handles IATA EMD issuance, lifecycle management, and reporting.
 * EMD-S: Standalone documents not tied to a flight ticket
 * EMD-A: Associated documents linked to a flight ticket
 */
export const emdRouter = router({
  /**
   * Issue a new Electronic Miscellaneous Document
   * Admin only - creates a new EMD-S or EMD-A
   */
  issue: adminProcedure
    .input(
      z.object({
        emdType: emdTypeEnum,
        bookingId: z.number().int().optional(),
        passengerId: z.number().int().optional(),
        ticketNumber: z.string().max(14).optional(),
        issuingAirlineId: z.number().int(),
        issuingAgentId: z.number().int().optional(),
        iataNumber: z.string().max(8).optional(),
        reasonForIssuance: reasonForIssuanceEnum,
        serviceDescription: z.string().min(1).max(255),
        rficCode: z.string().max(2).optional(),
        rfiscCode: z.string().max(4).optional(),
        amount: z.number().int().min(0),
        currency: z.string().length(3).default("SAR"),
        taxAmount: z.number().int().min(0).optional(),
        flightId: z.number().int().optional(),
        flightSegment: z.string().max(20).optional(),
        dateOfService: z.string().optional(),
        expiryDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await issueEmd(input);
      return {
        success: true,
        data: result,
      };
    }),

  /**
   * Get EMD by document number
   * Protected - any authenticated user can look up an EMD
   */
  get: protectedProcedure
    .input(
      z.object({
        emdNumber: z.string().length(14),
      })
    )
    .query(async ({ input }) => {
      const emd = await getEmd(input.emdNumber);
      if (!emd) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `EMD ${input.emdNumber} not found`,
        });
      }
      return {
        success: true,
        data: emd,
      };
    }),

  /**
   * List EMDs with filtering and pagination
   * Admin only - supports filters by airline, booking, passenger, status, type, and date range
   */
  list: adminProcedure
    .input(
      z.object({
        airlineId: z.number().int().optional(),
        bookingId: z.number().int().optional(),
        passengerId: z.number().int().optional(),
        status: emdStatusEnum.optional(),
        emdType: emdTypeEnum.optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const result = await listEmds(input);
      return {
        success: true,
        data: result,
      };
    }),

  /**
   * Mark an EMD as used (service consumed)
   * Admin only - transitions status from "issued" to "used"
   */
  use: adminProcedure
    .input(
      z.object({
        emdNumber: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await useEmd(input.emdNumber);
      return {
        success: true,
        data: result,
      };
    }),

  /**
   * Void (cancel) an EMD
   * Admin only - voids an EMD with a required reason
   */
  void: adminProcedure
    .input(
      z.object({
        emdNumber: z.string(),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const result = await voidEmd(input.emdNumber, input.reason);
      return {
        success: true,
        data: result,
      };
    }),

  /**
   * Exchange an EMD for a new one
   * Admin only - marks original as exchanged and issues a new EMD
   */
  exchange: adminProcedure
    .input(
      z.object({
        emdNumber: z.string(),
        newServiceDescription: z.string().min(1).max(255),
        newAmount: z.number().int().min(0),
        newReasonForIssuance: reasonForIssuanceEnum,
        newRficCode: z.string().max(2).optional(),
        newRfiscCode: z.string().max(4).optional(),
        newFlightId: z.number().int().optional(),
        newFlightSegment: z.string().max(20).optional(),
        newDateOfService: z.string().optional(),
        newExpiryDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { emdNumber, ...newParams } = input;
      const result = await exchangeEmd(emdNumber, {
        serviceDescription: newParams.newServiceDescription,
        amount: newParams.newAmount,
        reasonForIssuance: newParams.newReasonForIssuance,
        rficCode: newParams.newRficCode,
        rfiscCode: newParams.newRfiscCode,
        flightId: newParams.newFlightId,
        flightSegment: newParams.newFlightSegment,
        dateOfService: newParams.newDateOfService,
        expiryDate: newParams.newExpiryDate,
      });
      return {
        success: true,
        data: result,
      };
    }),

  /**
   * Refund an EMD (full or partial)
   * Admin only - if refundAmount is omitted, performs a full refund
   */
  refund: adminProcedure
    .input(
      z.object({
        emdNumber: z.string(),
        refundAmount: z.number().int().min(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await refundEmd(input.emdNumber, input.refundAmount);
      return {
        success: true,
        data: result,
      };
    }),

  /**
   * Get all EMDs for a specific booking
   * Protected - verifies the user owns the booking or is an admin
   */
  getByBooking: protectedProcedure
    .input(
      z.object({
        bookingId: z.number().int(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      }

      // Verify booking ownership
      const [booking] = await db
        .select({ userId: bookings.userId })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      if (!booking) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      if (
        booking.userId !== ctx.user.id &&
        ctx.user.role !== "admin" &&
        ctx.user.role !== "super_admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

      const items = await getEmdsByBooking(input.bookingId);
      return {
        success: true,
        data: items,
      };
    }),

  /**
   * Get EMD statistics for an airline
   * Admin only - aggregated counts and amounts by status, type, and reason
   */
  statistics: adminProcedure
    .input(
      z.object({
        airlineId: z.number().int(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const dateRange =
        input.dateFrom || input.dateTo
          ? {
              from: input.dateFrom ?? new Date(0).toISOString(),
              to: input.dateTo ?? new Date().toISOString(),
            }
          : undefined;
      const result = await getEmdStatistics(input.airlineId, dateRange);
      return {
        success: true,
        data: result,
      };
    }),
});
