/**
 * Weight & Balance Router
 *
 * Admin-only tRPC endpoints for flight weight & balance calculations,
 * aircraft limit management, load sheet generation, and weight history.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as wbService from "../services/weight-balance.service";

export const weightBalanceRouter = router({
  // ========================================================================
  // Calculate Weight & Balance
  // ========================================================================

  /**
   * Trigger a full W&B calculation for a flight.
   * Creates a load plan record with all weight components and CG data.
   */
  calculate: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        aircraftTypeId: z.number().int().positive(),
        fuelWeight: z.number().nonnegative(),
        cargoDistribution: z
          .array(
            z.object({
              zone: z.string().min(1),
              weight: z.number().nonnegative(),
            })
          )
          .optional(),
        status: z
          .enum(["preliminary", "final", "amended"])
          .optional()
          .default("preliminary"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await wbService.calculateFlightWeightBalance(input.flightId, {
        aircraftTypeId: input.aircraftTypeId,
        fuelWeight: input.fuelWeight,
        cargoDistribution: input.cargoDistribution,
        calculatedBy: ctx.user.id,
        status: input.status,
      });
    }),

  // ========================================================================
  // Get Flight W&B
  // ========================================================================

  /**
   * Get the current weight & balance data for a flight.
   * Returns the latest load plan calculation result.
   */
  getFlightWB: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      return await wbService.getFlightWeightBalance(input.flightId);
    }),

  // ========================================================================
  // Aircraft Limits
  // ========================================================================

  /**
   * Get weight limits for a specific aircraft type.
   * Includes MTOW, MLW, MZFW, OEW, and standard passenger weights.
   */
  getAircraftLimits: adminProcedure
    .input(
      z.object({
        aircraftTypeId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      return await wbService.getAircraftLimits(input.aircraftTypeId);
    }),

  /**
   * Update weight limits for an aircraft type.
   * All weight fields are in kg * 100 for precision.
   */
  updateAircraftLimits: adminProcedure
    .input(
      z.object({
        aircraftTypeId: z.number().int().positive(),
        maxTakeoffWeight: z.number().positive().optional(),
        maxLandingWeight: z.number().positive().optional(),
        maxZeroFuelWeight: z.number().positive().optional(),
        operatingEmptyWeight: z.number().positive().optional(),
        maxPayload: z.number().positive().optional(),
        maxFuelCapacity: z.number().positive().optional(),
        maxPassengers: z.number().int().positive().optional(),
        standardMaleWeight: z.number().positive().optional(),
        standardFemaleWeight: z.number().positive().optional(),
        standardChildWeight: z.number().positive().optional(),
        standardInfantWeight: z.number().positive().optional(),
        standardBagWeight: z.number().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { aircraftTypeId, ...updates } = input;
      return await wbService.updateAircraftLimits(aircraftTypeId, updates);
    }),

  // ========================================================================
  // Load Sheet
  // ========================================================================

  /**
   * Generate an IATA-standard load sheet for a flight.
   * Requires an existing load plan calculation.
   */
  generateLoadSheet: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      return await wbService.generateLoadSheet(input.flightId);
    }),

  // ========================================================================
  // Check Limits
  // ========================================================================

  /**
   * Verify all weight limits for a flight.
   * Returns detailed pass/fail results for each limit check.
   */
  checkLimits: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      return await wbService.checkWeightLimits(input.flightId);
    }),

  // ========================================================================
  // Weight History
  // ========================================================================

  /**
   * Get weight calculation history for a flight.
   * Returns all load plan records ordered by creation time (newest first).
   */
  getHistory: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      return await wbService.getWeightHistory(input.flightId);
    }),
});
