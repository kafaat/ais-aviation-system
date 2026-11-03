/**
 * Cached search and detail rows carry seat counts and a status that change
 * under bookings, refunds and operations, and nothing invalidated the cache.
 * The live state is overlaid before a cached row is served.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  search: vi.fn(),
  detail: vi.fn(),
  live: vi.fn(),
  cachedSearch: null as unknown,
  cachedDetail: null as unknown,
}));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  searchFlights: spies.search,
  getFlightById: spies.detail,
  getFlightLiveState: spies.live,
}));
vi.mock("../services/pricing/dynamic-pricing.service", () => ({
  DynamicPricingService: {},
}));
vi.mock("../services/redis-cache.service", () => ({
  CacheTTL: { FLIGHT_SEARCH: 120, FLIGHT_DETAILS: 300 },
  redisCacheService: {
    getCachedFlightSearch: async () => spies.cachedSearch,
    getCachedFlightDetails: async () => spies.cachedDetail,
    cacheFlightSearch: async () => undefined,
    cacheFlightDetails: async () => undefined,
  },
}));

import { getFlightById, searchFlights } from "../services/flights.service";

const row = (id: number) => ({
  id,
  flightNumber: `ZX${id}`,
  departureTime: new Date("2026-11-15T08:00:00.000Z"),
  arrivalTime: new Date("2026-11-15T10:00:00.000Z"),
  aircraftType: "B737",
  status: "scheduled" as const,
  economyPrice: 10000,
  businessPrice: 20000,
  economyAvailable: 9,
  businessAvailable: 2,
  airline: { code: "ZX", name: "Synthetic", logo: null },
  origin: {
    code: "RUH",
    name: "Origin",
    city: "Riyadh",
    timezone: "Asia/Riyadh",
  },
  destination: {
    code: "JED",
    name: "Destination",
    city: "Jeddah",
    timezone: null,
  },
});
const query = { originId: 1, destinationId: 2, departureDate: "2026-11-15" };

beforeEach(() => {
  spies.search.mockReset();
  spies.detail.mockReset();
  spies.live.mockReset();
  spies.cachedSearch = [row(1), row(2), row(3)];
  spies.cachedDetail = null;
});

describe("cached search results", () => {
  it("serve live seat counts and drop flights no longer on sale", async () => {
    spies.live.mockResolvedValue([
      { id: 1, status: "scheduled", economyAvailable: 0, businessAvailable: 2 },
      { id: 2, status: "cancelled", economyAvailable: 9, businessAvailable: 2 },
      // 3 was deleted; a fresh search would not return it either.
    ]);
    const results = await searchFlights(query);
    expect(results.map(r => r.id)).toEqual([1]);
    expect(results[0]).toMatchObject({
      economyAvailable: 0,
      businessAvailable: 2,
    });
    expect(spies.live).toHaveBeenCalledWith([1, 2, 3]);
    expect(spies.search).not.toHaveBeenCalled();
  });

  it("keep a delayed flight, which is still sold", async () => {
    spies.live.mockResolvedValue([
      { id: 1, status: "delayed", economyAvailable: 9, businessAvailable: 2 },
      { id: 2, status: "scheduled", economyAvailable: 9, businessAvailable: 2 },
      { id: 3, status: "completed", economyAvailable: 9, businessAvailable: 2 },
    ]);
    expect(
      (await searchFlights(query)).map(r => `${r.id}:${r.status}`)
    ).toEqual(["1:delayed", "2:scheduled"]);
  });

  it("do not touch the database for an empty cached result", async () => {
    spies.cachedSearch = [];
    expect(await searchFlights(query)).toEqual([]);
    expect(spies.live).not.toHaveBeenCalled();
  });
});

describe("cached flight details", () => {
  it("show the current status even when the flight is cancelled", async () => {
    spies.cachedDetail = {
      ...row(7),
      tenantId: 29,
      economySeats: 10,
      businessSeats: 2,
      airline: { id: 1, code: "ZX", name: "Synthetic", logo: null },
      origin: {
        id: 1,
        code: "RUH",
        name: "Origin",
        city: "Riyadh",
        country: "SA",
        timezone: "Asia/Riyadh",
      },
      destination: {
        id: 2,
        code: "JED",
        name: "Destination",
        city: "Jeddah",
        country: "SA",
        timezone: null,
      },
    };
    spies.live.mockResolvedValue([
      { id: 7, status: "cancelled", economyAvailable: 0, businessAvailable: 0 },
    ]);
    const flight = await getFlightById({ id: 7 });
    expect(flight).toMatchObject({
      id: 7,
      status: "cancelled",
      economyAvailable: 0,
    });
    expect(spies.detail).not.toHaveBeenCalled();
  });
});
