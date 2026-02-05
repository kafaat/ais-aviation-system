import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as refundsService from "../services/refunds.service";
import {
  getRefundStats,
  getRefundHistory,
  getRefundTrends,
} from "../services/refunds-stats.service";
import {
  calculateCancellationFee,
  getAllCancellationTiers,
} from "../services/cancellation-fees.service";
import { getDb } from "../db";
import { bookings, flights } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { auditRefund } from "../services/audit.service";

/**
 * Admin-only procedure
 */
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx });
});

/**
 * Refunds Router
 * Handles all refund-related operations
 */
export const refundsRouter = router({
  /**
   * Create a refund (user can refund their own bookings)
   */
  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/refunds",
        tags: ["Refunds"],
        summary: "Request a refund",
        description:
          "Request a refund for a booking. The refund amount is calculated based on the cancellation policy and time until departure. Refunds are processed to the original payment method.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().describe("Booking ID to refund"),
        reason: z.string().optional().describe("Reason for refund request"),
        amount: z.number().optional().describe("Requested refund amount (optional, calculated automatically if not provided)"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get booking reference for audit
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [booking] = await db
        .select({ bookingReference: bookings.bookingReference })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      const result = await refundsService.createRefund({
        bookingId: input.bookingId,
        userId: ctx.user.id,
        reason: input.reason,
        amount: input.amount,
      });

      // Audit log: Refund completed
      await auditRefund(
        input.bookingId,
        booking?.bookingReference || `booking-${input.bookingId}`,
        ctx.user.id,
        ctx.user.role,
        "REFUND_COMPLETED",
        result.amount || 0,
        result.refundId,
        input.reason,
        ctx.req.ip,
        ctx.req.headers["x-request-id"] as string
      );

      return result;
    }),

  /**
   * Admin: Create refund for any booking
   */
  adminCreate: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/refunds",
        tags: ["Refunds", "Admin"],
        summary: "Create refund (admin)",
        description:
          "Admin endpoint to create a refund for any booking. Allows overriding the calculated refund amount. Requires admin role.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().describe("Booking ID"),
        userId: z.number().describe("User ID who owns the booking"),
        reason: z.string().optional().describe("Refund reason"),
        amount: z.number().optional().describe("Override refund amount"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get booking reference for audit
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [booking] = await db
        .select({ bookingReference: bookings.bookingReference })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      const result = await refundsService.createRefund(input);

      // Audit log: Admin refund completed
      await auditRefund(
        input.bookingId,
        booking?.bookingReference || `booking-${input.bookingId}`,
        ctx.user.id,
        ctx.user.role,
        "REFUND_COMPLETED",
        result.amount || 0,
        result.refundId,
        input.reason,
        ctx.req.ip,
        ctx.req.headers["x-request-id"] as string
      );

      return result;
    }),

  /**
   * Get refund details
   */
  getDetails: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/refunds/{refundId}",
        tags: ["Refunds"],
        summary: "Get refund details",
        description: "Retrieve detailed information about a specific refund including status, amount, and processing history.",
        protect: true,
      },
    })
    .input(z.object({ refundId: z.string().describe("Refund ID") }))
    .query(async ({ input }) => {
      return await refundsService.getRefundDetails(input.refundId);
    }),

  /**
   * Check if booking is refundable
   */
  checkRefundable: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/refunds/check/{bookingId}",
        tags: ["Refunds"],
        summary: "Check if booking is refundable",
        description: "Check whether a booking is eligible for a refund based on its status, payment status, and the cancellation policy.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().describe("Booking ID to check") }))
    .query(async ({ input }) => {
      return await refundsService.isBookingRefundable(input.bookingId);
    }),

  /**
   * Calculate cancellation fee for a booking
   */
  calculateCancellationFee: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/refunds/calculate-fee/{bookingId}",
        tags: ["Refunds"],
        summary: "Calculate cancellation fee",
        description: "Calculate the cancellation fee for a booking based on the time until departure and the applicable cancellation policy tier.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().describe("Booking ID") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Get booking details
      const [booking] = await db
        .select({
          totalAmount: bookings.totalAmount,
          flightId: bookings.flightId,
        })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      if (!booking) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      // Get flight departure time
      const [flight] = await db
        .select({ departureTime: flights.departureTime })
        .from(flights)
        .where(eq(flights.id, booking.flightId))
        .limit(1);

      if (!flight) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flight not found",
        });
      }

      return calculateCancellationFee(
        booking.totalAmount,
        flight.departureTime
      );
    }),

  /**
   * Get cancellation policy tiers
   */
  getCancellationPolicy: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/refunds/policy",
        tags: ["Refunds"],
        summary: "Get cancellation policy",
        description: "Retrieve the complete cancellation policy with all fee tiers based on time until departure. Useful for displaying policy information to users before booking.",
        protect: true,
      },
    })
    .query(() => {
      return getAllCancellationTiers();
    }),

  /**
   * Admin: Get refund statistics
   */
  getStats: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/refunds/stats",
        tags: ["Refunds", "Admin"],
        summary: "Get refund statistics",
        description: "Admin endpoint to retrieve refund statistics including total refunds, amounts, and breakdown by reason and status.",
        protect: true,
      },
    })
    .query(async () => {
      return await getRefundStats();
    }),

  /**
   * Admin: Get refund history
   */
  getHistory: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/refunds/history",
        tags: ["Refunds", "Admin"],
        summary: "Get refund history",
        description: "Admin endpoint to retrieve paginated refund history with all refund records.",
        protect: true,
      },
    })
    .input(
      z.object({
        limit: z.number().optional().describe("Maximum number of records to return"),
        offset: z.number().optional().describe("Number of records to skip"),
      })
    )
    .query(async ({ input }) => {
      return await getRefundHistory(input);
    }),

  /**
   * Admin: Get refund trends
   */
  getTrends: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/refunds/trends",
        tags: ["Refunds", "Admin"],
        summary: "Get refund trends",
        description: "Admin endpoint to retrieve refund trends over time for analytics and reporting.",
        protect: true,
      },
    })
    .query(async () => {
      return await getRefundTrends();
    }),
});
