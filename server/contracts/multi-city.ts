// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  search: z.array(
    z.object({
      segmentIndex: outputNumber,
      flights: z.array(
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
    })
  ),
  calculatePrice: z.object({
    segments: z.array(
      z.object({
        segmentIndex: outputNumber,
        flightId: outputNumber,
        basePrice: outputNumber,
        discountedPrice: outputNumber,
        cabinClass: z.enum(["economy", "business"]),
      })
    ),
    subtotal: outputNumber,
    discount: outputNumber,
    discountPercentage: outputNumber,
    totalPrice: outputNumber,
  }),
  create: z.object({
    bookingId: outputNumber,
    bookingReference: z.string(),
    pnr: z.string(),
    totalAmount: outputNumber,
    segments: z.array(
      z.object({ segmentId: outputNumber, flightId: outputNumber })
    ),
  }),
  getSegments: z.array(
    z.object({
      id: outputNumber,
      segmentOrder: outputNumber,
      flightId: outputNumber,
      departureDate: z.date(),
      status: z.string(),
      flight: z.object({
        id: outputNumber,
        flightNumber: z.string(),
        departureTime: z.date(),
        arrivalTime: z.date(),
        status: z.string(),
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
      }),
    })
  ),
  isMultiCity: z.object({ isMultiCity: z.boolean() }),
};
