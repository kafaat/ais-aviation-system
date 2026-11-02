/**
 * The price calendar buckets flights by the origin airport's calendar day.
 * Before this, the day boundaries were computed in the server's zone, the
 * bucket in the MySQL session zone and the labels in UTC, so any non-UTC
 * deployment (or a Riyadh origin on a UTC server) shifted days by one.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const state = {
  airport: [{ timezone: "Asia/Riyadh" }] as Array<{ timezone: string | null }>,
  rows: [] as Array<Record<string, unknown>>,
  where: [] as unknown[],
  selects: [] as unknown[],
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: (shape: unknown) => {
      state.selects.push(shape);
      const chain = {
        from: () => chain,
        where: (cond: unknown) => {
          state.where.push(cond);
          return chain;
        },
        limit: async () => state.airport,
        groupBy: () => chain,
        orderBy: async () => state.rows,
      };
      return chain;
    },
  })),
}));
vi.mock("../services/redis-cache.service", () => ({
  redisCacheService: {
    getRaw: vi.fn().mockResolvedValue(null),
    setRaw: vi.fn().mockResolvedValue(undefined),
  },
  CacheTTL: { FLIGHT_SEARCH: 300 },
}));
vi.mock("../_core/logger", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getDb } from "../db";
import {
  getFlexiblePrices,
  getMonthlyPrices,
} from "../services/price-calendar.service";

type SqlNode = { queryChunks?: unknown[]; value?: unknown; sql?: unknown };
/** Flatten a drizzle SQL/condition tree into its literal chunks and params. */
function leaves(node: unknown, out: unknown[] = []): unknown[] {
  if (node && typeof node === "object") {
    const n = node as SqlNode;
    // `.as("alias")` wraps the expression
    if (n.sql && typeof n.sql === "object") return leaves(n.sql, out);
    if (Array.isArray(n.queryChunks)) {
      for (const chunk of n.queryChunks) leaves(chunk, out);
      return out;
    }
    if (Array.isArray(n.value)) {
      out.push(n.value.join(""));
      return out;
    }
    if ("value" in n) {
      out.push(n.value);
      return out;
    }
  }
  out.push(node);
  return out;
}

beforeEach(() => {
  state.rows = [];
  state.where = [];
  state.selects = [];
  state.airport = [{ timezone: "Asia/Riyadh" }];
  vi.mocked(getDb).mockClear();
});

describe("monthly price calendar", () => {
  it("bounds the month by Riyadh midnights, end exclusive, and buckets in Riyadh", async () => {
    await getMonthlyPrices({
      originId: 7,
      destinationId: 9,
      month: 11,
      year: 2026,
    });
    const params = leaves(state.where[1]);
    const dates = params.filter((p): p is Date => p instanceof Date);
    expect(dates.map(d => d.toISOString())).toEqual([
      "2026-10-31T21:00:00.000Z", // 1 Nov 00:00 Riyadh
      "2026-11-30T21:00:00.000Z", // 1 Dec 00:00 Riyadh, excluded
    ]);
    expect(params.join(" ")).toContain(" < ");
    expect(params.join(" ")).not.toContain(" <= ");
    const shape = state.selects[1] as { departureDate: unknown };
    const bucket = leaves(shape.departureDate);
    expect(bucket.join("")).toContain("CONVERT_TZ(");
    expect(bucket).toContain("+03:00");
  });

  it("labels every day of the month without consulting the process zone", async () => {
    state.rows = [
      {
        departureDate: "2026-11-15",
        minPrice: 100,
        maxPrice: 200,
        avgPrice: 150,
        flightCount: 2,
      },
    ];
    const result = await getMonthlyPrices({
      originId: 7,
      destinationId: 9,
      month: 11,
      year: 2026,
    });
    expect(result.prices).toHaveLength(30);
    expect(result.prices[0].date).toBe("2026-11-01");
    expect(result.prices[29].date).toBe("2026-11-30");
    expect(result.cheapestDay).toBe("2026-11-15");
  });

  it("falls back to the default airport zone when the origin has none", async () => {
    state.airport = [{ timezone: null }];
    await getMonthlyPrices({
      originId: 7,
      destinationId: 9,
      month: 11,
      year: 2026,
    });
    const dates = leaves(state.where[1]).filter(
      (p): p is Date => p instanceof Date
    );
    expect(dates[0].toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("flexible price calendar", () => {
  it("centres on the civil day the client chose, in the origin's zone", async () => {
    // A Riyadh browser encodes 15 Nov local midnight as 14 Nov 21:00Z.
    const result = await getFlexiblePrices({
      originId: 7,
      destinationId: 9,
      date: new Date("2026-11-14T21:00:00.000Z"),
      flexDays: 2,
    });
    expect(result.centerDate).toBe("2026-11-15");
    expect(result.prices.map(p => p.date)).toEqual([
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
    ]);
    const dates = leaves(state.where[1]).filter(
      (p): p is Date => p instanceof Date
    );
    expect(dates.map(d => d.toISOString())).toEqual([
      "2026-11-12T21:00:00.000Z", // 13 Nov 00:00 Riyadh
      "2026-11-17T21:00:00.000Z", // 18 Nov 00:00 Riyadh, excluded
    ]);
  });

  it("spans month ends without repeating or skipping a day", async () => {
    const result = await getFlexiblePrices({
      originId: 7,
      destinationId: 9,
      date: new Date("2026-11-30T00:00:00.000Z"),
      flexDays: 1,
    });
    expect(result.prices.map(p => p.date)).toEqual([
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
    ]);
  });
});
