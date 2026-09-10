// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getRebookData: z.object({
    originalBookingId: outputNumber,
    originalBookingRef: z.string(),
    cabinClass: z.enum(["economy", "business"]),
    passengers: z.array(
      z.object({
        type: z.enum(["adult", "child", "infant"]),
        title: z.union([z.null(), z.string()]),
        firstName: z.string(),
        lastName: z.string(),
        dateOfBirth: z.union([z.null(), z.date()]),
        passportNumber: z.union([z.null(), z.string()]),
        nationality: z.union([z.null(), z.string()]),
      })
    ),
    ancillaries: z.array(
      z.object({
        ancillaryServiceId: outputNumber,
        code: z.string(),
        name: z.string(),
        category: z.string(),
        quantity: outputNumber,
        unitPrice: outputNumber,
        totalPrice: outputNumber,
      })
    ),
    route: z.object({
      originId: outputNumber,
      originCode: z.string(),
      originCity: z.string(),
      destinationId: outputNumber,
      destinationCode: z.string(),
      destinationCity: z.string(),
    }),
  }),
  searchFlights: z.array(
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
      originCode: z.string(),
      originCity: z.string(),
      destinationCode: z.string(),
      destinationCity: z.string(),
    })
  ),
  quickRebook: z.object({
    newBookingId: outputNumber,
    bookingReference: z.string(),
    pnr: z.string(),
    totalAmount: outputNumber,
    passengers: outputNumber,
  }),
};
