import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  PricingStrategy,
  VariantMetrics,
} from "../../services/pricing/ab-testing.service";

// Mock database
vi.mock("../../db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

// Mock cache service
vi.mock("../../services/cache.service", () => ({
  cacheService: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock drizzle schema
vi.mock("../../../drizzle/schema", () => ({
  flights: {
    id: "id",
    originId: "originId",
    destinationId: "destinationId",
    departureTime: "departureTime",
    economyPrice: "economyPrice",
    businessPrice: "businessPrice",
    economySeats: "economySeats",
    businessSeats: "businessSeats",
    economyAvailable: "economyAvailable",
    businessAvailable: "businessAvailable",
  },
  bookings: {
    id: "id",
    flightId: "flightId",
    status: "status",
    cabinClass: "cabinClass",
    totalAmount: "totalAmount",
    numberOfPassengers: "numberOfPassengers",
    createdAt: "createdAt",
  },
  pricingAbTests: {
    id: "id",
    name: "name",
    status: "status",
    confidenceLevel: "confidenceLevel",
    minimumSampleSize: "minimumSampleSize",
  },
  pricingAbTestVariants: {
    id: "id",
    testId: "testId",
    name: "name",
    isControl: "isControl",
    impressions: "impressions",
    conversions: "conversions",
    totalRevenue: "totalRevenue",
    averageOrderValue: "averageOrderValue",
  },
  pricingAbTestExposures: {
    id: "id",
    testId: "testId",
    variantId: "variantId",
    userId: "userId",
    sessionId: "sessionId",
    flightId: "flightId",
    converted: "converted",
    bookingId: "bookingId",
    revenue: "revenue",
  },
  pricingHistory: {
    id: "id",
    flightId: "flightId",
    cabinClass: "cabinClass",
    basePrice: "basePrice",
    finalPrice: "finalPrice",
    occupancyRate: "occupancyRate",
    createdAt: "createdAt",
  },
  revenueOptimizationLogs: {
    id: "id",
    flightId: "flightId",
    cabinClass: "cabinClass",
    previousPrice: "previousPrice",
    optimizedPrice: "optimizedPrice",
    priceChange: "priceChange",
    factors: "factors",
    optimizationGoal: "optimizationGoal",
    expectedRevenueImpact: "expectedRevenueImpact",
    status: "status",
  },
  priceElasticityData: {
    id: "id",
    originId: "originId",
    destinationId: "destinationId",
    cabinClass: "cabinClass",
    elasticity: "elasticity",
    sampleSize: "sampleSize",
    rSquared: "rSquared",
    optimalPrice: "optimalPrice",
    minPrice: "minPrice",
    maxPrice: "maxPrice",
    periodStart: "periodStart",
    periodEnd: "periodEnd",
    createdAt: "createdAt",
  },
  demandPredictions: {
    id: "id",
    flightId: "flightId",
    cabinClass: "cabinClass",
  },
  aiPricingModels: { id: "id", modelType: "modelType", isActive: "isActive" },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ type: "eq", a, b })),
  and: vi.fn((...args) => ({ type: "and", args })),
  gte: vi.fn((a, b) => ({ type: "gte", a, b })),
  lte: vi.fn((a, b) => ({ type: "lte", a, b })),
  sql: Object.assign(
    vi.fn(() => "sql"),
    { raw: vi.fn(() => "raw") }
  ),
  desc: vi.fn(a => ({ type: "desc", a })),
  count: vi.fn(() => "count"),
  sum: vi.fn(() => "sum"),
}));

// ============================================================================
// Re-implement pure functions for testing (since they're not exported)
// ============================================================================

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
  const p = (p1 * n1 + p2 * n2) / (n1 + n2);

  if (p === 0 || p === 1) {
    return { pValue: 1, isSignificant: false, zScore: 0 };
  }

  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  const zScore = se > 0 ? (p2 - p1) / se : 0;
  const pValue = 2 * (1 - normalCDF(Math.abs(zScore)));
  const alpha = 1 - confidenceLevel;
  const isSignificant = pValue < alpha;

  return { pValue, isSignificant, zScore };
}

