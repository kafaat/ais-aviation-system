// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  calculateScore: z.object({
    id: outputNumber,
    passengerId: outputNumber,
    bookingId: outputNumber,
    flightId: outputNumber,
    loyaltyScore: outputNumber,
    fareClassScore: outputNumber,
    connectionScore: outputNumber,
    specialNeedsScore: outputNumber,
    timeSensitivityScore: outputNumber,
    bookingValueScore: outputNumber,
    totalScore: outputNumber,
    tier: z.enum(["high", "medium", "low", "critical"]),
    calculatedAt: z.date(),
    createdAt: z.date(),
  }),
  rankPassengers: z.array(
    z.object({
      id: outputNumber,
      passengerId: outputNumber,
      bookingId: outputNumber,
      flightId: outputNumber,
      loyaltyScore: outputNumber,
      fareClassScore: outputNumber,
      connectionScore: outputNumber,
      specialNeedsScore: outputNumber,
      timeSensitivityScore: outputNumber,
      bookingValueScore: outputNumber,
      totalScore: outputNumber,
      tier: z.enum(["high", "medium", "low", "critical"]),
      calculatedAt: z.date(),
      createdAt: z.date(),
    })
  ),
  getPassengerProfile: z.object({
    passenger: z.object({
      id: outputNumber,
      firstName: z.string(),
      lastName: z.string(),
      type: z.string(),
      dateOfBirth: z.union([z.null(), z.date()]),
      bookingId: outputNumber,
    }),
    booking: z.object({
      id: outputNumber,
      bookingReference: z.string(),
      cabinClass: z.string(),
      totalAmount: outputNumber,
      status: z.string(),
      flightId: outputNumber,
    }),
    loyalty: z.union([
      z.null(),
      z.object({
        tier: z.string(),
        tierPoints: outputNumber,
        currentMilesBalance: outputNumber,
      }),
    ]),
    specialServices: z.array(
      z.object({
        serviceType: z.string(),
        serviceCode: z.string(),
        status: z.string(),
      })
    ),
    priorityScore: z.object({
      id: outputNumber,
      passengerId: outputNumber,
      bookingId: outputNumber,
      flightId: outputNumber,
      loyaltyScore: outputNumber,
      fareClassScore: outputNumber,
      connectionScore: outputNumber,
      specialNeedsScore: outputNumber,
      timeSensitivityScore: outputNumber,
      bookingValueScore: outputNumber,
      totalScore: outputNumber,
      tier: z.enum(["high", "medium", "low", "critical"]),
      calculatedAt: z.date(),
      createdAt: z.date(),
    }),
  }),
  getRebookingOrder: z.array(
    z.object({
      passengerId: outputNumber,
      firstName: z.string(),
      lastName: z.string(),
      bookingId: outputNumber,
      bookingReference: z.string(),
      totalScore: outputNumber,
      tier: z.enum(["high", "medium", "low", "critical"]),
      loyaltyTier: z.union([z.null(), z.string()]),
      cabinClass: z.string(),
    })
  ),
  getProtectionOptions: z.object({
    priorityScore: z.object({
      id: outputNumber,
      passengerId: outputNumber,
      bookingId: outputNumber,
      flightId: outputNumber,
      loyaltyScore: outputNumber,
      fareClassScore: outputNumber,
      connectionScore: outputNumber,
      specialNeedsScore: outputNumber,
      timeSensitivityScore: outputNumber,
      bookingValueScore: outputNumber,
      totalScore: outputNumber,
      tier: z.enum(["high", "medium", "low", "critical"]),
      calculatedAt: z.date(),
      createdAt: z.date(),
    }),
    options: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        description: z.string(),
        available: z.boolean(),
      })
    ),
  }),
  getRules: z.array(
    z.object({
      id: outputNumber,
      factorName: z.string(),
      factorKey: z.string(),
      value: z.string(),
      score: outputNumber,
      isActive: z.boolean(),
      createdAt: z.date(),
    })
  ),
  updateRule: z.object({
    id: outputNumber,
    factorName: z.string(),
    factorKey: z.string(),
    value: z.string(),
    score: outputNumber,
    isActive: z.boolean(),
    createdAt: z.date(),
  }),
};

/** R2-11 — advisory reaccommodation assignment. Explicitly advisory: the
 * `advisory` literal is part of the contract so no consumer can mistake this
 * for a booking, and the objective travels with the plan so the weights can
 * be argued with rather than reverse-engineered. */
export const reaccommodationAdvisory = z.object({
  plan: z.object({
    disruptedFlightId: outputNumber,
    objectiveValue: outputNumber,
    assignments: z.array(
      z.object({
        passengerId: outputNumber,
        bookingId: outputNumber,
        flightId: outputNumber.nullable(),
        flightNumber: z.string().nullable(),
        cabin: z.enum(["economy", "business"]).nullable(),
        delayMinutes: outputNumber.nullable(),
        downgraded: z.boolean(),
        cost: outputNumber,
        reason: z.string(),
      })
    ),
    unassigned: z.array(outputNumber),
    advisory: z.literal(true),
    objective: z.object({
      order: z.literal("max-assigned-then-min-cost"),
      weightAtZeroPriority: outputNumber,
      weightPerPriorityPoint: outputNumber,
      downgradeMinutes: outputNumber,
      unassignedMinutes: outputNumber,
    }),
  }),
  consideredOptions: outputNumber,
  consideredPassengers: outputNumber,
  optionsTruncated: z.boolean(),
  window: z.object({ fromISO: z.string(), toISO: z.string() }),
});
