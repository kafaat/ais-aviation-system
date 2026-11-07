import { getClaimTargets } from "../services/booking-flight-membership.service";
import {
  regulationTypes,
  responseContracts,
  storedClaimTypes,
} from "../contracts/compensation";
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  createClaim,
  processClaim,
  getClaimById,
  getClaimsByUser,
  getClaimEvaluation,
  calculateTotalLiability,
  autoAssessEligibility,
  getAllClaims,
  getCompensationStats,
  getCompensationRules,
  updateCompensationRule,
} from "../services/compensation.service";
import {
  confirmRule,
  evaluateForReview,
  listRuleCatalog,
  previewEntitlements,
  serializeEvaluation,
  syncRuleCatalog,
} from "../services/passenger-rights.service";
import {
  listRefundDeadlines,
  openRefundDeadline,
} from "../services/passenger-rights-refund.service";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";

const reference = z.string().trim().min(5).max(500);
const minorUnits = z.number().int().nonnegative().max(2_147_483_647);
const reviewerFacts = z.object({
  actualArrivalUtc: z.string().datetime().optional(),
  departureDelayMinutes: z.number().nonnegative().optional(),
  cancellation: z
    .object({
      noticeDays: z.number().int().nonnegative().optional(),
      reroutedArrivalDelayMinutes: z.number().nonnegative().optional(),
    })
    .optional(),
  deniedBoarding: z
    .object({
      involuntary: z.boolean(),
      alternativeArrivalDelayMinutes: z.number().nonnegative().optional(),
      alternativeDepartureWithinMinutes: z.number().nonnegative().optional(),
    })
    .optional(),
  downgrade: z.boolean().optional(),
  baggage: z
    .object({
      delayDays: z.number().int().nonnegative().optional(),
      receiptsMinorUnits: minorUnits.optional(),
      receiptsCurrency: z.string().length(3).optional(),
    })
    .optional(),
  tarmacMinutes: z.number().nonnegative().optional(),
  careExpenses: z
    .object({
      receiptsMinorUnits: minorUnits,
      receiptsCurrency: z.string().length(3),
    })
    .optional(),
  refundTrigger: z
    .object({
      triggeredAt: z.string().datetime(),
      tenderClass: z.enum(["card", "other"]),
    })
    .optional(),
  extraordinaryCircumstances: z.boolean().optional(),
  passengerCaused: z.boolean().optional(),
});
const ticketValue = z.object({
  minorUnits,
  currency: z.string().length(3),
  basis: z.string().trim().min(3).max(120),
  reference,
});
const rightsEvidence = z.object({
  ruleCode: z.string().trim().min(5).max(120),
  scopeAndExceptionReview: reference,
  factsReference: reference,
  facts: reviewerFacts,
  ticketValue: ticketValue.optional(),
  distanceKm: z.number().int().positive().optional(),
  distanceReference: reference.optional(),
  fxRecordId: z.number().int().positive().optional(),
});

/**
 * Compensation Router
 * Jurisdiction-aware passenger-rights claims (GACA, EU261, UK261, US DOT).
 */
