import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("../../db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

// Mock the cache service
vi.mock("../../services/cache.service", () => ({
  cacheService: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock drizzle schema
vi.mock("../../../drizzle/schema", () => ({
  exchangeRates: {
    fromCurrency: "fromCurrency",
    toCurrency: "toCurrency",
    rate: "rate",
    source: "source",
    updatedAt: "updatedAt",
  },
  currencies: {
    code: "code",
    name: "name",
  },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ type: "eq", a, b })),
  and: vi.fn((...args) => ({ type: "and", args })),
  gte: vi.fn((a, b) => ({ type: "gte", a, b })),
  desc: vi.fn(a => ({ type: "desc", a })),
}));

describe("Currency Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getExchangeRate", () => {
    it("should return 1.0 for same currency conversion", async () => {
      const { getExchangeRate } = await import(
        "../../services/currency/currency.service"
      );

      const rate = await getExchangeRate("SAR", "SAR");

      expect(rate.rate).toBe(1);
      expect(rate.fromCurrency).toBe("SAR");
      expect(rate.toCurrency).toBe("SAR");
      expect(rate.source).toBe("identity");
    });

    it("should return fallback rate for SAR to USD", async () => {
      const { getExchangeRate } = await import(
        "../../services/currency/currency.service"
      );

      const rate = await getExchangeRate("SAR", "USD");

      expect(rate.rate).toBeCloseTo(0.2666, 3);
      expect(rate.fromCurrency).toBe("SAR");
      expect(rate.toCurrency).toBe("USD");
      expect(rate.source).toBe("fallback");
    });

    it("should return fallback rate for USD to SAR", async () => {
      const { getExchangeRate } = await import(
        "../../services/currency/currency.service"
      );

      const rate = await getExchangeRate("USD", "SAR");

      expect(rate.rate).toBe(3.75);
      expect(rate.source).toBe("fallback");
    });

    it("should return fallback rate for SAR to EUR", async () => {
      const { getExchangeRate } = await import(
        "../../services/currency/currency.service"
      );

      const rate = await getExchangeRate("SAR", "EUR");

      expect(rate.rate).toBeCloseTo(0.245, 3);
    });

    it("should return fallback rate for SAR to GBP", async () => {
      const { getExchangeRate } = await import(
        "../../services/currency/currency.service"
      );

      const rate = await getExchangeRate("SAR", "GBP");

      expect(rate.rate).toBeCloseTo(0.21, 2);
    });

    it("should return fallback rate for SAR to AED", async () => {
      const { getExchangeRate } = await import(
        "../../services/currency/currency.service"
      );

      const rate = await getExchangeRate("SAR", "AED");

      expect(rate.rate).toBeCloseTo(0.9793, 3);
    });
  });

  describe("convertCurrency", () => {
    it("should return same amount for same currency", async () => {
      const { convertCurrency } = await import(
        "../../services/currency/currency.service"
      );

      const result = await convertCurrency(100, "SAR", "SAR");

      expect(result.convertedAmount).toBe(100);
      expect(result.exchangeRate).toBe(1);
    });

    it("should convert SAR to USD correctly", async () => {
      const { convertCurrency } = await import(
        "../../services/currency/currency.service"
      );

      const result = await convertCurrency(1000, "SAR", "USD");

      // 1000 SAR * 0.2666 = ~266.60 USD
      expect(result.convertedAmount).toBeCloseTo(266.6, 1);
      expect(result.originalCurrency).toBe("SAR");
      expect(result.targetCurrency).toBe("USD");
    });

    it("should convert USD to SAR correctly", async () => {
      const { convertCurrency } = await import(
        "../../services/currency/currency.service"
      );

      const result = await convertCurrency(100, "USD", "SAR");

      // 100 USD * 3.75 = 375 SAR
      expect(result.convertedAmount).toBe(375);
    });
  });

  describe("convertPriceForDisplay", () => {
    it("should return SAR price unchanged", async () => {
      const { convertPriceForDisplay } = await import(
        "../../services/currency/currency.service"
      );

      const result = await convertPriceForDisplay(500, "SAR");

      expect(result.amount).toBe(500);
      expect(result.currency).toBe("SAR");
      expect(result.formatted).toContain("500");
    });

    it("should convert to USD for display", async () => {
      const { convertPriceForDisplay } = await import(
        "../../services/currency/currency.service"
      );

      const result = await convertPriceForDisplay(1000, "USD");

      expect(result.currency).toBe("USD");
      expect(result.amount).toBeCloseTo(266.6, 1);
    });
  });

  describe("getCurrencyInfo", () => {
    it("should return SAR currency info", async () => {
      const { getCurrencyInfo } = await import(
        "../../services/currency/currency.service"
      );

      const info = getCurrencyInfo("SAR");

      expect(info.code).toBe("SAR");
      expect(info.name).toBe("Saudi Riyal");
      expect(info.symbol).toBe("ر.س");
      expect(info.decimalPlaces).toBe(2);
    });

    it("should return USD currency info", async () => {
      const { getCurrencyInfo } = await import(
        "../../services/currency/currency.service"
      );

      const info = getCurrencyInfo("USD");

      expect(info.code).toBe("USD");
      expect(info.name).toBe("US Dollar");
      expect(info.symbol).toBe("$");
    });

    it("should throw error for unsupported currency", async () => {
      const { getCurrencyInfo } = await import(
        "../../services/currency/currency.service"
      );

      expect(() => getCurrencyInfo("XYZ")).toThrow("Unsupported currency: XYZ");
    });
  });

  describe("getSupportedCurrencies", () => {
    it("should return list of supported currencies", async () => {
      const { getSupportedCurrencies } = await import(
        "../../services/currency/currency.service"
      );

      const currencies = getSupportedCurrencies();

      expect(currencies.length).toBeGreaterThan(0);
      expect(currencies.some(c => c.code === "SAR")).toBe(true);
      expect(currencies.some(c => c.code === "USD")).toBe(true);
      expect(currencies.some(c => c.code === "EUR")).toBe(true);
    });
  });

  describe("isCurrencySupported", () => {
    it("should return true for supported currencies", async () => {
      const { isCurrencySupported } = await import(
        "../../services/currency/currency.service"
      );

      expect(isCurrencySupported("SAR")).toBe(true);
      expect(isCurrencySupported("USD")).toBe(true);
      expect(isCurrencySupported("EUR")).toBe(true);
    });

    it("should return false for unsupported currencies", async () => {
      const { isCurrencySupported } = await import(
        "../../services/currency/currency.service"
      );

      expect(isCurrencySupported("XYZ")).toBe(false);
      expect(isCurrencySupported("ABC")).toBe(false);
    });
  });

  describe("formatAmount", () => {
    it("should format SAR amount correctly", async () => {
      const { formatAmount, getCurrencyInfo } = await import(
        "../../services/currency/currency.service"
      );

      const sarInfo = getCurrencyInfo("SAR");
      const formatted = formatAmount(1234.56, sarInfo);

      expect(formatted).toContain("1,234.56");
    });

    it("should format KWD with 3 decimal places", async () => {
      const { formatAmount, getCurrencyInfo } = await import(
        "../../services/currency/currency.service"
      );

      const kwdInfo = getCurrencyInfo("KWD");
      const formatted = formatAmount(1234.567, kwdInfo);

      expect(formatted).toContain("1,234.567");
    });
  });

  describe("formatPrice", () => {
    it("should format SAR with symbol after amount", async () => {
      const { formatPrice } = await import(
        "../../services/currency/currency.service"
      );

      const formatted = formatPrice(500, "SAR");

      expect(formatted).toContain("500");
      expect(formatted).toContain("ر.س");
    });

    it("should format USD with symbol before amount", async () => {
      const { formatPrice } = await import(
        "../../services/currency/currency.service"
      );

      const formatted = formatPrice(500, "USD");

      expect(formatted).toBe("$500.00");
    });

    it("should format EUR with symbol before amount", async () => {
      const { formatPrice } = await import(
        "../../services/currency/currency.service"
      );

      const formatted = formatPrice(500, "EUR");

      expect(formatted).toBe("€500.00");
    });
  });

  describe("parseAmount", () => {
    it("should parse formatted amount correctly", async () => {
      const { parseAmount } = await import(
        "../../services/currency/currency.service"
      );

      expect(parseAmount("1,234.56")).toBe(1234.56);
      expect(parseAmount("$500.00")).toBe(500);
      expect(parseAmount("500.00 ر.س")).toBe(500);
    });

    it("should handle amounts without formatting", async () => {
      const { parseAmount } = await import(
        "../../services/currency/currency.service"
      );

      expect(parseAmount("500")).toBe(500);
      expect(parseAmount("123.45")).toBe(123.45);
    });
  });
});
