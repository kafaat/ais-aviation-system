/**
 * Crew Assignment Router
 *
 * Admin-only endpoints for managing crew assignments,
 * schedules, FTL compliance, and availability.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as crewService from "../services/crew-assignment.service";

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
    .query(async ({ input }) => {
      return await crewService.getCrewMembers(input ?? undefined);
    }),

  /** Get a single crew member by ID */
  getMember: adminProcedure
    .input(z.object({ id: z.number() }))
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
    .mutation(async ({ input, ctx }) => {
      return await crewService.assignCrewToFlight({
        ...input,
        assignedBy: ctx.user.id,
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
    .mutation(async ({ input }) => {
      return await crewService.removeCrewFromFlight(
        input.flightId,
        input.crewMemberId
      );
    }),

  /** Get all crew assigned to a flight */
  getFlightCrew: adminProcedure
    .input(z.object({ flightId: z.number() }))
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
    .query(async ({ input }) => {
      return await crewService.findReplacementCrew(input.flightId, input.role);
    }),
});
