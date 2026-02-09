import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  calculatePriorityScore,
  rankPassengers,
  getPassengerProfile,
  suggestRebookingOrder,
  getProtectionOptions,
  getRules,
  updateRule,
} from "../services/passenger-priority.service";

/**
 * Passenger Priority Router
 * Admin-only endpoints for IROPS passenger priority scoring,
 * ranking, rebooking order, and protection options.
 */
export const passengerPriorityRouter = router({
  /**
   * Calculate priority score for a specific passenger on a booking
   */
  calculateScore: adminProcedure
    .input(
      z.object({
        passengerId: z.number(),
        bookingId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return await calculatePriorityScore(input.passengerId, input.bookingId);
    }),

  /**
   * Rank all passengers on a flight by priority score (descending)
   */
  rankPassengers: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .query(async ({ input }) => {
      return await rankPassengers(input.flightId);
    }),

  /**
   * Get the complete priority profile for a passenger
   */
  getPassengerProfile: adminProcedure
    .input(z.object({ passengerId: z.number() }))
    .query(async ({ input }) => {
      return await getPassengerProfile(input.passengerId);
    }),

  /**
   * Get the suggested rebooking order for a disrupted flight
   */
  getRebookingOrder: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .query(async ({ input }) => {
      return await suggestRebookingOrder(input.flightId);
    }),

  /**
   * Get protection options available to a passenger based on priority level
   */
  getProtectionOptions: adminProcedure
    .input(
      z.object({
        passengerId: z.number(),
        bookingId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return await getProtectionOptions(input.passengerId, input.bookingId);
    }),

  /**
   * Get all priority scoring rules
   */
  getRules: adminProcedure.query(() => {
    return getRules();
  }),

  /**
   * Update a priority scoring rule (score or active status)
   */
  updateRule: adminProcedure
    .input(
      z.object({
        ruleId: z.number(),
        score: z.number().min(0).max(1000).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      return updateRule(input.ruleId, {
        score: input.score,
        isActive: input.isActive,
      });
    }),
});