export const compensationRouter = router({
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
        regulationType: z.enum(regulationTypes),
        claimType: z.enum(storedClaimTypes),
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
        disruptionType: z.enum(storedClaimTypes),
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
   * Non-binding "what you may be entitled to" preview with the jurisdiction
   * determination. Passenger-entered facts are labelled unverified.
   */
  previewEntitlements: protectedProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        flightId: z.number().int().positive().optional(),
        claimType: z.enum(storedClaimTypes),
        regulationType: z.enum(regulationTypes).optional(),
        facts: z
          .object({
            arrivalDelayMinutes: z
              .number()
              .nonnegative()
              .max(10_080)
              .optional(),
            departureDelayMinutes: z
              .number()
              .nonnegative()
              .max(10_080)
              .optional(),
            baggageDelayDays: z.number().int().nonnegative().max(60).optional(),
            tarmacMinutes: z.number().nonnegative().max(1_440).optional(),
            involuntaryDeniedBoarding: z.boolean().optional(),
          })
          .default({}),
      })
    )
    .output(responseContracts["previewEntitlements"])
    .query(({ ctx, input }) =>
      previewEntitlements({ ...input, userId: ctx.user.id })
    ),

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
        rightsEvidence: rightsEvidence.optional(),
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
          rightsEvidence: input.rightsEvidence,
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

  /** Dry-run of the engine with reviewer facts, before deciding (admin). */
  evaluateForReview: adminProcedure
    .input(
      z.object({
        claimId: z.number().int().positive(),
        facts: reviewerFacts,
        factsReference: reference,
        ticketValue: ticketValue.optional(),
        distanceKm: z.number().int().positive().optional(),
        distanceReference: reference.optional(),
        fxRecordId: z.number().int().positive().optional(),
      })
    )
    .output(responseContracts["evaluateForReview"])
    .query(async ({ input }) => {
      const db = getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
      const claim = await getClaimById(input.claimId);
      const review = await evaluateForReview(db, {
        flightId: claim.flightId,
        bookingId: claim.bookingId,
        claimType: claim.claimType,
        regulationType: claim.regulationType,
        settlementCurrency: claim.currency,
        facts: input.facts,
        factsReference: input.factsReference,
        ticketValue: input.ticketValue,
        distanceKm: input.distanceKm,
        distanceReference: input.distanceReference,
        fxRecordId: input.fxRecordId,
        now: new Date(),
      });
      return {
        ruleSource: review.ruleSource as "database" | "built-in",
        evaluation: serializeEvaluation(review.evaluation),
      };
    }),

  /** Stored evaluation trace of a decided claim (admin). */
  getClaimEvaluation: adminProcedure
    .input(z.object({ claimId: z.number().int().positive() }))
    .output(responseContracts["getClaimEvaluation"])
    .query(({ input }) => getClaimEvaluation(input.claimId)),

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
        regulationType: z.enum(regulationTypes).optional(),
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

  /** Rule sets with provenance and confirmation state (admin). */
  getRuleCatalog: adminProcedure
    .output(responseContracts["getRuleCatalog"])
    .query(() => listRuleCatalog()),

  /** Upsert the built-in seed into the catalogue tables (admin). */
  syncRuleCatalog: adminProcedure
    .output(responseContracts["syncRuleCatalog"])
    .mutation(({ ctx }) => syncRuleCatalog(ctx.user.id)),

  /** Operator confirmation of a secondary or disputed value (admin). */
  confirmRule: adminProcedure
    .input(
      z.object({
        ruleCode: z.string().trim().min(5).max(120),
        decision: z.enum(["confirmed", "rejected"]),
        reference,
      })
    )
    .output(responseContracts["confirmRule"])
    .mutation(({ input, ctx }) =>
      confirmRule({ ...input, actorId: ctx.user.id })
    ),

  /** US DOT refund deadlines; `overdueOnly` is the admin overdue list. */
  listRefundDeadlines: adminProcedure
    .input(
      z
        .object({ overdueOnly: z.boolean().default(false) })
        .default({ overdueOnly: false })
    )
    .output(responseContracts["listRefundDeadlines"])
    .query(({ input }) => listRefundDeadlines(input)),

  /** Record that an involuntary refund became due for a booking (admin). */
  openRefundDeadline: adminProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        trigger: z.enum(["carrier_cancellation", "significant_change"]),
        tenderClass: z.enum(["card", "other"]),
        triggeredAt: z.string().datetime(),
        note: z.string().trim().max(500).optional(),
      })
    )
    .output(responseContracts["openRefundDeadline"])
    .mutation(({ input, ctx }) => {
      const db = getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
      const triggeredAt = new Date(input.triggeredAt);
      if (triggeredAt.getTime() > Date.now())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Trigger time cannot be in the future",
        });
      return openRefundDeadline(db, {
        bookingId: input.bookingId,
        trigger: input.trigger,
        tenderClass: input.tenderClass,
        triggeredAt,
        openedBy: ctx.user.id,
        note: input.note,
      });
    }),
});
