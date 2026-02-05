import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import * as priceAlertsService from "../services/price-alerts.service";

export const priceAlertsRouter = router({
  /**
   * Create a new price alert
   */
  create: protectedProcedure
    .input(
      z.object({
        originId: z.number().int().positive(),
        destinationId: z.number().int().positive(),
        targetPrice: z.number().int().positive(),
        cabinClass: z.enum(["economy", "business"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await priceAlertsService.createAlert({
        userId: ctx.user.id,
        ...input,
      });
    }),

  /**
   * Get all user's price alerts
   */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    return await priceAlertsService.getUserAlerts(ctx.user.id);
  }),

  /**
   * Get a specific price alert
   */
  getById: protectedProcedure
    .input(
      z.object({
        alertId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await priceAlertsService.getAlertById(input.alertId, ctx.user.id);
    }),

  /**
   * Delete a price alert
   */
  delete: protectedProcedure
    .input(
      z.object({
        alertId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await priceAlertsService.deleteAlert(input.alertId, ctx.user.id);
    }),

  /**
   * Toggle alert active status
   */
  toggle: protectedProcedure
    .input(
      z.object({
        alertId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await priceAlertsService.toggleAlert(input.alertId, ctx.user.id);
    }),

  /**
   * Update alert target price
   */
  updatePrice: protectedProcedure
    .input(
      z.object({
        alertId: z.number().int().positive(),
        targetPrice: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await priceAlertsService.updateAlertPrice(
        input.alertId,
        ctx.user.id,
        input.targetPrice
      );
    }),

  /**
   * Check all alerts (admin only - for cron job)
   */
  checkAlerts: adminProcedure.mutation(async () => {
    return await priceAlertsService.checkAlerts();
  }),
});
