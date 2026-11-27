import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startNativeRedis } from "../__tests__/helpers/native-redis";
import { startRedisFaultProxy } from "../__tests__/helpers/redis-fault-proxy";

// Native Redis and the real cache, calendar and generation code; MySQL rows
// are a fixture. Only the generation keys present in the actual query match.
const source = vi.hoisted(() => ({
  generations: new Map<string, string>(),
  price: 100,
  available: true,
  waitForRows: undefined as Promise<void> | undefined,
  queryCount: 0,
}));

vi.mock("../db", () => ({
  getDb: async () => ({
    select: (shape: Record<string, unknown>) => ({
      from: () => ({
        where: (condition: SQL) => {
          if ("generation" in shape) {
            if (!source.available) throw new Error("authority offline");
            const { params } = new MySqlDialect().sqlToQuery(condition);
            return [...source.generations]
              .filter(([key]) => params.includes(key))
              .map(([key, generation]) => ({ key, generation }));
          }
          return {
            limit: async () => [{ timezone: "UTC" }],
            groupBy: () => ({
              orderBy: async () => {
                source.queryCount++;
                const price = source.price;
                await source.waitForRows;
                return [
                  {
                    departureDate: "2030-01-02",
                    minPrice: price,
                    avgPrice: price,
                    maxPrice: price,
                    flightCount: 1,
                  },
                ];
              },
            }),
          };
        },
      }),
    }),
    insert: () => ({
      values: (row: { scopeHash: string; generation: string }) => ({
        onDuplicateKeyUpdate: async () => {
          source.generations.set(row.scopeHash, row.generation);
        },
      }),
    }),
  }),
}));

const native = process.env.AIS_TEST_REDIS_SERVER_BIN ? describe : describe.skip;
native("public price calendar across cache generations", () => {
  let redis: Awaited<ReturnType<typeof startNativeRedis>>;
  let proxy: Awaited<ReturnType<typeof startRedisFaultProxy>>;
  let cache: (typeof import("./redis-cache.service"))["redisCacheService"];
  let calendar: typeof import("./price-calendar.service");
  const route = { originId: 1, destinationId: 2 };
  const monthly = () =>
    calendar.getMonthlyPrices({ ...route, month: 1, year: 2030 });
  const flexible = () =>
    calendar.getFlexiblePrices({
      ...route,
      date: new Date("2030-01-02T00:00:00Z"),
    });

  beforeAll(async () => {
    redis = await startNativeRedis();
    proxy = await startRedisFaultProxy(redis.url);
    vi.stubEnv("REDIS_URL", proxy.url);
    vi.stubEnv("CACHE_PREFIX", "ais_synthetic_calendar");
    cache = (await import("./redis-cache.service")).redisCacheService;
    calendar = await import("./price-calendar.service");
    await vi.waitFor(() => expect(cache.isConnected()).toBe(true));
  });
  afterAll(async () => {
    await cache?.shutdown();
    await proxy?.close();
    await redis?.stop();
    vi.unstubAllEnvs();
  });

  it("refreshes both public aggregates on an individual flight-price invalidation", async () => {
    source.price = 100;
    expect((await monthly()).lowestMonthPrice).toBe(100);
    expect((await flexible()).priceRange.min).toBe(100);
    const count = source.queryCount;
    source.price = 200;
    expect((await monthly()).lowestMonthPrice).toBe(100);
    expect((await flexible()).priceRange.min).toBe(100);
    expect(source.queryCount).toBe(count);
    await cache.invalidatePricingCache(7);
    expect((await monthly()).lowestMonthPrice).toBe(200);
    expect((await flexible()).priceRange.min).toBe(200);
  });

  it("keeps a delayed source result behind a remote flight generation change", async () => {
    const { advanceCacheGeneration } =
      await import("./cache-generation-authority");
    await cache.invalidateFlightSearchCache();
    let resume!: () => void;
    source.waitForRows = new Promise(resolve => {
      resume = resolve;
    });
    const count = source.queryCount;
    source.price = 300;
    const pending = monthly();
    try {
      await vi.waitFor(() => expect(source.queryCount).toBe(count + 1));
      // Another writer advances only the durable generation. This reader's
      // Redis connection and local epoch stay unchanged during the slow fill.
      await advanceCacheGeneration("ais_synthetic_calendar", "flight");
      source.price = 400;
    } finally {
      source.waitForRows = undefined;
      resume();
    }
    expect((await pending).lowestMonthPrice).toBe(300);
    expect((await monthly()).lowestMonthPrice).toBe(400);
  });

  it("refreshes fallback on offline invalidation and bypasses it if authority is unavailable", async () => {
    proxy.disconnect();
    await vi.waitFor(() => expect(cache.isConnected()).toBe(false));
    source.price = 500;
    await cache.invalidateFlightSearchCache();
    expect((await monthly()).lowestMonthPrice).toBe(500);
    source.available = false;
    source.price = 600;
    try {
      expect((await monthly()).lowestMonthPrice).toBe(600);
    } finally {
      source.available = true;
      proxy.reconnect();
    }
    await vi.waitFor(() => expect(cache.isConnected()).toBe(true), {
      timeout: 5000,
    });
    expect((await monthly()).lowestMonthPrice).toBe(600);
  });
});
