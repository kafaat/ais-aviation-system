// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getDashboard: z.object({
    totalRevenue: outputNumber,
    deferredRevenue: outputNumber,
    recognizedRevenue: outputNumber,
    ancillaryRevenue: outputNumber,
    refundTotal: outputNumber,
    netRevenue: outputNumber,
    revenueGrowthPercent: outputNumber,
    averageRevenuePerBooking: outputNumber,
    totalBookings: outputNumber,
  }),
  getRevenueByRoute: z.array(
    z.object({
      originCode: z.string(),
      originCity: z.string(),
      destinationCode: z.string(),
      destinationCity: z.string(),
      totalRevenue: outputNumber,
      bookingCount: outputNumber,
      averageRevenue: outputNumber,
      passengerCount: outputNumber,
    })
  ),
  getRevenueByClass: z.array(
    z.object({
      classOfService: z.string(),
      totalRevenue: outputNumber,
      bookingCount: outputNumber,
      averageRevenue: outputNumber,
      passengerCount: outputNumber,
      percentageOfTotal: outputNumber,
    })
  ),
  getRevenueByChannel: z.array(
    z.object({
      channel: z.string(),
      totalRevenue: outputNumber,
      bookingCount: outputNumber,
      averageRevenue: outputNumber,
      percentageOfTotal: outputNumber,
    })
  ),
  getAncillaryRevenue: z.object({
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
    total: outputNumber,
    items: z.array(
      z.object({
        bookingId: outputNumber,
        bookingReference: z.string(),
        flightNumber: z.string(),
        departureDate: z.string(),
        cabinClass: z.string(),
        amount: outputNumber,
        passengerCount: outputNumber,
      })
    ),
  }),
  generateReport: z.object({
    id: z.string(),
    reportType: z.enum(["monthly", "quarterly", "annual"]),
    periodStart: z.string(),
    periodEnd: z.string(),
    totalRevenue: outputNumber,
    deferredRevenue: outputNumber,
    recognizedRevenue: outputNumber,
    refundAmount: outputNumber,
    ancillaryRevenue: outputNumber,
    status: z.enum(["draft", "finalized"]),
    generatedAt: z.string(),
  }),
  getReports: z.array(
    z.object({
      id: z.string(),
      reportType: z.enum(["monthly", "quarterly", "annual"]),
      periodStart: z.string(),
      periodEnd: z.string(),
      totalRevenue: outputNumber,
      deferredRevenue: outputNumber,
      recognizedRevenue: outputNumber,
      refundAmount: outputNumber,
      ancillaryRevenue: outputNumber,
      status: z.enum(["draft", "finalized"]),
      generatedAt: z.string(),
    })
  ),
  getYieldAnalysis: z.array(
    z.object({
      flightId: outputNumber,
      flightNumber: z.string(),
      originCode: z.string(),
      destinationCode: z.string(),
      totalRevenue: outputNumber,
      passengerCount: outputNumber,
      distanceKm: outputNumber,
      rpk: outputNumber,
      yield: outputNumber,
      loadFactor: outputNumber,
    })
  ),
  getRefundImpact: z.object({
    totalRefunds: outputNumber,
    refundCount: outputNumber,
    averageRefundAmount: outputNumber,
    refundRate: outputNumber,
    refundsByMonth: z.array(
      z.object({ month: z.string(), amount: outputNumber, count: outputNumber })
    ),
  }),
};
