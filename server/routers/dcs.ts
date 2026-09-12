import { responseContracts } from "../contracts/dcs";
/**
 * Departure Control System (DCS) Router
 *
 * Admin-only endpoints for flight operations:
 * - Aircraft type management
 * - Crew management & assignments
 * - Flight manifest generation
 * - Weight & balance calculations
 * - Load plan management
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as dcsService from "../services/dcs.service";

export const dcsRouter = router({
  // ========================================================================
  // Aircraft Types
  // ========================================================================

  getAircraftTypes: adminProcedure
    .output(responseContracts["getAircraftTypes"])
    .query(async () => {
      return await dcsService.getAircraftTypes();
    }),

  getAircraftType: adminProcedure
    .input(z.object({ id: z.number() }))
    .output(responseContracts["getAircraftType"])
    .query(async ({ input }) => {
      return await dcsService.getAircraftTypeById(input.id);
    }),

  createAircraftType: adminProcedure
    .input(
      z.object({
        code: z.string().min(2).max(10),
        name: z.string().min(1).max(100),
        manufacturer: z.string().min(1).max(50),
        maxTakeoffWeight: z.number().positive(),
        maxLandingWeight: z.number().positive(),
        maxZeroFuelWeight: z.number().positive(),
        operatingEmptyWeight: z.number().positive(),
        maxPayload: z.number().positive(),
        maxFuelCapacity: z.number().positive(),
        totalSeats: z.number().positive(),
        economySeats: z.number().nonnegative(),
        businessSeats: z.number().nonnegative(),
        cargoZones: z
          .array(z.object({ zone: z.string(), maxWeight: z.number() }))
          .optional(),
        forwardCgLimit: z.string().optional(),
        aftCgLimit: z.string().optional(),
      })
    )
    .output(responseContracts["createAircraftType"])
    .mutation(async ({ input }) => {
      return await dcsService.createAircraftType(input);
    }),

  // ========================================================================
  // Crew Management
  // ========================================================================

  getCrewMembers: adminProcedure
    .input(
      z
        .object({
          airlineId: z.number().optional(),
          role: z.string().optional(),
          status: z.string().optional(),
        })
        .optional()
    )
    .output(responseContracts["getCrewMembers"])
    .query(async ({ input }) => {
      return await dcsService.getCrewMembers(input ?? undefined);
    }),

  createCrewMember: adminProcedure
    .input(
      z.object({
        employeeId: z.string().min(1).max(20),
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
        airlineId: z.number(),
        licenseNumber: z.string().max(50).optional(),
        licenseExpiry: z.date().optional(),
        medicalExpiry: z.date().optional(),
        qualifiedAircraft: z.array(z.string()).optional(),
        phone: z.string().max(20).optional(),
        email: z.string().email().optional(),
      })
    )
    .output(responseContracts["createCrewMember"])
    .mutation(async ({ input }) => {
      return await dcsService.createCrewMember(input);
    }),

  assignCrew: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        crewMemberId: z.number(),
        role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
        notes: z.string().optional(),
      })
    )
    .output(responseContracts["assignCrew"])
    .mutation(async ({ input, ctx }) => {
      return await dcsService.assignCrewToFlight({
        ...input,
        assignedBy: ctx.user.id,
        tenantId: ctx.tenantId,
      });
    }),

  getFlightCrew: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .output(responseContracts["getFlightCrew"])
    .query(async ({ input }) => {
      return await dcsService.getFlightCrew(input.flightId);
    }),

  removeCrewAssignment: adminProcedure
    .input(z.object({ assignmentId: z.number() }))
    .output(responseContracts["removeCrewAssignment"])
    .mutation(async ({ input }) => {
      return await dcsService.removeCrewFromFlight(input.assignmentId);
    }),

  // ========================================================================
  // Flight Manifest
  // ========================================================================

  getFlightManifest: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .output(responseContracts["getFlightManifest"])
    .query(async ({ input }) => {
      return await dcsService.generateFlightManifest(input.flightId);
    }),

  // ========================================================================
  // Weight & Balance
  // ========================================================================

  calculateWeightBalance: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        aircraftTypeId: z.number(),
        fuelWeight: z.number().nonnegative(),
        cargoDistribution: z
          .array(
            z.object({ zone: z.string(), weight: z.number().nonnegative() })
          )
          .optional(),
      })
    )
    .output(responseContracts["calculateWeightBalance"])
    .query(async ({ input }) => {
      return await dcsService.calculateWeightAndBalance(input);
    }),

  // ========================================================================
  // Load Plans
  // ========================================================================

  createLoadPlan: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        aircraftTypeId: z.number(),
        fuelWeight: z.number().nonnegative(),
        cargoDistribution: z
          .array(
            z.object({ zone: z.string(), weight: z.number().nonnegative() })
          )
          .optional(),
      })
    )
    .output(responseContracts["createLoadPlan"])
    .mutation(async ({ input }) => {
      return await dcsService.createLoadPlan(input);
    }),

  getLoadPlan: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .output(responseContracts["getLoadPlan"])
    .query(async ({ input }) => {
      return await dcsService.getLoadPlan(input.flightId);
    }),

  approveLoadPlan: adminProcedure
    .input(z.object({ loadPlanId: z.number() }))
    .output(responseContracts["approveLoadPlan"])
    .mutation(async ({ input, ctx }) => {
      return await dcsService.approveLoadPlan(input.loadPlanId, ctx.user.id);
    }),

  finalizeLoadPlan: adminProcedure
    .input(z.object({ loadPlanId: z.number() }))
    .output(responseContracts["finalizeLoadPlan"])
    .mutation(async ({ input, ctx }) => {
      return await dcsService.finalizeLoadPlan(input.loadPlanId, ctx.user.id);
    }),

  // ========================================================================
  // DCS Dashboard Stats
  // ========================================================================

  getStats: adminProcedure
    .output(responseContracts["getStats"])
    .query(async () => {
      return await dcsService.getDcsStats();
    }),
});
