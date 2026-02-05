import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  DayPrice,
  MonthlyPriceResult,
  FlexiblePriceResult,
} from "../../services/price-calendar.service";

// Mock the database module
vi.mock("../../db", () => ({
  getDb: vi.fn(),
}));

// Mock the redis cache service
vi.mock("../../services/redis-cache.service", () => ({
  redisCacheService: {
    getRaw: vi.fn().mockResolvedValue(null),
    setRaw: vi.fn().mockResolvedValue(undefined),
  },
  CacheTTL: {
    FLIGHT_SEARCH: 300,
  },
}));

// Mock the logger
vi.mock("../../_core/logger", () => ({
  createServiceLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { getDb } from "../../db";
import * as priceCalendarService from "../../services/price-calendar.service";

describe("Price Calendar Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("getMonthlyPrices", () => {
    it("should return monthly prices with correct structure", async () => {
      // Mock flight data for a month
      const mockFlightData = [
        {
          departureDate: "2024-03-01",
          minPrice: 50000,
          maxPrice: 80000,
          avgPrice: 65000,
          flightCount: 3,
        },
        {
          departureDate: "2024-03-05",
          minPrice: 45000,
          maxPrice: 75000,
          avgPrice: 60000,
          flightCount: 2,
        },
        {
          departureDate: "2024-03-10",
          minPrice: 55000,
          maxPrice: 90000,
          avgPrice: 72500,
          flightCount: 4,
        },
      ];

      // Create a chainable mock that returns the data at the end
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockFlightData),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      const result = await priceCalendarService.getMonthlyPrices({
        originId: 1,
        destinationId: 2,
        month: 3,
        year: 2024,
        cabinClass: "economy",
      });

      expect(result).toBeDefined();
      expect(result.originId).toBe(1);
      expect(result.destinationId).toBe(2);
      expect(result.month).toBe(3);
      expect(result.year).toBe(2024);
      expect(result.cabinClass).toBe("economy");
      expect(result.prices).toHaveLength(31); // March has 31 days
      expect(result.lowestMonthPrice).toBe(45000); // Cheapest from mock data
      expect(result.highestMonthPrice).toBe(90000); // Most expensive from mock data
      expect(result.cheapestDay).toBe("2024-03-05"); // Day with lowest price
    });

    it("should handle empty results", async () => {
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      const result = await priceCalendarService.getMonthlyPrices({
        originId: 1,
        destinationId: 2,
        month: 3,
        year: 2024,
      });

      expect(result.prices).toHaveLength(31); // Still returns all days
      expect(result.lowestMonthPrice).toBeNull();
      expect(result.highestMonthPrice).toBeNull();
      expect(result.cheapestDay).toBeNull();

      // All days should have no flights
      result.prices.forEach(day => {
        expect(day.hasFlights).toBe(false);
        expect(day.lowestPrice).toBeNull();
      });
    });

    it("should default to economy cabin class", async () => {
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      const result = await priceCalendarService.getMonthlyPrices({
        originId: 1,
        destinationId: 2,
        month: 3,
        year: 2024,
      });

      expect(result.cabinClass).toBe("economy");
    });

    it("should throw error when database is not available", async () => {
      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        priceCalendarService.getMonthlyPrices({
          originId: 1,
          destinationId: 2,
          month: 3,
          year: 2024,
        })
      ).rejects.toThrow("Database not available");
    });

    it("should handle different months with correct number of days", async () => {
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      // February 2024 (leap year)
      const febResult = await priceCalendarService.getMonthlyPrices({
        originId: 1,
        destinationId: 2,
        month: 2,
        year: 2024,
      });
      expect(febResult.prices).toHaveLength(29); // Leap year

      // April
      const aprilResult = await priceCalendarService.getMonthlyPrices({
        originId: 1,
        destinationId: 2,
        month: 4,
        year: 2024,
      });
      expect(aprilResult.prices).toHaveLength(30);
    });
  });

  describe("getFlexiblePrices", () => {
    it("should return flexible prices with correct structure", async () => {
      const mockFlightData = [
        {
          departureDate: "2024-03-08",
          minPrice: 55000,
          maxPrice: 70000,
          avgPrice: 62500,
          flightCount: 2,
        },
        {
          departureDate: "2024-03-10",
          minPrice: 45000, // Cheapest
          maxPrice: 65000,
          avgPrice: 55000,
          flightCount: 3,
        },
        {
          departureDate: "2024-03-12",
          minPrice: 60000,
          maxPrice: 85000,
          avgPrice: 72500,
          flightCount: 2,
        },
      ];

      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockFlightData),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      const centerDate = new Date("2024-03-10");
      const result = await priceCalendarService.getFlexiblePrices({
        originId: 1,
        destinationId: 2,
        date: centerDate,
        flexDays: 3,
        cabinClass: "economy",
      });

      expect(result).toBeDefined();
      expect(result.originId).toBe(1);
      expect(result.destinationId).toBe(2);
      expect(result.centerDate).toBe("2024-03-10");
      expect(result.cabinClass).toBe("economy");
      expect(result.prices).toHaveLength(7); // +/- 3 days = 7 days total
      expect(result.cheapestDay).toEqual({
        date: "2024-03-10",
        price: 45000,
      });
      expect(result.priceRange.min).toBe(45000);
      expect(result.priceRange.max).toBe(85000);
    });

    it("should default to 3 flex days and economy class", async () => {
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      const result = await priceCalendarService.getFlexiblePrices({
        originId: 1,
        destinationId: 2,
        date: new Date("2024-03-10"),
      });

      expect(result.cabinClass).toBe("economy");
      expect(result.prices).toHaveLength(7); // Default 3 flex days
    });

    it("should handle no flights in flexible range", async () => {
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      const result = await priceCalendarService.getFlexiblePrices({
        originId: 1,
        destinationId: 2,
        date: new Date("2024-03-10"),
        flexDays: 3,
      });

      expect(result.cheapestDay).toBeNull();
      expect(result.priceRange.min).toBeNull();
      expect(result.priceRange.max).toBeNull();
      result.prices.forEach(day => {
        expect(day.hasFlights).toBe(false);
      });
    });

    it("should throw error when database is not available", async () => {
      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        priceCalendarService.getFlexiblePrices({
          originId: 1,
          destinationId: 2,
          date: new Date("2024-03-10"),
        })
      ).rejects.toThrow("Database not available");
    });

    it("should respect custom flex days parameter", async () => {
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      const result5Days = await priceCalendarService.getFlexiblePrices({
        originId: 1,
        destinationId: 2,
        date: new Date("2024-03-10"),
        flexDays: 5,
      });
      expect(result5Days.prices).toHaveLength(11); // +/- 5 days = 11 days

      const result1Day = await priceCalendarService.getFlexiblePrices({
        originId: 1,
        destinationId: 2,
        date: new Date("2024-03-10"),
        flexDays: 1,
      });
      expect(result1Day.prices).toHaveLength(3); // +/- 1 day = 3 days
    });
  });

  describe("getAvailableMonths", () => {
    it("should return available months with flight data", async () => {
      // Get the current date to create valid mock data
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;

      const mockMonthData = [
        { year: currentYear, month: currentMonth, flightCount: 45 },
        { year: nextYear, month: nextMonth, flightCount: 30 },
      ];

      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockMonthData),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      const result = await priceCalendarService.getAvailableMonths(1, 2, 6);

      expect(result).toHaveLength(6);
      // The first month in the result should have flights (current month)
      expect(result[0].hasFlights).toBe(true);
      // At least one month should have no flights (months beyond the mock data)
      expect(result.some(m => m.hasFlights === false)).toBe(true);
    });

    it("should throw error when database is not available", async () => {
      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        priceCalendarService.getAvailableMonths(1, 2)
      ).rejects.toThrow("Database not available");
    });

    it("should default to 12 months lookahead", async () => {
      const chainMock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };

      (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        chainMock
      );

      const result = await priceCalendarService.getAvailableMonths(1, 2);

      expect(result).toHaveLength(12);
    });
  });
});

