import {
  couponMonthInput,
  couponMonthResult,
  reviewCouponMonth,
} from "../services/coupon-month-review";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { draftStoredBookingInvoice } from "../services/fare-components.service";
import { responseContracts } from "../contracts/revenue-accounting";
import { z } from "zod";
import { adminProcedure, airlineFinanceProcedure, router } from "../_core/trpc";
import * as revenueService from "../services/revenue-accounting.service";

/**
 * Revenue Accounting Router
 * Admin-only endpoints for revenue recognition, yield analysis, and financial reporting.
 * All monetary values are in SAR cents (100 = 1 SAR).
 */
export const revenueAccountingRouter = router({
  couponMonthReview: airlineFinanceProcedure
    .input(couponMonthInput)
    .output(couponMonthResult)
    .query(({ input, ctx }) => {
      if (ctx.tenantId == null) throw new TRPCError({ code: "FORBIDDEN" });
      return reviewCouponMonth(input, ctx.tenantId);
    }),
  prepareZatcaDraft: airlineFinanceProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        invoiceNumber: z.string().trim().min(1).max(64),
        issueTimestamp: z.date(),
        supplyTimestamp: z.date(),
        sellerName: z.string().trim().min(1).max(255),
        sellerVatNumber: z.string().regex(/^3\d{13}3$/),
      })
    )
    .output(
      z.object({
        id: z.string(),
        invoiceNumber: z.string(),
        totalAmount: z.number(),
        taxAmount: z.number(),
        previewQrPayload: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      if (tenantId == null) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new Error("Booking invoice storage unavailable");
      return db.transaction(tx =>
        draftStoredBookingInvoice(tx, tenantId, input)
      );
    }),
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
    .output(responseContracts["getDashboard"])
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
    .output(responseContracts["getRevenueByRoute"])
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
    .output(responseContracts["getRevenueByClass"])
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
    .output(responseContracts["getRevenueByChannel"])
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
    .output(responseContracts["getAncillaryRevenue"])
    .query(async ({ input }) => {
      return await revenueService.getAncillaryRevenue(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Compatibility route: upcoming booking gross with unverified deferred total.
   */
  getDeferredRevenue: adminProcedure
    .output(responseContracts["getDeferredRevenue"])
    .query(async () => {
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
    .output(responseContracts["generateReport"])
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
    .output(responseContracts["getReports"])
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
    .output(responseContracts["getYieldAnalysis"])
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
    .output(responseContracts["getRefundImpact"])
    .query(async ({ input }) => {
      return await revenueService.getRefundImpact(
        input?.startDate,
        input?.endDate
      );
    }),
});
