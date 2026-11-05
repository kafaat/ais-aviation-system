/**
 * Multi-Currency Support Service
 *
 * Provides currency conversion and management:
 * - Real-time exchange rates
 * - Currency conversion
 * - Price formatting
 * - Rate caching
 *
 * @module services/currency/currency.service
 */

import { getDb } from "../../db";
import { exchangeRates } from "../../../drizzle/schema";
import {
  DISPLAY_RATE_MAX_AGE_MS,
  DISPLAY_RATE_SOURCES,
  type DisplayCurrency,
} from "../../../shared/ibe-search";
import { eq, and, asc, desc, gt, lte, inArray, isNull, or } from "drizzle-orm";
import { cacheService as CacheService } from "../cache.service";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface Currency {
  code: string;
  name: string;
  nameAr: string;
  symbol: string;
  decimalPlaces: number;
  isActive: boolean;
}

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  inverseRate: number;
  source: string;
  updatedAt: Date;
}

export interface ConversionResult {
  originalAmount: number;
  originalCurrency: string;
  convertedAmount: number;
  targetCurrency: string;
  exchangeRate: number;
  formattedOriginal: string;
  formattedConverted: string;
  rateTimestamp: Date;
}

export interface PriceDisplay {
  amount: number;
  currency: string;
  formatted: string;
  formattedWithSymbol: string;
}

// ============================================================================
// Constants
// ============================================================================

// Supported currencies
export const SUPPORTED_CURRENCIES: Currency[] = [
  {
    code: "SAR",
    name: "Saudi Riyal",
    nameAr: "ريال سعودي",
    symbol: "ر.س",
    decimalPlaces: 2,
    isActive: true,
  },
  {
    code: "USD",
    name: "US Dollar",
    nameAr: "دولار أمريكي",
    symbol: "$",
    decimalPlaces: 2,
    isActive: true,
  },
  {
    code: "EUR",
    name: "Euro",
    nameAr: "يورو",
    symbol: "€",
    decimalPlaces: 2,
    isActive: true,
  },
  {
    code: "AED",
    name: "UAE Dirham",
    nameAr: "درهم إماراتي",
    symbol: "د.إ",
    decimalPlaces: 2,
    isActive: true,
  },
  {
    code: "GBP",
    name: "British Pound",
    nameAr: "جنيه إسترليني",
    symbol: "£",
    decimalPlaces: 2,
    isActive: true,
  },
  {
    code: "KWD",
    name: "Kuwaiti Dinar",
    nameAr: "دينار كويتي",
    symbol: "د.ك",
    decimalPlaces: 3,
    isActive: true,
  },
  {
    code: "BHD",
    name: "Bahraini Dinar",
    nameAr: "دينار بحريني",
    symbol: "د.ب",
    decimalPlaces: 3,
    isActive: true,
  },
  {
    code: "QAR",
    name: "Qatari Riyal",
    nameAr: "ريال قطري",
    symbol: "ر.ق",
    decimalPlaces: 2,
    isActive: true,
  },
  {
    code: "OMR",
    name: "Omani Rial",
    nameAr: "ريال عماني",
    symbol: "ر.ع",
    decimalPlaces: 3,
    isActive: true,
  },
  {
    code: "EGP",
    name: "Egyptian Pound",
    nameAr: "جنيه مصري",
    symbol: "ج.م",
    decimalPlaces: 2,
    isActive: true,
  },
];

// Base currency for all conversions
const BASE_CURRENCY = "SAR";

// Cache TTL for exchange rates (1 hour)
const RATE_CACHE_TTL = 60 * 60;

// Fallback rates (updated periodically)
const FALLBACK_RATES: Record<string, number> = {
  SAR_USD: 0.2666,
  SAR_EUR: 0.245,
  SAR_AED: 0.9793,
  SAR_GBP: 0.21,
  SAR_KWD: 0.082,
  SAR_BHD: 0.1004,
  SAR_QAR: 0.9707,
  SAR_OMR: 0.1026,
  SAR_EGP: 8.24,
  USD_SAR: 3.75,
  EUR_SAR: 4.0816,
  AED_SAR: 1.0211,
  GBP_SAR: 4.7619,
  KWD_SAR: 12.1951,
  BHD_SAR: 9.9602,
  QAR_SAR: 1.0302,
  OMR_SAR: 9.7466,
  EGP_SAR: 0.1214,
};

