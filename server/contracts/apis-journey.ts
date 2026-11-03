import { z } from "zod";

export const passengerJourneyStatus = z.object({
  bookingId: z.number().int().positive(),
  passengerId: z.number().int().positive(),
  flightId: z.number().int().positive(),
  flightNumber: z.string(),
  originAirport: z.string(),
  destinationAirport: z.string(),
  originCountry: z.string().nullable(),
  destinationCountry: z.string().nullable(),
  clearanceRequired: z.boolean(),
  clearanceStatus: z.enum(["not_required", "cleared", "not_cleared"]),
  checkedAt: z.string(),
});

export const authoritySubmissionCapability = z.object({
  available: z.boolean(),
  reason: z.literal("authority_transport_unavailable"),
});
