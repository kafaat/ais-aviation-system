/**
 * Multi-Currency Support Service
 *
 * Provides currency conversion and management:
 * - Observed exchange rates (operator quotes, see operator-rates.service)
 * - Currency conversion
 * - Price formatting
 * - Rate caching
 *
 * Amounts are converted only with an observed, currently effective rate.
 * The hard-coded fallback constants can label an estimate returned by
 * getExchangeRate (source "fallback"); they never produce an amount. Every
 * pricing route, and convertPriceForDisplay, further requires the display
 * rule (an approved source, current, not superseded, observed less than 24
 * hours ago): a SAR price shown in another currency and convertPriceForDisplay
 * use the quote the display estimate would show (sarPriceConverter);
 * pricing.convertCurrency and pricing.getExchangeRate apply the same rule to
 * every observed leg (convertCurrencyWithDisplayRule,
 * getExchangeRateWithDisplayRule). The display rule reads MySQL on every
 * call: it never reads or writes a Redis snapshot, which is not re-checked
 * for supersession.
 *
 * @module services/currency/currency.service
 */

import { getDb } from "../../db";
import { exchangeRates } from "../../../drizzle/schema";
import {
  DISPLAY_CURRENCIES,
  DISPLAY_RATE_MAX_AGE_MS,
  DISPLAY_RATE_SOURCES,
  type DisplayCurrency,
} from "../../../shared/ibe-search";
import {
  eq,
  and,
  asc,
  desc,
  gt,
  lte,
  inArray,
  isNull,
  notExists,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
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

// Label-only estimates. Module-private: reachable solely through
// getExchangeRate and getExchangeRateWithDisplayRule, whose result names its
// source "fallback". Never an amount.
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

/** No observed, currently effective rate exists for the pair. */
export class ExchangeRateUnavailableError extends Error {
  constructor(
    readonly fromCurrency: string,
    readonly toCurrency: string
  ) {
    super(
      `No current exchange rate observation: ${fromCurrency} to ${toCurrency}`
    );
    this.name = "ExchangeRateUnavailableError";
  }
}

type Database = NonNullable<ReturnType<typeof getDb>>;

/** A row stops being eligible once a correction that names it has started. */
function notSuperseded(database: Database, now: Date) {
  const correction = alias(exchangeRates, "exchange_rate_correction");
  return notExists(
    database
      .select({ id: correction.id })
      .from(correction)
      .where(
        and(
          eq(correction.supersedesId, exchangeRates.id),
          lte(correction.validFrom, now)
        )
      )
  );
}

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

/**
 * How getRateSnapshot may answer. `estimate` admits the labelled fallback
 * constants, never an amount. `display` admits only observations that pass
 * the display rule, leg by leg (displaySnapshot), each read from MySQL on
 * every call with no Redis snapshot.
 */
interface RateRule {
  estimate: boolean;
  display: boolean;
}

/** convertCurrency: any observed, currently effective rate. */
const OBSERVED_RULE: RateRule = { estimate: false, display: false };
/** getExchangeRate: as OBSERVED_RULE, else the labelled estimate. */
const ESTIMATE_RULE: RateRule = { estimate: true, display: false };
/** pricing.convertCurrency: observations the display rule accepts. */
const DISPLAY_RULE: RateRule = { estimate: false, display: true };
/** pricing.getExchangeRate: as DISPLAY_RULE, else the labelled estimate. */
const DISPLAY_ESTIMATE_RULE: RateRule = { estimate: true, display: true };

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

function isDisplayRateSource(source: string): boolean {
  return (DISPLAY_RATE_SOURCES as readonly string[]).includes(source);
}

/**
 * The display rule for a direct observation just read from MySQL: the rule
 * findCurrentDisplayQuote applies to a SAR quote, applied to every observed
 * leg. It needs an approved source (DISPLAY_RATE_SOURCES) and an observation
 * (validFrom) less than 24 hours old; getDbExchangeRate already requires it
 * to be effective and not superseded. Returns the snapshot with its expiry
 * capped at the end of that 24-hour use, or null.
 */
function displaySnapshot(
  snapshot: RateSnapshot,
  now: Date
): RateSnapshot | null {
  if (!isDisplayRateSource(snapshot.quote.source.toLowerCase())) return null;
  const until = snapshot.validFrom.getTime() + DISPLAY_RATE_MAX_AGE_MS;
  if (until <= now.getTime()) return null;
  return {
    ...snapshot,
    expiresAt: new Date(Math.min(snapshot.expiresAt.getTime(), until)),
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

/**
 * `rule.estimate` admits the labelled fallback constants. Only the quote
 * functions pass it; every amount-producing caller resolves observed rates
 * only. `rule.display` admits only observations that pass the display rule,
 * and resolves each from MySQL on every call: a snapshot is never re-checked
 * for supersession, so under that rule none is read from or written to Redis
 * (a correction shows on the next call, whatever Redis holds).
 */
async function getRateSnapshot(
  from: string,
  to: string,
  rule: RateRule
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
  const cache = !rule.display;
  if (cache) {
    const value = await CacheService.get<unknown>(key);
    const cached = decodeRateSnapshot(value, from, to, new Date());
    if (cached) {
      return cached;
    }
  }
  const observed = await getDbExchangeRate(from, to, new Date());
  // Under the display rule an observation the display would not use counts
  // as none: the cross rate or the refusal below, never that rate.
  let direct = observed?.snapshot ?? null;
  if (direct && rule.display) direct = displaySnapshot(direct, new Date());
  if (direct) {
    if (cache) await cacheRate(key, direct);
    return direct;
  }
  if (from !== BASE_CURRENCY && to !== BASE_CURRENCY) {
    const first = await getRateSnapshot(from, BASE_CURRENCY, rule);
    const second = await getRateSnapshot(BASE_CURRENCY, to, rule);
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
    if (cache && !fallback && observed) {
      await cacheRate(key, cross);
    }
    return cross;
  }
  if (!rule.estimate) {
    throw new ExchangeRateUnavailableError(from, to);
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

/**
 * Restore Date and recheck expiry after all database/cache awaits finish.
 * Without an observation this returns the labelled fallback estimate
 * (source "fallback" or "cross_rate_fallback"); it is a label, not a price.
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string
): Promise<ExchangeRate> {
  const snapshot = await getRateSnapshot(
    fromCurrency,
    toCurrency,
    ESTIMATE_RULE
  );
  return requireCurrentRateSnapshot(snapshot, fromCurrency, toCurrency).quote;
}

/**
 * The quote pricing.getExchangeRate returns: an observed rate only when
 * every observed leg passes the display rule (an approved source, current,
 * not superseded, observed less than 24 hours ago). A pair whose observation
 * the display would not use answers as a pair without one, with the labelled
 * estimate (source "fallback" or "cross_rate_fallback"), never that rate.
 */
export async function getExchangeRateWithDisplayRule(
  fromCurrency: string,
  toCurrency: string
): Promise<ExchangeRate> {
  const snapshot = await getRateSnapshot(
    fromCurrency,
    toCurrency,
    DISPLAY_ESTIMATE_RULE
  );
  return requireCurrentRateSnapshot(snapshot, fromCurrency, toCurrency).quote;
}

/**
 * The newest direct SAR quote a display estimate may use: an approved
 * source, not superseded by a correction that has started, effective now and
 * observed less than 24 hours ago. The staleness alarm uses the same rule.
 */
export async function findCurrentDisplayQuote(
  database: Database,
  currency: DisplayCurrency,
  now: Date
) {
  if (currency === BASE_CURRENCY) return null;
  const [quote] = await database
    .select({
      id: exchangeRates.id,
      rate: exchangeRates.rate,
      source: exchangeRates.source,
      validFrom: exchangeRates.validFrom,
      validTo: exchangeRates.validTo,
    })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.fromCurrency, BASE_CURRENCY),
        eq(exchangeRates.toCurrency, currency),
        inArray(exchangeRates.source, [...DISPLAY_RATE_SOURCES]),
        gt(exchangeRates.rate, "0"),
        gt(
          exchangeRates.validFrom,
          new Date(now.getTime() - DISPLAY_RATE_MAX_AGE_MS)
        ),
        lte(exchangeRates.validFrom, now),
        or(isNull(exchangeRates.validTo), gt(exchangeRates.validTo, now)),
        notSuperseded(database, now)
      )
    )
    .orderBy(desc(exchangeRates.validFrom), desc(exchangeRates.id))
    .limit(1);
  if (!quote?.source) return null;
  const maxExpiry = quote.validFrom.getTime() + DISPLAY_RATE_MAX_AGE_MS;
  return {
    ...quote,
    source: quote.source.toLowerCase(),
    expiresAt: new Date(
      Math.min(maxExpiry, quote.validTo?.getTime() ?? maxExpiry)
    ),
  };
}

/** Public fare estimates read only direct, currently effective observations. */
export async function getDisplayExchangeRate(currency: DisplayCurrency) {
  const db = await getDb();
  if (!db || currency === BASE_CURRENCY) return null;
  const quote = await findCurrentDisplayQuote(db, currency, new Date());
  if (!quote) return null;
  return {
    fromCurrency: BASE_CURRENCY,
    toCurrency: currency,
    rate: Number(quote.rate),
    source: quote.source,
    updatedAt: quote.validFrom,
    expiresAt: quote.expiresAt,
  };
}

/** Converts a SAR amount, in major units, into the converter's currency. */
export type SarPriceConverter = (amountInSar: number) => number;

/**
 * A converter for SAR prices quoted in another currency (pricing.calculate,
 * getPriceRange and getForecast). It uses only the quote the display
 * estimate would show, through the same findCurrentDisplayQuote rule: an
 * approved source, effective now, not superseded and observed less than 24
 * hours ago. A quote the display would not show converts no price either.
 * Throws ExchangeRateUnavailableError when no such quote exists; YER and
 * other unsupported codes stay "Unsupported currency".
 */
export async function sarPriceConverter(
  targetCurrency: string
): Promise<SarPriceConverter> {
  getCurrencyInfo(targetCurrency);
  if (targetCurrency === BASE_CURRENCY)
    return amount =>
      fromMinorUnits(
        roundedMinor(amount, UNIT_RATE, BASE_CURRENCY),
        BASE_CURRENCY
      );
  const displayCurrency = DISPLAY_CURRENCIES.find(
    code => code === targetCurrency
  );
  let quote: Awaited<ReturnType<typeof findCurrentDisplayQuote>> = null;
  try {
    const database = await getDb();
    if (database && displayCurrency)
      quote = await findCurrentDisplayQuote(
        database,
        displayCurrency,
        new Date()
      );
  } catch (error) {
    // As for an observation: a failed query is no quote, never an estimate.
    console.error(
      JSON.stringify({
        event: "exchange_rate_query_failed",
        fromCurrency: BASE_CURRENCY,
        toCurrency: targetCurrency,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      })
    );
  }
  if (!quote)
    throw new ExchangeRateUnavailableError(BASE_CURRENCY, targetCurrency);
  const ratio = exactRate(quote.rate);
  const rate = rateAsNumber(ratio);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(1 / rate)) {
    throw new Error("Invalid exchange rate observation");
  }
  const expiresAt = quote.expiresAt.getTime();
  return amount => {
    // Recheck synchronously at each use, after the caller's last await.
    if (Date.now() >= expiresAt)
      throw new ExchangeRateUnavailableError(BASE_CURRENCY, targetCurrency);
    return fromMinorUnits(
      roundedMinor(amount, ratio, targetCurrency),
      targetCurrency
    );
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
          or(isNull(exchangeRates.validTo), gt(exchangeRates.validTo, now)),
          notSuperseded(database, now)
        )
      )
      .orderBy(desc(exchangeRates.validFrom), desc(exchangeRates.id))
      .limit(1);
    // A scheduled row, including a correction, bounds the cached snapshot.
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
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<ConversionResult> {
  return convertWithRule(amount, fromCurrency, toCurrency, OBSERVED_RULE);
}

/**
 * The conversion pricing.convertCurrency returns: an amount only from
 * observations that pass the display rule, leg by leg (an approved source,
 * current, not superseded, observed less than 24 hours ago). Otherwise
 * ExchangeRateUnavailableError, naming the pair or leg without one.
 */
export function convertCurrencyWithDisplayRule(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<ConversionResult> {
  return convertWithRule(amount, fromCurrency, toCurrency, DISPLAY_RULE);
}

async function convertWithRule(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rule: RateRule
): Promise<ConversionResult> {
  const snapshot = requireCurrentRateSnapshot(
    await getRateSnapshot(fromCurrency, toCurrency, rule),
    fromCurrency,
    toCurrency
  );
  const rate = snapshot.quote;
  // An observed-only rule never builds a fallback; keep the invariant local
  // to the only function that turns a rate into an amount.
  if (rate.source.includes("fallback")) {
    throw new ExchangeRateUnavailableError(fromCurrency, toCurrency);
  }
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
 * Convert price for display in user's preferred currency. A non-SAR amount
 * uses only the quote the display estimate would show (sarPriceConverter);
 * without one it throws ExchangeRateUnavailableError.
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

  const toTarget = await sarPriceConverter(targetCurrency);
  const amount = toTarget(priceInSAR);
  const currencyInfo = getCurrencyInfo(targetCurrency);

  return {
    amount,
    currency: targetCurrency,
    formatted: formatAmount(amount, currencyInfo),
    formattedWithSymbol: `${currencyInfo.symbol} ${formatAmount(amount, currencyInfo)}`,
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
// Exchange Rate Cache Invalidation
// ============================================================================

/**
 * Drop cached snapshots that may contain the pair, directly or as a leg of a
 * cross rate, after an operator records or corrects a quote.
 */
export async function invalidateExchangeRateSnapshots(
  fromCurrency: string,
  toCurrency: string
): Promise<void> {
  const keys = new Set<string>();
  for (const code of [fromCurrency, toCurrency])
    for (const other of SUPPORTED_CURRENCIES) {
      keys.add(`exchange_rate:v3:${code}_${other.code}`);
      keys.add(`exchange_rate:v3:${other.code}_${code}`);
    }
  for (const key of keys) await CacheService.del(key);
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
  getExchangeRateWithDisplayRule,
  toMinorUnits,
  fromMinorUnits,
  convertCurrency,
  convertCurrencyWithDisplayRule,
  convertPriceForDisplay,
  sarPriceConverter,
  getCurrencyInfo,
  getSupportedCurrencies,
  isCurrencySupported,
  formatAmount,
  formatPrice,
  parseAmount,
  getHistoricalRates,
};

export default CurrencyService;