// ============================================================================
// Main Currency Service
// ============================================================================

/** Exact decimal ratios remain JSON-safe without rounding through a JS number. */
interface ExactRate {
  numerator: string;
  denominator: string;
}

const UNIT_RATE: ExactRate = { numerator: "1", denominator: "1" };

/** Internal cache envelope; the public ExchangeRate contract is unchanged. */
interface RateSnapshot {
  version: 3;
  quote: ExchangeRate;
  exactRate: ExactRate;
  validFrom: Date;
  expiresAt: Date;
}

function exactRate(value: string | number): ExactRate {
  const [numerator, denominator] = decimalRatio(value);
  return {
    numerator: numerator.toString(),
    denominator: denominator.toString(),
  };
}

function rateAsNumber(rate: ExactRate): number {
  // Every denominator is a power of ten. Parse a single decimal representation
  // for the public DTO, rather than introducing a floating-point division.
  return Number(`${rate.numerator}e-${rate.denominator.length - 1}`);
}

function decodeExactRate(value: unknown): ExactRate | null {
  if (!value || typeof value !== "object") return null;
  const rate = value as Partial<ExactRate>;
  // A database decimal has at most 18 digits; a two-leg product has at most 36.
  // Bound malformed cache input before BigInt parsing, and require powers of ten.
  if (
    typeof rate.numerator !== "string" ||
    !/^[1-9]\d{0,63}$/.test(rate.numerator) ||
    typeof rate.denominator !== "string" ||
    !/^10{0,63}$/.test(rate.denominator)
  )
    return null;
  return { numerator: rate.numerator, denominator: rate.denominator };
}

