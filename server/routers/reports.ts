/**
 * Reports Router
 *
 * Admin endpoints for generating and exporting reports
 * Supports CSV, PDF, and Excel formats
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  exportBookingsToCSV,
  exportRevenueToCSV,
  exportFlightPerformanceToCSV,
  exportBookingsToExcel,
  exportRevenueToExcel,
  exportFlightPerformanceToExcel,
  exportRefundsToCSV,
  exportRefundsToExcel,
  generateBookingsPDF,
  generateRevenuePDF,
  generateRefundsPDF,
  generateFlightPerformancePDF,
  getReportFilename,
} from "../services/report-export.service";

export const reportsRouter = router({
  /**
   * Export bookings report to CSV
   */
  exportBookingsCSV: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        status: input.status,
      };

      const csv = await exportBookingsToCSV(filters);
      const filename = getReportFilename("bookings", "csv");

      return {
        filename,
        content: csv,
        contentType: "text/csv",
      };
    }),

  /**
   * Export revenue report to CSV
   */
  exportRevenueCSV: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const csv = await exportRevenueToCSV(filters);
      const filename = getReportFilename("revenue", "csv");

      return {
        filename,
        content: csv,
        contentType: "text/csv",
      };
    }),

  /**
   * Export flight performance report to CSV
   */
  exportFlightPerformanceCSV: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const csv = await exportFlightPerformanceToCSV(filters);
      const filename = getReportFilename("flight-performance", "csv");

      return {
        filename,
        content: csv,
        contentType: "text/csv",
      };
    }),

  /**
   * Generate bookings PDF report
   */
  generateBookingsPDF: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        status: input.status,
      };

      const pdfBuffer = await generateBookingsPDF(filters);
      const filename = getReportFilename("bookings-report", "pdf");

      return {
        filename,
        content: pdfBuffer.toString("base64"),
        contentType: "application/pdf",
        encoding: "base64",
      };
    }),

  /**
   * Generate revenue PDF report
   */
  generateRevenuePDF: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const pdfBuffer = await generateRevenuePDF(filters);
      const filename = getReportFilename("revenue-report", "pdf");

      return {
        filename,
        content: pdfBuffer.toString("base64"),
        contentType: "application/pdf",
        encoding: "base64",
      };
    }),

  // ============================================================================
  // Excel Export Endpoints
  // ============================================================================

  /**
   * Export bookings report to Excel
   */
  exportBookingsExcel: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        status: input.status,
      };

      const excelBuffer = await exportBookingsToExcel(filters);
      const filename = getReportFilename("bookings", "xlsx");

      return {
        filename,
        content: excelBuffer.toString("base64"),
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        encoding: "base64",
      };
    }),

  /**
   * Export revenue report to Excel
   */
  exportRevenueExcel: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const excelBuffer = await exportRevenueToExcel(filters);
      const filename = getReportFilename("revenue", "xlsx");

      return {
        filename,
        content: excelBuffer.toString("base64"),
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        encoding: "base64",
      };
    }),

  /**
   * Export flight performance report to Excel
   */
  exportFlightPerformanceExcel: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const excelBuffer = await exportFlightPerformanceToExcel(filters);
      const filename = getReportFilename("flight-performance", "xlsx");

      return {
        filename,
        content: excelBuffer.toString("base64"),
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        encoding: "base64",
      };
    }),

  /**
   * Generate flight performance PDF report
   */
  generateFlightPerformancePDF: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const pdfBuffer = await generateFlightPerformancePDF(filters);
      const filename = getReportFilename("flight-performance-report", "pdf");

      return {
        filename,
        content: pdfBuffer.toString("base64"),
        contentType: "application/pdf",
        encoding: "base64",
      };
    }),

  // ============================================================================
  // Refunds Report Endpoints
  // ============================================================================

  /**
   * Export refunds report to CSV
   */
  exportRefundsCSV: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const csv = await exportRefundsToCSV(filters);
      const filename = getReportFilename("refunds", "csv");

      return {
        filename,
        content: csv,
        contentType: "text/csv",
      };
    }),

  /**
   * Export refunds report to Excel
   */
  exportRefundsExcel: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const excelBuffer = await exportRefundsToExcel(filters);
      const filename = getReportFilename("refunds", "xlsx");

      return {
        filename,
        content: excelBuffer.toString("base64"),
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        encoding: "base64",
      };
    }),

  /**
   * Generate refunds PDF report
   */
  generateRefundsPDF: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      };

      const pdfBuffer = await generateRefundsPDF(filters);
      const filename = getReportFilename("refunds-report", "pdf");

      return {
        filename,
        content: pdfBuffer.toString("base64"),
        contentType: "application/pdf",
        encoding: "base64",
      };
    }),
});
