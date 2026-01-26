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
    .input(
      z.object({
        bookingId: z.number(),
        reason: z.string().optional(),
        amount: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await refundsService.createRefund({
        bookingId: input.bookingId,
        userId: ctx.user.id,
        reason: input.reason,
        amount: input.amount,
      });
    }),

  /**
   * Admin: Create refund for any booking
   */
  adminCreate: adminProcedure
    .input(
      z.object({
        bookingId: z.number(),
        userId: z.number(),
        reason: z.string().optional(),
        amount: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await refundsService.createRefund(input);
    }),

  /**
   * Get refund details
   */
  getDetails: protectedProcedure
    .input(z.object({ refundId: z.string() }))
    .query(async ({ input }) => {
      return await refundsService.getRefundDetails(input.refundId);
    }),

  /**
   * Check if booking is refundable
   */
  checkRefundable: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input }) => {
      return await refundsService.isBookingRefundable(input.bookingId);
    }),

  /**
   * Calculate cancellation fee for a booking
   */
  calculateCancellationFee: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
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
  getCancellationPolicy: protectedProcedure.query(() => {
    return getAllCancellationTiers();
  }),

  /**
   * Admin: Get refund statistics
   */
  getStats: adminProcedure.query(async () => {
    return await getRefundStats();
  }),

  /**
   * Admin: Get refund history
   */
  getHistory: adminProcedure
    .input(
      z.object({
        limit: z.number().optional(),
        offset: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      return await getRefundHistory(input);
    }),

  /**
   * Admin: Get refund trends
   */
  getTrends: adminProcedure.query(async () => {
    return await getRefundTrends();
  }),
});
