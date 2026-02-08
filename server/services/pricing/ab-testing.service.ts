/**
 * A/B Testing Service for Pricing
 *
 * Manages controlled experiments for pricing strategies:
 * - Test creation with control/variant groups
 * - Deterministic user-to-variant assignment
 * - Statistical significance calculation
 * - Revenue and conversion tracking per variant
 *
 * @module services/pricing/ab-testing.service
 */

import { getDb } from "../../db";
import {
  pricingAbTests,
  pricingAbTestVariants,
  pricingAbTestExposures,
} from "../../../drizzle/schema";
import { eq, and, gte, lte, sql, count, sum, desc } from "drizzle-orm";
import { cacheService } from "../cache.service";

// ============================================================================
// Types
// ============================================================================

export interface ABTest {
  id: number;
  name: string;
  description: string | null;
  hypothesis: string | null;
  status: string;
  variants: ABTestVariant[];
  startDate: Date;
  endDate: Date | null;
  trafficPercentage: number;
  minimumSampleSize: number;
  confidenceLevel: number;
}

export interface ABTestVariant {
  id: number;
  name: string;
  isControl: boolean;
  pricingStrategy: PricingStrategy;
  weight: number;
  metrics: VariantMetrics;
}

export interface PricingStrategy {
  type: "multiplier" | "fixed_adjustment" | "dynamic_rule";
  multiplier?: number;
  fixedAdjustment?: number; // SAR cents
  ruleConfig?: Record<string, unknown>;
}

export interface VariantMetrics {
  impressions: number;
  conversions: number;
  conversionRate: number;
  totalRevenue: number;
  averageOrderValue: number;
  revenuePerImpression: number;
}

export interface ABTestResults {
  testId: number;
  testName: string;
  status: string;
  variants: VariantResult[];
  winner: VariantResult | null;
  isSignificant: boolean;
  pValue: number;
  relativeLift: number;
  confidenceLevel: number;
  recommendedAction: string;
}

export interface VariantResult {
  variantId: number;
  variantName: string;
  isControl: boolean;
  metrics: VariantMetrics;
  statisticalPower: number;
}

export interface VariantAssignment {
  testId: number;
  variantId: number;
  variantName: string;
  pricingStrategy: PricingStrategy;
}

// ============================================================================
// Constants
// ============================================================================

const TEST_CACHE_TTL = 5 * 60; // 5 minutes
const ASSIGNMENT_CACHE_TTL = 60 * 60; // 1 hour

// ============================================================================
// Test Management
// ============================================================================

/**
 * Create a new A/B test
 */
