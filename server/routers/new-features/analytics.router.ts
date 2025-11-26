import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import {
  trackEvent,
  getDashboardOverview,
  getDailyMetrics,
  getPopularRoutes,
  getBookingTrends,
  getRevenueTrends,
  getUserGrowthTrends,
  getRealTimeStats,
  calculateDailyMetrics,
} from "../services/analytics.service";

/**
 * Analytics Router
 * Handles analytics and dashboard API endpoints
 */

export const analyticsRouter = router({
  /**
   * Track an analytics event (public)
   */
  trackEvent: publicProcedure
    .input(
      z.object({
        eventType: z.string(),
        eventCategory: z.string(),
        sessionId: z.string().optional(),
        metadata: z.record(z.any()).optional(),
        pageUrl: z.string().optional(),
        referrer: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await trackEvent({
        eventType: input.eventType,
        eventCategory: input.eventCategory,
        userId: ctx.user?.id,
        sessionId: input.sessionId,
        metadata: input.metadata,
        pageUrl: input.pageUrl,
        referrer: input.referrer,
      });

      return { success: true };
    }),

  /**
   * Get dashboard overview (admin only)
   */
  getDashboardOverview: adminProcedure
    .input(
      z.object({
        startDate: z.string(), // ISO date string
        endDate: z.string(),
      })
    )
    .query(async ({ input }) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);

      const overview = await getDashboardOverview(startDate, endDate);

      return {
        period: {
          startDate: input.startDate,
          endDate: input.endDate,
        },
        metrics: overview,
      };
    }),

  /**
   * Get daily metrics (admin only)
   */
  getDailyMetrics: adminProcedure
    .input(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .query(async ({ input }) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);

      const metrics = await getDailyMetrics(startDate, endDate);

      return {
        period: {
          startDate: input.startDate,
          endDate: input.endDate,
        },
        data: metrics,
      };
    }),

  /**
   * Get popular routes (admin only)
   */
  getPopularRoutes: adminProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(50).optional(),
      })
    )
    .query(async ({ input }) => {
      const routes = await getPopularRoutes(input.limit);

      return routes;
    }),

  /**
   * Get booking trends (admin only)
   */
  getBookingTrends: adminProcedure
    .input(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .query(async ({ input }) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);

      const trends = await getBookingTrends(startDate, endDate);

      return {
        period: {
          startDate: input.startDate,
          endDate: input.endDate,
        },
        data: trends,
      };
    }),

  /**
   * Get revenue trends (admin only)
   */
  getRevenueTrends: adminProcedure
    .input(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .query(async ({ input }) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);

      const trends = await getRevenueTrends(startDate, endDate);

      return {
        period: {
          startDate: input.startDate,
          endDate: input.endDate,
        },
        data: trends,
      };
    }),

  /**
   * Get user growth trends (admin only)
   */
  getUserGrowthTrends: adminProcedure
    .input(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .query(async ({ input }) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);

      const trends = await getUserGrowthTrends(startDate, endDate);

      return {
        period: {
          startDate: input.startDate,
          endDate: input.endDate,
        },
        data: trends,
      };
    }),

  /**
   * Get real-time stats (admin only)
   */
  getRealTimeStats: adminProcedure.query(async () => {
    const stats = await getRealTimeStats();

    return stats;
  }),

  /**
   * Manually trigger daily metrics calculation (admin only)
   */
  calculateDailyMetrics: adminProcedure
    .input(
      z.object({
        date: z.string(), // ISO date string
      })
    )
    .mutation(async ({ input }) => {
      const date = new Date(input.date);

      await calculateDailyMetrics(date);

      return {
        success: true,
        message: `Daily metrics calculated for ${input.date}`,
      };
    }),
});
