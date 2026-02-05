import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import * as flightsService from "../services/flights.service";
import { getFlightStatusHistory } from "../services/flight-status.service";
import { trackSearch } from "../services/metrics.service";
import {
  getPopularRoutes,
  getSuggestedDestinations,
  trackRouteSearch,
} from "../services/popular-routes.service";

/**
 * Flights Router
 * Handles all flight-related operations
 */
export const flightsRouter = router({
  /**
   * Search for flights
   * Results are cached for 2 minutes
   */
  search: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/flights/search",
        tags: ["Flights"],
        summary: "Search for available flights",
        description:
          "Search for flights between two airports on a specific date. Results are cached for 2 minutes for performance. Returns available flights with pricing for economy and business class.",
      },
    })
    .input(
      z.object({
        originId: z.number().describe("Origin airport ID"),
        destinationId: z.number().describe("Destination airport ID"),
        departureDate: z.date().describe("Departure date (ISO 8601 format)"),
      })
    )
    .query(async ({ input, ctx }) => {
      const startTime = Date.now();
      const results = await flightsService.searchFlights(input);
      const responseTimeMs = Date.now() - startTime;

      // Track search event for metrics
      // Safely handle results count - check if results is an array
      const resultsCount = Array.isArray(results) ? results.length : 0;
      trackSearch({
        userId: ctx.user?.id,
        originId: input.originId,
        destinationId: input.destinationId,
        departureDate: input.departureDate,
        resultsCount,
        responseTimeMs,
      });

      // Track route search for popularity (non-blocking)
      trackRouteSearch(input.originId, input.destinationId).catch(() => {});

      return results;
    }),

  /**
   * Get flight details by ID
   * Results are cached for 5 minutes
   */
  getById: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/flights/{id}",
        tags: ["Flights"],
        summary: "Get flight details by ID",
        description:
          "Retrieve detailed information about a specific flight including airline, airports, pricing, and availability. Results are cached for 5 minutes.",
      },
    })
    .input(z.object({ id: z.number().describe("Flight ID") }))
    .query(async ({ input }) => {
      return await flightsService.getFlightById(input);
    }),

  /**
   * Get flight status history
   */
  getStatusHistory: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/flights/{flightId}/status-history",
        tags: ["Flights"],
        summary: "Get flight status history",
        description:
          "Retrieve the status change history for a flight, including delays, cancellations, and other status updates with timestamps and reasons.",
      },
    })
    .input(z.object({ flightId: z.number().describe("Flight ID") }))
    .query(async ({ input }) => {
      return await getFlightStatusHistory(input.flightId);
    }),

  /**
   * Get popular routes
   * Results are cached for 10 minutes
   */
  popularRoutes: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/flights/popular-routes",
        tags: ["Flights"],
        summary: "Get popular flight routes",
        description:
          "Retrieve the most popular flight routes based on booking frequency. Results are cached for 10 minutes. Useful for displaying trending destinations.",
      },
    })
    .input(
      z
        .object({
          limit: z
            .number()
            .min(1)
            .max(50)
            .default(10)
            .describe("Maximum number of routes to return"),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 10;
      return await getPopularRoutes(limit);
    }),

  /**
   * Get suggested destinations from a specific origin
   * Results are cached for 10 minutes
   */
  suggestedDestinations: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/flights/suggested-destinations",
        tags: ["Flights"],
        summary: "Get suggested destinations",
        description:
          "Get personalized destination suggestions based on the selected origin airport. Results are cached for 10 minutes and ordered by popularity.",
      },
    })
    .input(
      z.object({
        originId: z.number().describe("Origin airport ID"),
        limit: z
          .number()
          .min(1)
          .max(20)
          .default(5)
          .describe("Maximum number of suggestions"),
      })
    )
    .query(async ({ input }) => {
      return await getSuggestedDestinations(input.originId, input.limit);
    }),
});
