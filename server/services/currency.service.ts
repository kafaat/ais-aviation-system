import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { exchangeRates, userCurrencyPreferences, type InsertExchangeRate, type SupportedCurrency, SUPPORTED_CURRENCIES } from "../../drizzle/schema";
import axios from "axios";
import { logger } from "../_core/logger";

/**
 * Currency Service
 * Handles currency conversion and exchange rate management
 */

const EXCHANGE_RATE_API_URL = "https://api.exchangerate-api.com/v4/latest/SAR";
const CACHE_DURATION_HOURS = 24; // Update rates every 24 hours

/**
 * Fetch latest exchange rates from external API
 */
export async function fetchLatestExchangeRates(): Promise<void> {
  try {
    const response = await axios.get(EXCHANGE_RATE_API_URL);
    const rates = response.data.rates;
    
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Update rates for all supported currencies
    for (const currency of SUPPORTED_CURRENCIES) {
      if (currency.code === "SAR") continue; // Skip base currency

      const rate = rates[currency.code];
      if (!rate) {
        logger.warn(`[Currency] Rate not found for ${currency.code}`);
        continue;
      }

      // Check if rate exists
      const existing = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.baseCurrency, "SAR"),
            eq(exchangeRates.targetCurrency, currency.code)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Update existing rate
        await db
          .update(exchangeRates)
          .set({
            rate: rate.toString(),
            lastUpdated: new Date(),
            source: "exchangerate-api.com",
          })
          .where(eq(exchangeRates.id, existing[0].id));
      } else {
        // Insert new rate
        await db.insert(exchangeRates).values({
          baseCurrency: "SAR",
          targetCurrency: currency.code,
          rate: rate.toString(),
          source: "exchangerate-api.com",
        });
      }
    }

    logger.info("[Currency] Exchange rates updated successfully");
  } catch (error) {
    logger.error({ err: error }, "[Currency] Failed to fetch exchange rates");
    throw error;
  }
}

/**
 * Get exchange rate from SAR to target currency
 */
export async function getExchangeRate(targetCurrency: SupportedCurrency): Promise<number> {
  if (targetCurrency === "SAR") return 1.0;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.baseCurrency, "SAR"),
        eq(exchangeRates.targetCurrency, targetCurrency)
      )
    )
    .limit(1);

  if (result.length === 0) {
    // If rate not found, fetch latest rates and try again
    await fetchLatestExchangeRates();
    
    const retryResult = await db
      .select()
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.baseCurrency, "SAR"),
          eq(exchangeRates.targetCurrency, targetCurrency)
        )
      )
      .limit(1);

    if (retryResult.length === 0) {
      throw new Error(`Exchange rate not found for ${targetCurrency}`);
    }

    return parseFloat(retryResult[0].rate);
  }

  // Check if rate is outdated (older than CACHE_DURATION_HOURS)
  const lastUpdated = new Date(result[0].lastUpdated);
  const now = new Date();
  const hoursSinceUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

  if (hoursSinceUpdate > CACHE_DURATION_HOURS) {
    // Update rates in background (don't wait)
    fetchLatestExchangeRates().catch(err => 
      logger.error({ err }, "[Currency] Background rate update failed")
    );
  }

  return parseFloat(result[0].rate);
}

/**
 * Convert amount from SAR to target currency
 * @param amountInSAR - Amount in SAR cents (e.g., 50000 = 500.00 SAR)
 * @param targetCurrency - Target currency code
 * @returns Converted amount in target currency cents
 */
export async function convertFromSAR(
  amountInSAR: number,
  targetCurrency: SupportedCurrency
): Promise<number> {
  if (targetCurrency === "SAR") return amountInSAR;

  const rate = await getExchangeRate(targetCurrency);
  
  // Convert: SAR cents -> SAR -> target currency -> target currency cents
  const amountInSARUnits = amountInSAR / 100;
  const convertedAmount = amountInSARUnits * rate;
  const convertedAmountCents = Math.round(convertedAmount * 100);

  return convertedAmountCents;
}

