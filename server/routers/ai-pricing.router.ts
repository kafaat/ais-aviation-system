/**
 * AI Pricing Router
 *
 * tRPC endpoints for AI-powered dynamic pricing management:
 * - Demand forecasting
 * - Customer segmentation
 * - Revenue optimization
 * - A/B testing
 * - Dashboard data
 *
 * @module routers/ai-pricing.router
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { AIPricingService } from "../services/pricing/ai-pricing.service";
import { DemandForecastingService } from "../services/pricing/demand-forecasting.service";
import { CustomerSegmentationService } from "../services/pricing/customer-segmentation.service";
import { RevenueOptimizationService } from "../services/pricing/revenue-optimization.service";
import { ABTestingService } from "../services/pricing/ab-testing.service";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Input Schemas
// ============================================================================

const forecastInput = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  horizonDays: z.number().int().min(1).max(60).default(14),
});

const routeForecastInput = z.object({
  originId: z.number().int().positive(),
  destinationId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

const segmentInput = z.object({
  name: z.string().min(1).max(255),
  nameAr: z.string().max(255).optional(),
  description: z.string().optional(),
  segmentType: z.enum([
    "value",
    "frequency",
    "behavior",
    "loyalty_tier",
    "corporate",
    "price_sensitive",
    "premium",
  ]),
  criteria: z.record(z.string(), z.unknown()),
  priceMultiplier: z.number().min(0.5).max(2.0),
  maxDiscount: z.number().min(0).max(1),
});

const optimizeInput = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  goal: z
    .enum([
      "maximize_revenue",
      "maximize_load_factor",
      "maximize_yield",
      "balance",
    ])
    .default("balance"),
});

const abTestInput = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  hypothesis: z.string().optional(),
  airlineId: z.number().int().positive().optional(),
  originId: z.number().int().positive().optional(),
  destinationId: z.number().int().positive().optional(),
  cabinClass: z.enum(["economy", "business"]).optional(),
  trafficPercentage: z.number().int().min(1).max(100).default(100),
  confidenceLevel: z.number().min(0.8).max(0.99).default(0.95),
  minimumSampleSize: z.number().int().min(10).max(100000).default(100),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        isControl: z.boolean(),
        pricingStrategy: z.object({
          type: z.enum(["multiplier", "fixed_adjustment", "dynamic_rule"]),
          multiplier: z.number().min(0.5).max(2.0).optional(),
          fixedAdjustment: z.number().optional(),
          ruleConfig: z.record(z.string(), z.unknown()).optional(),
        }),
        weight: z.number().int().min(1).max(100),
      })
    )
    .min(2),
});

const metricsInput = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  airlineId: z.number().int().positive().optional(),
});

// ============================================================================
// Router
// ============================================================================

export const aiPricingRouter = router({
  // ========================
  // Dashboard
  // ========================

  /** Get AI pricing dashboard data */
  getDashboard: adminProcedure.query(async () => {
    try {
      const data = await AIPricingService.getAIDashboardData();
      return { success: true, data };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Failed to load dashboard data",
      });
    }
  }),

  /** Toggle AI pricing on/off */
  setEnabled: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await AIPricingService.setAIPricingEnabled(input.enabled);
      return { success: true, enabled: input.enabled };
    }),

  // ========================
  // Demand Forecasting
  // ========================

  /** Get demand forecast for a flight */
  forecastDemand: adminProcedure
    .input(forecastInput)
    .query(async ({ input }) => {
      try {
        const forecasts = await DemandForecastingService.forecastFlightDemand(
          input.flightId,
          input.cabinClass,
          input.horizonDays
        );

        return {
          success: true,
          data: forecasts.map(f => ({
            date: f.date.toISOString(),
            predictedDemand: f.predictedDemand,
            confidenceLower: f.confidenceLower,
            confidenceUpper: f.confidenceUpper,
            recommendedPrice: f.recommendedPrice,
            recommendedMultiplier: f.recommendedMultiplier,
            featureImportances: f.featureImportances,
          })),
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to generate forecast",
        });
      }
    }),

  /** Get route-level demand forecast */
  forecastRoute: adminProcedure
    .input(routeForecastInput)
    .query(async ({ input }) => {
      try {
        const forecasts = await DemandForecastingService.forecastRouteDemand(
          input.originId,
          input.destinationId,
          input.cabinClass,
          new Date(input.startDate),
          new Date(input.endDate)
        );

        return {
          success: true,
          data: forecasts.map(f => ({
            flightId: f.flightId,
            date: f.date.toISOString(),
            predictedDemand: f.predictedDemand,
            confidenceLower: f.confidenceLower,
            confidenceUpper: f.confidenceUpper,
            recommendedPrice: f.recommendedPrice,
          })),
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to generate route forecast",
        });
      }
    }),

  /** Get model accuracy metrics */
  forecastAccuracy: adminProcedure
    .input(
      z.object({
        modelId: z.number().int().positive(),
        periodDays: z.number().int().min(1).max(365).default(30),
      })
    )
    .query(async ({ input }) => {
      const accuracy = await DemandForecastingService.evaluateForecastAccuracy(
        input.modelId,
        input.periodDays
      );
      return { success: true, data: accuracy };
    }),

  // ========================
  // Customer Segmentation
  // ========================

  /** Get customer profile and segments */
  getCustomerProfile: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        const profile = await CustomerSegmentationService.getCustomerProfile(
          input.userId
        );
        return { success: true, data: profile };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get customer profile",
        });
      }
    }),

  /** Get my own profile (for logged-in users) */
  getMyProfile: protectedProcedure.query(async ({ ctx }) => {
    try {
      const profile = await CustomerSegmentationService.getCustomerProfile(
        ctx.user.id
      );
      return {
        success: true,
        data: {
          segments: profile.segments.map(s => ({
            name: s.segmentName,
            type: s.segmentType,
          })),
          metrics: {
            totalBookings: profile.metrics.totalBookings,
            avgBookingValue: profile.metrics.avgBookingValue,
            preferredCabinClass: profile.metrics.preferredCabinClass,
          },
        },
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Failed to get profile",
      });
    }
  }),

  /** List all segment definitions */
  getSegments: adminProcedure.query(async () => {
    const segments = await CustomerSegmentationService.getSegments();
    return {
      success: true,
      data: segments.map(s => ({
        id: s.id,
        name: s.name,
        nameAr: s.nameAr,
        description: s.description,
        segmentType: s.segmentType,
        criteria: JSON.parse(s.criteria),
        priceMultiplier: parseFloat(s.priceMultiplier || "1"),
        maxDiscount: parseFloat(s.maxDiscount || "0.3"),
        memberCount: s.memberCount,
        isActive: s.isActive,
      })),
    };
  }),

  /** Create or update a segment */
  upsertSegment: adminProcedure
    .input(segmentInput)
    .mutation(async ({ input }) => {
      try {
        const id = await CustomerSegmentationService.upsertSegment(input);
        return { success: true, id };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to save segment",
        });
      }
    }),

  /** Run bulk segmentation for all users */
  runSegmentation: adminProcedure.mutation(async () => {
    const result = await CustomerSegmentationService.runBulkSegmentation();
    return { success: true, data: result };
  }),

  // ========================
  // Revenue Optimization
  // ========================

  /** Optimize a single flight's price */
  optimizeFlight: adminProcedure
    .input(optimizeInput)
    .query(async ({ input }) => {
      try {
        const result = await RevenueOptimizationService.optimizeFlightPrice(
          input.flightId,
          input.cabinClass,
          input.goal
        );
        return { success: true, data: result };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to optimize flight",
        });
      }
    }),

  /** Batch optimize upcoming flights */
  optimizeUpcoming: adminProcedure
    .input(
      z.object({
        goal: z
          .enum([
            "maximize_revenue",
            "maximize_load_factor",
            "maximize_yield",
            "balance",
          ])
          .default("balance"),
        daysAhead: z.number().int().min(1).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      try {
        const results =
          await RevenueOptimizationService.optimizeUpcomingFlights(
            input.goal,
            input.daysAhead
          );
        return {
          success: true,
          data: results.slice(0, 50), // Top 50 recommendations
          total: results.length,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to optimize flights",
        });
      }
    }),

  /** Apply an optimization recommendation */
  applyOptimization: adminProcedure
    .input(
      z.object({
        logId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await RevenueOptimizationService.applyOptimization(
          input.logId,
          ctx.user.id
        );
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to apply optimization",
        });
      }
    }),

  /** Get revenue metrics */
  getRevenueMetrics: adminProcedure
    .input(metricsInput)
    .query(async ({ input }) => {
      try {
        const metrics = await RevenueOptimizationService.getRevenueMetrics(
          new Date(input.startDate),
          new Date(input.endDate),
          input.airlineId
        );
        return { success: true, data: metrics };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get revenue metrics",
        });
      }
    }),

  // ========================
  // A/B Testing
  // ========================

  /** Create a new A/B test */
  createABTest: adminProcedure
    .input(abTestInput)
    .mutation(async ({ input, ctx }) => {
      try {
        const testId = await ABTestingService.createTest({
          ...input,
          startDate: new Date(input.startDate),
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          createdBy: ctx.user.id,
        });
        return { success: true, testId };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to create test",
        });
      }
    }),

  /** Start an A/B test */
  startABTest: adminProcedure
    .input(z.object({ testId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await ABTestingService.startTest(input.testId);
      return { success: true };
    }),

  /** Pause an A/B test */
  pauseABTest: adminProcedure
    .input(z.object({ testId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await ABTestingService.pauseTest(input.testId);
      return { success: true };
    }),

  /** Complete an A/B test */
  completeABTest: adminProcedure
    .input(
      z.object({
        testId: z.number().int().positive(),
        winnerVariantId: z.number().int().positive(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await ABTestingService.completeTest(
        input.testId,
        input.winnerVariantId,
        input.notes
      );
      return { success: true };
    }),

  /** List A/B tests */
  getABTests: adminProcedure
    .input(
      z.object({
        status: z
          .enum(["draft", "running", "paused", "completed", "cancelled"])
          .optional(),
      })
    )
    .query(async ({ input }) => {
      const tests = await ABTestingService.getTests(input.status);
      return { success: true, data: tests };
    }),

  /** Get A/B test results with statistical analysis */
  getABTestResults: adminProcedure
    .input(z.object({ testId: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        const results = await ABTestingService.getTestResults(input.testId);
        return { success: true, data: results };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get test results",
        });
      }
    }),
});

export type AIPricingRouter = typeof aiPricingRouter;
