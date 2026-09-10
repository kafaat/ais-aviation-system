// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  forUser: z.array(
    z.object({
      flightId: outputNumber,
      flightNumber: z.string(),
      originId: outputNumber,
      originCode: z.string(),
      originCity: z.string(),
      destinationId: outputNumber,
      destinationCode: z.string(),
      destinationCity: z.string(),
      departureTime: z.date(),
      arrivalTime: z.date(),
      economyPrice: outputNumber,
      businessPrice: outputNumber,
      economyAvailable: outputNumber,
      businessAvailable: outputNumber,
      airlineName: z.string(),
      airlineCode: z.string(),
      reason: z.enum(["popular", "history", "deal", "trending"]),
      score: outputNumber,
    })
  ),
  popular: z.array(
    z.object({
      flightId: outputNumber,
      flightNumber: z.string(),
      originId: outputNumber,
      originCode: z.string(),
      originCity: z.string(),
      destinationId: outputNumber,
      destinationCode: z.string(),
      destinationCity: z.string(),
      departureTime: z.date(),
      arrivalTime: z.date(),
      economyPrice: outputNumber,
      businessPrice: outputNumber,
      economyAvailable: outputNumber,
      businessAvailable: outputNumber,
      airlineName: z.string(),
      airlineCode: z.string(),
      reason: z.enum(["popular", "history", "deal", "trending"]),
      score: outputNumber,
    })
  ),
  deals: z.array(
    z.object({
      flightId: outputNumber,
      flightNumber: z.string(),
      originId: outputNumber,
      originCode: z.string(),
      originCity: z.string(),
      destinationId: outputNumber,
      destinationCode: z.string(),
      destinationCity: z.string(),
      departureTime: z.date(),
      arrivalTime: z.date(),
      economyPrice: outputNumber,
      businessPrice: outputNumber,
      economyAvailable: outputNumber,
      businessAvailable: outputNumber,
      airlineName: z.string(),
      airlineCode: z.string(),
      reason: z.enum(["popular", "history", "deal", "trending"]),
      score: outputNumber,
    })
  ),
};
