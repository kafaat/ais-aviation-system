// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  search: z.array(
    z.object({
      id: outputNumber,
      flightNumber: z.string(),
      departureTime: z.date(),
      arrivalTime: z.date(),
      aircraftType: z.union([z.null(), z.string()]),
      status: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
      economyPrice: outputNumber,
      businessPrice: outputNumber,
      economyAvailable: outputNumber,
      businessAvailable: outputNumber,
      airline: z.object({
        code: z.string(),
        name: z.string(),
        logo: z.union([z.null(), z.string()]),
      }),
      origin: z.object({
        code: z.string(),
        name: z.string(),
        city: z.string(),
      }),
      destination: z.object({
        code: z.string(),
        name: z.string(),
        city: z.string(),
      }),
    })
  ),
  getById: z.union([
    z.null(),
    z.object({
      id: outputNumber,
      flightNumber: z.string(),
      departureTime: z.date(),
      arrivalTime: z.date(),
      aircraftType: z.union([z.null(), z.string()]),
      status: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
      economySeats: outputNumber,
      businessSeats: outputNumber,
      economyPrice: outputNumber,
      businessPrice: outputNumber,
      economyAvailable: outputNumber,
      businessAvailable: outputNumber,
      airline: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
        logo: z.union([z.null(), z.string()]),
      }),
      origin: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
        city: z.string(),
        country: z.string(),
      }),
      destination: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
        city: z.string(),
        country: z.string(),
      }),
    }),
  ]),
  getStatusHistory: z.object({
    flightNumber: z.string(),
    currentStatus: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
    lastUpdated: z.date(),
    history: z.array(
      z.object({
        id: outputNumber,
        flightId: outputNumber,
        oldStatus: z.union([
          z.null(),
          z.literal("scheduled"),
          z.literal("delayed"),
          z.literal("cancelled"),
          z.literal("completed"),
        ]),
        newStatus: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
        delayMinutes: z.union([z.null(), outputNumber]),
        reason: z.union([z.null(), z.string()]),
        changedBy: z.union([z.null(), outputNumber]),
        createdAt: z.date(),
      })
    ),
  }),
  popularRoutes: z.array(
    z.object({
      originId: outputNumber,
      destinationId: outputNumber,
      originCode: z.string(),
      originCity: z.string(),
      originCountry: z.string(),
      destinationCode: z.string(),
      destinationCity: z.string(),
      destinationCountry: z.string(),
      searchCount: outputNumber,
      bookingCount: outputNumber,
      score: outputNumber,
    })
  ),
  suggestedDestinations: z.array(
    z.object({
      originId: outputNumber,
      destinationId: outputNumber,
      originCode: z.string(),
      originCity: z.string(),
      originCountry: z.string(),
      destinationCode: z.string(),
      destinationCity: z.string(),
      destinationCountry: z.string(),
      searchCount: outputNumber,
      bookingCount: outputNumber,
      score: outputNumber,
    })
  ),
};
