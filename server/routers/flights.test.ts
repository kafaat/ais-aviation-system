import { describe, it, expect, vi, beforeEach } from "vitest";
import { flightsRouter } from "./flights";
import * as flightsService from "../services/flights.service";

// Mock the flights service
vi.mock("../services/flights.service");

describe("Flights Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("search", () => {
    it("should call flightsService.searchFlights with correct params", async () => {
      const mockFlights = [
        {
          id: 1,
          aircraftType: null,
          status: "scheduled",
          economyPrice: 10000,
          businessPrice: 20000,
          economyAvailable: 50,
          businessAvailable: 5,
          airline: { code: "ZX", name: "Test", logo: null },
          origin: { code: "ZZZ", name: "Origin", city: "Test" },
          destination: { code: "ZZY", name: "Destination", city: "Test" },
          flightNumber: "SV123",
          departureTime: new Date("2025-01-01T10:00:00Z"),
          arrivalTime: new Date("2025-01-01T12:00:00Z"),
        },
      ];

      vi.mocked(flightsService.searchFlights).mockResolvedValue(
        mockFlights as any
      );

      const caller = flightsRouter.createCaller({} as any);
      const result = await caller.search({
        originId: 1,
        destinationId: 2,
        departureDate: new Date("2025-01-01"),
      });

      expect(result).toEqual(mockFlights);
      expect(flightsService.searchFlights).toHaveBeenCalledWith({
        originId: 1,
        destinationId: 2,
        departureDate: expect.any(Date),
      });
    });
  });

  describe("getById", () => {
    it("should call flightsService.getFlightById with correct params", async () => {
      const mockFlight = {
        id: 1,
        flightNumber: "SV123",
        departureTime: new Date("2025-01-01T10:00:00Z"),
        arrivalTime: new Date("2025-01-01T12:00:00Z"),
        aircraftType: null,
        status: "scheduled",
        economySeats: 100,
        businessSeats: 10,
        economyPrice: 10000,
        businessPrice: 20000,
        economyAvailable: 50,
        businessAvailable: 5,
        airline: { id: 1, code: "ZX", name: "Test", logo: null },
        origin: {
          id: 1,
          code: "ZZZ",
          name: "Origin",
          city: "Test",
          country: "Test",
        },
        destination: {
          id: 2,
          code: "ZZY",
          name: "Destination",
          city: "Test",
          country: "Test",
        },
      };

      vi.mocked(flightsService.getFlightById).mockResolvedValue(
        mockFlight as any
      );

      const caller = flightsRouter.createCaller({} as any);
      const result = await caller.getById({ id: 1 });

      expect(result).toEqual(mockFlight);
      expect(flightsService.getFlightById).toHaveBeenCalledWith({ id: 1 });
    });
  });
});
