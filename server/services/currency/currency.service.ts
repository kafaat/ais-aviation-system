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
import { eq, and, desc, gt, lte, inArray, isNull, or } from "drizzle-orm";
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

/** The cache envelope is internal; the public ExchangeRate DTO is unchanged. */
interface RateSnapshot {
  version: 2;
  quote: ExchangeRate;
  validFrom: Date;
  expiresAt: Date;
}

function cacheDate(value: unknown): Date | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = new Date(value instanceof Date ? value.getTime() : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function decodeRateSnapshot(
  value: unknown,
  fromCurrency: string,
  toCurrency: string,
  now: Date
): RateSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RateSnapshot>;
  const quote = record.quote;
  const validFrom = cacheDate(record.validFrom);
  const expiresAt = cacheDate(record.expiresAt);
  const updatedAt = cacheDate(quote?.updatedAt);
  if (
    record.version !== 2 ||
    !quote ||
    quote.fromCurrency !== fromCurrency ||
    quote.toCurrency !== toCurrency ||
    typeof quote.rate !== "number" ||
    !Number.isFinite(quote.rate) ||
    quote.rate <= 0 ||
    !Number.isFinite(1 / quote.rate) ||
    typeof quote.source !== "string" ||
    !quote.source ||
    !validFrom ||
    !expiresAt ||
    !updatedAt ||
    validFrom > now ||
    expiresAt <= now
  )
    return null;
  return {
    version: 2,
    quote: { ...quote, inverseRate: 1 / quote.rate, updatedAt },
    validFrom,
    expiresAt,
  };
}

async function cacheRate(key: string, snapshot: RateSnapshot) {
  // Never extend a provider validity window, including across Redis round trips.
  const ttl = Math.floor((snapshot.expiresAt.getTime() - Date.now()) / 1000);
  if (ttl > 0)
    await CacheService.set(key, snapshot, Math.min(ttl, RATE_CACHE_TTL));
}

async function getRateSnapshot(
  fromCurrency: string,
  toCurrency: string
): Promise<RateSnapshot> {
  getCurrencyInfo(fromCurrency);
  getCurrencyInfo(toCurrency);
  const now = new Date();
  if (fromCurrency === toCurrency) {
    return {
      version: 2,
      quote: {
        fromCurrency,
        toCurrency,
        rate: 1,
        inverseRate: 1,
        source: "identity",
        updatedAt: now,
      },
      validFrom: now,
      expiresAt: new Date(now.getTime() + RATE_CACHE_TTL * 1000),
    };
  }
  // The versioned key prevents a legacy JSON object without validity metadata
  // from being accepted as a current observation after deployment.
  const key = `exchange_rate:v2:${fromCurrency}_${toCurrency}`;
  const cached = decodeRateSnapshot(
    await CacheService.get<unknown>(key),
    fromCurrency,
    toCurrency,
    now
  );
  if (cached) return cached;

  const direct = await getDbExchangeRate(fromCurrency, toCurrency, now);
  if (direct) {
    await cacheRate(key, direct);
    return direct;
  }
  if (fromCurrency !== BASE_CURRENCY && toCurrency !== BASE_CURRENCY) {
    const first = await getRateSnapshot(fromCurrency, BASE_CURRENCY);
    const second = await getRateSnapshot(BASE_CURRENCY, toCurrency);
    const rate = first.quote.rate * second.quote.rate;
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(1 / rate))
      throw new Error("Invalid cross exchange rate");
    const cross: RateSnapshot = {
      version: 2,
      quote: {
        fromCurrency,
        toCurrency,
        rate,
        inverseRate: 1 / rate,
        source: [first.quote.source, second.quote.source].some(s =>
          s.includes("fallback")
        )
          ? "cross_rate_fallback"
          : "cross_rate",
        updatedAt: new Date(
          Math.min(
            first.quote.updatedAt.getTime(),
            second.quote.updatedAt.getTime()
          )
        ),
      },
      validFrom: new Date(
        Math.max(first.validFrom.getTime(), second.validFrom.getTime())
      ),
      expiresAt: new Date(
        Math.min(first.expiresAt.getTime(), second.expiresAt.getTime())
      ),
    };
    if (cross.expiresAt.getTime() <= Date.now())
      throw new Error("Exchange rate expired during conversion");
    if (!cross.quote.source.includes("fallback")) await cacheRate(key, cross);
    return cross;
  }
  // These constants remain explicitly labelled estimates, not provider observations.
  const rate = FALLBACK_RATES[`${fromCurrency}_${toCurrency}`];
  if (!rate)
    throw new Error(
      `Exchange rate not found: ${fromCurrency} to ${toCurrency}`
    );
  const fallback: RateSnapshot = {
    version: 2,
    quote: {
      fromCurrency,
      toCurrency,
      rate,
      inverseRate: 1 / rate,
      source: "fallback",
      updatedAt: now,
    },
    validFrom: now,
    expiresAt: new Date(now.getTime() + RATE_CACHE_TTL * 1000),
  };
  // Do not cache a fallback: a newly supplied effective observation must win.
  return fallback;
}

