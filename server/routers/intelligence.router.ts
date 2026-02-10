/**
 * Intelligence Router
 *
 * tRPC endpoints for the AIS Autonomous Intelligence Platform (AAIP):
 * - Intelligence briefing (combined agent output)
 * - Economics analysis (CASK/RASK, profitability)
 * - Fraud assessment (real-time booking scoring)
 * - Operations prediction (delay, disruption, OTP)
 * - AI Gateway management (models, stats)
 *
 * @module routers/intelligence.router
 */

import { z } from "zod";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import {
  intelligenceKernel,
  type IntelligenceContext,
} from "../services/intelligence";

// ============================================================================
// Input Schemas
// ============================================================================

const contextInput = z.object({
  timeHorizon: z
    .enum(["realtime", "short_term", "medium_term", "long_term"])
    .default("short_term"),
  flightIds: z.array(z.number().int().positive()).optional(),
  routeIds: z.array(z.number().int().positive()).optional(),
  dateRange: z
    .object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    })
    .optional(),
});

const fraudAssessInput = z.object({
  bookingId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

const delayPredictInput = z.object({
  flightId: z.number().int().positive(),
});

// ============================================================================
// Helper
// ============================================================================

function buildContext(
  input: z.infer<typeof contextInput>,
  userId?: number
): IntelligenceContext {
  return {
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    timestamp: new Date(),
    timeHorizon: input.timeHorizon,
    scope: {
      flightIds: input.flightIds,
      routeIds: input.routeIds,
      dateRange: input.dateRange
        ? {
            start: new Date(input.dateRange.start),
            end: new Date(input.dateRange.end),
          }
        : undefined,
    },
  };
}

// ============================================================================
// Router
// ============================================================================

export const intelligenceRouter = router({
  /**
   * Generate comprehensive intelligence briefing
   * Runs all agents and produces a unified dashboard summary
   */
  getBriefing: adminProcedure
    .input(contextInput)
    .query(async ({ input, ctx }) => {
      const context = buildContext(input, ctx.user?.id);
      return intelligenceKernel.generateBriefing(context);
    }),

  /**
   * Get economics analysis (RASK/CASK, route profitability)
   */
  getEconomics: adminProcedure
    .input(contextInput)
    .query(async ({ input, ctx }) => {
      const context = buildContext(input, ctx.user?.id);
      return intelligenceKernel.getEconomicsAnalysis(context);
    }),

  /**
   * Assess fraud risk for a specific booking
   */
  assessFraud: protectedProcedure
    .input(fraudAssessInput)
    .query(async ({ input, ctx }) => {
      const context = buildContext({ timeHorizon: "realtime" }, ctx.user?.id);
      return intelligenceKernel.assessBookingFraud(
        input.bookingId,
        input.userId,
        context
      );
    }),

  /**
   * Predict delay for a specific flight
   */
  predictDelay: protectedProcedure
    .input(delayPredictInput)
    .query(async ({ input, ctx }) => {
      const context = buildContext({ timeHorizon: "realtime" }, ctx.user?.id);
      return intelligenceKernel.predictFlightDelay(input.flightId, context);
    }),

  /**
   * Get disruption forecast for upcoming week
   */
  getDisruptionForecast: adminProcedure
    .input(contextInput)
    .query(async ({ input, ctx }) => {
      const context = buildContext(input, ctx.user?.id);
      return intelligenceKernel.getDisruptionForecast(context);
    }),

  /**
   * Get AI Gateway statistics
   */
  getGatewayStats: adminProcedure.query(() => {
    return intelligenceKernel.getGatewayStats();
  }),

  /**
   * Get available AI models
   */
  getModels: adminProcedure.query(() => {
    return intelligenceKernel.getAvailableModels();
  }),

  /**
   * Get kernel status and configuration
   */
  getStatus: adminProcedure.query(() => {
    return {
      ...intelligenceKernel.getStatus(),
      config: intelligenceKernel.getConfig(),
    };
  }),

  /**
   * Update kernel configuration
   */
  updateConfig: adminProcedure
    .input(
      z.object({
        briefingCacheTtlMs: z.number().int().positive().optional(),
        maxConcurrentAgents: z.number().int().min(1).max(10).optional(),
        agents: z
          .object({
            economics: z
              .object({
                enabled: z.boolean(),
                timeoutMs: z.number().int().positive(),
              })
              .partial()
              .optional(),
            fraud: z
              .object({
                enabled: z.boolean(),
                timeoutMs: z.number().int().positive(),
              })
              .partial()
              .optional(),
            operations: z
              .object({
                enabled: z.boolean(),
                timeoutMs: z.number().int().positive(),
              })
              .partial()
              .optional(),
            pricing: z
              .object({
                enabled: z.boolean(),
                timeoutMs: z.number().int().positive(),
              })
              .partial()
              .optional(),
          })
          .optional(),
      })
    )
    .mutation(({ input }) => {
      // Deep-merge partial agent configs with existing config
      const currentConfig = intelligenceKernel.getConfig();
      const updates: Record<string, unknown> = {};

      if (input.briefingCacheTtlMs !== undefined) {
        updates.briefingCacheTtlMs = input.briefingCacheTtlMs;
      }
      if (input.maxConcurrentAgents !== undefined) {
        updates.maxConcurrentAgents = input.maxConcurrentAgents;
      }
      if (input.agents) {
        updates.agents = {
          economics: {
            ...currentConfig.agents.economics,
            ...input.agents.economics,
          },
          fraud: { ...currentConfig.agents.fraud, ...input.agents.fraud },
          operations: {
            ...currentConfig.agents.operations,
            ...input.agents.operations,
          },
          pricing: { ...currentConfig.agents.pricing, ...input.agents.pricing },
        };
      }

      intelligenceKernel.updateConfig(updates as Partial<typeof currentConfig>);
      return { success: true, config: intelligenceKernel.getConfig() };
    }),
});
