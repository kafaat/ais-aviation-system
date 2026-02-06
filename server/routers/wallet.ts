import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getWalletBalance,
  topUpWallet,
  payFromWallet,
  getWalletTransactions,
} from "../services/wallet.service";
import { TRPCError } from "@trpc/server";

/**
 * Wallet Router
 * Digital wallet for quick payments and refund receipts
 */
export const walletRouter = router({
  /**
   * Get current wallet balance
   */
  balance: protectedProcedure.query(async ({ ctx }) => {
    return await getWalletBalance(ctx.user.id);
  }),

  /**
   * Top up wallet balance
   */
  topUp: protectedProcedure
    .input(
      z.object({
        amount: z.number().min(1000).max(1000000), // 10 SAR to 10,000 SAR in cents
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await topUpWallet(ctx.user.id, input.amount, "Wallet top-up");
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to top up wallet",
        });
      }
    }),

  /**
   * Pay from wallet for a booking
   */
  pay: protectedProcedure
    .input(
      z.object({
        amount: z.number().min(1),
        bookingId: z.number().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await payFromWallet(
          ctx.user.id,
          input.amount,
          input.description || "Wallet payment",
          input.bookingId
        );
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to process wallet payment",
        });
      }
    }),

  /**
   * Get transaction history
   */
  transactions: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).optional().default(20),
          offset: z.number().min(0).optional().default(0),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return await getWalletTransactions(
        ctx.user.id,
        input?.limit ?? 20,
        input?.offset ?? 0
      );
    }),
});
