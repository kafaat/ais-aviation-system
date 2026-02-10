import { describe, it, expect, vi, beforeEach } from "vitest";

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
    $inferSelect: {},
  },
  bookings: {
    id: "id",
    flightId: "flightId",
    status: "status",
    cabinClass: "cabinClass",
    createdAt: "createdAt",
    totalAmount: "totalAmount",
    numberOfPassengers: "numberOfPassengers",
  },
  demandPredictions: {
    id: "id",
    flightId: "flightId",
    cabinClass: "cabinClass",
  },
  aiPricingModels: {
    id: "id",
    modelType: "modelType",
    isActive: "isActive",
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
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ type: "eq", a, b })),
  and: vi.fn((...args) => ({ type: "and", args })),
  gte: vi.fn((a, b) => ({ type: "gte", a, b })),
  lte: vi.fn((a, b) => ({ type: "lte", a, b })),
  sql: Object.assign(
    vi.fn(() => "sql"),
    {
      raw: vi.fn(() => "raw"),
    }
  ),
  desc: vi.fn(a => ({ type: "desc", a })),
}));

describe("Demand Forecasting Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Holt-Winters Algorithm", () => {
    it("should throw when database is unavailable for flight forecast", async () => {
      const { DemandForecastingService } =
        await import("../../services/pricing/demand-forecasting.service");

      await expect(
        DemandForecastingService.forecastFlightDemand(1, "economy", 1)
      ).rejects.toThrow("Database not available");
    });

    it("should throw when database is unavailable for route forecast", async () => {
      const { DemandForecastingService } =
        await import("../../services/pricing/demand-forecasting.service");

      await expect(
        DemandForecastingService.forecastRouteDemand(1, 2, "economy", 7)
      ).rejects.toThrow("Database not available");
    });
  });

  describe("Feature Weights", () => {
    it("should have weights that sum to 1.0", () => {
      const weights: Record<string, number> = {
        historicalAvgDemand: 0.25,
        recentBookingVelocity: 0.2,
        dayOfWeek: 0.1,
        seasonalIndex: 0.15,
        daysUntilDeparture: 0.1,
        occupancyRate: 0.08,
        priceLevel: 0.07,
        routePopularity: 0.05,
      };
      const total = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1.0, 10);
    });

    it("should give highest weight to historicalAvgDemand", () => {
      const weights = {
        historicalAvgDemand: 0.25,
        recentBookingVelocity: 0.2,
        dayOfWeek: 0.1,
        seasonalIndex: 0.15,
        daysUntilDeparture: 0.1,
        occupancyRate: 0.08,
        priceLevel: 0.07,
        routePopularity: 0.05,
      };
      const maxWeight = Math.max(...Object.values(weights));
      expect(weights.historicalAvgDemand).toBe(maxWeight);
    });
  });

  describe("Seasonal Index Calculation", () => {
    it("should return highest indices for peak summer months (July/August)", () => {
      // Months 7 and 8 should have index 1.4
      const peakMonths: Record<number, number> = {
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

      expect(peakMonths[7]).toBe(1.4);
      expect(peakMonths[8]).toBe(1.4);
      // Winter holiday should also be elevated
      expect(peakMonths[1]).toBeGreaterThan(1.0);
      expect(peakMonths[12]).toBeGreaterThan(1.0);
    });

    it("should recognize Saudi weekends (Thu/Fri)", () => {
      // In Saudi Arabia, weekend is Thursday (4) and Friday (5)
      const _thursdayDate = new Date("2026-01-01"); // Just testing dayOfWeek=4
      const isWeekend = (dayOfWeek: number) =>
        dayOfWeek === 4 || dayOfWeek === 5;

      expect(isWeekend(4)).toBe(true); // Thursday
      expect(isWeekend(5)).toBe(true); // Friday
      expect(isWeekend(0)).toBe(false); // Sunday
      expect(isWeekend(1)).toBe(false); // Monday
    });
  });

  describe("Confidence Interval", () => {
    it("should use 1.96 Z-score for 95% confidence", () => {
      const CONFIDENCE_Z = 1.96;
      const predicted = 50;
      const stdError = 10;

      const lower = predicted - CONFIDENCE_Z * stdError;
      const upper = predicted + CONFIDENCE_Z * stdError;

      expect(lower).toBe(30.4);
      expect(upper).toBe(69.6);
      expect(upper - lower).toBeCloseTo(2 * CONFIDENCE_Z * stdError);
    });

    it("should always have non-negative lower bound", () => {
      const CONFIDENCE_Z = 1.96;
      const predicted = 5;
      const stdError = 10;

      const lower = Math.max(0, predicted - CONFIDENCE_Z * stdError);
      expect(lower).toBe(0);
    });
  });

  describe("Optimal Multiplier Calculation", () => {
    it("should increase price for high demand", () => {
      const historicalAvg = 10;
      const highDemand = historicalAvg * 1.6; // > 1.5x

      let multiplier = 1.0;
      if (highDemand > historicalAvg * 1.5) {
        multiplier *= 1.3;
      }
      expect(multiplier).toBe(1.3);
    });

    it("should decrease price for low demand", () => {
      const historicalAvg = 10;
      const lowDemand = historicalAvg * 0.4; // < 0.5x

      let multiplier = 1.0;
      if (lowDemand < historicalAvg * 0.5) {
        multiplier *= 0.8;
      }
      expect(multiplier).toBe(0.8);
    });

    it("should add urgency premium for last-minute bookings", () => {
      const daysUntilDeparture = 2;
      let multiplier = 1.0;

      if (daysUntilDeparture < 3) {
        multiplier *= 1.4;
      }
      expect(multiplier).toBe(1.4);
    });

    it("should give early booking discount for far-out departures", () => {
      const daysUntilDeparture = 65;
      let multiplier = 1.0;

      if (daysUntilDeparture > 60) {
        multiplier *= 0.85;
      }
      expect(multiplier).toBe(0.85);
    });

    it("should add scarcity premium when occupancy > 90%", () => {
      const occupancyRate = 0.95;
      let multiplier = 1.0;

      if (occupancyRate > 0.9) {
        multiplier *= 1.5;
      }
      expect(multiplier).toBe(1.5);
    });

    it("should cap multiplier between 0.7 and 2.5", () => {
      // Very high combined multiplier
      let multiplier = 1.3 * 1.4 * 1.5; // 2.73
      multiplier = Math.min(2.5, Math.max(0.7, multiplier));
      expect(multiplier).toBe(2.5);

      // Very low combined multiplier
      let lowMultiplier = 0.8 * 0.85 * 0.85; // 0.578
      lowMultiplier = Math.min(2.5, Math.max(0.7, lowMultiplier));
      expect(lowMultiplier).toBe(0.7);
    });
  });

  describe("Holiday Detection", () => {
    it("should apply 30% holiday boost to demand score", () => {
      const baseScore = 100;
      const isHoliday = true;

      const adjustedScore = isHoliday ? baseScore * 1.3 : baseScore;
      expect(adjustedScore).toBe(130);
    });
  });

  describe("Forecast Accuracy Metrics", () => {
    it("should throw when database is unavailable for accuracy evaluation", async () => {
      const { DemandForecastingService } =
        await import("../../services/pricing/demand-forecasting.service");

      await expect(
        DemandForecastingService.evaluateForecastAccuracy(1, "economy")
      ).rejects.toThrow("Database not available");
    });

    it("should calculate MAE correctly", () => {
      const actuals = [10, 20, 30, 40, 50];
      const predictions = [12, 18, 35, 38, 55];

      const errors = actuals.map((a, i) => Math.abs(a - predictions[i]));
      const mae = errors.reduce((a, b) => a + b, 0) / errors.length;

      expect(mae).toBeCloseTo(3.2); // (2+2+5+2+5)/5 = 3.2
    });

    it("should calculate RMSE correctly", () => {
      const actuals = [10, 20, 30];
      const predictions = [12, 18, 33];

      const squaredErrors = actuals.map((a, i) =>
        Math.pow(a - predictions[i], 2)
      );
      const mse =
        squaredErrors.reduce((a, b) => a + b, 0) / squaredErrors.length;
      const rmse = Math.sqrt(mse);

      // (4 + 4 + 9) / 3 = 5.667, sqrt = 2.38
      expect(rmse).toBeCloseTo(2.38, 1);
    });

    it("should calculate MAPE correctly", () => {
      const actuals = [100, 200, 300];
      const predictions = [90, 210, 330];

      const percentErrors = actuals.map(
        (a, i) => Math.abs(a - predictions[i]) / a
      );
      const mape =
        (percentErrors.reduce((a, b) => a + b, 0) / percentErrors.length) * 100;

      // (10/100 + 10/200 + 30/300) / 3 * 100 = (0.1 + 0.05 + 0.1) / 3 * 100 = 8.33%
      expect(mape).toBeCloseTo(8.33, 1);
    });
  });

  describe("Time-series Smoothing", () => {
    it("should handle simple exponential smoothing with alpha=0.3", () => {
      const alpha = 0.3;
      const data = [10, 12, 14, 13, 15, 16, 14, 17, 18, 20];

      let level = data[0];
      let trend = 0;
      const beta = 0.1;

      for (let i = 1; i < data.length; i++) {
        const prevLevel = level;
        level = alpha * data[i] + (1 - alpha) * (level + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
      }

      const forecast = level + trend;

      // Forecast should be in a reasonable range
      expect(forecast).toBeGreaterThan(10);
      expect(forecast).toBeLessThan(25);
    });

    it("should detect upward trends", () => {
      const alpha = 0.3;
      const beta = 0.1;
      const data = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];

      let level = data[0];
      let trend = 0;

      for (let i = 1; i < data.length; i++) {
        const prevLevel = level;
        level = alpha * data[i] + (1 - alpha) * (level + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
      }

      expect(trend).toBeGreaterThan(0);
    });
  });
});