function cacheDate(value: unknown): Date | null {
  if (!(value instanceof Date) && typeof value !== "string") {
    return null;
  }
  const date = new Date(value instanceof Date ? value.getTime() : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function decodeRateSnapshot(
  value: unknown,
  from: string,
  to: string,
  now: Date
): RateSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<RateSnapshot>;
  const quote = record.quote;
  const validFrom = cacheDate(record.validFrom);
  const expiresAt = cacheDate(record.expiresAt);
  const updatedAt = cacheDate(quote?.updatedAt);
  const ratio = decodeExactRate(record.exactRate);
  if (
    record.version !== 3 ||
    !quote ||
    quote.fromCurrency !== from ||
    quote.toCurrency !== to ||
    typeof quote.rate !== "number" ||
    !Number.isFinite(quote.rate) ||
    quote.rate <= 0 ||
    !Number.isFinite(1 / quote.rate) ||
    !ratio ||
    rateAsNumber(ratio) !== quote.rate ||
    typeof quote.source !== "string" ||
    !quote.source ||
    !validFrom ||
    !expiresAt ||
    !updatedAt ||
    validFrom > now ||
    expiresAt <= now
  ) {
    return null;
  }
  return {
    version: 3,
    quote: { ...quote, inverseRate: 1 / quote.rate, updatedAt },
    exactRate: ratio,
    validFrom,
    expiresAt,
  };
}

async function cacheRate(key: string, snapshot: RateSnapshot) {
  const remaining = snapshot.expiresAt.getTime() - Date.now();
  const ttl = Math.min(Math.floor(remaining / 1000), RATE_CACHE_TTL);
  // Never extend the observation's validity window across a Redis round trip.
  if (ttl > 0) {
    await CacheService.set(key, snapshot, ttl);
  }
}

async function getRateSnapshot(
  from: string,
  to: string
): Promise<RateSnapshot> {
  getCurrencyInfo(from);
  getCurrencyInfo(to);
  const now = new Date();
  if (from === to) {
    return {
      version: 3,
      quote: {
        fromCurrency: from,
        toCurrency: to,
        rate: 1,
        inverseRate: 1,
        source: "identity",
        updatedAt: now,
      },
      exactRate: UNIT_RATE,
      validFrom: now,
      expiresAt: new Date(now.getTime() + RATE_CACHE_TTL * 1000),
    };
  }
  // Older envelopes did not preserve the exact decimal cross product. Never
  // reconstruct that financial value from an imprecise legacy numeric quote.
  const key = `exchange_rate:v3:${from}_${to}`;
  const value = await CacheService.get<unknown>(key);
  const cached = decodeRateSnapshot(value, from, to, new Date());
  if (cached) {
    return cached;
  }
  const observed = await getDbExchangeRate(from, to, new Date());
  if (observed?.snapshot) {
    await cacheRate(key, observed.snapshot);
    return observed.snapshot;
  }
  if (from !== BASE_CURRENCY && to !== BASE_CURRENCY) {
    const first = await getRateSnapshot(from, BASE_CURRENCY);
    const second = await getRateSnapshot(BASE_CURRENCY, to);
    const ratio: ExactRate = {
      numerator: (
        BigInt(first.exactRate.numerator) * BigInt(second.exactRate.numerator)
      ).toString(),
      denominator: (
        BigInt(first.exactRate.denominator) *
        BigInt(second.exactRate.denominator)
      ).toString(),
    };
    const rate = rateAsNumber(ratio);
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(1 / rate)) {
      throw new Error("Invalid cross exchange rate");
    }
    const firstFallback = first.quote.source.includes("fallback");
    const secondFallback = second.quote.source.includes("fallback");
    const fallback = firstFallback || secondFallback;
    const oldest = Math.min(
      first.quote.updatedAt.getTime(),
      second.quote.updatedAt.getTime()
    );
    const starts = Math.max(
      first.validFrom.getTime(),
      second.validFrom.getTime()
    );
    const expires = Math.min(
      first.expiresAt.getTime(),
      second.expiresAt.getTime(),
      observed?.nextValidFrom?.getTime() ?? Infinity
    );
    const cross: RateSnapshot = {
      version: 3,
      quote: {
        fromCurrency: from,
        toCurrency: to,
        rate,
        inverseRate: 1 / rate,
        source: fallback ? "cross_rate_fallback" : "cross_rate",
        updatedAt: new Date(oldest),
      },
      exactRate: ratio,
      validFrom: new Date(starts),
      expiresAt: new Date(expires),
    };
    if (expires <= Date.now()) {
      throw new Error("Exchange rate expired during conversion");
    }
    // A failed direct lookup leaves its next effective boundary unknown.
    if (!fallback && observed) {
      await cacheRate(key, cross);
    }
    return cross;
  }
  // Constants remain explicitly labelled estimates, never cached observations.
  const rate = FALLBACK_RATES[`${from}_${to}`];
  if (!rate) {
    throw new Error(`Exchange rate not found: ${from} to ${to}`);
  }
  const fallbackTime = new Date();
  return {
    version: 3,
    quote: {
      fromCurrency: from,
      toCurrency: to,
      rate,
      inverseRate: 1 / rate,
      source: "fallback",
      updatedAt: fallbackTime,
    },
    exactRate: exactRate(rate),
    validFrom: fallbackTime,
    expiresAt: new Date(fallbackTime.getTime() + RATE_CACHE_TTL * 1000),
  };
}

/** Validate synchronously after the caller's final database/cache await. */
function requireCurrentRateSnapshot(
  snapshot: RateSnapshot,
  from: string,
  to: string
): RateSnapshot {
  const current = decodeRateSnapshot(snapshot, from, to, new Date());
  if (!current) {
    throw new Error("Exchange rate expired during conversion");
  }
  return current;
}

/** Restore Date and recheck expiry after all database/cache awaits finish. */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string
): Promise<ExchangeRate> {
  const snapshot = await getRateSnapshot(fromCurrency, toCurrency);
  return requireCurrentRateSnapshot(snapshot, fromCurrency, toCurrency).quote;
}

