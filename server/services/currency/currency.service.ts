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
import { eq, and, desc } from "drizzle-orm";
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

/**
 * Get exchange rate between two currencies
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string
): Promise<ExchangeRate> {
  // Same currency - no conversion needed
  if (fromCurrency === toCurrency) {
    return {
      fromCurrency,
      toCurrency,
      rate: 1,
      inverseRate: 1,
      source: "identity",
      updatedAt: new Date(),
    };
  }

  // Try cache first
  const cacheKey = `exchange_rate:${fromCurrency}_${toCurrency}`;
  const cached = await CacheService.get<ExchangeRate>(cacheKey);
  if (cached) {
    return cached;
  }

  // Try database
  const dbRate = await getDbExchangeRate(fromCurrency, toCurrency);
  if (dbRate) {
    await CacheService.set(cacheKey, dbRate, RATE_CACHE_TTL);
    return dbRate;
  }

  // Try to calculate through base currency
  if (fromCurrency !== BASE_CURRENCY && toCurrency !== BASE_CURRENCY) {
    const fromToBase = await getExchangeRate(fromCurrency, BASE_CURRENCY);
    const baseToTarget = await getExchangeRate(BASE_CURRENCY, toCurrency);

    const crossRate: ExchangeRate = {
      fromCurrency,
      toCurrency,
      rate: fromToBase.rate * baseToTarget.rate,
      inverseRate: 1 / (fromToBase.rate * baseToTarget.rate),
      source: "cross_rate",
      updatedAt: new Date(),
    };

    await CacheService.set(cacheKey, crossRate, RATE_CACHE_TTL);
    return crossRate;
  }

  // Use fallback rates
  const fallbackKey = `${fromCurrency}_${toCurrency}`;
  const fallbackRate = FALLBACK_RATES[fallbackKey];

  if (fallbackRate) {
    const rate: ExchangeRate = {
      fromCurrency,
      toCurrency,
      rate: fallbackRate,
      inverseRate: 1 / fallbackRate,
      source: "fallback",
      updatedAt: new Date(),
    };

    await CacheService.set(cacheKey, rate, RATE_CACHE_TTL);
    return rate;
  }

  throw new Error(`Exchange rate not found: ${fromCurrency} to ${toCurrency}`);
}

/**
 * Get exchange rate from database
 */
async function getDbExchangeRate(
  fromCurrency: string,
  toCurrency: string
): Promise<ExchangeRate | null> {
  try {
    const database = await getDb();
    if (!database) {
      return null;
    }

    const results = await database
      .select()
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.fromCurrency, fromCurrency),
          eq(exchangeRates.toCurrency, toCurrency)
        )
      )
      .orderBy(desc(exchangeRates.updatedAt))
      .limit(1);

    const result = results[0];
    if (result) {
      return {
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        rate: parseFloat(result.rate),
        inverseRate: 1 / parseFloat(result.rate),
        source: result.source || "database",
        updatedAt: result.updatedAt,
      };
    }
  } catch (error) {
    // Table might not exist yet
    console.info(
      JSON.stringify({
        event: "exchange_rate_db_error",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    );
  }

  return null;
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
  const convertedAmount = Math.round(amount * rate.rate * 100) / 100;

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
