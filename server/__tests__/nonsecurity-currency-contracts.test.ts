import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeRates } from "../../drizzle/schema";
import * as relational from "./helpers/authority-relational-fixture";

const boundary = vi.hoisted(() => ({
  db: null as unknown,
  cache: new Map<string, string>(),
  ttls: new Map<string, number>(),
}));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../services/cache.service", () => ({
  cacheService: {
    async get(key: string) {
      const text = boundary.cache.get(key);
      return text ? JSON.parse(text) : null;
    },
    async set(key: string, value: unknown, ttl: number) {
      boundary.cache.set(key, JSON.stringify(value));
      boundary.ttls.set(key, ttl);
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
const key = "exchange_rate:v2:SAR_KWD";
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
    const envelope = JSON.parse(boundary.cache.get(key)!);
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

  it("breaks equal timestamps deterministically by id", async () => {
    seed(1, { rate: "0.081" });
    seed(2, { rate: "0.082" });
    expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.082);
  });

  it("caps Redis TTL at the observation expiry", async () => {
    seed(1, { validTo: "2026-11-05 12:01:00" });
    await getExchangeRate("SAR", "KWD");
    expect(boundary.ttls.get(key)).toBe(60);
  });

  it("limits open-ended observations to one hour", async () => {
    seed(1, { validTo: null });
    await getExchangeRate("SAR", "KWD");
    expect(boundary.ttls.get(key)).toBe(3600);
  });

  it("rechecks expiry independently of the cache TTL", async () => {
    seed(1, { validTo: "2026-11-05 12:01:00" });
    await getExchangeRate("SAR", "KWD");
    vi.setSystemTime(new Date("2026-11-05T12:02:00Z"));
    seed(2, { rate: "0.084", validFrom: "2026-11-05 12:01:00" });
    expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.084);
  });

  it.each(["old-version", "wrong-pair", "bad-date", "future", "zero-rate"])(
    "does not admit a %s cache envelope",
    async invalid => {
      seed(1);
      await getExchangeRate("SAR", "KWD");
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

  it("does not cache fallback estimates", async () => {
    expect((await getExchangeRate("SAR", "KWD")).source).toBe("fallback");
    expect(boundary.cache.size).toBe(0);
    seed(1, { rate: "0.085" });
    expect((await getExchangeRate("SAR", "KWD")).rate).toBe(0.085);
  });

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
    expect(boundary.ttls.get("exchange_rate:v2:USD_KWD")).toBe(60);
  });
});
