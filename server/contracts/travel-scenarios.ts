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
    method: z.string().nullable(),
    methodVersion: z.string().nullable(),
    reference: z.string().nullable(),
    basis: z.enum(["measured", "estimated", "unavailable"]),
    sourceId: z.string().nullable(),
    evidenceId: z.number().nullable(),
    observedAt: z.date().nullable(),
    validUntil: z.date().nullable(),
    offsetQuoteId: z.string().nullable(),
    offsetReference: z.string().nullable(),
    offsetBusinessCostSAR: outputNumber.nullable(),
    distanceKm: outputNumber.nullable(),
    co2Economy: outputNumber.nullable(),
    co2Business: outputNumber.nullable(),
    treesEquivalent: z.null(),
    offsetCostSAR: outputNumber.nullable(),
  }),
  getTravelRequirements: z.object({
    status: z.enum(["sourced_requirements", "unknown"]),
    sourceId: z.string().nullable(),
    evidenceId: z.number().nullable(),
    reference: z.string().nullable(),
    version: z.string().nullable(),
    observedAt: z.date().nullable(),
    validUntil: z.date().nullable(),
    destination: z.object({
      code: z.string(),
      city: z.string(),
      country: z.string(),
    }),
    requirements: z.object({
      visaRequired: z.boolean().nullable(),
      visaOnArrival: z.boolean().nullable(),
      passportValidityMonths: z.null(),
      passportValidUntil: z.string().nullable(),
      covidTestRequired: z.boolean().nullable(),
      notes: z.array(z.string()),
    }),
  }),
};
