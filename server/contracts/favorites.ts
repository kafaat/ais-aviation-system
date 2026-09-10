// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  addFlight: z.object({
    createdAt: z.date(),
    flightId: outputNumber,
    userId: outputNumber,
    id: outputNumber,
  }),
  removeFlight: z.object({ success: z.boolean() }),
  getFlights: z.array(
    z.object({
      favorite: z.object({
        id: outputNumber,
        userId: outputNumber,
        flightId: outputNumber,
        createdAt: z.date(),
      }),
      flight: z.object({
        id: outputNumber,
        flightNumber: z.string(),
        airlineId: outputNumber,
        tenantId: z.union([z.null(), outputNumber]),
        originId: outputNumber,
        destinationId: outputNumber,
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
        createdAt: z.date(),
        updatedAt: z.date(),
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
      airline: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
        logo: z.union([z.null(), z.string()]),
      }),
    })
  ),
  isFlightFavorited: z.boolean(),
  add: z.object({
    createdAt: z.date(),
    updatedAt: z.date(),
    originId: outputNumber,
    destinationId: outputNumber,
    userId: outputNumber,
    id: outputNumber,
    airlineId: z.union([z.undefined(), z.null(), outputNumber]).optional(),
    cabinClass: z
      .union([
        z.undefined(),
        z.null(),
        z.literal("economy"),
        z.literal("business"),
      ])
      .optional(),
    emailNotifications: z
      .union([z.undefined(), z.literal(false), z.literal(true)])
      .optional(),
    enablePriceAlert: z
      .union([z.undefined(), z.literal(false), z.literal(true)])
      .optional(),
    maxPrice: z.union([z.undefined(), z.null(), outputNumber]).optional(),
    notes: z.union([z.undefined(), z.null(), z.string()]).optional(),
    lastAlertSent: z.union([z.undefined(), z.null(), z.date()]).optional(),
  }),
  getAll: z.array(
    z.object({
      favorite: z.object({
        id: outputNumber,
        userId: outputNumber,
        originId: outputNumber,
        destinationId: outputNumber,
        airlineId: z.union([z.null(), outputNumber]),
        cabinClass: z.union([
          z.null(),
          z.literal("economy"),
          z.literal("business"),
        ]),
        enablePriceAlert: z.boolean(),
        maxPrice: z.union([z.null(), outputNumber]),
        lastAlertSent: z.union([z.null(), z.date()]),
        emailNotifications: z.boolean(),
        notes: z.union([z.null(), z.string()]),
        createdAt: z.date(),
        updatedAt: z.date(),
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
      airline: z.union([
        z.null(),
        z.object({
          id: outputNumber,
          code: z.string(),
          name: z.string(),
          logo: z.union([z.null(), z.string()]),
        }),
      ]),
    })
  ),
  update: z.object({ success: z.boolean() }),
  delete: z.object({ success: z.boolean() }),
  isFavorited: z.boolean(),
  getPriceAlertHistory: z.array(
    z.object({
      alert: z.object({
        id: outputNumber,
        favoriteFlightId: outputNumber,
        flightId: outputNumber,
        previousPrice: outputNumber,
        newPrice: outputNumber,
        priceChange: outputNumber,
        alertSent: z.boolean(),
        sentAt: z.union([z.null(), z.date()]),
        createdAt: z.date(),
      }),
      flight: z.object({
        id: outputNumber,
        flightNumber: z.string(),
        airlineId: outputNumber,
        tenantId: z.union([z.null(), outputNumber]),
        originId: outputNumber,
        destinationId: outputNumber,
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
        createdAt: z.date(),
        updatedAt: z.date(),
      }),
    })
  ),
  getBestPrices: z.object({
    lowestPrice: outputNumber,
    lowestPriceFlight: z.union([
      z.null(),
      z.object({
        flights: z.object({
          id: outputNumber,
          flightNumber: z.string(),
          airlineId: outputNumber,
          tenantId: z.union([z.null(), outputNumber]),
          originId: outputNumber,
          destinationId: outputNumber,
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
          createdAt: z.date(),
          updatedAt: z.date(),
        }),
        airlines: z.object({
          id: outputNumber,
          code: z.string(),
          name: z.string(),
          country: z.union([z.null(), z.string()]),
          logo: z.union([z.null(), z.string()]),
          active: z.boolean(),
          createdAt: z.date(),
        }),
      }),
    ]),
    totalFlights: outputNumber,
    favoriteMaxPrice: z.union([z.null(), outputNumber]),
    priceAlertActive: z.boolean(),
  }),
  checkPriceAlerts: z.object({
    alertsFound: outputNumber,
    alerts: z.array(
      z.object({
        favoriteId: outputNumber,
        flightId: outputNumber,
        userId: outputNumber,
        previousPrice: outputNumber,
        newPrice: outputNumber,
        priceChange: outputNumber,
      })
    ),
  }),
};
