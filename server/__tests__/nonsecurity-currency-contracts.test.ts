import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeRates } from "../../drizzle/schema";
import * as relational from "./helpers/authority-relational-fixture";

const boundary = vi.hoisted(() => ({
  db: null as unknown,
  cache: new Map<string, string>(),
  ttls: new Map<string, number>(),
  readDelayMs: 0,
  writeDelayMs: 0,
}));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../services/cache.service", () => ({
  cacheService: {
    async get(key: string) {
      const text = boundary.cache.get(key);
      if (boundary.readDelayMs) {
        vi.setSystemTime(Date.now() + boundary.readDelayMs);
      }
      return text ? JSON.parse(text) : null;
    },
    async set(key: string, value: unknown, ttl: number) {
      boundary.cache.set(key, JSON.stringify(value));
      boundary.ttls.set(key, ttl);
      if (boundary.writeDelayMs) {
        vi.setSystemTime(Date.now() + boundary.writeDelayMs);
      }
    },
    async del(key: string) {
      boundary.cache.delete(key);
    },
  },
}));

import { responseContracts } from "../contracts/pricing.router";
import {
  convertCurrency,
  fromMinorUnits,
  getExchangeRate,
  toMinorUnits,
} from "../services/currency/currency.service";

// Production Drizzle SQL and Zod contracts execute here. The database engine
// is SQLite and the JSON cache is a double: this is not MySQL/Redis acceptance.
const createFixture = relational.authorityRelationalFixture;
let fixture: ReturnType<typeof createFixture>;
const now = new Date("2026-11-05T12:00:00Z");
function cachedPairKey(fromCurrency = "SAR", toCurrency = "KWD") {
  const key = [...boundary.cache.keys()].find(candidate =>
    candidate.endsWith(`:${fromCurrency}_${toCurrency}`)
  );
  if (!key)
    throw new Error(`No cached quote for ${fromCurrency}/${toCurrency}`);
  return key;
}
function seed(
  id: number,
  options: {
    from?: string;
    to?: string;
    rate?: string;
    source?: string;
    validFrom?: string;
    validTo?: string | null;
    updatedAt?: string;
  } = {}
) {
  fixture.insert(exchangeRates, {
    id,
    fromCurrency: options.from ?? "SAR",
    toCurrency: options.to ?? "KWD",
    rate: options.rate ?? "0.082",
    source: options.source ?? "fixture",
    validFrom: options.validFrom ?? "2026-11-05 11:00:00",
    validTo:
      options.validTo === undefined ? "2026-11-05 13:00:00" : options.validTo,
    updatedAt: options.updatedAt ?? "2026-11-05 11:00:00",
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  boundary.cache.clear();
  boundary.ttls.clear();
  boundary.readDelayMs = 0;
  boundary.writeDelayMs = 0;
  fixture = createFixture([exchangeRates]);
  boundary.db = fixture.db;
});
afterEach(() => {
  boundary.db = null;
  fixture.close();
  vi.useRealTimers();
});

describe("currency precision and effective observation contracts", () => {
  it.each(["KWD", "BHD", "OMR"])(
    "%s identity preserves all three decimals",
    async currency => {
      const result = await convertCurrency(1.234, currency, currency);
      expect(result.convertedAmount).toBe(1.234);
      expect(result.formattedConverted).toBe("1.234");
      expect(toMinorUnits(result.convertedAmount, currency)).toBe(1234);
      expect(fromMinorUnits(1234, currency)).toBe(1.234);
    }
  );

  it("retains the two-decimal SAR unit contract", async () => {
    const result = await convertCurrency(1.23, "SAR", "SAR");
    expect(result.convertedAmount).toBe(1.23);
    expect(toMinorUnits(1.23, "SAR")).toBe(123);
    expect(fromMinorUnits(123, "SAR")).toBe(1.23);
  });

  it("converts a riyal to 82 fils, not 80 or 8", async () => {
    seed(1);
    const result = await convertCurrency(1, "SAR", "KWD");
    expect(result.convertedAmount).toBe(0.082);
    expect(result.formattedConverted).toBe("0.082");
    expect(toMinorUnits(result.convertedAmount, "KWD")).toBe(82);
  });

  it.each([
    [1.005, 101],
    [-1.005, -101],
    [0.004, 0],
    [1e-7, 0],
  ])("rounds %s once at the minor-unit boundary", (amount, minor) => {
    expect(toMinorUnits(amount, "SAR")).toBe(minor);
  });

  it("rejects invalid monetary inputs", () => {
    expect(() => toMinorUnits(Infinity, "SAR")).toThrow();
    expect(() => toMinorUnits(NaN, "KWD")).toThrow();
    expect(() => toMinorUnits(Number.MAX_SAFE_INTEGER, "KWD")).toThrow();
    expect(() => fromMinorUnits(1.5, "SAR")).toThrow();
    expect(() => toMinorUnits(1, "XXX")).toThrow();
  });

  it("passes Zod contracts after a JSON cache hit", async () => {
    seed(1);
    const cold = await getExchangeRate("SAR", "KWD");
    expect(cold.updatedAt).toBeInstanceOf(Date);
    const envelope = JSON.parse(boundary.cache.get(cachedPairKey())!);
    expect(typeof envelope.quote.updatedAt).toBe("string");
    // Prove that the second read uses the cache rather than the database row.
    fixture.sqlite.exec("DELETE FROM exchange_rates");
    const warm = await getExchangeRate("SAR", "KWD");
    expect(warm).toEqual(cold);
    const converted = await convertCurrency(1, "SAR", "KWD");
    expect(converted.rateTimestamp).toEqual(cold.updatedAt);
    for (const data of [cold, warm]) {
      const parsed = responseContracts.getExchangeRate.parse({
        success: true,
        data,
      });
      expect(parsed.success).toBe(true);
    }
    const parsed = responseContracts.convertCurrency.parse({
      success: true,
      data: converted,
    });
    expect(parsed.success).toBe(true);
  });

  it("excludes future and expired observations", async () => {
    seed(1, { rate: "0.080" });
    seed(2, {
      rate: "0.5",
      validFrom: "2026-11-06 00:00:00",
      validTo: "2026-11-07 00:00:00",
      updatedAt: "2026-11-05 11:59:00",
    });
    seed(3, {
      rate: "0.9",
      validTo: "2026-11-05 11:59:59",
      updatedAt: "2026-11-05 11:59:00",
    });
    expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.08);
  });

  it("uses inclusive start and exclusive expiry", async () => {
    seed(1, { rate: "0.2", validTo: "2026-11-05 12:00:00" });
    seed(2, { rate: "0.083", validFrom: "2026-11-05 12:00:00" });
    expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.083);
  });

  it.each([null, "2026-11-05 13:00:00"])(
    "refreshes a warmed observation ending %s at the next eligible start",
    async validTo => {
      seed(1, { rate: "0.080", validTo });
      seed(2, {
        rate: "0.083",
        validFrom: "2026-11-05 12:05:00",
      });
      const cold = await getExchangeRate("SAR", "KWD");
      expect(cold.rate).toBe(0.08);
      const coldQueries = fixture.queries.length;
      vi.setSystemTime(new Date("2026-11-05T12:04:59.999Z"));
      expect(await getExchangeRate("SAR", "KWD")).toEqual(cold);
      expect(fixture.queries).toHaveLength(coldQueries);

      // The earlier observation is still valid, but the scheduled observation
      // becomes the winner at its inclusive start even after a JSON cache hit.
      vi.setSystemTime(new Date("2026-11-05T12:05:00Z"));
      expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.083);
    }
  );

  it.each(["component leg", "direct pair"])(
    "refreshes a warmed cross quote at the future %s observation",
    async futurePair => {
      seed(1, { from: "USD", to: "SAR", rate: "3.75", validTo: null });
      seed(2, { rate: "0.080", validTo: null });
      seed(3, {
        from: futurePair === "component leg" ? "SAR" : "USD",
        rate: futurePair === "component leg" ? "0.084" : "0.32",
        source: "scheduled-observation",
        validFrom: "2026-11-05 12:05:00",
        validTo: null,
      });
      const cold = await getExchangeRate("USD", "KWD");
      expect(cold.rate).toBeCloseTo(0.3, 12);
      expect(cold.source).toBe("cross_rate");
      const coldQueries = fixture.queries.length;
      vi.setSystemTime(new Date("2026-11-05T12:04:59.999Z"));
      expect(await getExchangeRate("USD", "KWD")).toEqual(cold);
      expect(fixture.queries).toHaveLength(coldQueries);

      vi.setSystemTime(new Date("2026-11-05T12:05:00Z"));
      const current = await getExchangeRate("USD", "KWD");
      expect(current.rate).toBeCloseTo(
        futurePair === "component leg" ? 0.315 : 0.32,
        12
      );
      expect(current.source).toBe(
        futurePair === "component leg" ? "cross_rate" : "scheduled-observation"
      );
    }
  );

  it("breaks equal timestamps deterministically by id", async () => {
    seed(1, { rate: "0.081" });
    seed(2, { rate: "0.082" });
    expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.082);
  });

  it("caps Redis TTL at the observation expiry", async () => {
    seed(1, { validTo: "2026-11-05 12:01:00" });
    await getExchangeRate("SAR", "KWD");
    expect(boundary.ttls.get(cachedPairKey())).toBe(60);
  });

  it("limits open-ended observations to one hour", async () => {
    seed(1, { validTo: null });
    await getExchangeRate("SAR", "KWD");
    expect(boundary.ttls.get(cachedPairKey())).toBe(3600);
  });

  it.each([
    ["2026-11-05 13:00:00", "2026-11-05 12:05:00", 300],
    ["2026-11-05 12:01:00", "2026-11-05 12:05:00", 60],
    ["2026-11-05 15:00:00", "2026-11-05 14:00:00", 3600],
  ] as const)(
    "caps cache TTL for expiry %s and next start %s at %s seconds",
    async (validTo, validFrom, expectedTtl) => {
      seed(1, { validTo });
      seed(2, {
        rate: "0.083",
        validFrom,
        validTo: "2026-11-05 16:00:00",
      });
      await getExchangeRate("SAR", "KWD");
      expect(boundary.ttls.get(cachedPairKey())).toBe(expectedTtl);
    }
  );

  it("caps cache at the next eligible observation, ignoring an empty future window", async () => {
    seed(1, { validTo: null });
    seed(2, {
      rate: "0.7",
      validFrom: "2026-11-05 12:01:00",
      validTo: "2026-11-05 12:01:00",
    });
    seed(3, { rate: "0.083", validFrom: "2026-11-05 12:05:00" });
    await getExchangeRate("SAR", "KWD");
    expect(boundary.ttls.get(cachedPairKey())).toBe(300);
    vi.setSystemTime(new Date("2026-11-05T12:05:00Z"));
    expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.083);
  });

  it("rechecks expiry independently of the cache TTL", async () => {
    seed(1, { validTo: "2026-11-05 12:01:00" });
    await getExchangeRate("SAR", "KWD");
    vi.setSystemTime(new Date("2026-11-05T12:02:00Z"));
    seed(2, { rate: "0.084", validFrom: "2026-11-05 12:01:00" });
    expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.084);
  });

  it("rechecks the clock after a delayed cache read", async () => {
    seed(1, { rate: "0.081", validTo: "2026-11-05 12:01:00" });
    await getExchangeRate("SAR", "KWD");
    boundary.readDelayMs = 120000;
    const result = await getExchangeRate("SAR", "KWD");
    expect(result.source).toBe("fallback");
    expect(result.rate).not.toBe(0.081);
  });

  it("rejects a quote that expires during a cache write", async () => {
    seed(1, { validTo: "2026-11-05 12:01:00" });
    boundary.writeDelayMs = 120000;
    await expect(getExchangeRate("SAR", "KWD")).rejects.toThrow(
      "Exchange rate expired during conversion"
    );
  });

  it("converts with the newly effective observation after a delayed cache read", async () => {
    seed(1, { rate: "0.081", validTo: "2026-11-05 12:01:00" });
    seed(2, { rate: "0.084", validFrom: "2026-11-05 12:01:00" });
    await getExchangeRate("SAR", "KWD");
    boundary.readDelayMs = 120000;

    const result = await convertCurrency(1000, "SAR", "KWD");
    expect(result.exchangeRate).toBe(0.084);
    expect(result.convertedAmount).toBe(84);
    expect(result.formattedConverted).toBe("84.000");
  });

  it.each(["direct", "cross"])(
    "rejects a %s conversion when its final cache write crosses expiry",
    async path => {
      seed(1, {
        to: "AED",
        rate: "0.9793",
        validTo: "2026-11-05 12:01:00",
      });
      if (path === "cross") {
        seed(2, {
          from: "USD",
          to: "SAR",
          rate: "3.75",
          validTo: "2026-11-05 12:01:00",
        });
        // Warm only the component legs. The delayed write must belong to the
        // final cross quote, after its initial validity check has succeeded.
        await getExchangeRate("USD", "SAR");
        await getExchangeRate("SAR", "AED");
      }
      boundary.writeDelayMs = 120000;
      await expect(
        convertCurrency(1000, path === "cross" ? "USD" : "SAR", "AED")
      ).rejects.toThrow("Exchange rate expired during conversion");
    }
  );

  it.each(["old-version", "wrong-pair", "bad-date", "future", "zero-rate"])(
    "does not admit a %s cache envelope",
    async invalid => {
      seed(1);
      await getExchangeRate("SAR", "KWD");
      const key = cachedPairKey();
      const value = JSON.parse(boundary.cache.get(key)!);
      if (invalid === "old-version") value.version = 1;
      if (invalid === "wrong-pair") value.quote.toCurrency = "USD";
      if (invalid === "bad-date") value.quote.updatedAt = "not-a-date";
      if (invalid === "future") value.validFrom = "2026-11-06T12:00:00Z";
      if (invalid === "zero-rate") value.quote.rate = 0;
      boundary.cache.set(key, JSON.stringify(value));
      seed(2, { rate: "0.084", validFrom: "2026-11-05 11:30:00" });
      expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.084);
    }
  );

  it("ignores legacy v2 envelopes without exact conversion metadata", async () => {
    boundary.cache.set(
      "exchange_rate:v2:SAR_KWD",
      JSON.stringify({
        version: 2,
        quote: {
          fromCurrency: "SAR",
          toCurrency: "KWD",
          rate: 0.08,
          inverseRate: 12.5,
          source: "legacy-observation",
          updatedAt: now,
        },
        validFrom: "2026-11-05T11:00:00Z",
        expiresAt: "2026-11-05T13:00:00Z",
      })
    );
    seed(1, { rate: "0.085", source: "current-observation" });
    expect(await getExchangeRate("SAR", "KWD")).toMatchObject({
      rate: 0.085,
      source: "current-observation",
    });
  });

  it("does not cache fallback estimates", async () => {
    expect((await getExchangeRate("SAR", "KWD")).source).toBe("fallback");
    expect(boundary.cache.size).toBe(0);
    seed(1, { rate: "0.085" });
    expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.085);
  });

  it("returns an uncached labelled fallback after an actual query rejection", async () => {
    // Keep the real Drizzle handle available while making its SQL execution
    // fail. This exercises query rejection, not the getDb() === null branch.
    fixture.sqlite.exec(
      "ALTER TABLE exchange_rates RENAME TO unavailable_exchange_rates"
    );
    const fallback = await getExchangeRate("SAR", "KWD");
    expect(fixture.queries.length).toBeGreaterThan(0);
    expect(fallback).toMatchObject({ rate: 0.082, source: "fallback" });
    expect(
      responseContracts.getExchangeRate.parse({ success: true, data: fallback })
    ).toEqual({ success: true, data: fallback });
    expect(boundary.cache.size).toBe(0);

    fixture.sqlite.exec(
      "ALTER TABLE unavailable_exchange_rates RENAME TO exchange_rates"
    );
    seed(1, { rate: "0.085", source: "restored-observation" });
    expect(await getExchangeRate("SAR", "KWD")).toMatchObject({
      rate: 0.085,
      source: "restored-observation",
    });
  });

  it.each([{ rate: "not-a-number" }, { updatedAt: "2026-99-99 99:99:99" }])(
    "does not mask a malformed stored observation %j as fallback",
    async options => {
      seed(1, options);
      await expect(getExchangeRate("SAR", "KWD")).rejects.toThrow(
        /exchange rate observation/i
      );
      expect(boundary.cache.size).toBe(0);
    }
  );

  it.each(["cold", "serialized warm"])(
    "converts USD 1000 to AED 3672.38 with an unchanged DTO on a %s cache",
    async cacheState => {
      seed(1, {
        from: "USD",
        to: "SAR",
        rate: "3.75",
        updatedAt: "2026-11-05 10:00:00",
      });
      seed(2, { to: "AED", rate: "0.9793" });
      if (cacheState === "serialized warm") {
        await getExchangeRate("USD", "AED");
        expect(boundary.cache.size).toBeGreaterThan(0);
        // Every cache value is serialized JSON. Remove all observations to
        // prove the exact cross-rate survives the cache boundary on its own.
        fixture.sqlite.exec("DELETE FROM exchange_rates");
      }
      const queriesBeforeConversion = fixture.queries.length;
      const converted = await convertCurrency(1000, "USD", "AED");
      expect(converted).toEqual({
        originalAmount: 1000,
        originalCurrency: "USD",
        convertedAmount: 3672.38,
        targetCurrency: "AED",
        exchangeRate: expect.any(Number),
        formattedOriginal: "1,000.00",
        formattedConverted: "3,672.38",
        rateTimestamp: new Date("2026-11-05T10:00:00Z"),
      });
      expect(toMinorUnits(converted.convertedAmount, "AED")).toBe(367238);
      const quote = await getExchangeRate("USD", "AED");
      expect(quote).toEqual({
        fromCurrency: "USD",
        toCurrency: "AED",
        rate: expect.any(Number),
        inverseRate: expect.any(Number),
        source: "cross_rate",
        updatedAt: new Date("2026-11-05T10:00:00Z"),
      });
      expect(quote.rate).toBeCloseTo(3.672375, 12);
      expect(
        responseContracts.getExchangeRate.parse({ success: true, data: quote })
      ).toEqual({ success: true, data: quote });
      expect(
        responseContracts.convertCurrency.parse({
          success: true,
          data: converted,
        })
      ).toEqual({ success: true, data: converted });
      if (cacheState === "serialized warm")
        expect(fixture.queries).toHaveLength(queriesBeforeConversion);
    }
  );

  it("inherits cross-rate expiry and observation time", async () => {
    seed(1, {
      from: "USD",
      to: "SAR",
      rate: "3.75",
      validTo: "2026-11-05 12:01:00",
      updatedAt: "2026-11-05 10:00:00",
    });
    seed(2, { updatedAt: "2026-11-05 11:00:00" });
    const rate = await getExchangeRate("USD", "KWD");
    expect(rate.rate).toBeCloseTo(0.3075);
    expect(rate.updatedAt).toEqual(new Date("2026-11-05T10:00:00Z"));
    expect(boundary.ttls.get(cachedPairKey("USD", "KWD"))).toBe(60);
  });
});