/** Get a currently effective rate, restoring the public Date contract on cache hits. */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string
): Promise<ExchangeRate> {
  return (await getRateSnapshot(fromCurrency, toCurrency)).quote;
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

/**
 * Get exchange rate from database
 */
async function getDbExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  now: Date
): Promise<RateSnapshot | null> {
  const database = await getDb();
  if (!database) return null;
  const [result] = await database
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.fromCurrency, fromCurrency),
        eq(exchangeRates.toCurrency, toCurrency),
        gt(exchangeRates.rate, "0"),
        lte(exchangeRates.validFrom, now),
        or(isNull(exchangeRates.validTo), gt(exchangeRates.validTo, now))
      )
    )
    .orderBy(desc(exchangeRates.validFrom), desc(exchangeRates.id))
    .limit(1);
  if (!result) return null;
  const rate = Number(result.rate);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(1 / rate))
    throw new Error("Invalid exchange rate observation");
  const snapshot: RateSnapshot = {
    version: 2,
    quote: {
      fromCurrency: result.fromCurrency,
      toCurrency: result.toCurrency,
      rate,
      inverseRate: 1 / rate,
      source: result.source || "database",
      updatedAt: result.updatedAt,
    },
    validFrom: result.validFrom,
    expiresAt: new Date(
      Math.min(
        now.getTime() + RATE_CACHE_TTL * 1000,
        result.validTo?.getTime() ?? Infinity
      )
    ),
  };
  // Defensive validation also applies to malformed dates from a storage adapter.
  const validated = decodeRateSnapshot(
    snapshot,
    fromCurrency,
    toCurrency,
    new Date()
  );
  if (!validated)
    throw new Error("Exchange rate observation is not currently valid");
  return validated;
}

/** Decimal arithmetic over the API number's decimal representation. */
function decimalRatio(value: number): [bigint, bigint] {
  if (!Number.isFinite(value)) throw new Error("Non-finite monetary amount");
  const [mantissa, exponentText = "0"] = String(value).toLowerCase().split("e");
  const sign = mantissa.startsWith("-") ? -1n : 1n;
  const unsigned = mantissa.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const scale = fraction.length - Number(exponentText);
  const digits = sign * BigInt(whole + fraction);
  return scale >= 0
    ? [digits, 10n ** BigInt(scale)]
    : [digits * 10n ** BigInt(-scale), 1n];
}

function roundedMinor(amount: number, rate: number, currency: string): number {
  const [a, ad] = decimalRatio(amount);
  const [r, rd] = decimalRatio(rate);
  const denominator = ad * rd;
  const numerator =
    a * r * 10n ** BigInt(getCurrencyInfo(currency).decimalPlaces);
  const magnitude = numerator < 0n ? -numerator : numerator;
  // Half away from zero, once, at the target currency's minor-unit boundary.
  const rounded = (magnitude + denominator / 2n) / denominator;
  const result = Number(numerator < 0n ? -rounded : rounded);
  if (!Number.isSafeInteger(result))
    throw new Error("Monetary amount exceeds safe minor units");
  return result;
}

export function toMinorUnits(amount: number, currency: string): number {
  return roundedMinor(amount, 1, currency);
}
export function fromMinorUnits(amount: number, currency: string): number {
  if (!Number.isSafeInteger(amount))
    throw new Error("Invalid minor-unit amount");
  const major = amount / 10 ** getCurrencyInfo(currency).decimalPlaces;
  if (roundedMinor(major, 1, currency) !== amount)
    throw new Error(
      "Minor units cannot be represented by the public amount type"
    );
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
  const rate = await getExchangeRate(fromCurrency, toCurrency);
  const convertedAmount = fromMinorUnits(
    roundedMinor(amount, rate.rate, toCurrency),
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
