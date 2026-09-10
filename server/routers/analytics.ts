import { responseContracts } from "../contracts/analytics";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as analyticsService from "../services/analytics.service";

/**
 * Analytics Router
 * Admin-only endpoints for business intelligence and reporting
 */
export const analyticsRouter = router({
  /**
   * Get overall KPI metrics
   */
  getKPIs: adminProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
    )
    .output(responseContracts["getKPIs"])
    .query(async ({ input }) => {
      return await analyticsService.getKPIMetrics(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Get revenue over time (daily breakdown)
   */
  getRevenueOverTime: adminProcedure
    .input(
      z
        .object({
          days: z.number().min(1).max(365).default(30),
        })
        .optional()
    )
    .output(responseContracts["getRevenueOverTime"])
    .query(async ({ input }) => {
      return await analyticsService.getRevenueOverTime(input?.days || 30);
    }),

  /**
   * Get most popular destinations
   */
  getPopularDestinations: adminProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(50).default(10),
        })
        .optional()
    )
    .output(responseContracts["getPopularDestinations"])
    .query(async ({ input }) => {
      return await analyticsService.getPopularDestinations(input?.limit || 10);
    }),

  /**
   * Get booking trends over time
   */
  getBookingTrends: adminProcedure
    .input(
      z
        .object({
          days: z.number().min(1).max(365).default(30),
        })
        .optional()
    )
    .output(responseContracts["getBookingTrends"])
    .query(async ({ input }) => {
      return await analyticsService.getBookingTrends(input?.days || 30);
    }),

  /**
   * Get flight occupancy details
   */
  getFlightOccupancy: adminProcedure
    .output(responseContracts["getFlightOccupancy"])
    .query(async () => {
      return await analyticsService.getFlightOccupancyDetails();
    }),

  /**
   * Get ancillary services KPI metrics
   */
  getAncillaryMetrics: adminProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
    )
    .output(responseContracts["getAncillaryMetrics"])
    .query(async ({ input }) => {
      return await analyticsService.getAncillaryMetrics(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Get ancillary revenue breakdown by category
   */
  getAncillaryRevenueByCategory: adminProcedure
    .output(responseContracts["getAncillaryRevenueByCategory"])
    .query(async () => {
      return await analyticsService.getAncillaryRevenueByCategory();
    }),

  /**
   * Get most popular ancillary services
   */
  getPopularAncillaries: adminProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(50).default(10),
        })
        .optional()
    )
    .output(responseContracts["getPopularAncillaries"])
    .query(async ({ input }) => {
      return await analyticsService.getPopularAncillaries(input?.limit || 10);
    }),
});
