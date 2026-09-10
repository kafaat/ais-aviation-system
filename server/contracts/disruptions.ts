// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  myDisruptions: z.array(
    z.object({
      bookingReference: z.union([z.undefined(), z.string()]),
      bookingId: z.union([z.undefined(), outputNumber]),
      id: outputNumber,
      flightId: outputNumber,
      type: z.enum(["delay", "cancellation", "diversion"]),
      reason: z.string(),
      severity: z.enum(["minor", "moderate", "severe"]),
      originalDepartureTime: z.union([z.null(), z.date()]),
      newDepartureTime: z.union([z.null(), z.date()]),
      delayMinutes: z.union([z.null(), outputNumber]),
      status: z.enum(["cancelled", "active", "resolved"]),
      createdAt: z.date(),
      flightNumber: z.string(),
      originId: outputNumber,
      destinationId: outputNumber,
    })
  ),
  getAlternatives: z.object({
    originalFlight: z.object({
      id: outputNumber,
      flightNumber: z.string(),
      departureTime: z.date(),
      origin: z.object({ code: z.string(), city: z.string() }),
      destination: z.object({ code: z.string(), city: z.string() }),
    }),
    alternatives: z.array(
      z.object({
        id: outputNumber,
        flightNumber: z.string(),
        departureTime: z.date(),
        arrivalTime: z.date(),
        economyPrice: outputNumber,
        businessPrice: outputNumber,
        economyAvailable: outputNumber,
        businessAvailable: outputNumber,
        status: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
        airlineId: outputNumber,
      })
    ),
  }),
  create: z.object({
    id: outputNumber,
    flightId: outputNumber,
    type: z.enum(["delay", "cancellation", "diversion"]),
    reason: z.string(),
    severity: z.enum(["minor", "moderate", "severe"]),
    originalDepartureTime: z.union([z.null(), z.date()]),
    newDepartureTime: z.union([z.null(), z.date()]),
    delayMinutes: z.union([z.null(), outputNumber]),
    status: z.enum(["cancelled", "active", "resolved"]),
    createdBy: z.union([z.null(), outputNumber]),
    resolvedAt: z.union([z.null(), z.date()]),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
  activeDisruptions: z.array(
    z.object({
      id: outputNumber,
      flightId: outputNumber,
      type: z.enum(["delay", "cancellation", "diversion"]),
      reason: z.string(),
      severity: z.enum(["minor", "moderate", "severe"]),
      originalDepartureTime: z.union([z.null(), z.date()]),
      newDepartureTime: z.union([z.null(), z.date()]),
      delayMinutes: z.union([z.null(), outputNumber]),
      status: z.enum(["cancelled", "active", "resolved"]),
      createdAt: z.date(),
      flightNumber: z.string(),
    })
  ),
  resolve: z.object({ success: z.boolean() }),
};