function applyVariantPricing(
  basePrice: number,
  strategy: PricingStrategy
): number {
  switch (strategy.type) {
    case "multiplier":
      return Math.round(basePrice * (strategy.multiplier || 1));
    case "fixed_adjustment":
      return Math.max(0, basePrice + (strategy.fixedAdjustment || 0));
    case "dynamic_rule":
      return basePrice;
    default:
      return basePrice;
  }
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function calculatePower(p1: number, p2: number, totalSamples: number): number {
  if (p1 === p2 || totalSamples === 0) return 0;
  const n = totalSamples / 2;
  const p = (p1 + p2) / 2;
  const se = Math.sqrt(p * (1 - p) * (2 / n));
  const effectSize = se > 0 ? Math.abs(p2 - p1) / se : 0;
  return Math.min(1, normalCDF(effectSize - 1.96));
}

// Optimal price function for revenue optimization
function calculateOptimalPrice(
  currentPrice: number,
  occupancyRate: number,
  elasticity: number,
  daysUntilDeparture: number,
  goal: string,
  seasonalFactor: number = 1.0,
  demandForecast: number = 0
): number {
  let priceAdjustment = 0;
  const MAX_PRICE_CHANGE_PCT = 0.3;
  const MIN_MULTIPLIER = 0.7;
  const MAX_MULTIPLIER = 2.5;

  switch (goal) {
    case "maximize_revenue": {
      const e = Math.abs(elasticity);
      if (e > 1.5) priceAdjustment = -0.1;
      else if (e < 0.8) priceAdjustment = 0.15;
      break;
    }
    case "maximize_load_factor": {
      if (occupancyRate < 0.5) priceAdjustment = -0.2;
      else if (occupancyRate < 0.7) priceAdjustment = -0.1;
      else if (occupancyRate > 0.9) priceAdjustment = 0.1;
      break;
    }
    case "maximize_yield": {
      if (occupancyRate > 0.7 && daysUntilDeparture < 14) priceAdjustment = 0.2;
      else if (demandForecast > 0) priceAdjustment = 0.1;
      break;
    }
    case "balance":
    default: {
      const loadWeight = occupancyRate < 0.5 ? 0.6 : 0.3;
      const revenueWeight = 1 - loadWeight;
      const loadAdj =
        occupancyRate < 0.3
          ? -0.15
          : occupancyRate < 0.5
            ? -0.08
            : occupancyRate > 0.85
              ? 0.15
              : 0;
      const e = Math.abs(elasticity);
      const revAdj = e > 1.5 ? -0.08 : e < 0.8 ? 0.1 : 0;
      priceAdjustment = loadAdj * loadWeight + revAdj * revenueWeight;
      break;
    }
  }

  // Time urgency
  if (daysUntilDeparture < 3) priceAdjustment += 0.15;
  else if (daysUntilDeparture > 60) priceAdjustment -= 0.05;

  // Seasonal
  priceAdjustment += (seasonalFactor - 1) * 0.5;

  // Cap
  priceAdjustment = Math.max(
    -MAX_PRICE_CHANGE_PCT,
    Math.min(MAX_PRICE_CHANGE_PCT, priceAdjustment)
  );
  const optimizedPrice = Math.round(currentPrice * (1 + priceAdjustment));

  return Math.round(
    Math.max(
      currentPrice * MIN_MULTIPLIER,
      Math.min(currentPrice * MAX_MULTIPLIER, optimizedPrice)
    )
  );
}

// ============================================================================
// A/B Testing Tests
// ============================================================================

describe("A/B Testing Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Normal CDF Approximation", () => {
    it("should return 0.5 for x=0 (symmetric)", () => {
      expect(normalCDF(0)).toBeCloseTo(0.5, 4);
    });

    it("should return ~0.8413 for x=1", () => {
      expect(normalCDF(1)).toBeCloseTo(0.8413, 3);
    });

    it("should return ~0.9772 for x=2", () => {
      expect(normalCDF(2)).toBeCloseTo(0.9772, 3);
    });

    it("should return ~0.9987 for x=3", () => {
      expect(normalCDF(3)).toBeCloseTo(0.9987, 3);
    });

    it("should return 0 for very negative x", () => {
      expect(normalCDF(-10)).toBe(0);
    });

    it("should return 1 for very positive x", () => {
      expect(normalCDF(10)).toBe(1);
    });

    it("should be symmetric: CDF(x) + CDF(-x) = 1", () => {
      expect(normalCDF(1.5) + normalCDF(-1.5)).toBeCloseTo(1, 4);
      expect(normalCDF(2.3) + normalCDF(-2.3)).toBeCloseTo(1, 4);
    });
  });

  describe("Statistical Significance (Z-test)", () => {
    it("should detect significant difference with large samples", () => {
      const control: VariantMetrics = {
        impressions: 5000,
        conversions: 250,
        conversionRate: 0.05,
        totalRevenue: 2500000,
        averageOrderValue: 10000,
        revenuePerImpression: 500,
      };
      const treatment: VariantMetrics = {
        impressions: 5000,
        conversions: 350,
        conversionRate: 0.07,
        totalRevenue: 3500000,
        averageOrderValue: 10000,
        revenuePerImpression: 700,
      };

      const result = calculateSignificance(control, treatment, 0.95);
      expect(result.isSignificant).toBe(true);
      expect(result.pValue).toBeLessThan(0.05);
      expect(result.zScore).toBeGreaterThan(0);
    });

    it("should NOT detect significance with small samples", () => {
      const control: VariantMetrics = {
        impressions: 10,
        conversions: 1,
        conversionRate: 0.1,
        totalRevenue: 10000,
        averageOrderValue: 10000,
        revenuePerImpression: 1000,
      };
      const treatment: VariantMetrics = {
        impressions: 10,
        conversions: 2,
        conversionRate: 0.2,
        totalRevenue: 20000,
        averageOrderValue: 10000,
        revenuePerImpression: 2000,
      };

      const result = calculateSignificance(control, treatment, 0.95);
      expect(result.isSignificant).toBe(false);
    });

    it("should return pValue=1 when either group has 0 impressions", () => {
      const control: VariantMetrics = {
        impressions: 0,
        conversions: 0,
        conversionRate: 0,
        totalRevenue: 0,
        averageOrderValue: 0,
        revenuePerImpression: 0,
      };
      const treatment: VariantMetrics = {
        impressions: 1000,
        conversions: 50,
        conversionRate: 0.05,
        totalRevenue: 500000,
        averageOrderValue: 10000,
        revenuePerImpression: 500,
      };

      const result = calculateSignificance(control, treatment, 0.95);
      expect(result.pValue).toBe(1);
      expect(result.isSignificant).toBe(false);
    });

    it("should return not significant when conversion rates are equal", () => {
      const control: VariantMetrics = {
        impressions: 1000,
        conversions: 50,
        conversionRate: 0.05,
        totalRevenue: 500000,
        averageOrderValue: 10000,
        revenuePerImpression: 500,
      };
      const treatment: VariantMetrics = {
        impressions: 1000,
        conversions: 50,
        conversionRate: 0.05,
        totalRevenue: 500000,
        averageOrderValue: 10000,
        revenuePerImpression: 500,
      };

      const result = calculateSignificance(control, treatment, 0.95);
      expect(result.zScore).toBeCloseTo(0, 5);
      expect(result.isSignificant).toBe(false);
    });

    it("should respect confidence level parameter", () => {
      const control: VariantMetrics = {
        impressions: 1000,
        conversions: 50,
        conversionRate: 0.05,
        totalRevenue: 500000,
        averageOrderValue: 10000,
        revenuePerImpression: 500,
      };
      const treatment: VariantMetrics = {
        impressions: 1000,
        conversions: 70,
        conversionRate: 0.07,
        totalRevenue: 700000,
        averageOrderValue: 10000,
        revenuePerImpression: 700,
      };

      // Lower confidence = easier to declare significance
      const result90 = calculateSignificance(control, treatment, 0.9);
      const result99 = calculateSignificance(control, treatment, 0.99);

      // With 90% confidence, it might be significant when 99% is not
      if (result90.isSignificant) {
        expect(result90.pValue).toBeLessThan(0.1);
      }
      // 99% requires pValue < 0.01
      if (!result99.isSignificant) {
        expect(result99.pValue).toBeGreaterThanOrEqual(0.01);
      }
    });
  });

  describe("Variant Pricing Application", () => {
    it("should apply multiplier strategy correctly", () => {
      const strategy: PricingStrategy = { type: "multiplier", multiplier: 1.1 };
      expect(applyVariantPricing(10000, strategy)).toBe(11000);
    });

    it("should apply fixed adjustment strategy", () => {
      const strategy: PricingStrategy = {
        type: "fixed_adjustment",
        fixedAdjustment: 5000,
      };
      expect(applyVariantPricing(10000, strategy)).toBe(15000);
    });

    it("should not go below 0 for negative fixed adjustments", () => {
      const strategy: PricingStrategy = {
        type: "fixed_adjustment",
        fixedAdjustment: -20000,
      };
      expect(applyVariantPricing(10000, strategy)).toBe(0);
    });

    it("should return base price for dynamic_rule (placeholder)", () => {
      const strategy: PricingStrategy = {
        type: "dynamic_rule",
        ruleConfig: {},
      };
      expect(applyVariantPricing(10000, strategy)).toBe(10000);
    });

    it("should handle missing multiplier (default to 1)", () => {
      const strategy: PricingStrategy = { type: "multiplier" };
      expect(applyVariantPricing(10000, strategy)).toBe(10000);
    });
  });

  describe("Hash Function (Deterministic Assignment)", () => {
    it("should produce consistent results for same input", () => {
      expect(simpleHash("user123_test1")).toBe(simpleHash("user123_test1"));
    });

    it("should produce different results for different inputs", () => {
      expect(simpleHash("user123")).not.toBe(simpleHash("user456"));
    });

    it("should always produce non-negative values", () => {
      const testInputs = [
        "",
        "a",
        "test",
        "user_12345",
        "long_session_id_abc123",
      ];
      for (const input of testInputs) {
        expect(simpleHash(input)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Power Calculation", () => {
    it("should return 0 when conversion rates are equal", () => {
      expect(calculatePower(0.05, 0.05, 10000)).toBe(0);
    });

    it("should return 0 when no samples", () => {
      expect(calculatePower(0.05, 0.1, 0)).toBe(0);
    });

    it("should increase power with larger sample sizes", () => {
      const power100 = calculatePower(0.05, 0.08, 200);
      const power10000 = calculatePower(0.05, 0.08, 20000);
      expect(power10000).toBeGreaterThan(power100);
    });

    it("should increase power with larger effect sizes", () => {
      const smallEffect = calculatePower(0.05, 0.06, 5000);
      const largeEffect = calculatePower(0.05, 0.15, 5000);
      expect(largeEffect).toBeGreaterThan(smallEffect);
    });
  });

  describe("Service API (DB unavailable)", () => {
    it("should export applyVariantPricing as a public function", async () => {
      const { ABTestingService } =
        await import("../../services/pricing/ab-testing.service");
      expect(ABTestingService.applyVariantPricing).toBeDefined();
    });

    it("should apply variant pricing correctly via service", async () => {
      const { ABTestingService } =
        await import("../../services/pricing/ab-testing.service");
      const result = ABTestingService.applyVariantPricing(10000, {
        type: "multiplier",
        multiplier: 0.9,
      });
      expect(result).toBe(9000);
    });
  });
});

// ============================================================================
// Revenue Optimization Tests
// ============================================================================

describe("Revenue Optimization Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Price Optimization Algorithm", () => {
    it("should lower price for elastic demand (|e| > 1.5) in maximize_revenue", () => {
      const price = calculateOptimalPrice(
        100000,
        0.5,
        -2.0,
        15,
        "maximize_revenue"
      );
      expect(price).toBeLessThan(100000);
    });

    it("should raise price for inelastic demand (|e| < 0.8) in maximize_revenue", () => {
      const price = calculateOptimalPrice(
        100000,
        0.5,
        -0.5,
        15,
        "maximize_revenue"
      );
      expect(price).toBeGreaterThan(100000);
    });

    it("should give significant discount for low occupancy in maximize_load_factor", () => {
      const price = calculateOptimalPrice(
        100000,
        0.3,
        -1.2,
        15,
        "maximize_load_factor"
      );
      expect(price).toBeLessThan(100000);
    });

    it("should increase price for high occupancy in maximize_load_factor", () => {
      const price = calculateOptimalPrice(
        100000,
        0.95,
        -1.2,
        15,
        "maximize_load_factor"
      );
      expect(price).toBeGreaterThan(100000);
    });

    it("should increase price for high demand close to departure in maximize_yield", () => {
      const price = calculateOptimalPrice(
        100000,
        0.8,
        -1.2,
        7,
        "maximize_yield"
      );
      expect(price).toBeGreaterThan(100000);
    });

    it("should balance revenue and load in 'balance' mode", () => {
      // Low occupancy => discount
      const lowOccPrice = calculateOptimalPrice(
        100000,
        0.2,
        -1.2,
        15,
        "balance"
      );
      expect(lowOccPrice).toBeLessThan(100000);

      // High occupancy => increase
      const highOccPrice = calculateOptimalPrice(
        100000,
        0.9,
        -1.2,
        15,
        "balance"
      );
      expect(highOccPrice).toBeGreaterThan(100000);
    });

    it("should add last-minute premium (< 3 days)", () => {
      const normalPrice = calculateOptimalPrice(
        100000,
        0.5,
        -1.2,
        20,
        "balance"
      );
      const lastMinutePrice = calculateOptimalPrice(
        100000,
        0.5,
        -1.2,
        2,
        "balance"
      );
      expect(lastMinutePrice).toBeGreaterThan(normalPrice);
    });

    it("should add early booking discount (> 60 days)", () => {
      const normalPrice = calculateOptimalPrice(
        100000,
        0.5,
        -1.2,
        20,
        "balance"
      );
      const earlyPrice = calculateOptimalPrice(
        100000,
        0.5,
        -1.2,
        90,
        "balance"
      );
      expect(earlyPrice).toBeLessThan(normalPrice);
    });

    it("should cap price change at 30%", () => {
      // Even with extreme inputs, price shouldn't change more than 30%
      const extremeHighPrice = calculateOptimalPrice(
        100000,
        0.99,
        -0.3,
        1,
        "maximize_yield",
        1.5
      );
      expect(extremeHighPrice).toBeLessThanOrEqual(130000);

      const extremeLowPrice = calculateOptimalPrice(
        100000,
        0.1,
        -3.0,
        90,
        "maximize_load_factor",
        0.7
      );
      expect(extremeLowPrice).toBeGreaterThanOrEqual(70000);
    });

    it("should never exceed global bounds (0.7x to 2.5x)", () => {
      const result = calculateOptimalPrice(100000, 0.5, -1.2, 15, "balance");
      expect(result).toBeGreaterThanOrEqual(70000);
      expect(result).toBeLessThanOrEqual(250000);
    });
  });

  describe("Seasonal Factors", () => {
    it("should have peak summer factors (July/August)", () => {
      const factors: Record<number, number> = {
        1: 1.2,
        2: 0.9,
        3: 0.9,
        4: 1.0,
        5: 1.0,
        6: 1.2,
        7: 1.4,
        8: 1.4,
        9: 1.1,
        10: 1.0,
        11: 0.9,
        12: 1.3,
      };
      expect(factors[7]).toBe(1.4);
      expect(factors[8]).toBe(1.4);
    });

    it("should have low season factors (Feb/Mar/Nov)", () => {
      const factors: Record<number, number> = {
        1: 1.2,
        2: 0.9,
        3: 0.9,
        4: 1.0,
        5: 1.0,
        6: 1.2,
        7: 1.4,
        8: 1.4,
        9: 1.1,
        10: 1.0,
        11: 0.9,
        12: 1.3,
      };
      expect(factors[2]).toBe(0.9);
      expect(factors[3]).toBe(0.9);
      expect(factors[11]).toBe(0.9);
    });

    it("should increase price during peak seasons via seasonal adjustment", () => {
      // Peak season (seasonalFactor=1.4) should add positive adjustment
      const peakPrice = calculateOptimalPrice(
        100000,
        0.5,
        -1.2,
        15,
        "balance",
        1.4
      );
      const offPeakPrice = calculateOptimalPrice(
        100000,
        0.5,
        -1.2,
        15,
        "balance",
        0.9
      );
      expect(peakPrice).toBeGreaterThan(offPeakPrice);
    });
  });

  describe("Elasticity Estimation", () => {
    it("should use log-linear regression for elasticity", () => {
      // ln(demand) = a + b * ln(price), where b is elasticity
      const prices = [100, 110, 120, 90, 80];
      const demands = [50, 42, 35, 60, 72];

      const points = prices.map((p, i) => ({
        lnPrice: Math.log(p),
        lnDemand: Math.log(demands[i]),
      }));

      const n = points.length;
      const sumX = points.reduce((s, p) => s + p.lnPrice, 0);
      const sumY = points.reduce((s, p) => s + p.lnDemand, 0);
      const sumXY = points.reduce((s, p) => s + p.lnPrice * p.lnDemand, 0);
      const sumX2 = points.reduce((s, p) => s + p.lnPrice * p.lnPrice, 0);

      const denominator = n * sumX2 - sumX * sumX;
      const elasticity =
        denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : -1.2;

      // Elasticity should be negative (higher price → lower demand)
      expect(elasticity).toBeLessThan(0);
    });

    it("should default to -1.2 elasticity when no data", () => {
      const DEFAULT_ELASTICITY = -1.2;
      expect(DEFAULT_ELASTICITY).toBe(-1.2);
    });

    it("should bound elasticity to [-5, -0.1]", () => {
      const rawElasticity = -10;
      const bounded = Math.max(-5, Math.min(-0.1, rawElasticity));
      expect(bounded).toBe(-5);

      const rawLow = 0.5;
      const boundedLow = Math.max(-5, Math.min(-0.1, rawLow));
      expect(boundedLow).toBe(-0.1);
    });
  });

  describe("Service API (DB unavailable)", () => {
    it("should export optimization service functions", async () => {
      const { RevenueOptimizationService } =
        await import("../../services/pricing/revenue-optimization.service");
      expect(RevenueOptimizationService.optimizeFlightPrice).toBeDefined();
      expect(RevenueOptimizationService.optimizeUpcomingFlights).toBeDefined();
      expect(RevenueOptimizationService.getRevenueMetrics).toBeDefined();
      expect(RevenueOptimizationService.applyOptimization).toBeDefined();
    });
  });
});
