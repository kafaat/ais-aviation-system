import {
  responseContracts,
  reaccommodationAdvisory,
} from "../contracts/passenger-priority";
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
import { buildReaccommodationAdvisory } from "../services/reaccommodation-advisory.service";

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
    .output(responseContracts["calculateScore"])
    .query(async ({ input }) => {
      return await calculatePriorityScore(input.passengerId, input.bookingId);
    }),

  /**
   * Rank all passengers on a flight by priority score (descending)
   */
  rankPassengers: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .output(responseContracts["rankPassengers"])
    .query(async ({ input }) => {
      return await rankPassengers(input.flightId);
    }),

  /**
   * Get the complete priority profile for a passenger
   */
  getPassengerProfile: adminProcedure
    .input(z.object({ passengerId: z.number() }))
    .output(responseContracts["getPassengerProfile"])
    .query(async ({ input }) => {
      return await getPassengerProfile(input.passengerId);
    }),

  /**
   * Get the suggested rebooking order for a disrupted flight
   */
  getRebookingOrder: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .output(responseContracts["getRebookingOrder"])
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
    .output(responseContracts["getProtectionOptions"])
    .query(async ({ input }) => {
      return await getProtectionOptions(input.passengerId, input.bookingId);
    }),

  /**
   * Advisory reaccommodation assignment for a disrupted flight (R2-11).
   *
   * Read-only. Ranking answers "who first"; this answers "who on which
   * flight", which ranking alone cannot, and it books nothing.
   */
  reaccommodationAdvisory: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(reaccommodationAdvisory)
    .query(({ input }) => buildReaccommodationAdvisory(input.flightId)),

  /**
   * Get all priority scoring rules
   */
  getRules: adminProcedure.output(responseContracts["getRules"]).query(() => {
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
    .output(responseContracts["updateRule"])
    .mutation(({ input }) => {
      return updateRule(input.ruleId, {
        score: input.score,
        isActive: input.isActive,
      });
    }),
});
