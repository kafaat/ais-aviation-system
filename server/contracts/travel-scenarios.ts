// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getAutoCheckIn: z.object({ autoCheckIn: z.boolean() }),
  setAutoCheckIn: z.object({ autoCheckIn: z.boolean() }),
  getShareableItinerary: z.object({
    bookingReference: z.string(),
    flightNumber: z.string(),
    cabinClass: z.enum(["economy", "business"]),
    departureTime: z.date(),
    arrivalTime: z.date(),
    origin: z.object({ code: z.string(), city: z.string() }),
    destination: z.object({ code: z.string(), city: z.string() }),
    passengers: z.array(
      z.object({
        firstName: z.string(),
        type: z.enum(["adult", "child", "infant"]),
      })
    ),
    numberOfPassengers: outputNumber,
  }),
  getCarbonOffset: z.object({
    distanceKm: outputNumber,
    co2Economy: outputNumber,
    co2Business: outputNumber,
    treesEquivalent: outputNumber,
    offsetCostSAR: outputNumber,
  }),
  getTravelRequirements: z.object({
    destination: z.object({
      code: z.string(),
      city: z.string(),
      country: z.string(),
    }),
    requirements: z.object({
      visaRequired: z.boolean(),
      visaOnArrival: z.boolean(),
      passportValidityMonths: outputNumber,
      covidTestRequired: z.boolean(),
      notes: z.array(z.string()),
    }),
  }),
};
