// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";

export const responseContracts = {
  exportBookingsCSV: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
  }),
  exportRevenueCSV: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
  }),
  exportFlightPerformanceCSV: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
  }),
  generateBookingsPDF: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
    encoding: z.string(),
  }),
  generateRevenuePDF: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
    encoding: z.string(),
  }),
  exportBookingsExcel: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
    encoding: z.string(),
  }),
  exportRevenueExcel: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
    encoding: z.string(),
  }),
  exportFlightPerformanceExcel: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
    encoding: z.string(),
  }),
  generateFlightPerformancePDF: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
    encoding: z.string(),
  }),
  exportRefundsCSV: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
  }),
  exportRefundsExcel: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
    encoding: z.string(),
  }),
  generateRefundsPDF: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
    encoding: z.string(),
  }),
};
