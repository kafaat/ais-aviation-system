import { responseContracts } from "../contracts/reports";
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

// Date-only exports include the complete UTC end day; ISO instants stay exact.
const dateOrInstant = z
  .string()
  .date()
  .or(z.string().datetime({ offset: true }));
const period = z.object({
  startDate: dateOrInstant.transform(value => new Date(value)).optional(),
  endDate: dateOrInstant
    .transform(
      value => new Date(value.length === 10 ? value + "T23:59:59.999Z" : value)
    )
    .optional(),
});
const ordered = ({
  startDate,
  endDate,
}: {
  startDate?: Date;
  endDate?: Date;
}) => !startDate || !endDate || startDate <= endDate;
const orderMessage = "Report start must precede end";
const periodInput = period.refine(ordered, orderMessage);
const bookingInput = period
  .extend({
    status: z
      .string()
      .pipe(z.enum(["pending", "confirmed", "cancelled", "completed"]))
      .optional(),
  })
  .refine(ordered, orderMessage);
const flightInput = period
  .extend({
    status: z
      .string()
      .pipe(z.enum(["scheduled", "cancelled", "completed", "delayed"]))
      .optional(),
  })
  .refine(ordered, orderMessage);

export const reportsRouter = router({
  /**
   * Export bookings report to CSV
   */
  exportBookingsCSV: adminProcedure
    .input(bookingInput)
    .output(responseContracts["exportBookingsCSV"])
    .mutation(async ({ input: filters }) => {
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
    .input(periodInput)
    .output(responseContracts["exportRevenueCSV"])
    .mutation(async ({ input: filters }) => {
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
    .input(flightInput)
    .output(responseContracts["exportFlightPerformanceCSV"])
    .mutation(async ({ input: filters }) => {
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
    .input(bookingInput)
    .output(responseContracts["generateBookingsPDF"])
    .mutation(async ({ input: filters }) => {
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
    .input(periodInput)
    .output(responseContracts["generateRevenuePDF"])
    .mutation(async ({ input: filters }) => {
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
    .input(bookingInput)
    .output(responseContracts["exportBookingsExcel"])
    .mutation(async ({ input: filters }) => {
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
    .input(periodInput)
    .output(responseContracts["exportRevenueExcel"])
    .mutation(async ({ input: filters }) => {
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
    .input(flightInput)
    .output(responseContracts["exportFlightPerformanceExcel"])
    .mutation(async ({ input: filters }) => {
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
    .input(flightInput)
    .output(responseContracts["generateFlightPerformancePDF"])
    .mutation(async ({ input: filters }) => {
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
    .input(periodInput)
    .output(responseContracts["exportRefundsCSV"])
    .mutation(async ({ input: filters }) => {
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
    .input(periodInput)
    .output(responseContracts["exportRefundsExcel"])
    .mutation(async ({ input: filters }) => {
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
    .input(periodInput)
    .output(responseContracts["generateRefundsPDF"])
    .mutation(async ({ input: filters }) => {
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
