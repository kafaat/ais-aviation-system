/**
 * The search cache is keyed by the civil day, so two browsers in different
 * zones asking for the same calendar day share one entry and never poison
 * each other's results.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../db", () => ({
  searchFlights: spies.search,
  getFlightById: vi.fn(),
}));
vi.mock("../services/pricing/dynamic-pricing.service", () => ({
  DynamicPricingService: {},
}));
vi.mock("../services/redis-cache.service", () => ({
  CacheTTL: { FLIGHT_SEARCH: 120, FLIGHT_DETAILS: 300 },
  redisCacheService: {
    getCachedFlightSearch: spies.get,
    cacheFlightSearch: spies.set,
  },
}));

import { searchFlights } from "../services/flights.service";

beforeEach(() => {
  spies.get.mockReset().mockResolvedValue(null);
  spies.set.mockReset().mockResolvedValue(undefined);
  spies.search.mockReset().mockResolvedValue([]);
});

describe("search cache key", () => {
  it.each([
    ["Riyadh local midnight", new Date("2026-11-14T21:00:00.000Z")],
    ["London local midnight", new Date("2026-11-15T00:00:00.000Z")],
    ["New York local midnight", new Date("2026-11-15T05:00:00.000Z")],
    ["civil date string", "2026-11-15"],
    ["legacy ISO instant string", "2026-11-14T21:00:00.000Z"],
  ])("keys %s for 15 Nov 2026 as 2026-11-15", async (_label, departureDate) => {
    await searchFlights({ originId: 1, destinationId: 2, departureDate });
    expect(spies.get).toHaveBeenCalledWith({
      originId: 1,
      destinationId: 2,
      departureDate: "2026-11-15",
    });
    expect(spies.set).toHaveBeenCalledWith(
      { originId: 1, destinationId: 2, departureDate: "2026-11-15" },
      [],
      120
    );
    // The source query receives the caller's value untouched; it resolves
    // the day in the origin airport's zone itself.
    expect(spies.search).toHaveBeenCalledWith({
      originId: 1,
      destinationId: 2,
      departureDate,
    });
  });

  it("rejects an unparseable date instead of guessing a day", async () => {
    await expect(
      searchFlights({
        originId: 1,
        destinationId: 2,
        departureDate: "tomorrow",
      })
    ).rejects.toThrow();
    expect(spies.search).not.toHaveBeenCalled();
  });
});
