import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mock Setup
// ============================================================================

// Mock database
vi.mock("../../db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

// Mock cache service
const mockCacheGet = vi.fn().mockResolvedValue(null);
const mockCacheSet = vi.fn().mockResolvedValue(undefined);
vi.mock("../../services/cache.service", () => ({
  cacheService: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
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
    userId: "userId",
    status: "status",
    cabinClass: "cabinClass",
    totalAmount: "totalAmount",
    numberOfPassengers: "numberOfPassengers",
    createdAt: "createdAt",
  },
  users: { id: "id" },
  demandPredictions: {
    id: "id",
    flightId: "flightId",
    cabinClass: "cabinClass",
  },
  aiPricingModels: { id: "id", modelType: "modelType", isActive: "isActive" },
  pricingHistory: {
    id: "id",
    flightId: "flightId",
    cabinClass: "cabinClass",
    basePrice: "basePrice",
    finalPrice: "finalPrice",
    occupancyRate: "occupancyRate",
    createdAt: "createdAt",
  },
  customerSegments: {
    id: "id",
    name: "name",
    segmentType: "segmentType",
    criteria: "criteria",
    priceMultiplier: "priceMultiplier",
    isActive: "isActive",
    memberCount: "memberCount",
  },
  customerSegmentAssignments: {
    id: "id",
    userId: "userId",
    segmentId: "segmentId",
    score: "score",
    behaviorSnapshot: "behaviorSnapshot",
    assignedAt: "assignedAt",
    isActive: "isActive",
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
  },
  revenueOptimizationLogs: { id: "id" },
  priceElasticityData: {
    id: "id",
    originId: "originId",
    destinationId: "destinationId",
    cabinClass: "cabinClass",
    elasticity: "elasticity",
    sampleSize: "sampleSize",
    rSquared: "rSquared",
    optimalPrice: "optimalPrice",
    createdAt: "createdAt",
  },
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
  between: vi.fn((a, b, c) => ({ type: "between", a, b, c })),
  avg: vi.fn(() => "avg"),
  isNull: vi.fn(a => ({ type: "isNull", a })),
  or: vi.fn((...args) => ({ type: "or", args })),
}));

// ============================================================================
// Confidence Calculation (mirrors internal calculateConfidence)
// ============================================================================

function calculateConfidence(
  hasDemand: boolean,
  hasSegment: boolean,
  hasAbTest: boolean,
  demandForecast: number | null
): number {
  let confidence = 0.3;
  if (hasDemand && demandForecast !== null) confidence += 0.3;
  if (hasSegment) confidence += 0.2;
  if (hasAbTest) confidence += 0.1;
  if (demandForecast && demandForecast > 0) confidence += 0.1;
  return Math.min(1, confidence);
}

// ============================================================================
// Weighted Multiplier Calculation (mirrors AI pricing orchestrator)
// ============================================================================

function calculateCombinedMultiplier(
  demandMultiplier: number,
  optimizationMultiplier: number,
  segmentMultiplier: number,
  abTestMultiplier: number
): number {
  const combined =
    demandMultiplier * 0.35 +
    optimizationMultiplier * 0.3 +
    segmentMultiplier * 0.2 +
    abTestMultiplier * 0.15;

  return Math.min(2.0, Math.max(0.75, combined));
}

// ============================================================================
// Tests
// ============================================================================

