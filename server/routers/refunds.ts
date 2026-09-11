import { responseContracts } from "../contracts/refunds";
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
import { assertBookingOwnership } from "../services/access-control.service";
import {
  getSplitRefundCancellation,
  reserveSplitRefundCancellation,
  resumeSplitRefundCancellation,
  listSplitRefundCancellations,
} from "../services/split-refund.service";

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
  splitCancellationQueue: adminProcedure
    .input(
      z.object({
        beforeBookingId: z.number().int().positive().optional(),
        status: z
          .enum(["processing", "completed", "review_required"])
          .optional(),
      })
    )
    .output(responseContracts.splitCancellationQueue)
    .query(({ input, ctx }) => listSplitRefundCancellations(input, ctx.user)),
  splitCancellation: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/bookings/{bookingId}/split-cancellation",
        tags: ["Refunds"],
        protect: true,
        summary: "Preview or track cancellation refunds for each payer",
      },
    })
    .input(z.object({ bookingId: z.number().int().positive() }))
    .output(responseContracts.splitCancellation)
    .query(({ input, ctx }) =>
      getSplitRefundCancellation(input.bookingId, ctx.user)
    ),

  cancelSplitBooking: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/bookings/{bookingId}/split-cancellation",
        tags: ["Refunds"],
        protect: true,
        summary: "Cancel with a frozen refund allocation to original payers",
      },
    })
    .input(
      z
        .object({
          bookingId: z.number().int().positive(),
          quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
          reason: z
            .enum(["requested_by_customer", "duplicate"])
            .default("requested_by_customer"),
          notes: z.string().max(500).optional(),
        })
        .strict()
    )
    .output(responseContracts.cancelSplitBooking)
    .mutation(({ input, ctx }) =>
      reserveSplitRefundCancellation(input, ctx.user)
    ),

  resumeSplitCancellation: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/bookings/{bookingId}/split-cancellation/resume",
        tags: ["Refunds"],
        protect: true,
        summary:
          "Reconcile or resume one payer refund without issuing a duplicate",
      },
    })
    .input(
      z
        .object({
          bookingId: z.number().int().positive(),
          splitId: z.number().int().positive(),
        })
        .strict()
    )
    .output(responseContracts.resumeSplitCancellation)
    .mutation(({ input, ctx }) =>
      resumeSplitRefundCancellation(input, ctx.user)
    ),
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
        amount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Admin-only refund override in integer cents"),
      })
    )
    .output(responseContracts["create"])
    .mutation(async ({ ctx, input }) => {
      if (input.amount !== undefined && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can override the refund amount",
        });
      }

      // Get booking reference for audit
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });

      const [booking] = await db
        .select({ bookingReference: bookings.bookingReference })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      const result = await refundsService.createRefund(
        {
          bookingId: input.bookingId,
          userId: ctx.user.id,
          reason: input.reason,
          amount: input.amount,
        },
        ctx.user
      );

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
        amount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Override refund amount in integer cents"),
      })
    )
    .output(responseContracts["adminCreate"])
    .mutation(async ({ ctx, input }) => {
      // Get booking reference for audit
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });

      const [booking] = await db
        .select({ bookingReference: bookings.bookingReference })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      const result = await refundsService.createRefund(input, ctx.user);

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
        description:
          "Retrieve detailed information about a specific refund including status, amount, and processing history.",
        protect: true,
      },
    })
    .input(z.object({ refundId: z.string().min(1).describe("Refund ID") }))
    .output(responseContracts["getDetails"])
    .query(async ({ input, ctx }) => {
      return await refundsService.getRefundDetails(input.refundId, ctx.user);
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
        description:
          "Check whether a booking is eligible for a refund based on its status, payment status, and the cancellation policy.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().describe("Booking ID to check") }))
    .output(responseContracts["checkRefundable"])
    .query(async ({ input, ctx }) => {
      // Ownership check: prevent leaking other users' booking status (IDOR)
      await assertBookingOwnership(input.bookingId, ctx.user.id, ctx.user.role);
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
        description:
          "Calculate the cancellation fee for a booking based on the time until departure and the applicable cancellation policy tier.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().describe("Booking ID") }))
    .output(responseContracts["calculateCancellationFee"])
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });

      // Ownership check: prevent leaking other users' fare/flight details (IDOR)
      await assertBookingOwnership(input.bookingId, ctx.user.id, ctx.user.role);

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
        description:
          "Retrieve the complete cancellation policy with all fee tiers based on time until departure. Useful for displaying policy information to users before booking.",
        protect: true,
      },
    })
    .output(responseContracts["getCancellationPolicy"])
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
        description:
          "Admin endpoint to retrieve refund statistics including total refunds, amounts, and breakdown by reason and status.",
        protect: true,
      },
    })
    .output(responseContracts["getStats"])
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
        description:
          "Admin endpoint to retrieve paginated refund history with all refund records.",
        protect: true,
      },
    })
    .input(
      z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of records to return"),
        offset: z
          .number()
          .int()
          .min(0)
          .max(1000000)
          .optional()
          .describe("Number of records to skip"),
      })
    )
    .output(responseContracts["getHistory"])
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
        description:
          "Admin endpoint to retrieve refund trends over time for analytics and reporting.",
        protect: true,
      },
    })
    .output(responseContracts["getTrends"])
    .query(async () => {
      return await getRefundTrends();
    }),
});