describe("Price Calendar Data Structures", () => {
  describe("DayPrice", () => {
    it("should have correct structure for a day with flights", () => {
      const dayPrice: DayPrice = {
        date: "2024-03-15",
        lowestPrice: 45000,
        highestPrice: 80000,
        averagePrice: 62500,
        flightCount: 3,
        hasFlights: true,
      };

      expect(dayPrice.date).toBe("2024-03-15");
      expect(dayPrice.lowestPrice).toBe(45000);
      expect(dayPrice.highestPrice).toBe(80000);
      expect(dayPrice.averagePrice).toBe(62500);
      expect(dayPrice.flightCount).toBe(3);
      expect(dayPrice.hasFlights).toBe(true);
    });

    it("should have correct structure for a day without flights", () => {
      const dayPrice: DayPrice = {
        date: "2024-03-16",
        lowestPrice: null,
        highestPrice: null,
        averagePrice: null,
        flightCount: 0,
        hasFlights: false,
      };

      expect(dayPrice.lowestPrice).toBeNull();
      expect(dayPrice.hasFlights).toBe(false);
    });
  });

  describe("MonthlyPriceResult", () => {
    it("should have correct structure", () => {
      const result: MonthlyPriceResult = {
        originId: 1,
        destinationId: 2,
        month: 3,
        year: 2024,
        cabinClass: "economy",
        prices: [],
        lowestMonthPrice: 45000,
        highestMonthPrice: 90000,
        cheapestDay: "2024-03-10",
      };

      expect(result.originId).toBe(1);
      expect(result.destinationId).toBe(2);
      expect(result.cabinClass).toBe("economy");
      expect(result.cheapestDay).toBe("2024-03-10");
    });
  });

  describe("FlexiblePriceResult", () => {
    it("should have correct structure", () => {
      const result: FlexiblePriceResult = {
        originId: 1,
        destinationId: 2,
        centerDate: "2024-03-10",
        cabinClass: "business",
        prices: [],
        cheapestDay: {
          date: "2024-03-08",
          price: 95000,
        },
        priceRange: {
          min: 95000,
          max: 150000,
        },
      };

      expect(result.cabinClass).toBe("business");
      expect(result.cheapestDay?.date).toBe("2024-03-08");
      expect(result.priceRange.min).toBe(95000);
    });
  });
});
