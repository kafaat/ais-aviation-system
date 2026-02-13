import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getRebookData,
  searchFlightsForRebook,
  quickRebook,
} from "../services/rebooking.service";

/**
 * Rebooking Router
 * Handles quick rebooking from previous bookings
 */
export const rebookingRouter = router({
  /**
   * Get rebooking data from a previous booking
   * Returns passengers, route, cabin class, and ancillaries for pre-filling
   */
  getRebookData: protectedProcedure
    .input(
      z.object({
        bookingId: z.number().describe("Previous booking ID to rebook from"),
      })
    )
    .query(async ({ ctx, input }) => {
      return await getRebookData(input.bookingId, ctx.user.id);
    }),

  /**
   * Search available flights for rebooking on the same route
   */
  searchFlights: protectedProcedure
    .input(
      z.object({
        originId: z.number().describe("Origin airport ID"),
        destinationId: z.number().describe("Destination airport ID"),
        cabinClass: z
          .enum(["economy", "business"])
          .describe("Preferred cabin class"),
      })
    )
    .query(async ({ input }) => {
      return await searchFlightsForRebook(
        input.originId,
        input.destinationId,
        input.cabinClass
      );
    }),

  /**
   * Quick rebook - create a new booking from a previous one in a single step
   * Copies passengers, ancillaries, and cabin class automatically
   */
  quickRebook: protectedProcedure
    .input(
      z.object({
        bookingId: z
          .number()
          .describe("Previous booking ID to copy passengers from"),
        newFlightId: z.number().describe("New flight ID to book"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await quickRebook(input.bookingId, input.newFlightId, ctx.user.id);
    }),
});
