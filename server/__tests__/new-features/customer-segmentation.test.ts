import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  CustomerMetrics,
  RFMScores,
  SegmentAssignment,
} from "../../services/pricing/customer-segmentation.service";

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
  users: { id: "id", status: "status" },
  bookings: {
    id: "id",
    userId: "userId",
    flightId: "flightId",
    status: "status",
    cabinClass: "cabinClass",
    totalAmount: "totalAmount",
    numberOfPassengers: "numberOfPassengers",
    createdAt: "createdAt",
  },
  flights: {
    id: "id",
    departureTime: "departureTime",
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
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ type: "eq", a, b })),
  and: vi.fn((...args) => ({ type: "and", args })),
  count: vi.fn(() => "count"),
  desc: vi.fn(a => ({ type: "desc", a })),
}));

// ============================================================================
// RFM Scoring (mirrors internal calculateRFMScores logic)
// ============================================================================
const RECENCY_THRESHOLDS = [7, 30, 90, 180];
const FREQUENCY_THRESHOLDS = [1, 3, 6, 12];
const MONETARY_THRESHOLDS = [50000, 150000, 400000, 1000000];

function calculateRFMScores(metrics: CustomerMetrics): RFMScores {
  const recency =
    metrics.daysSinceLastBooking <= RECENCY_THRESHOLDS[0]
      ? 5
      : metrics.daysSinceLastBooking <= RECENCY_THRESHOLDS[1]
        ? 4
        : metrics.daysSinceLastBooking <= RECENCY_THRESHOLDS[2]
          ? 3
          : metrics.daysSinceLastBooking <= RECENCY_THRESHOLDS[3]
            ? 2
            : 1;

  const annualBookings = metrics.bookingsLast365Days;
  const frequency =
    annualBookings >= FREQUENCY_THRESHOLDS[3]
      ? 5
      : annualBookings >= FREQUENCY_THRESHOLDS[2]
        ? 4
        : annualBookings >= FREQUENCY_THRESHOLDS[1]
          ? 3
          : annualBookings >= FREQUENCY_THRESHOLDS[0]
            ? 2
            : 1;

  const monetary =
    metrics.totalSpending >= MONETARY_THRESHOLDS[3]
      ? 5
      : metrics.totalSpending >= MONETARY_THRESHOLDS[2]
        ? 4
        : metrics.totalSpending >= MONETARY_THRESHOLDS[1]
          ? 3
          : metrics.totalSpending >= MONETARY_THRESHOLDS[0]
            ? 2
            : 1;

  return {
    recency,
    frequency,
    monetary,
    totalScore: recency + frequency + monetary,
  };
}

// ============================================================================
// Auto-assign segments (mirrors internal autoAssignSegments logic)
// ============================================================================
function autoAssignSegments(
  metrics: CustomerMetrics,
  rfm: RFMScores
): SegmentAssignment[] {
  const assignments: SegmentAssignment[] = [];

  if (rfm.totalScore >= 12) {
    assignments.push({
      segmentId: 0,
      segmentName: "Premium Traveler",
      segmentType: "premium",
      score: rfm.totalScore / 15,
      priceMultiplier: 1.0,
    });
  }

  if (rfm.frequency >= 4) {
    assignments.push({
      segmentId: 0,
      segmentName: "Frequent Flyer",
      segmentType: "frequency",
      score: rfm.frequency / 5,
      priceMultiplier: 0.95,
    });
  }

  if (metrics.priceSensitivityScore > 0.7) {
    assignments.push({
      segmentId: 0,
      segmentName: "Price Sensitive",
      segmentType: "price_sensitive",
      score: metrics.priceSensitivityScore,
      priceMultiplier: 0.92,
    });
  }

  if (rfm.monetary >= 4) {
    assignments.push({
      segmentId: 0,
      segmentName: "High Value",
      segmentType: "value",
      score: rfm.monetary / 5,
      priceMultiplier: 0.97,
    });
  }

  if (metrics.avgLeadTimeDays < 7 && metrics.avgBookingValue > 200000) {
    assignments.push({
      segmentId: 0,
      segmentName: "Business Traveler",
      segmentType: "corporate",
      score: 0.8,
      priceMultiplier: 1.05,
    });
  }

  if (rfm.recency <= 2 && rfm.frequency >= 3) {
    assignments.push({
      segmentId: 0,
      segmentName: "Lapsed Customer",
      segmentType: "behavior",
      score: 0.6,
      priceMultiplier: 0.88,
    });
  }

  return assignments;
}

