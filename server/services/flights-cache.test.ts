import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { responseContracts } from "../contracts/flights";
import { getFlightById, searchFlights } from "./flights.service";

const cache = vi.hoisted(() => ({
  search: null as unknown,
  detail: null as unknown,
}));
vi.mock("../db", () => ({ searchFlights: vi.fn(), getFlightById: vi.fn() }));
vi.mock("./pricing/dynamic-pricing.service", () => ({
  DynamicPricingService: {},
}));
vi.mock("./redis-cache.service", () => ({
  CacheTTL: { FLIGHT_SEARCH: 120, FLIGHT_DETAILS: 300 },
  redisCacheService: {
    getCachedFlightSearch: async () => cache.search,
    getCachedFlightDetails: async () => cache.detail,
    cacheFlightSearch: async (_key: unknown, data: unknown) => {
      cache.search = JSON.parse(JSON.stringify(data));
    },
    cacheFlightDetails: async (_id: number, data: unknown) => {
      cache.detail = JSON.parse(JSON.stringify(data));
    },
  },
}));
const departureTime = new Date("2026-11-01T08:00:00.000Z");
const flight = {
  id: 701,
  tenantId: 29,
  flightNumber: "ZX701",
  departureTime,
  arrivalTime: new Date("2026-11-01T10:00:00.000Z"),
  aircraftType: "B737",
  status: "scheduled" as const,
  economySeats: 10,
  businessSeats: 2,
  economyPrice: 10000,
  businessPrice: 20000,
  economyAvailable: 9,
  businessAvailable: 2,
  airline: { id: 1, code: "ZX", name: "Synthetic", logo: null },
  origin: { id: 1, code: "RUH", name: "Origin", city: "Riyadh", country: "SA" },
  destination: {
    id: 2,
    code: "JED",
    name: "Destination",
    city: "Jeddah",
    country: "SA",
  },
};
const searchRow = {
  id: flight.id,
  flightNumber: flight.flightNumber,
  departureTime,
  arrivalTime: flight.arrivalTime,
  aircraftType: flight.aircraftType,
  status: flight.status,
  economyPrice: flight.economyPrice,
  businessPrice: flight.businessPrice,
  economyAvailable: flight.economyAvailable,
  businessAvailable: flight.businessAvailable,
  airline: { code: "ZX", name: "Synthetic", logo: null },
  origin: { code: "RUH", name: "Origin", city: "Riyadh" },
  destination: { code: "JED", name: "Destination", city: "Jeddah" },
};
const input = { originId: 1, destinationId: 2, departureDate: departureTime };
beforeEach(() => {
  vi.clearAllMocks();
  cache.search = cache.detail = null;
  vi.mocked(db.searchFlights).mockResolvedValue([searchRow]);
  vi.mocked(db.getFlightById).mockResolvedValue(flight);
});
describe("flight JSON cache boundary", () => {
  it("preserves nonempty search results, dates and the public contract after JSON serialization", async () => {
    const cold = await searchFlights(input);
    const warm = await searchFlights(input);
    expect(responseContracts.search.parse(warm)).toEqual(cold);
    expect(warm[0].departureTime).toBeInstanceOf(Date);
    expect(warm[0].arrivalTime).toBeInstanceOf(Date);
    expect(db.searchFlights).toHaveBeenCalledOnce();
  });
  it("preserves internal tenant identity and detail dates across a cache hit", async () => {
    const cold = await getFlightById({ id: flight.id });
    const warm = await getFlightById({ id: flight.id });
    expect(warm).toEqual(cold);
    expect(warm?.tenantId).toBe(29);
    expect(warm?.departureTime).toBeInstanceOf(Date);
    expect(warm?.arrivalTime).toBeInstanceOf(Date);
    expect(responseContracts.getById.parse(warm)).not.toHaveProperty(
      "tenantId"
    );
    expect(db.getFlightById).toHaveBeenCalledOnce();
  });
  it("accepts typed dates from the in-memory fallback", async () => {
    cache.search = [searchRow];
    cache.detail = flight;
    expect(await searchFlights(input)).toEqual([searchRow]);
    expect(await getFlightById({ id: flight.id })).toEqual(flight);
    expect(db.searchFlights).not.toHaveBeenCalled();
    expect(db.getFlightById).not.toHaveBeenCalled();
  });
  it.each([null, "bad-date", 1793520000000])(
    "refreshes malformed search dates (%s)",
    async created => {
      cache.search = [{ ...searchRow, departureTime: created }];
      expect(await searchFlights(input)).toEqual([searchRow]);
      expect(db.searchFlights).toHaveBeenCalledOnce();
    }
  );
  it.each([null, "bad-date", 1793520000000])(
    "refreshes malformed detail dates (%s)",
    async created => {
      cache.detail = { ...flight, arrivalTime: created };
      expect(await getFlightById({ id: flight.id })).toEqual(flight);
      expect(db.getFlightById).toHaveBeenCalledOnce();
    }
  );
  it("treats a missing cached tenantId as a cache miss", async () => {
    const { tenantId: _tenantId, ...legacy } = flight;
    cache.detail = legacy;
    expect((await getFlightById({ id: flight.id }))?.tenantId).toBe(29);
    expect(db.getFlightById).toHaveBeenCalledOnce();
  });
  it("rejects a cached detail belonging to a different flight ID", async () => {
    cache.detail = { ...flight, id: 999 };
    expect((await getFlightById({ id: flight.id }))?.id).toBe(flight.id);
    expect(db.getFlightById).toHaveBeenCalledOnce();
  });
  it("keeps an authoritative empty search distinct from cache corruption", async () => {
    cache.search = [];
    expect(await searchFlights(input)).toEqual([]);
    expect(db.searchFlights).not.toHaveBeenCalled();
  });
  it("propagates source failure after rejecting a malformed search cache", async () => {
    cache.search = [{ departureTime: "broken" }];
    vi.mocked(db.searchFlights).mockRejectedValue(new Error("DB unavailable"));
    await expect(searchFlights(input)).rejects.toThrow(
      "Failed to search flights"
    );
  });
  it("propagates detail source failure and does not invent a missing flight", async () => {
    cache.detail = { arrivalTime: "broken" };
    vi.mocked(db.getFlightById)
      .mockRejectedValueOnce(new Error("DB unavailable"))
      .mockResolvedValueOnce(null);
    await expect(getFlightById({ id: flight.id })).rejects.toThrow(
      "Failed to get flight details"
    );
    await expect(getFlightById({ id: flight.id })).rejects.toThrow(
      "Flight not found"
    );
  });
});