describe("AI Pricing Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
  });

  describe("Confidence Scoring", () => {
    it("should have base confidence of 0.3", () => {
      expect(calculateConfidence(false, false, false, null)).toBe(0.3);
    });

    it("should add 0.3 for demand data with forecast", () => {
      expect(calculateConfidence(true, false, false, 50)).toBe(0.7);
    });

    it("should add 0.2 for segment data", () => {
      expect(calculateConfidence(false, true, false, null)).toBe(0.5);
    });

    it("should add 0.1 for A/B test data", () => {
      expect(calculateConfidence(false, false, true, null)).toBe(0.4);
    });

    it("should add 0.1 for positive demand forecast", () => {
      expect(calculateConfidence(true, false, false, 100)).toBeCloseTo(0.7);
    });

    it("should cap at 1.0 with all data available", () => {
      expect(calculateConfidence(true, true, true, 100)).toBe(1.0);
    });

    it("should not add demand bonus for null forecast", () => {
      expect(calculateConfidence(true, false, false, null)).toBe(0.3);
      // hasDemand is true but forecast is null → no 0.3 addition
    });

    it("should not add bonus for zero demand forecast", () => {
      const withZero = calculateConfidence(true, false, false, 0);
      // hasDemand && demandForecast !== null → +0.3
      // demandForecast && demandForecast > 0 → 0 is falsy, no +0.1
      expect(withZero).toBe(0.6);
    });
  });

  describe("Weighted Multiplier Combination", () => {
    it("should return 1.0 when all components are 1.0", () => {
      expect(calculateCombinedMultiplier(1.0, 1.0, 1.0, 1.0)).toBeCloseTo(
        1.0,
        10
      );
    });

    it("should weight demand at 35%", () => {
      // Only demand differs
      const result = calculateCombinedMultiplier(1.5, 1.0, 1.0, 1.0);
      // 1.5*0.35 + 1.0*0.30 + 1.0*0.20 + 1.0*0.15 = 0.525 + 0.30 + 0.20 + 0.15 = 1.175
      expect(result).toBeCloseTo(1.175);
    });

    it("should weight optimization at 30%", () => {
      const result = calculateCombinedMultiplier(1.0, 1.5, 1.0, 1.0);
      // 1.0*0.35 + 1.5*0.30 + 1.0*0.20 + 1.0*0.15 = 0.35 + 0.45 + 0.20 + 0.15 = 1.15
      expect(result).toBeCloseTo(1.15);
    });

    it("should weight segment at 20%", () => {
      const result = calculateCombinedMultiplier(1.0, 1.0, 0.9, 1.0);
      // 0.35 + 0.30 + 0.18 + 0.15 = 0.98
      expect(result).toBeCloseTo(0.98);
    });

    it("should weight A/B test at 15%", () => {
      const result = calculateCombinedMultiplier(1.0, 1.0, 1.0, 1.2);
      // 0.35 + 0.30 + 0.20 + 0.18 = 1.03
      expect(result).toBeCloseTo(1.03);
    });

    it("should cap at 2.0 for extreme high multipliers", () => {
      expect(calculateCombinedMultiplier(3.0, 3.0, 3.0, 3.0)).toBe(2.0);
    });

    it("should floor at 0.75 for extreme low multipliers", () => {
      expect(calculateCombinedMultiplier(0.1, 0.1, 0.1, 0.1)).toBe(0.75);
    });

    it("should handle mixed high and low multipliers", () => {
      // High demand but low segment
      const result = calculateCombinedMultiplier(1.8, 1.2, 0.85, 1.0);
      // 0.63 + 0.36 + 0.17 + 0.15 = 1.31
      expect(result).toBeCloseTo(1.31);
      expect(result).toBeGreaterThan(0.75);
      expect(result).toBeLessThan(2.0);
    });
  });

  describe("AI Pricing Enabled/Disabled", () => {
    it("should return default result (all 1.0) when disabled", async () => {
      // Mock cache returns false for AI enabled key
      mockCacheGet.mockImplementation(async (key: string) => {
        if (key === "ai_pricing_enabled") return false;
        return null;
      });

      const { AIPricingService } =
        await import("../../services/pricing/ai-pricing.service");

      const result = await AIPricingService.calculateAIPricingMultiplier({
        flightId: 1,
        cabinClass: "economy",
        requestedSeats: 1,
      });

      expect(result.aiMultiplier).toBe(1.0);
      expect(result.components.demandMultiplier).toBe(1.0);
      expect(result.components.segmentMultiplier).toBe(1.0);
      expect(result.components.optimizationMultiplier).toBe(1.0);
      expect(result.components.abTestMultiplier).toBe(1.0);
      expect(result.metadata.confidence).toBe(0);
    });

    it("should allow enabling/disabling AI pricing", async () => {
      const { AIPricingService } =
        await import("../../services/pricing/ai-pricing.service");

      // This should call cacheService.set with the right key
      await AIPricingService.setAIPricingEnabled(false);
      expect(mockCacheSet).toHaveBeenCalledWith("ai_pricing_enabled", false, 0);

      await AIPricingService.setAIPricingEnabled(true);
      expect(mockCacheSet).toHaveBeenCalledWith("ai_pricing_enabled", true, 0);
    });
  });

  describe("Graceful Degradation", () => {
    it("should fall back to 1.0 multiplier when all AI components fail", async () => {
      // Cache returns null (AI pricing is enabled by default)
      mockCacheGet.mockResolvedValue(null);

      const { AIPricingService } =
        await import("../../services/pricing/ai-pricing.service");

      const result = await AIPricingService.calculateAIPricingMultiplier({
        flightId: 999,
        cabinClass: "economy",
        requestedSeats: 1,
      });

      // When DB is null, all sub-services return defaults
      // demandMultiplier should fallback to 1.0, segment to 1.0, etc.
      expect(result.aiMultiplier).toBeGreaterThanOrEqual(0.75);
      expect(result.aiMultiplier).toBeLessThanOrEqual(2.0);
    });

    it("should still produce a result without userId", async () => {
      const { AIPricingService } =
        await import("../../services/pricing/ai-pricing.service");

      const result = await AIPricingService.calculateAIPricingMultiplier({
        flightId: 1,
        cabinClass: "business",
        requestedSeats: 2,
        // No userId or sessionId
      });

      // Should work without user context (segment multiplier defaults to 1.0)
      expect(result.metadata.customerSegment).toBeNull();
    });

    it("should return cached result on second call", async () => {
      const cachedResult = {
        aiMultiplier: 1.15,
        components: {
          demandMultiplier: 1.2,
          segmentMultiplier: 0.95,
          optimizationMultiplier: 1.1,
          abTestMultiplier: 1.0,
        },
        metadata: {
          demandForecast: 42,
          customerSegment: "Frequent Flyer",
          abTestVariant: null,
          optimizationGoal: "balance",
          confidence: 0.8,
        },
      };

      mockCacheGet.mockImplementation(async (key: string) => {
        if (key.startsWith("ai_pricing:")) return cachedResult;
        return null;
      });

      const { AIPricingService } =
        await import("../../services/pricing/ai-pricing.service");

      const result = await AIPricingService.calculateAIPricingMultiplier({
        flightId: 1,
        cabinClass: "economy",
        requestedSeats: 1,
      });

      expect(result).toEqual(cachedResult);
    });
  });

  describe("Dashboard Data", () => {
    it("should return empty/default dashboard when DB is unavailable", async () => {
      const { AIPricingService } =
        await import("../../services/pricing/ai-pricing.service");

      const dashboard = await AIPricingService.getAIDashboardData();

      expect(dashboard.demandForecasts).toEqual([]);
      expect(dashboard.recentOptimizations).toEqual([]);
      expect(dashboard.revenueMetrics).toBeDefined();
      expect(dashboard.revenueMetrics.totalRevenue).toBe(0);
    });

    it("should handle partial data gracefully in dashboard", async () => {
      const { AIPricingService } =
        await import("../../services/pricing/ai-pricing.service");

      const dashboard = await AIPricingService.getAIDashboardData();

      // Segment distribution should be empty but defined
      expect(Array.isArray(dashboard.segmentDistribution)).toBe(true);
      expect(Array.isArray(dashboard.activeTests)).toBe(true);
    });
  });

  describe("Multiplier Precision", () => {
    it("should round to 4 decimal places", () => {
      const rawMultiplier = 1.12345678;
      const rounded = Math.round(rawMultiplier * 10000) / 10000;
      expect(rounded).toBe(1.1235);
    });

    it("should handle exact values without rounding error", () => {
      const multiplier = 1.0;
      const rounded = Math.round(multiplier * 10000) / 10000;
      expect(rounded).toBe(1.0);
    });
  });

  describe("End-to-End Scenarios", () => {
    it("Scenario: Peak season flight, high occupancy, business traveler", () => {
      // Demand multiplier high (peak season)
      // Optimization suggests increase
      // Segment: business traveler (willing to pay more)
      // No A/B test
      const result = calculateCombinedMultiplier(1.4, 1.2, 1.05, 1.0);
      // 0.49 + 0.36 + 0.21 + 0.15 = 1.21
      expect(result).toBeCloseTo(1.21);
      expect(result).toBeGreaterThan(1.0);
    });

    it("Scenario: Off-season, low occupancy, price-sensitive customer", () => {
      // Demand multiplier low
      // Optimization suggests decrease
      // Segment: price sensitive (discount)
      // No A/B test
      const result = calculateCombinedMultiplier(0.8, 0.85, 0.92, 1.0);
      // 0.28 + 0.255 + 0.184 + 0.15 = 0.869
      expect(result).toBeCloseTo(0.869);
      expect(result).toBeLessThan(1.0);
      expect(result).toBeGreaterThanOrEqual(0.75);
    });

    it("Scenario: Normal conditions, A/B test with 10% increase", () => {
      // All normal except A/B test applies 10% increase
      const result = calculateCombinedMultiplier(1.0, 1.0, 1.0, 1.1);
      // 0.35 + 0.30 + 0.20 + 0.165 = 1.015
      expect(result).toBeCloseTo(1.015);
    });

    it("Scenario: Last-minute high-demand flight, premium customer", () => {
      const result = calculateCombinedMultiplier(1.8, 1.5, 1.0, 1.0);
      // 0.63 + 0.45 + 0.20 + 0.15 = 1.43
      expect(result).toBeCloseTo(1.43);
      expect(result).toBeLessThanOrEqual(2.0);
    });

    it("Scenario: Extreme - all components push maximum increase", () => {
      const result = calculateCombinedMultiplier(2.5, 2.5, 1.1, 1.5);
      // 0.875 + 0.75 + 0.22 + 0.225 = 2.07 → capped to 2.0
      expect(result).toBe(2.0);
    });

    it("Scenario: Extreme - all components push maximum decrease", () => {
      const result = calculateCombinedMultiplier(0.5, 0.5, 0.85, 0.8);
      // 0.175 + 0.15 + 0.17 + 0.12 = 0.615 → floored to 0.75
      expect(result).toBe(0.75);
    });
  });
});