// ============================================================================
// Pricing adjustment calculation (mirrors internal calculatePricingAdjustment)
// ============================================================================
function calculatePricingAdjustment(segments: SegmentAssignment[]): number {
  if (segments.length === 0) return 1.0;

  let totalWeight = 0;
  let weightedMultiplier = 0;

  for (const seg of segments) {
    weightedMultiplier += seg.priceMultiplier * seg.score;
    totalWeight += seg.score;
  }

  const baseMultiplier =
    totalWeight > 0 ? weightedMultiplier / totalWeight : 1.0;
  return Math.min(1.1, Math.max(0.85, baseMultiplier));
}

// ============================================================================
// Price sensitivity (mirrors internal calculatePriceSensitivity)
// ============================================================================
function calculatePriceSensitivity(
  userBookings: {
    totalAmount: number | null;
    status: string | null;
    createdAt: Date;
    departureTime: Date | null;
  }[]
): number {
  if (userBookings.length < 2) return 0.5;

  const confirmedBookings = userBookings.filter(
    b => b.status !== "cancelled" && b.totalAmount
  );
  if (confirmedBookings.length < 2) return 0.5;

  const amounts = confirmedBookings.map(b => b.totalAmount!);
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance =
    amounts.reduce((sum, a) => sum + (a - mean) ** 2, 0) / amounts.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  const leadTimes = confirmedBookings
    .filter(b => b.departureTime)
    .map(b => {
      const dep = b.departureTime as Date;
      return (dep.getTime() - b.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    });
  const avgLeadTime =
    leadTimes.length > 0
      ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
      : 14;

  const leadTimeFactor = Math.min(avgLeadTime / 60, 1);
  const varianceFactor = Math.min(cv, 1);

  return Math.min(1, leadTimeFactor * 0.4 + varianceFactor * 0.6);
}

// ============================================================================
// Tests
// ============================================================================

describe("Customer Segmentation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseMetrics: CustomerMetrics = {
    daysSinceLastBooking: 5,
    lastBookingDate: new Date("2026-01-01"),
    totalBookings: 15,
    bookingsLast90Days: 4,
    bookingsLast365Days: 12,
    avgBookingsPerMonth: 1.25,
    totalSpending: 1200000,
    avgBookingValue: 80000,
    maxBookingValue: 250000,
    avgLeadTimeDays: 14,
    preferredCabinClass: "economy",
    cancellationRate: 0.05,
    ancillaryPurchaseRate: 0.3,
    priceSensitivityScore: 0.3,
    avgPriceLevel: 1.0,
  };

  describe("RFM Scoring", () => {
    it("should give score 5 for recency <= 7 days", () => {
      const rfm = calculateRFMScores({
        ...baseMetrics,
        daysSinceLastBooking: 3,
      });
      expect(rfm.recency).toBe(5);
    });

    it("should give score 4 for recency 8-30 days", () => {
      const rfm = calculateRFMScores({
        ...baseMetrics,
        daysSinceLastBooking: 15,
      });
      expect(rfm.recency).toBe(4);
    });

    it("should give score 3 for recency 31-90 days", () => {
      const rfm = calculateRFMScores({
        ...baseMetrics,
        daysSinceLastBooking: 60,
      });
      expect(rfm.recency).toBe(3);
    });

    it("should give score 2 for recency 91-180 days", () => {
      const rfm = calculateRFMScores({
        ...baseMetrics,
        daysSinceLastBooking: 120,
      });
      expect(rfm.recency).toBe(2);
    });

    it("should give score 1 for recency > 180 days", () => {
      const rfm = calculateRFMScores({
        ...baseMetrics,
        daysSinceLastBooking: 365,
      });
      expect(rfm.recency).toBe(1);
    });

    it("should score frequency 5 for >= 12 bookings/year", () => {
      const rfm = calculateRFMScores({
        ...baseMetrics,
        bookingsLast365Days: 15,
      });
      expect(rfm.frequency).toBe(5);
    });

    it("should score frequency 4 for 6-11 bookings/year", () => {
      const rfm = calculateRFMScores({
        ...baseMetrics,
        bookingsLast365Days: 8,
      });
      expect(rfm.frequency).toBe(4);
    });

    it("should score frequency 1 for 0 bookings/year", () => {
      const rfm = calculateRFMScores({
        ...baseMetrics,
        bookingsLast365Days: 0,
      });
      expect(rfm.frequency).toBe(1);
    });

    it("should score monetary 5 for >= 1,000,000 SAR cents", () => {
      const rfm = calculateRFMScores({
        ...baseMetrics,
        totalSpending: 1500000,
      });
      expect(rfm.monetary).toBe(5);
    });

    it("should score monetary 1 for < 50,000 SAR cents", () => {
      const rfm = calculateRFMScores({ ...baseMetrics, totalSpending: 30000 });
      expect(rfm.monetary).toBe(1);
    });

    it("should have totalScore = recency + frequency + monetary", () => {
      const rfm = calculateRFMScores(baseMetrics);
      expect(rfm.totalScore).toBe(rfm.recency + rfm.frequency + rfm.monetary);
    });

    it("should range totalScore between 3 and 15", () => {
      // Best case
      const bestRfm = calculateRFMScores({
        ...baseMetrics,
        daysSinceLastBooking: 1,
        bookingsLast365Days: 20,
        totalSpending: 2000000,
      });
      expect(bestRfm.totalScore).toBe(15);

      // Worst case
      const worstRfm = calculateRFMScores({
        ...baseMetrics,
        daysSinceLastBooking: 400,
        bookingsLast365Days: 0,
        totalSpending: 10000,
      });
      expect(worstRfm.totalScore).toBe(3);
    });
  });

  describe("Auto Segment Assignment", () => {
    it("should assign Premium Traveler for totalScore >= 12", () => {
      const rfm = { recency: 5, frequency: 5, monetary: 4, totalScore: 14 };
      const segments = autoAssignSegments(baseMetrics, rfm);
      expect(
        segments.find(s => s.segmentName === "Premium Traveler")
      ).toBeDefined();
    });

    it("should NOT assign Premium Traveler for totalScore < 12", () => {
      const rfm = { recency: 3, frequency: 3, monetary: 3, totalScore: 9 };
      const segments = autoAssignSegments(baseMetrics, rfm);
      expect(
        segments.find(s => s.segmentName === "Premium Traveler")
      ).toBeUndefined();
    });

    it("should assign Frequent Flyer for frequency >= 4", () => {
      const rfm = { recency: 3, frequency: 4, monetary: 3, totalScore: 10 };
      const segments = autoAssignSegments(baseMetrics, rfm);
      expect(
        segments.find(s => s.segmentName === "Frequent Flyer")
      ).toBeDefined();
      expect(
        segments.find(s => s.segmentName === "Frequent Flyer")!.priceMultiplier
      ).toBe(0.95);
    });

    it("should assign Price Sensitive for priceSensitivity > 0.7", () => {
      const metrics = { ...baseMetrics, priceSensitivityScore: 0.85 };
      const rfm = { recency: 3, frequency: 3, monetary: 3, totalScore: 9 };
      const segments = autoAssignSegments(metrics, rfm);
      expect(
        segments.find(s => s.segmentName === "Price Sensitive")
      ).toBeDefined();
      expect(
        segments.find(s => s.segmentName === "Price Sensitive")!.priceMultiplier
      ).toBe(0.92);
    });

    it("should assign High Value for monetary >= 4", () => {
      const rfm = { recency: 3, frequency: 3, monetary: 5, totalScore: 11 };
      const segments = autoAssignSegments(baseMetrics, rfm);
      expect(segments.find(s => s.segmentName === "High Value")).toBeDefined();
    });

    it("should assign Business Traveler for short lead + high value", () => {
      const metrics = {
        ...baseMetrics,
        avgLeadTimeDays: 3,
        avgBookingValue: 300000,
      };
      const rfm = { recency: 3, frequency: 3, monetary: 3, totalScore: 9 };
      const segments = autoAssignSegments(metrics, rfm);
      expect(
        segments.find(s => s.segmentName === "Business Traveler")
      ).toBeDefined();
      expect(
        segments.find(s => s.segmentName === "Business Traveler")!
          .priceMultiplier
      ).toBe(1.05);
    });

    it("should assign Lapsed Customer for low recency + high frequency", () => {
      const metrics = { ...baseMetrics, daysSinceLastBooking: 200 };
      const rfm = { recency: 1, frequency: 4, monetary: 3, totalScore: 8 };
      const segments = autoAssignSegments(metrics, rfm);
      expect(
        segments.find(s => s.segmentName === "Lapsed Customer")
      ).toBeDefined();
      expect(
        segments.find(s => s.segmentName === "Lapsed Customer")!.priceMultiplier
      ).toBe(0.88);
    });

    it("should allow multiple segment assignments", () => {
      const metrics = {
        ...baseMetrics,
        daysSinceLastBooking: 1,
        bookingsLast365Days: 20,
        totalSpending: 2000000,
        priceSensitivityScore: 0.1,
      };
      const rfm = { recency: 5, frequency: 5, monetary: 5, totalScore: 15 };
      const segments = autoAssignSegments(metrics, rfm);

      expect(segments.length).toBeGreaterThan(1);
      expect(
        segments.find(s => s.segmentName === "Premium Traveler")
      ).toBeDefined();
      expect(
        segments.find(s => s.segmentName === "Frequent Flyer")
      ).toBeDefined();
      expect(segments.find(s => s.segmentName === "High Value")).toBeDefined();
    });
  });

  describe("Pricing Adjustment", () => {
    it("should return 1.0 for no segments", () => {
      expect(calculatePricingAdjustment([])).toBe(1.0);
    });

    it("should never go below 0.85 (max 15% discount)", () => {
      const heavyDiscountSegments: SegmentAssignment[] = [
        {
          segmentId: 0,
          segmentName: "Super Discount",
          segmentType: "test",
          score: 1.0,
          priceMultiplier: 0.5, // 50% discount requested
        },
      ];
      expect(calculatePricingAdjustment(heavyDiscountSegments)).toBe(0.85);
    });

    it("should never exceed 1.1 (max 10% increase)", () => {
      const premiumSegments: SegmentAssignment[] = [
        {
          segmentId: 0,
          segmentName: "Premium",
          segmentType: "test",
          score: 1.0,
          priceMultiplier: 1.5,
        },
      ];
      expect(calculatePricingAdjustment(premiumSegments)).toBe(1.1);
    });

    it("should calculate weighted average by score", () => {
      const segments: SegmentAssignment[] = [
        {
          segmentId: 0,
          segmentName: "Frequent Flyer",
          segmentType: "frequency",
          score: 0.8,
          priceMultiplier: 0.95,
        },
        {
          segmentId: 0,
          segmentName: "High Value",
          segmentType: "value",
          score: 1.0,
          priceMultiplier: 0.97,
        },
      ];

      const result = calculatePricingAdjustment(segments);
      // Weighted: (0.95*0.8 + 0.97*1.0) / (0.8 + 1.0) = (0.76 + 0.97) / 1.8 = 0.9611
      expect(result).toBeCloseTo(0.9611, 3);
    });
  });

  describe("Price Sensitivity Calculation", () => {
    it("should return 0.5 for less than 2 bookings", () => {
      expect(calculatePriceSensitivity([])).toBe(0.5);
      expect(
        calculatePriceSensitivity([
          {
            totalAmount: 50000,
            status: "confirmed",
            createdAt: new Date(),
            departureTime: new Date(),
          },
        ])
      ).toBe(0.5);
    });

    it("should return 0.5 when all bookings are cancelled", () => {
      const bookings = [
        {
          totalAmount: 50000,
          status: "cancelled",
          createdAt: new Date(),
          departureTime: new Date(),
        },
        {
          totalAmount: 80000,
          status: "cancelled",
          createdAt: new Date(),
          departureTime: new Date(),
        },
      ];
      expect(calculatePriceSensitivity(bookings)).toBe(0.5);
    });

    it("should detect high price sensitivity from booking variance", () => {
      const bookings = [
        {
          totalAmount: 20000,
          status: "confirmed",
          createdAt: new Date("2026-01-01"),
          departureTime: new Date("2026-03-01"),
        },
        {
          totalAmount: 200000,
          status: "confirmed",
          createdAt: new Date("2026-01-15"),
          departureTime: new Date("2026-05-01"),
        },
        {
          totalAmount: 15000,
          status: "confirmed",
          createdAt: new Date("2026-02-01"),
          departureTime: new Date("2026-06-01"),
        },
      ];
      const sensitivity = calculatePriceSensitivity(bookings);
      // High variance in amounts + moderate lead time → higher sensitivity
      expect(sensitivity).toBeGreaterThan(0.5);
    });

    it("should detect low price sensitivity from uniform amounts", () => {
      const bookings = [
        {
          totalAmount: 100000,
          status: "confirmed",
          createdAt: new Date("2026-01-01"),
          departureTime: new Date("2026-01-05"), // Short lead time
        },
        {
          totalAmount: 100000,
          status: "confirmed",
          createdAt: new Date("2026-01-10"),
          departureTime: new Date("2026-01-14"), // Short lead time
        },
        {
          totalAmount: 100000,
          status: "confirmed",
          createdAt: new Date("2026-01-20"),
          departureTime: new Date("2026-01-24"), // Short lead time
        },
      ];
      const sensitivity = calculatePriceSensitivity(bookings);
      // Zero variance + short lead time → very low sensitivity
      expect(sensitivity).toBeLessThan(0.15);
    });

    it("should factor in lead time (longer lead = more sensitive)", () => {
      // Same spending pattern but different lead times
      const shortLead = [
        {
          totalAmount: 100000,
          status: "confirmed",
          createdAt: new Date("2026-01-01"),
          departureTime: new Date("2026-01-03"),
        },
        {
          totalAmount: 150000,
          status: "confirmed",
          createdAt: new Date("2026-01-10"),
          departureTime: new Date("2026-01-12"),
        },
      ];

      const longLead = [
        {
          totalAmount: 100000,
          status: "confirmed",
          createdAt: new Date("2026-01-01"),
          departureTime: new Date("2026-04-01"),
        },
        {
          totalAmount: 150000,
          status: "confirmed",
          createdAt: new Date("2026-01-10"),
          departureTime: new Date("2026-05-10"),
        },
      ];

      const shortSensitivity = calculatePriceSensitivity(shortLead);
      const longSensitivity = calculatePriceSensitivity(longLead);

      expect(longSensitivity).toBeGreaterThan(shortSensitivity);
    });
  });

  describe("Service API (DB unavailable)", () => {
    it("should return default profile when DB is unavailable", async () => {
      const { CustomerSegmentationService } =
        await import("../../services/pricing/customer-segmentation.service");

      const profile = await CustomerSegmentationService.getCustomerProfile(1);

      expect(profile.userId).toBe(1);
      expect(profile.pricingAdjustment).toBe(1.0);
      expect(profile.segments).toEqual([]);
    });

    it("should return 1.0 multiplier when DB is unavailable", async () => {
      const { CustomerSegmentationService } =
        await import("../../services/pricing/customer-segmentation.service");

      const multiplier =
        await CustomerSegmentationService.getUserPricingMultiplier(1);

      expect(multiplier).toBe(1.0);
    });

    it("should return empty segments when DB is unavailable", async () => {
      const { CustomerSegmentationService } =
        await import("../../services/pricing/customer-segmentation.service");

      const segments = await CustomerSegmentationService.getSegments();
      expect(segments).toEqual([]);
    });
  });
});
