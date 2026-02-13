import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
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
      return await loyaltyService.getMilesTransactions(ctx.user.id, input.limit);
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
});
