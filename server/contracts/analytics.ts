// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getKPIs: z.object({
    totalBookings: outputNumber,
    totalRevenue: outputNumber,
    billedAmount: outputNumber,
    collectedAmount: outputNumber,
    refundedAmount: outputNumber,
    netCollectedAmount: outputNumber,
    earnedRevenue: z.null(),
    unreconciledBookings: outputNumber,
    unclassifiedEntries: outputNumber,
    currency: z.literal("SAR"),
    amountUnit: z.literal("minor"),
    averageOccupancyRate: outputNumber,
    cancellationRate: outputNumber,
    totalPassengers: outputNumber,
  }),
  getRevenueOverTime: z.array(
    z.object({
      date: z.string(),
      revenue: outputNumber,
      bookings: outputNumber,
    })
  ),
  getPopularDestinations: z.array(
    z.object({
      airportCode: z.string(),
      airportName: z.string(),
      city: z.string(),
      bookingCount: outputNumber,
      revenue: outputNumber,
    })
  ),
  getBookingTrends: z.array(
    z.object({
      date: z.string(),
      bookings: outputNumber,
      passengers: outputNumber,
    })
  ),
  getFlightOccupancy: z.array(
    z.object({
      flightId: outputNumber,
      flightNumber: z.string(),
      departureTime: z.date(),
      totalSeats: outputNumber,
      bookedSeats: outputNumber,
      occupancyRate: outputNumber,
    })
  ),
  getAncillaryMetrics: z.object({
    totalAncillaryRevenue: outputNumber,
    ancillaryAttachmentRate: outputNumber,
    averageAncillaryRevenuePerBooking: outputNumber,
    totalAncillariesSold: outputNumber,
  }),
  getAncillaryRevenueByCategory: z.array(
    z.object({
      category: z.string(),
      revenue: outputNumber,
      quantity: outputNumber,
      percentage: outputNumber,
    })
  ),
  getPopularAncillaries: z.array(
    z.object({
      serviceName: z.string(),
      category: z.string(),
      totalSold: outputNumber,
      revenue: outputNumber,
    })
  ),
};
