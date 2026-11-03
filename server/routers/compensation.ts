import { getDb } from "../db";
import { evaluatePassengerRights } from "../services/passenger-rights-policy";
import { findApprovedPassengerRightsProfile } from "../services/passenger-rights-policy-repository";
import { getClaimTargets } from "../services/booking-flight-membership.service";
import { responseContracts } from "../contracts/compensation";
import { z } from "zod";
import {
  protectedProcedure,
  adminProcedure,
  airlineFinanceProcedure,
  router,
} from "../_core/trpc";
import {
  createClaim,
  processClaim,
  getClaimById,
  getClaimsByUser,
  calculateTotalLiability,
  autoAssessEligibility,
  getAllClaims,
  getCompensationStats,
  getCompensationRules,
  updateCompensationRule,
} from "../services/compensation.service";
import { TRPCError } from "@trpc/server";

/**
 * Compensation Router
 * Handles EU261/DOT compensation claims for flight disruptions
 */
export const compensationRouter = router({
  // Reviewer preview only. No claim state or payment changes on this route.
  previewApprovedPolicy: airlineFinanceProcedure
    .input(
      z.object({
        jurisdiction: z.enum([
          "gaca-2023",
          "eu261-2004",
          "uk261",
          "us-dot-14-cfr-260",
        ]),
        event: z.enum([
          "delay",
          "cancellation",
          "denied_boarding",
          "downgrade",
          "baggage",
          "refund",
        ]),
        occurredAt: z.date(),
        delayMinutes: z.number().int().nonnegative().optional(),
        distanceKm: z.number().int().nonnegative().optional(),
        fareMinor: z.number().int().min(0).max(2147483647).optional(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
        conditionsSatisfied: z
          .array(z.string().trim().min(1).max(100))
          .max(100),
      })
    )
    .output(
      z.object({
        status: z.enum(["needs_review", "eligible_non_monetary", "calculated"]),
        reason: z.string(),
        amountMinor: z.number().nullable(),
        currency: z.string().nullable(),
        policyVersion: z.string().nullable(),
        refundDeadlineBusinessDays: z.number().nullable().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.tenantId == null) throw new TRPCError({ code: "FORBIDDEN" });
      if (input.occurredAt.getTime() > Date.now())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Event must already have occurred",
        });
      const db = await getDb();
      if (!db) throw new Error("Passenger-rights policy storage unavailable");
      const policy = await findApprovedPassengerRightsProfile(
        db,
        ctx.tenantId,
        input.jurisdiction,
        input.occurredAt
      );
      return evaluatePassengerRights(policy, input);
    }),
  claimTargets: protectedProcedure
    .input(z.object({ bookingId: z.number().int().positive() }))
    .output(
      z.object({
        flights: z.array(
          z.object({ id: z.number(), flightNumber: z.string() })
        ),
        passengers: z.array(
          z.object({
            id: z.number(),
            firstName: z.string(),
            lastName: z.string(),
          })
        ),
      })
    )
    .query(({ ctx, input }) => getClaimTargets(input.bookingId, ctx.user.id)),
  /**
   * File a new compensation claim (authenticated user)
   */
  fileClaim: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        flightId: z.number().int().positive().optional(),
        passengerId: z.number().int().positive().optional(),
        regulationType: z.enum(["eu261", "dot", "local"]),
        claimType: z.enum([
          "delay",
          "cancellation",
          "denied_boarding",
          "downgrade",
        ]),
        reason: z.string().max(1000).optional(),
      })
    )
    .output(responseContracts["fileClaim"])
    .mutation(async ({ ctx, input }) => {
      try {
        return await createClaim({
          bookingId: input.bookingId,
          flightId: input.flightId,
          passengerId: input.passengerId,
          regulationType: input.regulationType,
          claimType: input.claimType,
          reason: input.reason,
          userId: ctx.user.id,
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to file compensation claim",
        });
      }
    }),

  /**
   * Get all claims for the current user
   */
  getMyClaims: protectedProcedure
    .output(responseContracts["getMyClaims"])
    .query(async ({ ctx }) => {
      return await getClaimsByUser(ctx.user.id);
    }),

  /**
   * Get detailed info about a specific claim
   */
  getClaimDetail: protectedProcedure
    .input(z.object({ claimId: z.number() }))
    .output(responseContracts["getClaimDetail"])
    .query(async ({ ctx, input }) => {
      return await getClaimById(input.claimId, ctx.user.id);
    }),

  /**
   * Check eligibility for compensation on a booking
   */
  checkEligibility: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        flightId: z.number().int().positive().optional(),
        disruptionType: z.enum([
          "delay",
          "cancellation",
          "denied_boarding",
          "downgrade",
        ]),
      })
    )
    .output(responseContracts["checkEligibility"])
    .query(async ({ ctx, input }) => {
      return await autoAssessEligibility(
        input.bookingId,
        input.disruptionType,
        ctx.user.id,
        input.flightId
      );
    }),

  /**
   * Process a claim - approve, deny, or partially approve (admin)
   */
  processClaim: adminProcedure
    .input(
      z.object({
        claimId: z.number(),
        evidence: z
          .object({
            policyReference: z.string().trim().min(5).max(500),
            fxReference: z.string().trim().min(5).max(500),
            distanceReference: z.string().trim().min(5).max(500),
            distanceKm: z.number().int().positive(),
          })
          .optional(),
        gacaArrivalEvidence: z
          .object({
            scopeAndExceptionReview: z.string().trim().min(5).max(500),
            arrivalReference: z.string().trim().min(5).max(500),
            scheduledArrivalUtc: z.string().datetime(),
            actualArrivalUtc: z.string().datetime(),
            fxReference: z.string().trim().min(5).max(500),
            sarPerXdrMillionths: z.number().int().positive().safe(),
          })
          .optional(),
        decision: z.enum(["approved", "denied", "partial"]),
        approvedAmount: z.number().min(0).optional(),
        denialReason: z.string().max(1000).optional(),
      })
    )
    .output(responseContracts["processClaim"])
    .mutation(async ({ input, ctx }) => {
      try {
        return await processClaim({
          claimId: input.claimId,
          actorId: ctx.user.id,
          evidence: input.evidence,
          gacaArrivalEvidence: input.gacaArrivalEvidence,
          decision: input.decision,
          approvedAmount: input.approvedAmount,
          denialReason: input.denialReason,
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to process claim",
        });
      }
    }),

  /**
   * Get all claims with filters and pagination (admin)
   */
  getAllClaims: adminProcedure
    .input(
      z.object({
        status: z
          .enum([
            "pending",
            "under_review",
            "approved",
            "denied",
            "paid",
            "appealed",
          ])
          .optional(),
        regulationType: z.enum(["eu261", "dot", "local"]).optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .output(responseContracts["getAllClaims"])
    .query(async ({ input }) => {
      return await getAllClaims({
        status: input.status,
        regulationType: input.regulationType,
        page: input.page,
        limit: input.limit,
      });
    }),

  /**
   * Get total compensation liability for a flight (admin)
   */
  getFlightLiability: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .output(responseContracts["getFlightLiability"])
    .query(async ({ input }) => {
      return await calculateTotalLiability(input.flightId);
    }),

  /**
   * Get aggregate compensation statistics (admin)
   */
  getStats: adminProcedure
    .input(
      z
        .object({
          from: z.date().optional(),
          to: z.date().optional(),
        })
        .optional()
    )
    .output(responseContracts["getStats"])
    .query(async ({ input }) => {
      const dateRange =
        input?.from && input?.to
          ? { from: input.from, to: input.to }
          : undefined;
      return await getCompensationStats(dateRange);
    }),

  /**
   * Get all compensation rules (admin)
   */
  getRules: adminProcedure
    .output(responseContracts["getRules"])
    .query(async () => {
      return await getCompensationRules();
    }),

  /**
   * Update a compensation rule (admin)
   */
  updateRule: adminProcedure
    .input(
      z.object({
        id: z.number(),
        compensationAmount: z.number().min(0).optional(),
        minDelay: z.number().min(0).optional(),
        maxDelay: z.number().min(0).optional(),
        distanceMin: z.number().min(0).optional(),
        distanceMax: z.number().min(0).optional(),
        isActive: z.boolean().optional(),
        conditions: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(responseContracts["updateRule"])
    .mutation(async ({ input }) => {
      try {
        return await updateCompensationRule(input);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to update compensation rule",
        });
      }
    }),
});
