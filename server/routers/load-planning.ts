/**
 * Load Planning Router
 *
 * Admin-only endpoints for detailed cargo load planning:
 * - Create/retrieve load plans
 * - Assign items to compartments
 * - Optimize distribution for CG balance
 * - Validate against limits
 * - Update bulk cargo
 * - Get compartment layouts
 * - Finalize and amend (LIR)
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as loadPlanningService from "../services/load-planning.service";

export const loadPlanningRouter = router({
  // ========================================================================
  // Create Load Plan
  // ========================================================================

  create: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
      })
    )
    .mutation(async ({ input }) => {
      return await loadPlanningService.createLoadPlan(input.flightId);
    }),

  // ========================================================================
  // Get Load Plan
  // ========================================================================

  get: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
      })
    )
    .query(async ({ input }) => {
      return await loadPlanningService.getLoadPlan(input.flightId);
    }),

  // ========================================================================
  // Assign Item to Compartment
  // ========================================================================

  assignCompartment: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        itemId: z.number().positive(),
        compartmentId: z.number().positive(),
      })
    )
    .mutation(async ({ input }) => {
      return await loadPlanningService.assignCompartment(
        input.flightId,
        input.itemId,
        input.compartmentId
      );
    }),

  // ========================================================================
  // Optimize Distribution
  // ========================================================================

  optimize: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
      })
    )
    .mutation(async ({ input }) => {
      return await loadPlanningService.optimizeDistribution(input.flightId);
    }),

  // ========================================================================
  // Validate Load Plan
  // ========================================================================

  validate: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
      })
    )
    .query(async ({ input }) => {
      return await loadPlanningService.validateLoadPlan(input.flightId);
    }),

  // ========================================================================
  // Update Bulk Load
  // ========================================================================

  updateBulk: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        compartment: z.string().min(1).max(10),
        weight: z.number().nonnegative(),
      })
    )
    .mutation(async ({ input }) => {
      return await loadPlanningService.updateBulkLoad(
        input.flightId,
        input.compartment,
        input.weight
      );
    }),

  // ========================================================================
  // Get Compartment Layout
  // ========================================================================

  getCompartments: adminProcedure
    .input(
      z.object({
        aircraftTypeId: z.number().positive(),
      })
    )
    .query(async ({ input }) => {
      return await loadPlanningService.getCompartmentLayout(
        input.aircraftTypeId
      );
    }),

  // ========================================================================
  // Finalize Load Plan
  // ========================================================================

  finalize: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await loadPlanningService.finalizeLoadPlan(
        input.flightId,
        ctx.user.id
      );
    }),

  // ========================================================================
  // Amend Load Plan (LIR - Last Info Received)
  // ========================================================================

  amend: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        changes: z.array(
          z.object({
            action: z.enum(["add", "remove", "update_weight", "move"]),
            itemId: z.number().positive().optional(),
            newItem: z
              .object({
                itemType: z.enum(["baggage", "cargo", "mail", "ballast"]),
                description: z.string().min(1).max(255),
                pieces: z.number().nonnegative(),
                weight: z.number().nonnegative(),
                volume: z.number().nonnegative(),
                compartmentCode: z.string().min(1).max(10),
              })
              .optional(),
            newWeight: z.number().nonnegative().optional(),
            newCompartmentCode: z.string().min(1).max(10).optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      return await loadPlanningService.amendLoadPlan(
        input.flightId,
        input.changes
      );
    }),
});
