import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as paymentHistoryService from "../services/payment-history.service";

/**
 * Payment History Router
 * Provides endpoints for viewing payment history and statistics
 */
export const paymentHistoryRouter = router({
  /**
   * Get authenticated user's payment history
   */
  myPayments: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        method: z.string().optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await paymentHistoryService.getUserPaymentHistory(ctx.user.id, {
        ...input,
      });
    }),

  /**
   * Get authenticated user's payment statistics
   */
  myStats: protectedProcedure.query(async ({ ctx }) => {
    return await paymentHistoryService.getUserPaymentStats(ctx.user.id);
  }),

  /**
   * Admin: Get all payment history with filters
   */
  adminHistory: adminProcedure
    .input(
      z.object({
        status: z.string().optional(),
        method: z.string().optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ input }) => {
      return await paymentHistoryService.getAdminPaymentHistory(input);
    }),

  /**
   * Admin: Get overall payment statistics
   */
  adminStats: adminProcedure.query(async () => {
    return await paymentHistoryService.getAdminPaymentStats();
  }),
});
