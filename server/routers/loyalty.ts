import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as loyaltyService from "../services/loyalty.service";

/**
 * Loyalty Router
 * Handles loyalty program operations
 */
export const loyaltyRouter = router({
  /**
   * Get user's loyalty account details
   */
  myAccount: protectedProcedure.query(async ({ ctx }) => {
    return await loyaltyService.getLoyaltyAccountDetails(ctx.user.id);
  }),

  /**
   * Get miles transactions history
   */
  myTransactions: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      return await loyaltyService.getMilesTransactions(
        ctx.user.id,
        input.limit
      );
    }),

  /**
   * Redeem miles for discount
   */
  redeemMiles: protectedProcedure
    .input(
      z.object({
        milesToRedeem: z.number().min(100).max(100000),
        bookingId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await loyaltyService.redeemMiles(
        ctx.user.id,
        input.milesToRedeem,
        input.bookingId
      );
    }),

  // ============================================================================
  // Admin Endpoints
  // ============================================================================

  /**
   * Award bonus miles to a user (admin only)
   */
  awardBonusMiles: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        miles: z.number().min(1).max(1000000),
        reason: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ input }) => {
      return await loyaltyService.awardBonusMiles(
        input.userId,
        input.miles,
        input.reason
      );
    }),

  /**
   * Reverse miles for a cancelled booking (admin only)
   */
  reverseMilesForBooking: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        bookingId: z.number(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await loyaltyService.reverseMilesForBooking(
        input.userId,
        input.bookingId,
        input.reason
      );
    }),

  /**
   * Process expired miles - runs cleanup job (admin only)
   */
  processExpiredMiles: adminProcedure.mutation(async () => {
    return await loyaltyService.processExpiredMiles();
  }),

  /**
   * Get loyalty account for a specific user (admin only)
   */
  getUserAccount: adminProcedure
    .input(
      z.object({
        userId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return await loyaltyService.getLoyaltyAccountDetails(input.userId);
    }),

  /**
   * Get transactions for a specific user (admin only)
   */
  getUserTransactions: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        limit: z.number().min(1).max(100).optional().default(50),
      })
    )
    .query(async ({ input }) => {
      return await loyaltyService.getMilesTransactions(
        input.userId,
        input.limit
      );
    }),
});
