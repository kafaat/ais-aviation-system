import { responseContracts } from "../contracts/travel-scenarios";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  setAutoCheckIn,
  getAutoCheckInStatus,
  getShareableItinerary,
  calculateCarbonOffset,
  getTravelRequirements,
} from "../services/travel-scenarios.service";

/**
 * Travel Scenarios Router
 * Handles auto check-in, itinerary sharing, carbon offset, travel requirements
 */
export const travelScenariosRouter = router({
  // ============ Auto Check-In ============

  /**
   * Get auto check-in status for the current user
   */
  getAutoCheckIn: protectedProcedure
    .output(responseContracts["getAutoCheckIn"])
    .query(async ({ ctx }) => {
      return await getAutoCheckInStatus(ctx.user.id);
    }),

  /**
   * Toggle auto check-in preference
   */
  setAutoCheckIn: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().describe("Enable or disable auto check-in"),
      })
    )
    .output(responseContracts["setAutoCheckIn"])
    .mutation(async ({ ctx, input }) => {
      return await setAutoCheckIn(ctx.user.id, input.enabled);
    }),

  // ============ Itinerary Sharing ============

  /**
   * Get a shareable itinerary (no private/payment info)
   */
  getShareableItinerary: protectedProcedure
    .input(
      z.object({
        bookingId: z.number().describe("Booking ID to share"),
      })
    )
    .output(responseContracts["getShareableItinerary"])
    .query(async ({ ctx, input }) => {
      return await getShareableItinerary(input.bookingId, ctx.user.id);
    }),

  // ============ Carbon Offset ============

  /**
   * Calculate carbon footprint for a flight
   */
  getCarbonOffset: publicProcedure
    .input(
      z.object({
        flightId: z.number().describe("Flight ID"),
      })
    )
    .output(responseContracts["getCarbonOffset"])
    .query(async ({ input }) => {
      return await calculateCarbonOffset(input.flightId);
    }),

  // ============ Travel Document Requirements ============

  /**
   * Get travel document requirements for a flight's destination
   */
  getTravelRequirements: publicProcedure
    .input(
      z.object({
        flightId: z.number().describe("Flight ID"),
      })
    )
    .output(responseContracts["getTravelRequirements"])
    .query(async ({ input }) => {
      return await getTravelRequirements(input.flightId);
    }),
});
