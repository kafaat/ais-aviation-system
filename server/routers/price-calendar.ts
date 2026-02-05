import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import * as priceCalendarService from "../services/price-calendar.service";

/**
 * Price Calendar Router
 * Handles price calendar and flexible date search operations
 */
export const priceCalendarRouter = router({
  /**
   * Get monthly prices for a route
   * Returns lowest price per day for the specified month
   */
  getMonthlyPrices: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/price-calendar/monthly",
        tags: ["Price Calendar"],
        summary: "Get monthly flight prices",
        description:
          "Get lowest prices per day for a specific month and route. Useful for displaying a price calendar view.",
      },
    })
    .input(
      z.object({
        originId: z.number().describe("Origin airport ID"),
        destinationId: z.number().describe("Destination airport ID"),
        month: z.number().min(1).max(12).describe("Month (1-12)"),
        year: z.number().min(2024).max(2030).describe("Year"),
        cabinClass: z
          .enum(["economy", "business"])
          .optional()
          .default("economy")
          .describe("Cabin class for pricing"),
      })
    )
    .query(async ({ input }) => {
      return await priceCalendarService.getMonthlyPrices({
        originId: input.originId,
        destinationId: input.destinationId,
        month: input.month,
        year: input.year,
        cabinClass: input.cabinClass,
      });
    }),

  /**
   * Get flexible date prices (+/- N days)
   * Useful for finding the cheapest dates around a preferred travel date
   */
  getFlexiblePrices: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/price-calendar/flexible",
        tags: ["Price Calendar"],
        summary: "Get flexible date prices",
        description:
          "Get prices for dates around a center date (+/- flexDays). Useful for flexible date search feature.",
      },
    })
    .input(
      z.object({
        originId: z.number().describe("Origin airport ID"),
        destinationId: z.number().describe("Destination airport ID"),
        date: z.date().describe("Center date for flexible search"),
        flexDays: z
          .number()
          .min(1)
          .max(7)
          .optional()
          .default(3)
          .describe("Number of days flexibility (+/- from center date)"),
        cabinClass: z
          .enum(["economy", "business"])
          .optional()
          .default("economy")
          .describe("Cabin class for pricing"),
      })
    )
    .query(async ({ input }) => {
      return await priceCalendarService.getFlexiblePrices({
        originId: input.originId,
        destinationId: input.destinationId,
        date: input.date,
        flexDays: input.flexDays,
        cabinClass: input.cabinClass,
      });
    }),

  /**
   * Get available months with flights
   * Quick check for which months have flight availability
   */
  getAvailableMonths: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/price-calendar/available-months",
        tags: ["Price Calendar"],
        summary: "Get months with flight availability",
        description:
          "Get a list of upcoming months showing which have flight availability for a route.",
      },
    })
    .input(
      z.object({
        originId: z.number().describe("Origin airport ID"),
        destinationId: z.number().describe("Destination airport ID"),
        lookAheadMonths: z
          .number()
          .min(1)
          .max(24)
          .optional()
          .default(12)
          .describe("Number of months to look ahead"),
      })
    )
    .query(async ({ input }) => {
      return await priceCalendarService.getAvailableMonths(
        input.originId,
        input.destinationId,
        input.lookAheadMonths
      );
    }),
});
