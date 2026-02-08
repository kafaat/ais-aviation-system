/**
 * AI Pricing Orchestrator Service
 *
 * Main integration layer that enhances the existing dynamic pricing engine
 * with AI capabilities:
 * - Demand forecasting integration
 * - Customer segment-aware pricing
 * - A/B test variant application
 * - Revenue optimization recommendations
 *
 * @module services/pricing/ai-pricing.service
 */

import { DemandForecastingService } from "./demand-forecasting.service";
import {
  CustomerSegmentationService,
  type CustomerProfile,
} from "./customer-segmentation.service";
import {
  RevenueOptimizationService,
  type OptimizationResult,
} from "./revenue-optimization.service";
import { ABTestingService, type VariantAssignment } from "./ab-testing.service";
import { cacheService } from "../cache.service";

// ============================================================================
// Types
// ============================================================================

export interface AIPricingContext {
  flightId: number;
  cabinClass: "economy" | "business";
  requestedSeats: number;
  userId?: number;
  sessionId?: string;
}

export interface AIPricingResult {
  aiMultiplier: number;
  components: {
    demandMultiplier: number;
    segmentMultiplier: number;
    optimizationMultiplier: number;
    abTestMultiplier: number;
  };
  metadata: {
    demandForecast: number | null;
    customerSegment: string | null;
    abTestVariant: string | null;
    optimizationGoal: string | null;
    confidence: number;
  };
}

export interface AIDashboardData {
  demandForecasts: {
    flightId: number;
    forecasts: { date: string; demand: number; lower: number; upper: number }[];
  }[];
  segmentDistribution: { name: string; count: number; percentage: number }[];
  activeTests: {
    id: number;
    name: string;
    status: string;
    variants: {
      name: string;
      impressions: number;
      conversions: number;
      revenue: number;
    }[];
  }[];
  revenueMetrics: {
    totalRevenue: number;
    avgYield: number;
    loadFactor: number;
    optimizationImpact: number;
  };
  recentOptimizations: {
    flightId: number;
    cabinClass: string;
    recommendation: string;
    priceChange: number;
    status: string;
  }[];
}

// ============================================================================
// Constants
// ============================================================================

const AI_PRICING_CACHE_TTL = 5 * 60; // 5 minutes
const AI_ENABLED_KEY = "ai_pricing_enabled";

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Calculate AI-enhanced pricing multiplier
 * This is called by the existing dynamic pricing engine to get the AI component
 */
export async function calculateAIPricingMultiplier(
  context: AIPricingContext
): Promise<AIPricingResult> {
  const cacheKey = `ai_pricing:${context.flightId}:${context.cabinClass}:${context.userId || "anon"}`;
  const cached = await cacheService.get<AIPricingResult>(cacheKey);
  if (cached) return cached;

  // Check if AI pricing is enabled
  const enabled = await isAIPricingEnabled();
  if (!enabled) {
    return getDefaultResult();
  }

  // Run AI components in parallel where possible
  const [demandResult, segmentResult, abTestResult] = await Promise.allSettled([
    getDemandMultiplier(context.flightId, context.cabinClass),
    getSegmentMultiplier(context.userId),
    getABTestMultiplier(context),
  ]);

  const demandMultiplier =
    demandResult.status === "fulfilled" ? demandResult.value.multiplier : 1.0;
  const demandForecast =
    demandResult.status === "fulfilled" ? demandResult.value.forecast : null;

  const segmentMultiplier =
    segmentResult.status === "fulfilled" ? segmentResult.value.multiplier : 1.0;
  const segmentName =
    segmentResult.status === "fulfilled" ? segmentResult.value.name : null;

  const abTestMultiplier =
    abTestResult.status === "fulfilled" ? abTestResult.value.multiplier : 1.0;
  const abTestVariant =
    abTestResult.status === "fulfilled" ? abTestResult.value.variant : null;

  // Get optimization recommendation
  let optimizationMultiplier = 1.0;
  let optimizationGoal: string | null = null;
  try {
    const optResult = await RevenueOptimizationService.optimizeFlightPrice(
      context.flightId,
      context.cabinClass,
      "balance"
    );
    optimizationMultiplier = optResult.multiplier;
    optimizationGoal = optResult.optimizationGoal;
  } catch {
    // Non-critical
  }

  // Combine AI multipliers (weighted)
  // Demand: 35%, Optimization: 30%, Segment: 20%, A/B Test: 15%
  const combinedMultiplier =
    demandMultiplier * 0.35 +
    optimizationMultiplier * 0.3 +
    segmentMultiplier * 0.2 +
    abTestMultiplier * 0.15;

  // Normalize to be a multiplier around 1.0
  // The weights above sum to 1.0, so if all components are 1.0, result is 1.0
  const aiMultiplier = Math.min(2.0, Math.max(0.75, combinedMultiplier));

  // Confidence based on data availability
  const confidence = calculateConfidence(
    demandResult.status === "fulfilled",
    segmentResult.status === "fulfilled",
    abTestResult.status === "fulfilled",
    demandForecast
  );

  const result: AIPricingResult = {
    aiMultiplier: Math.round(aiMultiplier * 10000) / 10000,
    components: {
      demandMultiplier,
      segmentMultiplier,
      optimizationMultiplier,
      abTestMultiplier,
    },
    metadata: {
      demandForecast,
      customerSegment: segmentName,
      abTestVariant,
      optimizationGoal,
      confidence,
    },
  };

  await cacheService.set(cacheKey, result, AI_PRICING_CACHE_TTL);
  return result;
}