/** Public fare estimates read only direct, currently effective observations. */
export async function getDisplayExchangeRate(currency: DisplayCurrency) {
  const db = await getDb();
  if (!db || currency === "SAR") return null;
  const now = new Date();
  const [quote] = await db
    .select({
      rate: exchangeRates.rate,
      source: exchangeRates.source,
      validFrom: exchangeRates.validFrom,
      validTo: exchangeRates.validTo,
    })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.fromCurrency, "SAR"),
        eq(exchangeRates.toCurrency, currency),
        inArray(exchangeRates.source, [...DISPLAY_RATE_SOURCES]),
        gt(exchangeRates.rate, "0"),
        gt(
          exchangeRates.validFrom,
          new Date(now.getTime() - DISPLAY_RATE_MAX_AGE_MS)
        ),
        lte(exchangeRates.validFrom, now),
        or(isNull(exchangeRates.validTo), gt(exchangeRates.validTo, now))
      )
    )
    .orderBy(desc(exchangeRates.validFrom), desc(exchangeRates.id))
    .limit(1);
  if (!quote?.source) return null;
  const maxExpiry = quote.validFrom.getTime() + DISPLAY_RATE_MAX_AGE_MS;
  return {
    fromCurrency: "SAR",
    toCurrency: currency,
    rate: Number(quote.rate),
    source: quote.source.toLowerCase(),
    updatedAt: quote.validFrom,
    expiresAt: new Date(
      Math.min(maxExpiry, quote.validTo?.getTime() ?? maxExpiry)
    ),
  };
}

/** Select a currently effective observation, not the most recently edited row. */
async function getDbExchangeRate(
  from: string,
  to: string,
  now: Date
): Promise<{
  snapshot: RateSnapshot | null;
  nextValidFrom: Date | null;
} | null> {
  let result: typeof exchangeRates.$inferSelect | undefined;
  let next: Pick<typeof exchangeRates.$inferSelect, "validFrom"> | undefined;
  try {
    const database = await getDb();
    if (!database) {
      return null;
    }
    [result] = await database
      .select()
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.fromCurrency, from),
          eq(exchangeRates.toCurrency, to),
          gt(exchangeRates.rate, "0"),
          lte(exchangeRates.validFrom, now),
          or(isNull(exchangeRates.validTo), gt(exchangeRates.validTo, now))
        )
      )
      .orderBy(desc(exchangeRates.validFrom), desc(exchangeRates.id))
      .limit(1);
    [next] = await database
      .select({ validFrom: exchangeRates.validFrom })
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.fromCurrency, from),
          eq(exchangeRates.toCurrency, to),
          gt(exchangeRates.rate, "0"),
          gt(exchangeRates.validFrom, now),
          or(
            isNull(exchangeRates.validTo),
            gt(exchangeRates.validTo, exchangeRates.validFrom)
          )
        )
      )
      .orderBy(asc(exchangeRates.validFrom), desc(exchangeRates.id))
      .limit(1);
  } catch (error) {
    // A pool-backed database handle can survive a disconnect. Only query
    // failures permit labelled estimates; malformed observations below do not.
    console.error(
      JSON.stringify({
        event: "exchange_rate_query_failed",
        fromCurrency: from,
        toCurrency: to,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      })
    );
    return null;
  }
  const nextValidFrom = next ? cacheDate(next.validFrom) : null;
  if (next && (!nextValidFrom || nextValidFrom <= now)) {
    throw new Error("Invalid future exchange rate observation");
  }
  if (!result) {
    return { snapshot: null, nextValidFrom };
  }
  // Preserve the database decimal before creating the numeric public DTO.
  const ratio = exactRate(result.rate);
  const rate = rateAsNumber(ratio);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(1 / rate)) {
    throw new Error("Invalid exchange rate observation");
  }
  const maxExpiry = now.getTime() + RATE_CACHE_TTL * 1000;
  const expires = Math.min(
    maxExpiry,
    result.validTo?.getTime() ?? Infinity,
    nextValidFrom?.getTime() ?? Infinity
  );
  const snapshot: RateSnapshot = {
    version: 3,
    quote: {
      fromCurrency: result.fromCurrency,
      toCurrency: result.toCurrency,
      rate,
      inverseRate: 1 / rate,
      source: result.source || "database",
      updatedAt: result.updatedAt,
    },
    exactRate: ratio,
    validFrom: result.validFrom,
    expiresAt: new Date(expires),
  };
  const validated = decodeRateSnapshot(snapshot, from, to, new Date());
  if (!validated) {
    throw new Error("Exchange rate observation is not currently valid");
  }
  return { snapshot: validated, nextValidFrom };
}

