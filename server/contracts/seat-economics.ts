// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getByBooking: z.object({
    unverifiedVoucherDiscounts: z
      .union([z.undefined(), outputNumber])
      .optional(),
    bookingId: z.union([z.undefined(), outputNumber]).optional(),
    currency: z.string(),
    seats: z.array(
      z.object({
        passengerId: z.union([z.null(), outputNumber]),
        passengerName: z.string(),
        seatNumber: z.union([z.null(), z.string()]),
        revenue: z.object({
          baseFare: outputNumber,
          ancillaries: outputNumber,
          gross: outputNumber,
          discounts: outputNumber,
          netRevenue: outputNumber,
        }),
        cost: z.object({
          paymentFee: outputNumber,
          agentCommission: outputNumber,
          totalCost: outputNumber,
        }),
        netContribution: outputNumber,
        marginPct: outputNumber,
      })
    ),
    summary: z.object({
      seatCount: outputNumber,
      baseFare: outputNumber,
      ancillaries: outputNumber,
      gross: outputNumber,
      discounts: outputNumber,
      netRevenue: outputNumber,
      paymentFee: outputNumber,
      agentCommission: outputNumber,
      totalCost: outputNumber,
      netContribution: outputNumber,
      marginPct: outputNumber,
    }),
    assumptions: z.object({
      paymentFeeRate: outputNumber,
      paymentFeeFixed: outputNumber,
      note: z.string(),
    }),
  }),
  getByFlight: z.object({
    flightId: outputNumber,
    currency: z.string(),
    bookingCount: outputNumber,
    seatCount: outputNumber,
    gross: outputNumber,
    discounts: outputNumber,
    netRevenue: outputNumber,
    totalCost: outputNumber,
    netContribution: outputNumber,
    avgNetContributionPerSeat: outputNumber,
    marginPct: outputNumber,
  }),
};
