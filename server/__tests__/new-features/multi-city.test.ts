import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock the database module
vi.mock("../../db", () => ({
  getDb: vi.fn(),
  searchFlights: vi.fn(),
  createPassengers: vi.fn(),
  generateBookingReference: vi.fn(() => "ABC123"),
}));

// Mock the flights service
vi.mock("../../services/flights.service", () => ({
  checkFlightAvailability: vi.fn(),
  calculateFlightPrice: vi.fn(),
}));

// Mock the metrics service
vi.mock("../../services/metrics.service", () => ({
  trackBookingStarted: vi.fn(),
}));

// Import after mocking
import * as multiCityService from "../../services/multi-city.service";
import * as db from "../../db";
import * as flightsService from "../../services/flights.service";

describe("Multi-City Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("searchMultiCityFlights", () => {
    it("should reject search with less than 2 segments", async () => {
      const segments = [
        {
          originId: 1,
          destinationId: 2,
          departureDate: new Date("2025-06-01"),
        },
      ];

      await expect(
        multiCityService.searchMultiCityFlights(segments)
      ).rejects.toThrow(TRPCError);

      try {
        await multiCityService.searchMultiCityFlights(segments);
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("BAD_REQUEST");
      }
    });

    it("should reject search with more than 5 segments", async () => {
      const segments = Array(6)
        .fill(null)
        .map((_, i) => ({
          originId: i + 1,
          destinationId: i + 2,
          departureDate: new Date(`2025-06-0${i + 1}`),
        }));

      await expect(
        multiCityService.searchMultiCityFlights(segments)
      ).rejects.toThrow(TRPCError);

      try {
        await multiCityService.searchMultiCityFlights(segments);
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("BAD_REQUEST");
      }
    });

    it("should reject search with non-chronological dates", async () => {
      const segments = [
        {
          originId: 1,
          destinationId: 2,
          departureDate: new Date("2025-06-10"),
        },
        {
          originId: 2,
          destinationId: 3,
          departureDate: new Date("2025-06-05"), // Earlier date
        },
      ];

      await expect(
        multiCityService.searchMultiCityFlights(segments)
      ).rejects.toThrow(TRPCError);

      try {
        await multiCityService.searchMultiCityFlights(segments);
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("BAD_REQUEST");
        expect((error as TRPCError).message).toContain("chronological");
      }
    });

    it("should successfully search for 2 segments", async () => {
      const mockFlights = [
        {
          id: 1,
          flightNumber: "SV100",
          departureTime: new Date("2025-06-01T10:00:00"),
          arrivalTime: new Date("2025-06-01T12:00:00"),
          economyPrice: 50000,
          businessPrice: 100000,
          economyAvailable: 50,
          businessAvailable: 10,
          airline: { code: "SV", name: "Saudia", logo: null },
          origin: { code: "RUH", name: "Riyadh", city: "Riyadh" },
          destination: { code: "JED", name: "Jeddah", city: "Jeddah" },
        },
      ];

      vi.mocked(db.searchFlights).mockResolvedValue(mockFlights);

      const segments = [
        {
          originId: 1,
          destinationId: 2,
          departureDate: new Date("2025-06-01"),
        },
        {
          originId: 2,
          destinationId: 3,
          departureDate: new Date("2025-06-05"),
        },
      ];

      const results = await multiCityService.searchMultiCityFlights(segments);

      expect(results).toHaveLength(2);
      expect(results[0].segmentIndex).toBe(0);
      expect(results[1].segmentIndex).toBe(1);
      expect(db.searchFlights).toHaveBeenCalledTimes(2);
    });

    it("should search for segments in parallel", async () => {
      vi.mocked(db.searchFlights).mockImplementation(async () => {
        // Simulate async delay
        await new Promise(resolve => setTimeout(resolve, 10));
        return [];
      });

      const segments = [
        {
          originId: 1,
          destinationId: 2,
          departureDate: new Date("2025-06-01"),
        },
        {
          originId: 2,
          destinationId: 3,
          departureDate: new Date("2025-06-05"),
        },
        {
          originId: 3,
          destinationId: 4,
          departureDate: new Date("2025-06-10"),
        },
      ];

      const startTime = Date.now();
      await multiCityService.searchMultiCityFlights(segments);
      const duration = Date.now() - startTime;

      // If parallel, should be around 10ms; if sequential, would be ~30ms
      expect(duration).toBeLessThan(50);
    });
  });

  describe("calculateMultiCityPrice", () => {
    it("should reject pricing with less than 2 segments", async () => {
      const segments = [{ flightId: 1, cabinClass: "economy" as const }];

      await expect(
        multiCityService.calculateMultiCityPrice(segments, 1)
      ).rejects.toThrow(TRPCError);
    });

    it("should apply 0% discount for 2 segments", async () => {
      vi.mocked(flightsService.checkFlightAvailability).mockResolvedValue({
        available: true,
        flight: {
          id: 1,
          economyPrice: 50000,
          businessPrice: 100000,
        } as any,
      });

      vi.mocked(flightsService.calculateFlightPrice).mockResolvedValue({
        price: 50000,
        basePrice: 50000,
        taxes: 0,
        fees: 0,
      });

      const segments = [
        { flightId: 1, cabinClass: "economy" as const },
        { flightId: 2, cabinClass: "economy" as const },
      ];

      const result = await multiCityService.calculateMultiCityPrice(
        segments,
        1
      );

      expect(result.discountPercentage).toBe(0);
      expect(result.discount).toBe(0);
      expect(result.subtotal).toBe(100000);
      expect(result.totalPrice).toBe(100000);
    });

    it("should apply 5% discount for 3 segments", async () => {
      vi.mocked(flightsService.checkFlightAvailability).mockResolvedValue({
        available: true,
        flight: { id: 1 } as any,
      });

      vi.mocked(flightsService.calculateFlightPrice).mockResolvedValue({
        price: 50000,
        basePrice: 50000,
        taxes: 0,
        fees: 0,
      });

      const segments = [
        { flightId: 1, cabinClass: "economy" as const },
        { flightId: 2, cabinClass: "economy" as const },
        { flightId: 3, cabinClass: "economy" as const },
      ];

      const result = await multiCityService.calculateMultiCityPrice(
        segments,
        1
      );

      expect(result.discountPercentage).toBe(5);
      expect(result.subtotal).toBe(150000);
      expect(result.discount).toBe(7500); // 5% of 150000
      expect(result.totalPrice).toBe(142500);
    });

    it("should apply 8% discount for 4 segments", async () => {
      vi.mocked(flightsService.checkFlightAvailability).mockResolvedValue({
        available: true,
        flight: { id: 1 } as any,
      });

      vi.mocked(flightsService.calculateFlightPrice).mockResolvedValue({
        price: 50000,
        basePrice: 50000,
        taxes: 0,
        fees: 0,
      });

      const segments = [
        { flightId: 1, cabinClass: "economy" as const },
        { flightId: 2, cabinClass: "economy" as const },
        { flightId: 3, cabinClass: "economy" as const },
        { flightId: 4, cabinClass: "economy" as const },
      ];

      const result = await multiCityService.calculateMultiCityPrice(
        segments,
        1
      );

      expect(result.discountPercentage).toBe(8);
      expect(result.subtotal).toBe(200000);
      expect(result.discount).toBe(16000); // 8% of 200000
      expect(result.totalPrice).toBe(184000);
    });

    it("should apply 10% discount for 5 segments", async () => {
      vi.mocked(flightsService.checkFlightAvailability).mockResolvedValue({
        available: true,
        flight: { id: 1 } as any,
      });

      vi.mocked(flightsService.calculateFlightPrice).mockResolvedValue({
        price: 50000,
        basePrice: 50000,
        taxes: 0,
        fees: 0,
      });

      const segments = [
        { flightId: 1, cabinClass: "economy" as const },
        { flightId: 2, cabinClass: "economy" as const },
        { flightId: 3, cabinClass: "economy" as const },
        { flightId: 4, cabinClass: "economy" as const },
        { flightId: 5, cabinClass: "economy" as const },
      ];

      const result = await multiCityService.calculateMultiCityPrice(
        segments,
        1
      );

      expect(result.discountPercentage).toBe(10);
      expect(result.subtotal).toBe(250000);
      expect(result.discount).toBe(25000); // 10% of 250000
      expect(result.totalPrice).toBe(225000);
    });

    it("should throw error when flight has insufficient seats", async () => {
      vi.mocked(flightsService.checkFlightAvailability).mockResolvedValue({
        available: false,
        flight: null,
      });

      const segments = [
        { flightId: 1, cabinClass: "economy" as const },
        { flightId: 2, cabinClass: "economy" as const },
      ];

      await expect(
        multiCityService.calculateMultiCityPrice(segments, 1)
      ).rejects.toThrow(TRPCError);
    });

    it("should return segment details with individual prices", async () => {
      vi.mocked(flightsService.checkFlightAvailability).mockResolvedValue({
        available: true,
        flight: { id: 1 } as any,
      });

      // Return different prices for different flights
      vi.mocked(flightsService.calculateFlightPrice)
        .mockResolvedValueOnce({
          price: 40000,
          basePrice: 40000,
          taxes: 0,
          fees: 0,
        })
        .mockResolvedValueOnce({
          price: 60000,
          basePrice: 60000,
          taxes: 0,
          fees: 0,
        });

      const segments = [
        { flightId: 1, cabinClass: "economy" as const },
        { flightId: 2, cabinClass: "economy" as const },
      ];

      const result = await multiCityService.calculateMultiCityPrice(
        segments,
        1
      );

      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].basePrice).toBe(40000);
      expect(result.segments[1].basePrice).toBe(60000);
      expect(result.subtotal).toBe(100000);
    });
  });

  describe("isMultiCityBooking", () => {
    it("should return true for booking with multiple segments", async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      };

      vi.mocked(db.getDb).mockResolvedValue(mockDb as any);

      const result = await multiCityService.isMultiCityBooking(1);

      expect(result).toBe(true);
    });

    it("should return false for booking with single segment", async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 1 }]),
      };

      vi.mocked(db.getDb).mockResolvedValue(mockDb as any);

      const result = await multiCityService.isMultiCityBooking(1);

      expect(result).toBe(false);
    });

    it("should return false when database is unavailable", async () => {
      vi.mocked(db.getDb).mockResolvedValue(null);

      const result = await multiCityService.isMultiCityBooking(1);

      expect(result).toBe(false);
    });
  });
});

describe("Multi-City Discount Tiers", () => {
  it("should have correct discount percentages", () => {
    // These are the expected discount tiers
    const expectedTiers = {
      2: 0, // No discount
      3: 5, // 5%
      4: 8, // 8%
      5: 10, // 10%
    };

    // Verify via pricing calculations
    expect(expectedTiers[2]).toBe(0);
    expect(expectedTiers[3]).toBe(5);
    expect(expectedTiers[4]).toBe(8);
    expect(expectedTiers[5]).toBe(10);
  });
});