/** Preserve database decimals and the API number's decimal representation. */
function decimalRatio(value: string | number): [bigint, bigint] {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Non-finite monetary amount");
  }
  if (
    typeof value === "string" &&
    (value.length > 64 || !/^[+-]?\d+(?:\.\d+)?$/.test(value))
  ) {
    throw new Error("Invalid exchange rate observation");
  }
  const parts = String(value).toLowerCase().split("e");
  const [mantissa, exponentText = "0"] = parts;
  const sign = mantissa.startsWith("-") ? -1n : 1n;
  const unsigned = mantissa.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const scale = fraction.length - Number(exponentText);
  const digits = sign * BigInt(whole + fraction);
  if (scale >= 0) {
    return [digits, 10n ** BigInt(scale)];
  }
  const factor = 10n ** BigInt(-scale);
  return [digits * factor, 1n];
}

function roundedMinor(
  amount: number,
  rate: ExactRate,
  currency: string
): number {
  const [a, ad] = decimalRatio(amount);
  const r = BigInt(rate.numerator);
  const rd = BigInt(rate.denominator);
  const denominator = ad * rd;
  const scale = 10n ** BigInt(getCurrencyInfo(currency).decimalPlaces);
  const numerator = a * r * scale;
  const magnitude = numerator < 0n ? -numerator : numerator;
  // Half away from zero, once, at the target minor-unit boundary.
  const half = denominator / 2n;
  const rounded = (magnitude + half) / denominator;
  const result = Number(numerator < 0n ? -rounded : rounded);
  if (!Number.isSafeInteger(result)) {
    throw new Error("Monetary amount exceeds safe minor units");
  }
  return result;
}

export function toMinorUnits(amount: number, currency: string): number {
  return roundedMinor(amount, UNIT_RATE, currency);
}

export function fromMinorUnits(amount: number, currency: string): number {
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Invalid minor-unit amount");
  }
  const scale = 10 ** getCurrencyInfo(currency).decimalPlaces;
  const major = amount / scale;
  if (roundedMinor(major, UNIT_RATE, currency) !== amount) {
    throw new Error("Minor units cannot be represented as a public amount");
  }
  return major;
}

/**
 * Convert amount between currencies
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<ConversionResult> {
  const snapshot = requireCurrentRateSnapshot(
    await getRateSnapshot(fromCurrency, toCurrency),
    fromCurrency,
    toCurrency
  );
  const rate = snapshot.quote;
  const convertedAmount = fromMinorUnits(
    roundedMinor(amount, snapshot.exactRate, toCurrency),
    toCurrency
  );

  const fromCurrencyInfo = getCurrencyInfo(fromCurrency);
  const toCurrencyInfo = getCurrencyInfo(toCurrency);

  return {
    originalAmount: amount,
    originalCurrency: fromCurrency,
    convertedAmount,
    targetCurrency: toCurrency,
    exchangeRate: rate.rate,
    formattedOriginal: formatAmount(amount, fromCurrencyInfo),
    formattedConverted: formatAmount(convertedAmount, toCurrencyInfo),
    rateTimestamp: rate.updatedAt,
  };
}

/**
 * Convert price for display in user's preferred currency
 */
export async function convertPriceForDisplay(
  priceInSAR: number,
  targetCurrency: string
): Promise<PriceDisplay> {
  if (targetCurrency === "SAR") {
    const currencyInfo = getCurrencyInfo("SAR");
    return {
      amount: priceInSAR,
      currency: "SAR",
      formatted: formatAmount(priceInSAR, currencyInfo),
      formattedWithSymbol: `${currencyInfo.symbol} ${formatAmount(priceInSAR, currencyInfo)}`,
    };
  }

  const conversion = await convertCurrency(priceInSAR, "SAR", targetCurrency);
  const currencyInfo = getCurrencyInfo(targetCurrency);

  return {
    amount: conversion.convertedAmount,
    currency: targetCurrency,
    formatted: formatAmount(conversion.convertedAmount, currencyInfo),
    formattedWithSymbol: `${currencyInfo.symbol} ${formatAmount(conversion.convertedAmount, currencyInfo)}`,
  };
}

