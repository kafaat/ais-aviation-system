import { responseContracts } from "../contracts/weight-balance";
/**
 * Weight & Balance Router
 *
 * Admin-only tRPC endpoints for flight weight & balance calculations,
 * aircraft limit management, load sheet generation, and weight history.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as wbService from "../services/weight-balance.service";

import {
  loadSheetReview,
  assignmentInput,
  sheetInput,
  reviewInput,
  assignLoadSheetAircraft,
  evaluateLoadSheet,
  verifyCurrentLoadSheet,
} from "../services/load-sheet-lifecycle.service";

export const weightBalanceRouter = router({
  reviewFlight: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(
      z.object({
        flightId: z.number(),
        flightNumber: z.string(),
        registrationId: z.number().nullable(),
        edition: z.number(),
        status: z.enum(["draft", "signed_draft", "superseded"]).nullable(),
        assignment: z
          .object({
            id: z.number(),
            userId: z.number().nullable(),
            reason: z.string().nullable(),
          })
          .nullable(),
        evaluatedBy: z.number().nullable(),
        violations: z.array(z.string()),
        dispatchAcceptanceRequired: z.literal(true),
      })
    )
    .query(({ input, ctx }) =>
      loadSheetReview(input.flightId, {
        userId: ctx.user.id,
        tenantId: ctx.tenantId,
      })
    ),
  assignAircraft: adminProcedure
    .input(assignmentInput)
    .output(z.object({ flightId: z.number(), registrationId: z.number() }))
    .mutation(({ input, ctx }) =>
      assignLoadSheetAircraft(input, {
        userId: ctx.user.id,
        tenantId: ctx.tenantId,
      })
    ),
  evaluateDraft: adminProcedure
    .input(sheetInput)
    .output(
      z.object({
        edition: z.number(),
        withinLimits: z.boolean(),
        violations: z.array(z.string()),
        dispatchAcceptanceRequired: z.literal(true),
      })
    )
    .mutation(({ input, ctx }) =>
      evaluateLoadSheet(input, { userId: ctx.user.id, tenantId: ctx.tenantId })
    ),
  verifyCurrentDraft: adminProcedure
    .input(reviewInput)
    .output(
      z.object({
        edition: z.number(),
        registrationId: z.number(),
        digestSha256: z.string(),
        dispatchAcceptanceRequired: z.literal(true),
      })
    )
    .query(({ input, ctx }) =>
      verifyCurrentLoadSheet(input, {
        userId: ctx.user.id,
        tenantId: ctx.tenantId,
      })
    ),
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
    .output(responseContracts["calculate"])
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
    .output(responseContracts["getFlightWB"])
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
    .output(responseContracts["getAircraftLimits"])
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
    .output(responseContracts["updateAircraftLimits"])
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
    .output(responseContracts["generateLoadSheet"])
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
    .output(responseContracts["checkLimits"])
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
    .output(responseContracts["getHistory"])
    .query(async ({ input }) => {
      return await wbService.getWeightHistory(input.flightId);
    }),
});
