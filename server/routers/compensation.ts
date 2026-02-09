import { z } from "zod";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import {
  createClaim,
  processClaim,
  getClaimsByBooking,
  getClaimsByFlight,
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
  /**
   * File a new compensation claim (authenticated user)
   */
  fileClaim: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
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
    .mutation(async ({ ctx, input }) => {
      try {
        return await createClaim({
          bookingId: input.bookingId,
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
  getMyClaims: protectedProcedure.query(async ({ ctx }) => {
    return await getClaimsByUser(ctx.user.id);
  }),

  /**
   * Get detailed info about a specific claim
   */
  getClaimDetail: protectedProcedure
    .input(z.object({ claimId: z.number() }))
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
        disruptionType: z.enum([
          "delay",
          "cancellation",
          "denied_boarding",
          "downgrade",
        ]),
      })
    )
    .query(async ({ ctx, input }) => {
      return await autoAssessEligibility(
        input.bookingId,
        input.disruptionType,
        ctx.user.id
      );
    }),

  /**
   * Process a claim - approve, deny, or partially approve (admin)
   */
  processClaim: adminProcedure
    .input(
      z.object({
        claimId: z.number(),
        decision: z.enum(["approved", "denied", "partial"]),
        approvedAmount: z.number().min(0).optional(),
        denialReason: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await processClaim({
          claimId: input.claimId,
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
  getRules: adminProcedure.query(async () => {
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