/**
 * Get currency information
 */
export function getCurrencyInfo(code: string): Currency {
  const currency = SUPPORTED_CURRENCIES.find(c => c.code === code);
  if (!currency) {
    throw new Error(`Unsupported currency: ${code}`);
  }
  return currency;
}

/**
 * Get all supported currencies
 */
export function getSupportedCurrencies(): Currency[] {
  return SUPPORTED_CURRENCIES.filter(c => c.isActive);
}

/**
 * Check if currency is supported
 */
export function isCurrencySupported(code: string): boolean {
  return SUPPORTED_CURRENCIES.some(c => c.code === code && c.isActive);
}

/**
 * Format amount according to currency rules
 */
export function formatAmount(amount: number, currency: Currency): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: currency.decimalPlaces,
    maximumFractionDigits: currency.decimalPlaces,
  });
}

/**
 * Format price with currency symbol
 */
export function formatPrice(amount: number, currencyCode: string): string {
  const currency = getCurrencyInfo(currencyCode);
  const formatted = formatAmount(amount, currency);

  // Arabic currencies typically show symbol after amount
  const arabicCurrencies = ["SAR", "AED", "KWD", "BHD", "QAR", "OMR", "EGP"];
  if (arabicCurrencies.includes(currencyCode)) {
    return `${formatted} ${currency.symbol}`;
  }

  return `${currency.symbol}${formatted}`;
}

/**
 * Parse amount from formatted string
 */
export function parseAmount(formattedAmount: string): number {
  // Remove currency symbols and formatting
  const cleaned = formattedAmount.replace(/[^\d.,\-]/g, "").replace(/,/g, "");

  return parseFloat(cleaned);
}

// ============================================================================
// Exchange Rate Updates
// ============================================================================

/**
 * Update exchange rates from external API
 * Should be called periodically (e.g., every hour)
 */
export async function updateExchangeRates(): Promise<void> {
  console.info(
    JSON.stringify({
      event: "exchange_rates_update_started",
      timestamp: new Date().toISOString(),
    })
  );

  try {
    // In production, this would call an external API like:
    // - Open Exchange Rates
    // - Fixer.io
    // - XE
    // - Central Bank APIs

    // For now, we'll use the fallback rates
    for (const [key, _rate] of Object.entries(FALLBACK_RATES)) {
      const [from, to] = key.split("_");

      // Update database
      // await db.insert(exchangeRates).values({
      //   fromCurrency: from,
      //   toCurrency: to,
      //   rate: rate.toString(),
      //   source: 'fallback',
      //   updatedAt: new Date(),
      // }).onDuplicateKeyUpdate({
      //   set: { rate: rate.toString(), updatedAt: new Date() }
      // });

      // Invalidate cache
      const cacheKey = `exchange_rate:${from}_${to}`;
      await CacheService.del(cacheKey);
      await CacheService.del(`exchange_rate:v2:${from}_${to}`);
      await CacheService.del(`exchange_rate:v3:${from}_${to}`);
    }

    console.info(
      JSON.stringify({
        event: "exchange_rates_update_completed",
        ratesUpdated: Object.keys(FALLBACK_RATES).length,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "exchange_rates_update_failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      })
    );
  }
}

/**
 * Get historical exchange rates
 */
export function getHistoricalRates(
  fromCurrency: string,
  toCurrency: string,
  _days: number = 30
): { date: Date; rate: number }[] {
  // This would query historical data from the database
  // For now, return empty array
  return [];
}

// ============================================================================
// Exports
// ============================================================================

export const CurrencyService = {
  getExchangeRate,
  toMinorUnits,
  fromMinorUnits,
  convertCurrency,
  convertPriceForDisplay,
  getCurrencyInfo,
  getSupportedCurrencies,
  isCurrencySupported,
  formatAmount,
  formatPrice,
  parseAmount,
  updateExchangeRates,
  getHistoricalRates,
};

export default CurrencyService;
