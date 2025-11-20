import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as refundsService from "../services/refunds.service";

/**
 * Admin-only procedure
 */
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
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
});
