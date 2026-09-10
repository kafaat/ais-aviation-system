// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getStatus: z.object({
    success: z.boolean(),
    data: z.object({
      statusLabel: z.string(),
      statusLabelAr: z.string(),
      flightId: outputNumber,
      cabinClass: z.enum(["economy", "business"]),
      totalSeats: outputNumber,
      soldSeats: outputNumber,
      heldSeats: outputNumber,
      availableSeats: outputNumber,
      waitlistCount: outputNumber,
      overbookingLimit: outputNumber,
      effectiveAvailable: outputNumber,
      occupancyRate: outputNumber,
      status: z.enum(["available", "closed", "limited", "waitlist_only"]),
    }),
  }),
  allocateSeats: z.object({
    success: z.boolean(),
    data: z.object({
      success: z.boolean(),
      holdId: z.union([z.undefined(), outputNumber]).optional(),
      lockId: z.union([z.undefined(), outputNumber]).optional(),
      seatsAllocated: outputNumber,
      expiresAt: z.union([z.undefined(), z.date()]).optional(),
      waitlistPosition: z.union([z.undefined(), outputNumber]).optional(),
      message: z.string(),
    }),
  }),
  releaseHold: z.object({ success: z.boolean(), message: z.string() }),
  addToWaitlist: z.object({
    success: z.boolean(),
    data: z.object({
      message: z.string(),
      messageAr: z.string(),
      id: outputNumber,
      flightId: outputNumber,
      cabinClass: z.enum(["economy", "business"]),
      userId: outputNumber,
      seats: outputNumber,
      priority: outputNumber,
      status: z.enum([
        "cancelled",
        "confirmed",
        "expired",
        "waiting",
        "offered",
      ]),
      createdAt: z.date(),
      offeredAt: z.union([z.undefined(), z.date()]).optional(),
      expiresAt: z.union([z.undefined(), z.date()]).optional(),
    }),
  }),
  removeFromWaitlist: z.object({ success: z.boolean(), message: z.string() }),
  getForecast: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        date: z.date(),
        predictedDemand: outputNumber,
        recommendedOverbooking: outputNumber,
        expectedNoShows: outputNumber,
        riskLevel: z.enum(["high", "medium", "low"]),
      })
    ),
  }),
  getRecommendedOverbooking: z.object({
    success: z.boolean(),
    data: z.object({ economy: outputNumber, business: outputNumber }),
  }),
  handleDeniedBoarding: z.object({
    success: z.boolean(),
    data: z.object({
      volunteersNeeded: outputNumber,
      compensationOffer: outputNumber,
      alternativeFlights: z.array(
        z.object({
          id: outputNumber,
          flightNumber: z.string(),
          departureTime: z.date(),
          availableSeats: outputNumber,
        })
      ),
    }),
  }),
  recordDeniedBoarding: z.object({
    success: z.boolean(),
    data: z.object({ id: outputNumber }),
  }),
  getDeniedBoardingRecords: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        id: outputNumber,
        flightId: outputNumber,
        bookingId: outputNumber,
        userId: outputNumber,
        type: z.enum(["voluntary", "involuntary"]),
        compensationAmount: outputNumber,
        compensationCurrency: z.string(),
        compensationType: z.enum(["miles", "cash", "voucher"]),
        alternativeFlightId: z.union([z.null(), outputNumber]),
        status: z.enum(["completed", "pending", "rejected", "accepted"]),
        notes: z.union([z.null(), z.string()]),
        createdAt: z.date(),
        updatedAt: z.date(),
      })
    ),
  }),
  updateDeniedBoardingStatus: z.object({ success: z.boolean() }),
  getOverbookingConfigs: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        id: outputNumber,
        airlineId: z.union([z.null(), outputNumber]),
        originId: z.union([z.null(), outputNumber]),
        destinationId: z.union([z.null(), outputNumber]),
        economyRate: z.string(),
        businessRate: z.string(),
        maxOverbooking: outputNumber,
        historicalNoShowRate: z.union([z.null(), z.string()]),
        isActive: z.boolean(),
        createdAt: z.date(),
        updatedAt: z.date(),
      })
    ),
  }),
  createOverbookingConfig: z.object({
    success: z.boolean(),
    data: z.object({ id: outputNumber }),
  }),
  expireOldHolds: z.object({
    success: z.boolean(),
    data: z.object({ expiredCount: outputNumber, message: z.string() }),
  }),
  processWaitlist: z.object({
    success: z.boolean(),
    data: z.object({ seatsOffered: outputNumber }),
    message: z.string(),
  }),
};
