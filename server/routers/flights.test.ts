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
          flightNumber: "SV123",
          departureTime: new Date("2025-01-01T10:00:00Z"),
          arrivalTime: new Date("2025-01-01T12:00:00Z"),
        },
      ];

      vi.mocked(flightsService.searchFlights).mockResolvedValue(mockFlights as any);

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
      };

      vi.mocked(flightsService.getFlightById).mockResolvedValue(mockFlight as any);

      const caller = flightsRouter.createCaller({} as any);
      const result = await caller.getById({ id: 1 });

      expect(result).toEqual(mockFlight);
      expect(flightsService.getFlightById).toHaveBeenCalledWith({ id: 1 });
    });
  });
});