export async function createTest(data: {
  name: string;
  description?: string;
  hypothesis?: string;
  airlineId?: number;
  originId?: number;
  destinationId?: number;
  cabinClass?: "economy" | "business";
  trafficPercentage?: number;
  confidenceLevel?: number;
  minimumSampleSize?: number;
  startDate: Date;
  endDate?: Date;
  variants: {
    name: string;
    isControl: boolean;
    pricingStrategy: PricingStrategy;
    weight: number;
  }[];
  createdBy?: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate at least 2 variants and exactly 1 control
  if (data.variants.length < 2) {
    throw new Error("A/B test requires at least 2 variants");
  }
  const controlCount = data.variants.filter(v => v.isControl).length;
  if (controlCount !== 1) {
    throw new Error("Exactly one variant must be marked as control");
  }

  // Create test
  const [testResult] = await db.insert(pricingAbTests).values({
    name: data.name,
    description: data.description,
    hypothesis: data.hypothesis,
    airlineId: data.airlineId,
    originId: data.originId,
    destinationId: data.destinationId,
    cabinClass: data.cabinClass,
    trafficPercentage: data.trafficPercentage || 100,
    confidenceLevel: (data.confidenceLevel || 0.95).toString(),
    minimumSampleSize: data.minimumSampleSize || 100,
    startDate: data.startDate,
    endDate: data.endDate,
    status: "draft",
    createdBy: data.createdBy,
  });

  const testId = testResult.insertId;

  // Create variants
  for (const variant of data.variants) {
    await db.insert(pricingAbTestVariants).values({
      testId,
      name: variant.name,
      isControl: variant.isControl,
      pricingStrategy: JSON.stringify(variant.pricingStrategy),
      weight: variant.weight,
    });
  }

  return testId;
}

/**
 * Start an A/B test
 */
export async function startTest(testId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(pricingAbTests)
    .set({ status: "running", startDate: new Date() })
    .where(
      and(eq(pricingAbTests.id, testId), eq(pricingAbTests.status, "draft"))
    );
}

/**
 * Pause an A/B test
 */
export async function pauseTest(testId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(pricingAbTests)
    .set({ status: "paused" })
    .where(
      and(eq(pricingAbTests.id, testId), eq(pricingAbTests.status, "running"))
    );
}

/**
 * Complete an A/B test with winner
 */
export async function completeTest(
  testId: number,
  winnerVariantId: number,
  notes?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(pricingAbTests)
    .set({
      status: "completed",
      endDate: new Date(),
      winnerVariantId,
      conclusionNotes: notes,
    })
    .where(eq(pricingAbTests.id, testId));
}

/**
 * Get all tests with their variants
 */
export async function getTests(status?: string): Promise<ABTest[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = status
    ? [
        eq(
          pricingAbTests.status,
          status as "draft" | "running" | "paused" | "completed" | "cancelled"
        ),
      ]
    : [];

  const tests = await db.query.pricingAbTests?.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(pricingAbTests.createdAt)],
  });

  if (!tests) return [];

  const result: ABTest[] = [];
  for (const test of tests) {
    const variants = await db.query.pricingAbTestVariants?.findMany({
      where: eq(pricingAbTestVariants.testId, test.id),
    });

    result.push({
      id: test.id,
      name: test.name,
      description: test.description,
      hypothesis: test.hypothesis,
      status: test.status,
      startDate: test.startDate,
      endDate: test.endDate,
      trafficPercentage: test.trafficPercentage,
      minimumSampleSize: test.minimumSampleSize,
      confidenceLevel: parseFloat(test.confidenceLevel || "0.95"),
      variants: (variants || []).map(v => ({
        id: v.id,
        name: v.name,
        isControl: v.isControl,
        pricingStrategy: JSON.parse(v.pricingStrategy) as PricingStrategy,
        weight: v.weight,
        metrics: {
          impressions: v.impressions,
          conversions: v.conversions,
          conversionRate: v.impressions > 0 ? v.conversions / v.impressions : 0,
          totalRevenue: v.totalRevenue,
          averageOrderValue:
            v.conversions > 0 ? v.totalRevenue / v.conversions : 0,
          revenuePerImpression:
            v.impressions > 0 ? v.totalRevenue / v.impressions : 0,
        },
      })),
    });
  }

  return result;
}

// ============================================================================
// Variant Assignment
// ============================================================================

/**
 * Get variant assignment for a user/session in active tests
 */