/**
 * Convert amount from target currency to SAR
 * @param amountInTargetCurrency - Amount in target currency cents
 * @param sourceCurrency - Source currency code
 * @returns Converted amount in SAR cents
 */
export async function convertToSAR(
  amountInTargetCurrency: number,
  sourceCurrency: SupportedCurrency
): Promise<number> {
  if (sourceCurrency === "SAR") return amountInTargetCurrency;

  const rate = await getExchangeRate(sourceCurrency);
  
  // Convert: target currency cents -> target currency -> SAR -> SAR cents
  const amountInTargetUnits = amountInTargetCurrency / 100;
  const convertedAmount = amountInTargetUnits / rate;
  const convertedAmountCents = Math.round(convertedAmount * 100);

  return convertedAmountCents;
}

/**
 * Format amount with currency symbol
 * @param amountInCents - Amount in cents
 * @param currency - Currency code
 * @returns Formatted string (e.g., "﷼ 500.00" or "$ 135.00")
 */
export function formatCurrency(amountInCents: number, currency: SupportedCurrency): string {
  const currencyInfo = SUPPORTED_CURRENCIES.find(c => c.code === currency);
  if (!currencyInfo) throw new Error(`Unsupported currency: ${currency}`);

  const amount = amountInCents / 100;
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${currencyInfo.symbol} ${formatted}`;
}

/**
 * Get all exchange rates
 */
export async function getAllExchangeRates() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rates = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.baseCurrency, "SAR"));

  return rates.map(rate => ({
    currency: rate.targetCurrency,
    rate: parseFloat(rate.rate),
    lastUpdated: rate.lastUpdated,
  }));
}

/**
 * Get user's preferred currency
 */
export async function getUserPreferredCurrency(userId: number): Promise<SupportedCurrency> {
  const db = await getDb();
  if (!db) return "SAR"; // Default to SAR

  const result = await db
    .select()
    .from(userCurrencyPreferences)
    .where(eq(userCurrencyPreferences.userId, userId))
    .limit(1);

  if (result.length === 0) return "SAR";

  return result[0].preferredCurrency as SupportedCurrency;
}

/**
 * Set user's preferred currency
 */
export async function setUserPreferredCurrency(
  userId: number,
  currency: SupportedCurrency
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if preference exists
  const existing = await db
    .select()
    .from(userCurrencyPreferences)
    .where(eq(userCurrencyPreferences.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    // Update existing preference
    await db
      .update(userCurrencyPreferences)
      .set({ preferredCurrency: currency })
      .where(eq(userCurrencyPreferences.userId, userId));
  } else {
    // Insert new preference
    await db.insert(userCurrencyPreferences).values({
      userId,
      preferredCurrency: currency,
    });
  }

  logger.info({ userId, currency }, "[Currency] User preferred currency updated");
}

/**
 * Initialize exchange rates (run on server startup)
 */
export async function initializeExchangeRates(): Promise<void> {
  try {
    logger.info("[Currency] Initializing exchange rates...");
    await fetchLatestExchangeRates();
    logger.info("[Currency] Exchange rates initialized successfully");
  } catch (error) {
    logger.error({ err: error }, "[Currency] Failed to initialize exchange rates");
    // Don't throw - allow server to start even if rates fetch fails
  }
}

/**
 * Schedule periodic exchange rate updates
 * Call this on server startup to update rates every 24 hours
 */
export function scheduleExchangeRateUpdates(): void {
  // Update rates every 24 hours
  setInterval(async () => {
    try {
      logger.info("[Currency] Running scheduled exchange rate update...");
      await fetchLatestExchangeRates();
    } catch (error) {
      logger.error({ err: error }, "[Currency] Scheduled rate update failed");
    }
  }, CACHE_DURATION_HOURS * 60 * 60 * 1000);

  logger.info(`[Currency] Scheduled exchange rate updates every ${CACHE_DURATION_HOURS} hours`);
}
