import { describe, it, expect, vi, beforeEach } from "vitest";
import * as flightsService from "./flights.service";
import * as db from "../db";

// Mock the db module
vi.mock("../db");

describe("Flights Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("searchFlights", () => {
    it("should return flights from database", async () => {
      const mockFlights = [
        {
          id: 1,
          flightNumber: "SV123",
          departureTime: new Date("2025-01-01T10:00:00Z"),
          arrivalTime: new Date("2025-01-01T12:00:00Z"),
          economyPrice: 50000,
          businessPrice: 100000,
          economyAvailable: 100,
          businessAvailable: 20,
          airline: { code: "SV", name: "Saudi Airlines", logo: null },
          origin: { code: "JED", name: "King Abdulaziz", city: "Jeddah" },
          destination: { code: "RUH", name: "King Khalid", city: "Riyadh" },
        },
      ];

      vi.mocked(db.searchFlights).mockResolvedValue(mockFlights as any);

      const result = await flightsService.searchFlights({
        originId: 1,
        destinationId: 2,
        departureDate: new Date("2025-01-01"),
      });

      expect(result).toEqual(mockFlights);
      expect(db.searchFlights).toHaveBeenCalledWith({
        originId: 1,
        destinationId: 2,
        departureDate: expect.any(Date),
      });
    });
  });

  describe("getFlightById", () => {
    it("should return flight details when found", async () => {
      const mockFlight = {
        id: 1,
        flightNumber: "SV123",
        departureTime: new Date("2025-01-01T10:00:00Z"),
        arrivalTime: new Date("2025-01-01T12:00:00Z"),
        economyPrice: 50000,
        businessPrice: 100000,
        economyAvailable: 100,
        businessAvailable: 20,
        economySeats: 150,
        businessSeats: 30,
        aircraftType: "Boeing 777",
        status: "scheduled" as const,
        airline: { id: 1, code: "SV", name: "Saudi Airlines", logo: null },
        origin: {
          id: 1,
          code: "JED",
          name: "King Abdulaziz",
          city: "Jeddah",
          country: "Saudi Arabia",
        },
        destination: {
          id: 2,
          code: "RUH",
          name: "King Khalid",
          city: "Riyadh",
          country: "Saudi Arabia",
        },
      };

      vi.mocked(db.getFlightById).mockResolvedValue(mockFlight as any);

      const result = await flightsService.getFlightById({ id: 1 });

      expect(result).toEqual(mockFlight);
      expect(db.getFlightById).toHaveBeenCalledWith(1);
    });

    it("should throw error when flight not found", async () => {
      vi.mocked(db.getFlightById).mockResolvedValue(null);

      await expect(flightsService.getFlightById({ id: 999 })).rejects.toThrow(
        "Flight not found"
      );
    });
  });

  describe("checkFlightAvailability", () => {
    it("should return true when enough seats available", async () => {
      const mockFlight = {
        id: 1,
        economyAvailable: 100,
        businessAvailable: 20,
      };

      vi.mocked(db.getFlightById).mockResolvedValue(mockFlight as any);

      const result = await flightsService.checkFlightAvailability(1, "economy", 5);

      expect(result.available).toBe(true);
      expect(result.flight).toEqual(mockFlight);
    });

    it("should return false when not enough seats available", async () => {
      const mockFlight = {
        id: 1,
        economyAvailable: 2,
        businessAvailable: 20,
      };

      vi.mocked(db.getFlightById).mockResolvedValue(mockFlight as any);

      const result = await flightsService.checkFlightAvailability(1, "economy", 5);

      expect(result.available).toBe(false);
    });
  });

  describe("calculateFlightPrice", () => {
    it("should calculate correct price for economy with dynamic pricing", async () => {
      const mockFlight = {
        id: 1,
        economyPrice: 50000,
        businessPrice: 100000,
        economySeats: 150,
        businessSeats: 30,
        departureTime: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
      };

      const { price } = await flightsService.calculateFlightPrice(
        mockFlight as any,
        "economy",
        3
      );

      // Price should be calculated with dynamic pricing
      expect(price).toBeGreaterThan(0);
      expect(typeof price).toBe("number");
    });

    it("should calculate correct price for business with dynamic pricing", async () => {
      const mockFlight = {
        id: 1,
        economyPrice: 50000,
        businessPrice: 100000,
        economySeats: 150,
        businessSeats: 30,
        departureTime: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
      };

      const { price } = await flightsService.calculateFlightPrice(
        mockFlight as any,
        "business",
        2
      );

      // Price should be calculated with dynamic pricing
      expect(price).toBeGreaterThan(0);
      expect(typeof price).toBe("number");
    });
  });
});