export async function getVariantAssignment(
  userId: number | undefined,
  sessionId: string,
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<VariantAssignment | null> {
  const assignmentKey = userId
    ? `ab_assign:user:${userId}`
    : `ab_assign:session:${sessionId}`;

  // Check cache for existing assignment
  const cached = await cacheService.get<VariantAssignment>(assignmentKey);
  if (cached) return cached;

  const db = await getDb();
  if (!db) return null;

  // Find active test matching this context
  const now = new Date();
  const activeTests = await db.query.pricingAbTests?.findMany({
    where: and(
      eq(pricingAbTests.status, "running"),
      lte(pricingAbTests.startDate, now)
    ),
  });

  if (!activeTests || activeTests.length === 0) return null;

  // Find matching test
  const matchingTest = activeTests.find(t => {
    if (t.cabinClass && t.cabinClass !== cabinClass) return false;
    if (t.endDate && t.endDate < now) return false;
    return true;
  });

  if (!matchingTest) return null;

  // Check traffic allocation
  const hash = simpleHash(assignmentKey + matchingTest.id);
  const trafficBucket = hash % 100;
  if (trafficBucket >= matchingTest.trafficPercentage) return null;

  // Get variants
  const variants = await db.query.pricingAbTestVariants?.findMany({
    where: eq(pricingAbTestVariants.testId, matchingTest.id),
  });

  if (!variants || variants.length === 0) return null;

  // Deterministic assignment based on user/session hash
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  const variantBucket = hash % totalWeight;

  let cumulativeWeight = 0;
  let assignedVariant = variants[0];
  for (const v of variants) {
    cumulativeWeight += v.weight;
    if (variantBucket < cumulativeWeight) {
      assignedVariant = v;
      break;
    }
  }

  const assignment: VariantAssignment = {
    testId: matchingTest.id,
    variantId: assignedVariant.id,
    variantName: assignedVariant.name,
    pricingStrategy: JSON.parse(
      assignedVariant.pricingStrategy
    ) as PricingStrategy,
  };

  await cacheService.set(assignmentKey, assignment, ASSIGNMENT_CACHE_TTL);

  // Record impression
  await recordExposure({
    testId: matchingTest.id,
    variantId: assignedVariant.id,
    userId,
    sessionId,
    flightId,
  });

  return assignment;
}

/**
 * Apply A/B test variant pricing to a base price
 */
export function applyVariantPricing(
  basePrice: number,
  strategy: PricingStrategy
): number {
  switch (strategy.type) {
    case "multiplier":
      return Math.round(basePrice * (strategy.multiplier || 1));
    case "fixed_adjustment":
      return Math.max(0, basePrice + (strategy.fixedAdjustment || 0));
    case "dynamic_rule":
      // Custom rule evaluation would go here
      return basePrice;
    default:
      return basePrice;
  }
}

/**
 * Record a conversion (booking) for a test exposure
 */
export async function recordConversion(
  testId: number,
  variantId: number,
  userId: number | undefined,
  sessionId: string | undefined,
  bookingId: number,
  revenue: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // Update exposure record
    const conditions = [
      eq(pricingAbTestExposures.testId, testId),
      eq(pricingAbTestExposures.variantId, variantId),
    ];
    if (userId) {
      conditions.push(eq(pricingAbTestExposures.userId, userId));
    } else if (sessionId) {
      conditions.push(eq(pricingAbTestExposures.sessionId, sessionId));
    }

    await db
      .update(pricingAbTestExposures)
      .set({
        converted: true,
        bookingId,
        revenue,
      })
      .where(and(...conditions));

    // Update variant aggregates
    await db
      .update(pricingAbTestVariants)
      .set({
        conversions: sql`${pricingAbTestVariants.conversions} + 1`,
        totalRevenue: sql`${pricingAbTestVariants.totalRevenue} + ${revenue}`,
        averageOrderValue: sql`(${pricingAbTestVariants.totalRevenue} + ${revenue}) / (${pricingAbTestVariants.conversions} + 1)`,
      })
      .where(eq(pricingAbTestVariants.id, variantId));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ab_test_conversion_error",
        testId,
        variantId,
        error: error instanceof Error ? error.message : "Unknown",
      })
    );
  }
}

// ============================================================================
// Results & Statistical Analysis
// ============================================================================

/**
 * Get detailed test results with statistical analysis
 */
