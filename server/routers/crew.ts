import { responseContracts } from "../contracts/crew";
/**
 * Crew Assignment Router
 *
 * Admin-only endpoints for managing crew assignments,
 * schedules, FTL compliance, and availability.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as crewService from "../services/crew-assignment.service";
import * as legalityService from "../services/crew-legality.service";
import { ruleSetDocumentSchema } from "../services/crew-ftl-rule-set";

const crewRoleEnum = z.enum([
  "captain",
  "first_officer",
  "purser",
  "cabin_crew",
]);

export const crewRouter = router({
  // ========================================================================
  // Crew Members
  // ========================================================================

  /** List crew members with optional filters */
  getMembers: adminProcedure
    .input(
      z
        .object({
          airlineId: z.number().optional(),
          role: crewRoleEnum.optional(),
          status: z
            .enum(["active", "on_leave", "training", "inactive"])
            .optional(),
          search: z.string().optional(),
        })
        .optional()
    )
    .output(responseContracts["getMembers"])
    .query(async ({ input }) => {
      return await crewService.getCrewMembers(input ?? undefined);
    }),

  /** Get a single crew member by ID */
  getMember: adminProcedure
    .input(z.object({ id: z.number() }))
    .output(responseContracts["getMember"])
    .query(async ({ input }) => {
      return await crewService.getCrewMemberById(input.id);
    }),

  // ========================================================================
  // Crew Assignments
  // ========================================================================

  /** Assign a crew member to a flight */
  assignToFlight: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        crewMemberId: z.number(),
        role: crewRoleEnum,
        dutyStartTime: z.date().optional(),
        dutyEndTime: z.date().optional(),
        notes: z.string().max(500).optional(),
      })
    )
    .output(responseContracts["assignToFlight"])
    .mutation(async ({ input, ctx }) => {
      return await crewService.assignCrewToFlight({
        ...input,
        assignedBy: ctx.user.id,
        tenantId: ctx.tenantId,
      });
    }),

  /** Remove a crew member from a flight */
  removeFromFlight: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        crewMemberId: z.number(),
      })
    )
    .output(responseContracts["removeFromFlight"])
    .mutation(async ({ input }) => {
      return await crewService.removeCrewFromFlight(
        input.flightId,
        input.crewMemberId
      );
    }),

  /** Get all crew assigned to a flight */
  getFlightCrew: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .output(responseContracts["getFlightCrew"])
    .query(async ({ input }) => {
      return await crewService.getFlightCrew(input.flightId);
    }),

  // ========================================================================
  // Scheduling & Availability
  // ========================================================================

  /** Get a crew member's schedule for a date range */
  getSchedule: adminProcedure
    .input(
      z.object({
        crewMemberId: z.number(),
        startDate: z.date(),
        endDate: z.date(),
      })
    )
    .output(responseContracts["getSchedule"])
    .query(async ({ input }) => {
      return await crewService.getCrewSchedule(input.crewMemberId, {
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),

  /** Check if a crew member is available on a given date */
  checkAvailability: adminProcedure
    .input(
      z.object({
        crewMemberId: z.number(),
        date: z.date(),
      })
    )
    .output(responseContracts["checkAvailability"])
    .query(async ({ input }) => {
      return await crewService.checkCrewAvailability(
        input.crewMemberId,
        input.date
      );
    }),

  // ========================================================================
  // FTL & Compliance
  // ========================================================================

  /** Check Flight Time Limitations compliance for a proposed assignment */
  checkFTL: adminProcedure
    .input(
      z.object({
        crewMemberId: z.number(),
        departureTime: z.date(),
        arrivalTime: z.date(),
      })
    )
    .output(responseContracts["checkFTL"])
    .query(async ({ input }) => {
      return await crewService.checkFTLCompliance(input.crewMemberId, {
        departureTime: input.departureTime,
        arrivalTime: input.arrivalTime,
      });
    }),

  /** Validate minimum crew requirements for a flight */
  validateRequirements: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        proposedAssignments: z
          .array(
            z.object({
              crewMemberId: z.number(),
              role: crewRoleEnum,
            })
          )
          .optional(),
      })
    )
    .output(responseContracts["validateRequirements"])
    .query(async ({ input }) => {
      return await crewService.validateCrewRequirements(
        input.flightId,
        input.proposedAssignments
      );
    }),

  // ========================================================================
  // Replacement
  // ========================================================================

  /** Find available replacement crew for a specific role on a flight */
  findReplacement: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        role: crewRoleEnum,
      })
    )
    .output(responseContracts["findReplacement"])
    .query(async ({ input }) => {
      return await crewService.findReplacementCrew(input.flightId, input.role);
    }),

  // ========================================================================
  // Legality engine: rule sets (data), verdict audit log, overrides
  // ========================================================================

  listRuleSets: adminProcedure
    .input(z.object({ airlineId: z.number().optional() }).optional())
    .output(responseContracts["listRuleSets"])
    .query(({ input, ctx }) =>
      legalityService.listRuleSets({
        airlineId: input?.airlineId,
        tenantId: ctx.tenantId,
      })
    ),

  /** Import a template (EASA seed / GACAR structure) or a full document. */
  importRuleSet: adminProcedure
    .input(
      z.object({
        airlineId: z.number().int().positive(),
        template: z.enum(["EASA-ORO-FTL", "GACAR-117"]).optional(),
        document: ruleSetDocumentSchema.optional(),
      })
    )
    .output(responseContracts["importRuleSet"])
    .mutation(({ input, ctx }) =>
      legalityService.importRuleSet({
        airlineId: input.airlineId,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        template: input.template,
        document: input.document,
      })
    ),

  confirmRuleSet: adminProcedure
    .input(
      z.object({
        ruleSetId: z.number().int().positive(),
        note: z.string().min(1).max(500),
      })
    )
    .output(responseContracts["confirmRuleSet"])
    .mutation(({ input, ctx }) =>
      legalityService.confirmRuleSet({
        ruleSetId: input.ruleSetId,
        actorId: ctx.user.id,
        tenantId: ctx.tenantId,
        note: input.note,
      })
    ),

  activateRuleSet: adminProcedure
    .input(z.object({ ruleSetId: z.number().int().positive() }))
    .output(responseContracts["activateRuleSet"])
    .mutation(({ input, ctx }) =>
      legalityService.activateRuleSet({
        ruleSetId: input.ruleSetId,
        actorId: ctx.user.id,
        tenantId: ctx.tenantId,
      })
    ),

  setRuleSetOverridePolicy: adminProcedure
    .input(
      z.object({
        ruleSetId: z.number().int().positive(),
        allowsOverride: z.boolean(),
      })
    )
    .output(responseContracts["setRuleSetOverridePolicy"])
    .mutation(({ input, ctx }) =>
      legalityService.setRuleSetOverridePolicy({
        ...input,
        tenantId: ctx.tenantId,
      })
    ),

  /** Full verdict with every rule and margin; logged as a preview. */
  previewLegality: adminProcedure
    .input(
      z.object({
        crewMemberId: z.number().int().positive(),
        flightId: z.number().int().positive(),
      })
    )
    .output(responseContracts["previewLegality"])
    .query(({ input, ctx }) =>
      crewService.previewAssignmentLegality({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
      })
    ),

  listVerdicts: adminProcedure
    .input(
      z
        .object({
          crewMemberId: z.number().int().positive().optional(),
          flightId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional()
    )
    .output(responseContracts["listVerdicts"])
    .query(({ input, ctx }) =>
      legalityService.listVerdicts({ ...input, tenantId: ctx.tenantId })
    ),

  createOverride: adminProcedure
    .input(
      z.object({
        airlineId: z.number().int().positive(),
        crewMemberId: z.number().int().positive(),
        flightId: z.number().int().positive(),
        ruleCodes: z.array(z.string().min(1).max(40)).min(1).max(20),
        reason: z.string().min(10).max(2000),
        approvedBy: z.number().int().positive(),
        expiresAt: z.date(),
      })
    )
    .output(responseContracts["createOverride"])
    .mutation(({ input, ctx }) =>
      legalityService.createOverride({
        ...input,
        tenantId: ctx.tenantId,
        createdBy: ctx.user.id,
      })
    ),

  listOverrides: adminProcedure
    .input(
      z
        .object({
          crewMemberId: z.number().int().positive().optional(),
          flightId: z.number().int().positive().optional(),
        })
        .optional()
    )
    .output(responseContracts["listOverrides"])
    .query(({ input, ctx }) =>
      legalityService.listOverrides({ ...input, tenantId: ctx.tenantId })
    ),

  // ========================================================================
  // Rostering paths: bulk roster, pairings, standby
  // ========================================================================

  assignRoster: adminProcedure
    .input(
      z.object({
        pairingId: z.number().int().positive().optional(),
        lines: z
          .array(
            z.object({
              flightId: z.number().int().positive(),
              crewMemberId: z.number().int().positive(),
              role: crewRoleEnum,
              notes: z.string().max(500).optional(),
            })
          )
          .min(1)
          .max(200),
      })
    )
    .output(responseContracts["assignRoster"])
    .mutation(({ input, ctx }) =>
      crewService.bulkAssignRoster({
        lines: input.lines,
        pairingId: input.pairingId ?? null,
        assignedBy: ctx.user.id,
        tenantId: ctx.tenantId,
      })
    ),

  createPairing: adminProcedure
    .input(
      z.object({
        code: z.string().regex(/^[A-Z0-9-]{2,40}$/),
        flightIds: z.array(z.number().int().positive()).min(1).max(20),
        homeBaseAirportId: z.number().int().positive().optional(),
      })
    )
    .output(responseContracts["createPairing"])
    .mutation(({ input, ctx }) =>
      crewService.createPairing({
        ...input,
        createdBy: ctx.user.id,
        tenantId: ctx.tenantId,
      })
    ),

  listPairings: adminProcedure
    .input(z.object({ airlineId: z.number().optional() }).optional())
    .output(responseContracts["listPairings"])
    .query(({ input, ctx }) =>
      crewService.listPairings({
        airlineId: input?.airlineId,
        tenantId: ctx.tenantId,
      })
    ),

  createStandby: adminProcedure
    .input(
      z.object({
        crewMemberId: z.number().int().positive(),
        kind: z.enum(["airport", "home"]),
        startsAt: z.date(),
        endsAt: z.date(),
        locationAirportId: z.number().int().positive().optional(),
      })
    )
    .output(responseContracts["createStandby"])
    .mutation(({ input, ctx }) =>
      crewService.createStandby({
        ...input,
        createdBy: ctx.user.id,
        tenantId: ctx.tenantId,
      })
    ),

  listStandby: adminProcedure
    .input(
      z
        .object({
          crewMemberId: z.number().int().positive().optional(),
          from: z.date().optional(),
        })
        .optional()
    )
    .output(responseContracts["listStandby"])
    .query(({ input, ctx }) =>
      crewService.listStandby({ ...input, tenantId: ctx.tenantId })
    ),

  activateStandby: adminProcedure
    .input(
      z.object({
        standbyId: z.number().int().positive(),
        flightId: z.number().int().positive(),
        role: crewRoleEnum,
        notes: z.string().max(500).optional(),
      })
    )
    .output(responseContracts["activateStandby"])
    .mutation(({ input, ctx }) =>
      crewService.activateStandby({
        ...input,
        actorId: ctx.user.id,
        tenantId: ctx.tenantId,
      })
    ),
});
