// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  list: z.array(
    z.object({
      id: outputNumber,
      status: z.enum(["cancelled", "pending", "confirmed"]),
      createdAt: z.date(),
      updatedAt: z.date(),
      flightId: outputNumber,
      cabinClass: z.enum(["economy", "business"]),
      totalPrice: z.union([z.null(), outputNumber]),
      notes: z.union([z.null(), z.string()]),
      organizerName: z.string(),
      organizerEmail: z.string(),
      organizerPhone: z.string(),
      groupSize: outputNumber,
      discountPercent: z.union([z.null(), z.string()]),
      rejectionReason: z.union([z.null(), z.string()]),
      approvedBy: z.union([z.null(), outputNumber]),
      approvedAt: z.union([z.null(), z.date()]),
      flight: z.object({
        flightNumber: z.string(),
        departureTime: z.date(),
        economyPrice: outputNumber,
        businessPrice: outputNumber,
      }),
    })
  ),
  getStats: z.object({
    totalRequests: outputNumber,
    pendingRequests: outputNumber,
    confirmedRequests: outputNumber,
    cancelledRequests: outputNumber,
    totalGroupPassengers: outputNumber,
  }),
  getById: z.object({
    id: outputNumber,
    status: z.enum(["cancelled", "pending", "confirmed"]),
    createdAt: z.date(),
    updatedAt: z.date(),
    flightId: outputNumber,
    cabinClass: z.enum(["economy", "business"]),
    totalPrice: z.union([z.null(), outputNumber]),
    notes: z.union([z.null(), z.string()]),
    organizerName: z.string(),
    organizerEmail: z.string(),
    organizerPhone: z.string(),
    groupSize: outputNumber,
    discountPercent: z.union([z.null(), z.string()]),
    rejectionReason: z.union([z.null(), z.string()]),
    approvedBy: z.union([z.null(), outputNumber]),
    approvedAt: z.union([z.null(), z.date()]),
  }),
  getDiscountTiers: z.object({
    minGroupSize: outputNumber,
    tiers: z.array(
      z.union([
        z.object({
          name: z.string(),
          minPassengers: outputNumber,
          maxPassengers: outputNumber,
          discountPercent: outputNumber,
        }),
        z.object({
          name: z.string(),
          minPassengers: outputNumber,
          maxPassengers: z.null(),
          discountPercent: outputNumber,
        }),
      ])
    ),
  }),
};
