import { z } from "zod";
import { outputNumber } from "./primitives";
const basis = {
  schemaVersion: z.literal(2),
  basis: z.literal("posted_booking_ledger"),
  currency: z.literal("SAR"),
  recognitionStatus: z.literal("unavailable"),
  periodBasis: z.literal("ledger_transaction_date_utc"),
};
const unavailable = {
  deferredRevenue: z.null(),
  recognizedRevenue: z.null(),
  ancillaryRevenue: z.null(),
};
const money = {
  ...basis,
  totalRevenue: outputNumber,
  refundedAmount: outputNumber,
  netAmount: outputNumber,
  bookingCount: outputNumber,
  activeBookings: outputNumber,
  averageRevenue: outputNumber,
  passengerCount: outputNumber,
  unmatchedCollectionEntries: outputNumber,
  reviewCollectionAmount: outputNumber,
};
const report = z.object({
  ...basis,
  ...unavailable,
  id: z.string(),
  reportType: z.literal("monthly"),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalRevenue: outputNumber,
  refundAmount: outputNumber,
  netRevenue: outputNumber,
  status: z.literal("preview"),
  generatedAt: z.string(),
});
export const responseContracts = {
  getDashboard: z.object({
    ...basis,
    ...unavailable,
    totalRevenue: outputNumber,
    refundTotal: outputNumber,
    netRevenue: outputNumber,
    revenueGrowthPercent: outputNumber.nullable(),
    averageRevenuePerBooking: outputNumber,
    totalBookings: outputNumber,
    activeBookings: outputNumber,
    collectionEntries: outputNumber,
    refundEntries: outputNumber,
    bookedAmount: outputNumber,
    bookedCount: outputNumber,
    unpostedPaidBookings: outputNumber,
    unmatchedCollectionEntries: outputNumber,
    reviewCollectionAmount: outputNumber,
  }),
  getRevenueByRoute: z.array(
    z.object({
      ...money,
      originCode: z.string(),
      originCity: z.string(),
      destinationCode: z.string(),
      destinationCity: z.string(),
      itineraryType: z.string(),
    })
  ),
  getRevenueByClass: z.array(
    z.object({
      ...money,
      classOfService: z.string(),
      percentageOfTotal: outputNumber,
    })
  ),
  getRevenueByChannel: z.array(
    z.object({ ...money, channel: z.string(), percentageOfTotal: outputNumber })
  ),
  getAncillaryRevenue: z.object({
    basis: z.literal("active_ancillary_invoice_lines"),
    total: outputNumber,
    breakdown: z.array(
      z.object({
        category: z.string(),
        totalRevenue: outputNumber,
        quantity: outputNumber,
        averagePrice: outputNumber,
        percentageOfTotal: outputNumber,
      })
    ),
  }),
  getDeferredRevenue: z.object({
    total: z.null(),
    items: z.array(z.never()),
    recognitionStatus: z.literal("unavailable"),
    reason: z.string(),
  }),
  generateReport: report,
  getReports: z.array(report),
  getYieldAnalysis: z.array(
    z.object({
      ...money,
      flightId: outputNumber.nullable(),
      flightNumber: z.string(),
      originCode: z.string(),
      destinationCode: z.string(),
      itineraryType: z.string(),
      distanceKm: z.null(),
      rpk: z.null(),
      yield: z.null(),
      loadFactor: z.null(),
      yieldStatus: z.literal("unavailable"),
    })
  ),
  getRefundImpact: z.object({
    ...basis,
    totalRefunds: outputNumber,
    refundCount: outputNumber,
    refundedBookings: outputNumber,
    activeBookings: outputNumber,
    averageRefundAmount: outputNumber,
    refundRate: outputNumber,
    refundsByMonth: z.array(
      z.object({ month: z.string(), amount: outputNumber, count: outputNumber })
    ),
  }),
};