/**
 * Get dashboard data for admin AI pricing page
 */
export async function getAIDashboardData(): Promise<AIDashboardData> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get components in parallel
  const [segments, tests, metrics] = await Promise.allSettled([
    CustomerSegmentationService.getSegments(),
    ABTestingService.getTests("running"),
    RevenueOptimizationService.getRevenueMetrics(thirtyDaysAgo, now),
  ]);

  const segmentData = segments.status === "fulfilled" ? segments.value : [];
  const testData = tests.status === "fulfilled" ? tests.value : [];
  const metricsData =
    metrics.status === "fulfilled"
      ? metrics.value
      : {
          totalRevenue: 0,
          avgYield: 0,
          loadFactor: 0,
          optimizationImpact: 0,
        };

  // Segment distribution
  const totalMembers = segmentData.reduce((sum, s) => sum + s.memberCount, 0);
  const segmentDistribution = segmentData.map(s => ({
    name: s.name,
    count: s.memberCount,
    percentage: totalMembers > 0 ? (s.memberCount / totalMembers) * 100 : 0,
  }));

  // Active tests summary
  const activeTests = testData.map(t => ({
    id: t.id,
    name: t.name,
    status: t.status,
    variants: t.variants.map(v => ({
      name: v.name,
      impressions: v.metrics.impressions,
      conversions: v.metrics.conversions,
      revenue: v.metrics.totalRevenue,
    })),
  }));

  return {
    demandForecasts: [], // Populated on-demand per flight
    segmentDistribution,
    activeTests,
    revenueMetrics: {
      totalRevenue: metricsData.totalRevenue,
      avgYield: metricsData.avgYield,
      loadFactor: metricsData.loadFactor,
      optimizationImpact: metricsData.optimizationImpact,
    },
    recentOptimizations: [],
  };
}

// ============================================================================
// Component Multiplier Helpers
// ============================================================================

async function getDemandMultiplier(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<{ multiplier: number; forecast: number }> {
  const forecasts = await DemandForecastingService.forecastFlightDemand(
    flightId,
    cabinClass,
    1
  );

  if (forecasts.length === 0) {
    return { multiplier: 1.0, forecast: 0 };
  }

  const forecast = forecasts[0];
  return {
    multiplier: forecast.recommendedMultiplier,
    forecast: forecast.predictedDemand,
  };
}

async function getSegmentMultiplier(
  userId?: number
): Promise<{ multiplier: number; name: string | null }> {
  if (!userId) {
    return { multiplier: 1.0, name: null };
  }

  const profile = await CustomerSegmentationService.getCustomerProfile(userId);

  if (profile.segments.length === 0) {
    return { multiplier: 1.0, name: null };
  }

  return {
    multiplier: profile.pricingAdjustment,
    name: profile.segments[0].segmentName,
  };
}

async function getABTestMultiplier(
  context: AIPricingContext
): Promise<{ multiplier: number; variant: string | null }> {
  if (!context.sessionId && !context.userId) {
    return { multiplier: 1.0, variant: null };
  }

  const assignment = await ABTestingService.getVariantAssignment(
    context.userId,
    context.sessionId || `user_${context.userId}`,
    context.flightId,
    context.cabinClass
  );

  if (!assignment) {
    return { multiplier: 1.0, variant: null };
  }

  // Apply variant strategy
  const strategy = assignment.pricingStrategy;
  const multiplier =
    strategy.type === "multiplier" ? strategy.multiplier || 1 : 1.0;

  return { multiplier, variant: assignment.variantName };
}

// ============================================================================
// Utility
// ============================================================================

function getDefaultResult(): AIPricingResult {
  return {
    aiMultiplier: 1.0,
    components: {
      demandMultiplier: 1.0,
      segmentMultiplier: 1.0,
      optimizationMultiplier: 1.0,
      abTestMultiplier: 1.0,
    },
    metadata: {
      demandForecast: null,
      customerSegment: null,
      abTestVariant: null,
      optimizationGoal: null,
      confidence: 0,
    },
  };
}

function calculateConfidence(
  hasDemand: boolean,
  hasSegment: boolean,
  hasAbTest: boolean,
  demandForecast: number | null
): number {
  let confidence = 0.3; // Base confidence

  if (hasDemand && demandForecast !== null) {
    confidence += 0.3;
  }
  if (hasSegment) {
    confidence += 0.2;
  }
  if (hasAbTest) {
    confidence += 0.1;
  }

  // Higher demand forecast data = more confidence
  if (demandForecast && demandForecast > 0) {
    confidence += 0.1;
  }

  return Math.min(1, confidence);
}

async function isAIPricingEnabled(): Promise<boolean> {
  const setting = await cacheService.get<boolean>(AI_ENABLED_KEY);
  return setting !== false; // Enabled by default
}

/**
 * Enable or disable AI pricing
 */
export async function setAIPricingEnabled(enabled: boolean): Promise<void> {
  await cacheService.set(AI_ENABLED_KEY, enabled, 0); // No expiry
}

// ============================================================================
// Exports
// ============================================================================

export const AIPricingService = {
  calculateAIPricingMultiplier,
  getAIDashboardData,
  setAIPricingEnabled,
};

export default AIPricingService;
