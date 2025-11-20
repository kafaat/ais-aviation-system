import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import * as flightsService from "../services/flights.service";

/**
 * Flights Router
 * Handles all flight-related operations
 */
export const flightsRouter = router({
  /**
   * Search for flights
   */
  search: publicProcedure
    .input(
      z.object({
        originId: z.number(),
        destinationId: z.number(),
        departureDate: z.date(),
      })
    )
    .query(async ({ input }) => {
      return await flightsService.searchFlights(input);
    }),

  /**
   * Get flight details by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await flightsService.getFlightById(input);
    }),
});
