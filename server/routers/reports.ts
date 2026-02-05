/**
 * Reports Router
 *
 * Admin endpoints for generating and exporting reports
 * Supports CSV and PDF formats
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  exportBookingsToCSV,
  exportRevenueToCSV,
  exportFlightPerformanceToCSV,
  generateBookingsPDF,
  generateRevenuePDF,
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
});
