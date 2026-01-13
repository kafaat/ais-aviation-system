import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  fetchLatestExchangeRates,
  getExchangeRate,
  convertFromSAR,
  formatCurrency,
} from "../services/currency.service";

describe("Currency Service", () => {
  beforeAll(async () => {
    // Initialize exchange rates before tests
    await fetchLatestExchangeRates();
  });

  describe("fetchLatestExchangeRates", () => {
    it("should fetch and store exchange rates", async () => {
      await fetchLatestExchangeRates();

      // Verify rates are stored by trying to get one
      const usdRate = await getExchangeRate("USD");
      expect(usdRate).toBeGreaterThan(0);
    });
  });

  describe("getExchangeRate", () => {
    it("should return 1.0 for SAR to SAR", async () => {
      const rate = await getExchangeRate("SAR");
      expect(rate).toBe(1.0);
    });

    it("should return valid rate for USD", async () => {
      const rate = await getExchangeRate("USD");
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThan(1); // SAR is worth less than USD
    });

    it("should return valid rate for EUR", async () => {
      const rate = await getExchangeRate("EUR");
      expect(rate).toBeGreaterThan(0);
    });

    it("should return valid rate for GBP", async () => {
      const rate = await getExchangeRate("GBP");
      expect(rate).toBeGreaterThan(0);
    });

    it("should return valid rate for AED", async () => {
      const rate = await getExchangeRate("AED");
      expect(rate).toBeGreaterThan(0);
    });
  });

  describe("convertFromSAR", () => {
    it("should return same amount for SAR to SAR", async () => {
      const amount = 50000; // 500.00 SAR
      const converted = await convertFromSAR(amount, "SAR");
      expect(converted).toBe(amount);
    });

    it("should convert SAR to USD correctly", async () => {
      const amount = 100000; // 1000.00 SAR
      const converted = await convertFromSAR(amount, "USD");

      // USD should be less than SAR (approximately 0.27)
      expect(converted).toBeGreaterThan(0);
      expect(converted).toBeLessThan(amount);
    });

    it("should convert SAR to EUR correctly", async () => {
      const amount = 100000; // 1000.00 SAR
      const converted = await convertFromSAR(amount, "EUR");

      expect(converted).toBeGreaterThan(0);
      expect(converted).toBeLessThan(amount);
    });

    it("should handle small amounts", async () => {
      const amount = 100; // 1.00 SAR
      const converted = await convertFromSAR(amount, "USD");

      expect(converted).toBeGreaterThan(0);
    });

    it("should handle large amounts", async () => {
      const amount = 10000000; // 100,000.00 SAR
      const converted = await convertFromSAR(amount, "USD");

      expect(converted).toBeGreaterThan(0);
    });
  });

  describe("formatCurrency", () => {
    it("should format SAR correctly", () => {
      const formatted = formatCurrency(50000, "SAR");
      expect(formatted).toContain("﷼");
      expect(formatted).toContain("500.00");
    });

    it("should format USD correctly", () => {
      const formatted = formatCurrency(50000, "USD");
      expect(formatted).toContain("$");
      expect(formatted).toContain("500.00");
    });

    it("should format EUR correctly", () => {
      const formatted = formatCurrency(50000, "EUR");
      expect(formatted).toContain("€");
      expect(formatted).toContain("500.00");
    });

    it("should format GBP correctly", () => {
      const formatted = formatCurrency(50000, "GBP");
      expect(formatted).toContain("£");
      expect(formatted).toContain("500.00");
    });

    it("should format AED correctly", () => {
      const formatted = formatCurrency(50000, "AED");
      expect(formatted).toContain("د.إ");
      expect(formatted).toContain("500.00");
    });

    it("should handle zero amount", () => {
      const formatted = formatCurrency(0, "SAR");
      expect(formatted).toContain("0.00");
    });

    it("should handle decimal amounts correctly", () => {
      const formatted = formatCurrency(12345, "SAR"); // 123.45 SAR
      expect(formatted).toContain("123.45");
    });
  });
});
