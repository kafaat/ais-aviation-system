import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { referenceRouter } from "./reference";
import * as db from "../db";

const cache = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
vi.mock("../db", () => ({ getAllAirports: vi.fn(), getAllAirlines: vi.fn() }));
vi.mock("../services/redis-cache.service", () => ({
  CacheTTL: { AIRPORTS: 3600, AIRLINES: 3600 },
  redisCacheService: {
    getCachedAirports: async () => cache.values.airports ?? null,
    getCachedAirlines: async () => cache.values.airlines ?? null,
    cacheAirports: async (value: unknown) => {
      cache.values.airports = JSON.parse(JSON.stringify(value));
    },
    cacheAirlines: async (value: unknown) => {
      cache.values.airlines = JSON.parse(JSON.stringify(value));
    },
  },
}));
const createdAt = new Date("2026-10-23T00:00:00.000Z");
const airport = {
  id: 1,
  code: "RUH",
  name: "Airport",
  city: "Riyadh",
  country: "SA",
  timezone: "Asia/Riyadh",
  createdAt,
};
const airline = {
  id: 1,
  code: "SV",
  name: "Airline",
  country: "SA",
  logo: null,
  active: true,
  createdAt,
};
const caller = referenceRouter.createCaller({ user: null } as TrpcContext);
beforeEach(() => {
  vi.clearAllMocks();
  cache.values = {};
  vi.mocked(db.getAllAirports).mockResolvedValue([airport]);
  vi.mocked(db.getAllAirlines).mockResolvedValue([airline]);
});
for (const kind of ["airports", "airlines"] as const) {
  describe(`${kind} cache boundary`, () => {
    it("returns identical typed dates after the Redis JSON round trip", async () => {
      const cold = await caller[kind]();
      const warm = await caller[kind]();
      expect(warm).toEqual(cold);
      expect(warm[0].createdAt).toBeInstanceOf(Date);
      expect(
        kind === "airports" ? db.getAllAirports : db.getAllAirlines
      ).toHaveBeenCalledOnce();
    });
    it.each([null, "not-a-date", 1792713600000])(
      "refreshes malformed cached dates (%s) from the database",
      async badDate => {
        cache.values[kind] = [
          { ...(kind === "airports" ? airport : airline), createdAt: badDate },
        ];
        const result = await caller[kind]();
        expect(result[0].createdAt).toEqual(createdAt);
        expect(
          kind === "airports" ? db.getAllAirports : db.getAllAirlines
        ).toHaveBeenCalledOnce();
      }
    );
    it("preserves the explicit output allowlist on cache hits", async () => {
      cache.values[kind] = [
        {
          ...(kind === "airports" ? airport : airline),
          createdAt: createdAt.toISOString(),
          internalSecret: "fixture",
        },
      ];
      expect((await caller[kind]())[0]).not.toHaveProperty("internalSecret");
    });
    it("does not turn a source failure into empty reference data", async () => {
      cache.values[kind] = [{ createdAt: "broken" }];
      vi.mocked(db.getAllAirports).mockRejectedValue(
        new Error("Source unavailable")
      );
      vi.mocked(db.getAllAirlines).mockRejectedValue(
        new Error("Source unavailable")
      );
      await expect(caller[kind]()).rejects.toThrow("Source unavailable");
    });
  });
}
