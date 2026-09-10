// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  issue: z.object({
    token: z.string(),
    payload: z.object({
      bookingId: outputNumber,
      bookingReference: z.string(),
      passengerId: outputNumber,
      passengerName: z.string(),
      flightNumber: z.string(),
      originId: outputNumber,
      destinationId: outputNumber,
      departureTime: z.string(),
      seatNumber: z.union([z.null(), z.string()]),
      cabinClass: z.union([z.null(), z.string()]),
      sequence: z.union([z.null(), outputNumber]),
    }),
  }),
  verify: z.union([
    z.object({
      valid: z.literal(true),
      data: z.object({
        bookingId: outputNumber,
        bookingReference: z.string(),
        passengerId: outputNumber,
        passengerName: z.string(),
        flightNumber: z.string(),
        originId: outputNumber,
        destinationId: outputNumber,
        departureTime: z.string(),
        seatNumber: z.union([z.null(), z.string()]),
        cabinClass: z.union([z.null(), z.string()]),
        sequence: z.union([z.null(), outputNumber]),
      }),
    }),
    z.object({ valid: z.literal(false), reason: z.string() }),
  ]),
};