export async function getTestResults(testId: number): Promise<ABTestResults> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const test = await db.query.pricingAbTests?.findFirst({
    where: eq(pricingAbTests.id, testId),
  });
  if (!test) throw new Error(`Test ${testId} not found`);

  const variants = await db.query.pricingAbTestVariants?.findMany({
    where: eq(pricingAbTestVariants.testId, testId),
  });

  if (!variants || variants.length < 2) {
    throw new Error("Test must have at least 2 variants");
  }

  const variantResults: VariantResult[] = variants.map(v => ({
    variantId: v.id,
    variantName: v.name,
    isControl: v.isControl,
    metrics: {
      impressions: v.impressions,
      conversions: v.conversions,
      conversionRate: v.impressions > 0 ? v.conversions / v.impressions : 0,
      totalRevenue: v.totalRevenue,
      averageOrderValue: v.conversions > 0 ? v.totalRevenue / v.conversions : 0,
      revenuePerImpression:
        v.impressions > 0 ? v.totalRevenue / v.impressions : 0,
    },
    statisticalPower: 0,
  }));

  // Statistical significance test (Z-test for proportions)
  const control = variantResults.find(v => v.isControl);
  const treatment = variantResults.find(v => !v.isControl);

  if (!control || !treatment) {
    return {
      testId,
      testName: test.name,
      status: test.status,
      variants: variantResults,
      winner: null,
      isSignificant: false,
      pValue: 1,
      relativeLift: 0,
      confidenceLevel: parseFloat(test.confidenceLevel || "0.95"),
      recommendedAction: "Insufficient data - no control or treatment variant",
    };
  }

  const { pValue, isSignificant, zScore } = calculateSignificance(
    control.metrics,
    treatment.metrics,
    parseFloat(test.confidenceLevel || "0.95")
  );

  // Calculate relative lift
  const relativeLift =
    control.metrics.conversionRate > 0
      ? (treatment.metrics.conversionRate - control.metrics.conversionRate) /
        control.metrics.conversionRate
      : 0;

  // Determine winner
  let winner: VariantResult | null = null;
  if (isSignificant) {
    winner =
      treatment.metrics.revenuePerImpression >
      control.metrics.revenuePerImpression
        ? treatment
        : control;
  }

  // Power calculation
  const totalSamples =
    control.metrics.impressions + treatment.metrics.impressions;
  const power = calculatePower(
    control.metrics.conversionRate,
    treatment.metrics.conversionRate,
    totalSamples
  );
  control.statisticalPower = power;
  treatment.statisticalPower = power;

  // Recommendation
  let recommendedAction: string;
  if (!isSignificant && totalSamples < test.minimumSampleSize) {
    recommendedAction = `Continue test - need ${test.minimumSampleSize - totalSamples} more samples`;
  } else if (isSignificant && winner) {
    recommendedAction = `Implement ${winner.variantName} - ${(relativeLift * 100).toFixed(1)}% lift in conversion`;
  } else if (isSignificant) {
    recommendedAction =
      "Results are significant but no clear winner on revenue";
  } else {
    recommendedAction =
      "No significant difference detected - consider ending test";
  }

  return {
    testId,
    testName: test.name,
    status: test.status,
    variants: variantResults,
    winner,
    isSignificant,
    pValue,
    relativeLift,
    confidenceLevel: parseFloat(test.confidenceLevel || "0.95"),
    recommendedAction,
  };
}

// ============================================================================
// Statistical Helpers
// ============================================================================

function calculateSignificance(
  control: VariantMetrics,
  treatment: VariantMetrics,
  confidenceLevel: number
): { pValue: number; isSignificant: boolean; zScore: number } {
  const n1 = control.impressions;
  const n2 = treatment.impressions;

  if (n1 === 0 || n2 === 0) {
    return { pValue: 1, isSignificant: false, zScore: 0 };
  }

  const p1 = control.conversionRate;
  const p2 = treatment.conversionRate;

  // Pooled proportion
  const p = (p1 * n1 + p2 * n2) / (n1 + n2);

  if (p === 0 || p === 1) {
    return { pValue: 1, isSignificant: false, zScore: 0 };
  }

  // Z-score
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  const zScore = se > 0 ? (p2 - p1) / se : 0;

  // Two-tailed p-value (approximate using normal distribution)
  const pValue = 2 * (1 - normalCDF(Math.abs(zScore)));

  const alpha = 1 - confidenceLevel;
  const isSignificant = pValue < alpha;

  return { pValue, isSignificant, zScore };
}

function calculatePower(p1: number, p2: number, totalSamples: number): number {
  if (p1 === p2 || totalSamples === 0) return 0;

  const n = totalSamples / 2;
  const p = (p1 + p2) / 2;
  const se = Math.sqrt(p * (1 - p) * (2 / n));
  const effectSize = se > 0 ? Math.abs(p2 - p1) / se : 0;

  // Approximate power
  return Math.min(1, normalCDF(effectSize - 1.96));
}

/**
 * Approximate normal CDF using Abramowitz and Stegun formula
 */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function recordExposure(data: {
  testId: number;
  variantId: number;
  userId?: number;
  sessionId: string;
  flightId: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(pricingAbTestExposures).values({
      testId: data.testId,
      variantId: data.variantId,
      userId: data.userId,
      sessionId: data.sessionId,
      flightId: data.flightId,
    });

    // Increment impressions
    await db
      .update(pricingAbTestVariants)
      .set({
        impressions: sql`${pricingAbTestVariants.impressions} + 1`,
      })
      .where(eq(pricingAbTestVariants.id, data.variantId));
  } catch {
    // Non-critical
  }
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// ============================================================================
// Exports
// ============================================================================

export const ABTestingService = {
  createTest,
  startTest,
  pauseTest,
  completeTest,
  getTests,
  getVariantAssignment,
  applyVariantPricing,
  recordConversion,
  getTestResults,
};

export default ABTestingService;
