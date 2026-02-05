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
  myAccount: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/loyalty/account",
        tags: ["Loyalty"],
        summary: "Get my loyalty account",
        description:
          "Retrieve the authenticated user's loyalty account details including current miles balance, tier status, and tier benefits.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      return await loyaltyService.getLoyaltyAccountDetails(ctx.user.id);
    }),

  /**
   * Get miles transactions history
   */
  myTransactions: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/loyalty/transactions",
        tags: ["Loyalty"],
        summary: "Get miles transactions",
        description:
          "Retrieve the authenticated user's miles transaction history including earnings, redemptions, and expirations.",
        protect: true,
      },
    })
    .input(
      z.object({
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe("Maximum transactions to return"),
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
    .meta({
      openapi: {
        method: "POST",
        path: "/loyalty/redeem",
        tags: ["Loyalty"],
        summary: "Redeem miles",
        description:
          "Redeem miles for a discount on a booking. Minimum 100 miles, maximum 100,000 miles per redemption. Returns the discount value in SAR.",
        protect: true,
      },
    })
    .input(
      z.object({
        milesToRedeem: z
          .number()
          .min(100)
          .max(100000)
          .describe("Number of miles to redeem"),
        bookingId: z
          .number()
          .optional()
          .describe("Booking ID to apply discount to"),
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
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/award",
        tags: ["Loyalty", "Admin"],
        summary: "Award bonus miles",
        description:
          "Admin endpoint to award bonus miles to a user for promotions, compensation, or other reasons.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID to award miles to"),
        miles: z
          .number()
          .min(1)
          .max(1000000)
          .describe("Number of miles to award"),
        reason: z.string().min(1).max(500).describe("Reason for bonus miles"),
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
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/reverse",
        tags: ["Loyalty", "Admin"],
        summary: "Reverse miles for booking",
        description:
          "Admin endpoint to reverse miles that were earned from a cancelled or refunded booking.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID"),
        bookingId: z.number().describe("Booking ID to reverse miles for"),
        reason: z.string().optional().describe("Reason for reversal"),
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
  processExpiredMiles: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/process-expired",
        tags: ["Loyalty", "Admin"],
        summary: "Process expired miles",
        description:
          "Admin endpoint to manually trigger the expired miles cleanup job. Normally runs automatically on schedule.",
        protect: true,
      },
    })
    .mutation(async () => {
      return await loyaltyService.processExpiredMiles();
    }),

  /**
   * Get loyalty account for a specific user (admin only)
   */
  getUserAccount: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/loyalty/users/{userId}",
        tags: ["Loyalty", "Admin"],
        summary: "Get user loyalty account",
        description:
          "Admin endpoint to retrieve loyalty account details for any user.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID"),
      })
    )
    .query(async ({ input }) => {
      return await loyaltyService.getLoyaltyAccountDetails(input.userId);
    }),

  /**
   * Get transactions for a specific user (admin only)
   */
  getUserTransactions: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/loyalty/users/{userId}/transactions",
        tags: ["Loyalty", "Admin"],
        summary: "Get user transactions",
        description:
          "Admin endpoint to retrieve miles transaction history for any user.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID"),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe("Maximum transactions to return"),
      })
    )
    .query(async ({ input }) => {
      return await loyaltyService.getMilesTransactions(
        input.userId,
        input.limit
      );
    }),
});
