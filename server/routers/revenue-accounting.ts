import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as revenueService from "../services/revenue-accounting.service";

/**
 * Revenue Accounting Router
 * Admin-only endpoints for revenue recognition, yield analysis, and financial reporting.
 * All monetary values are in SAR cents (100 = 1 SAR).
 */
export const revenueAccountingRouter = router({
  /**
   * Get revenue dashboard overview with KPIs
   */
  getDashboard: adminProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await revenueService.getRevenueDashboard(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Get revenue breakdown by route
   */
  getRevenueByRoute: adminProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await revenueService.getRevenueByRoute(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Get revenue breakdown by cabin class (Economy vs Business)
   */
  getRevenueByClass: adminProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await revenueService.getRevenueByClass(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Get revenue breakdown by channel (Direct, Agent, Corporate)
   */
  getRevenueByChannel: adminProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await revenueService.getRevenueByChannel(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Get ancillary services revenue breakdown
   */
  getAncillaryRevenue: adminProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await revenueService.getAncillaryRevenue(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Get deferred revenue (tickets sold, flights not yet flown)
   */
  getDeferredRevenue: adminProcedure.query(async () => {
    return await revenueService.calculateDeferredRevenue();
  }),

  /**
   * Generate a monthly revenue reconciliation report
   */
  generateReport: adminProcedure
    .input(
      z.object({
        month: z.number().min(1).max(12),
        year: z.number().min(2020).max(2100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await revenueService.generateRevenueReport(
        input.month,
        input.year,
        ctx.user.id
      );
    }),

  /**
   * List previously generated revenue reports
   */
  getReports: adminProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(50).default(12),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await revenueService.getReports(input?.limit || 12);
    }),

  /**
   * Get yield analysis (Revenue per RPK) by route/flight
   */
  getYieldAnalysis: adminProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          limit: z.number().min(1).max(50).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await revenueService.getYieldAnalysis(
        input?.startDate,
        input?.endDate,
        input?.limit || 20
      );
    }),

  /**
   * Get refund impact analysis
   */
  getRefundImpact: adminProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await revenueService.getRefundImpact(
        input?.startDate,
        input?.endDate
      );
    }),
});
