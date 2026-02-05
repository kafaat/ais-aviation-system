import { TRPCError } from "@trpc/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { flights } from "../../drizzle/schema";
import { redisCacheService, CacheTTL } from "./redis-cache.service";
import { createServiceLogger } from "../_core/logger";

const log = createServiceLogger("price-calendar");

/**
 * Price Calendar Service
 * Provides monthly price overview and flexible date search functionality
 */

export interface MonthlyPriceInput {
  originId: number;
  destinationId: number;
  month: number; // 1-12
  year: number;
  cabinClass?: "economy" | "business";
}

export interface FlexiblePriceInput {
  originId: number;
  destinationId: number;
  date: Date;
  flexDays?: number; // Default 3 (meaning +/- 3 days)
  cabinClass?: "economy" | "business";
}

export interface DayPrice {
  date: string; // ISO date string (YYYY-MM-DD)
  lowestPrice: number | null;
  highestPrice: number | null;
  averagePrice: number | null;
  flightCount: number;
  hasFlights: boolean;
}

export interface MonthlyPriceResult {
  originId: number;
  destinationId: number;
  month: number;
  year: number;
  cabinClass: "economy" | "business";
  prices: DayPrice[];
  lowestMonthPrice: number | null;
  highestMonthPrice: number | null;
  cheapestDay: string | null;
}

export interface FlexiblePriceResult {
  originId: number;
  destinationId: number;
  centerDate: string;
  cabinClass: "economy" | "business";
  prices: DayPrice[];
  cheapestDay: {
    date: string;
    price: number;
  } | null;
  priceRange: {
    min: number | null;
    max: number | null;
  };
}

/**
 * Get monthly prices for a route
 * Returns lowest price per day for the specified month
 */
export async function getMonthlyPrices(
  input: MonthlyPriceInput
): Promise<MonthlyPriceResult> {
  const cabinClass = input.cabinClass || "economy";

  // Create cache key
  const cacheKey = `price-calendar:monthly:${input.originId}:${input.destinationId}:${input.year}-${input.month}:${cabinClass}`;

  try {
    // Try to get from cache
    const cached = await redisCacheService.getRaw<MonthlyPriceResult>(cacheKey);
    if (cached) {
      return cached;
    }
  } catch (error) {
    log.warn({ error }, "Failed to get monthly prices from cache");
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    // Calculate month boundaries
    const startOfMonth = new Date(input.year, input.month - 1, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(input.year, input.month, 0, 23, 59, 59, 999);

    // Get price column based on cabin class
    const priceColumn =
      cabinClass === "business" ? flights.businessPrice : flights.economyPrice;

    // Query flights for the month with aggregations per day
    const flightData = await db
      .select({
        departureDate: sql<string>`DATE(${flights.departureTime})`.as(
          "departureDate"
        ),
        minPrice: sql<number>`MIN(${priceColumn})`.as("minPrice"),
        maxPrice: sql<number>`MAX(${priceColumn})`.as("maxPrice"),
        avgPrice: sql<number>`AVG(${priceColumn})`.as("avgPrice"),
        flightCount: sql<number>`COUNT(*)`.as("flightCount"),
      })
      .from(flights)
      .where(
        and(
          eq(flights.originId, input.originId),
          eq(flights.destinationId, input.destinationId),
          gte(flights.departureTime, startOfMonth),
          lte(flights.departureTime, endOfMonth),
          eq(flights.status, "scheduled")
        )
      )
      .groupBy(sql`DATE(${flights.departureTime})`)
      .orderBy(sql`DATE(${flights.departureTime})`);

    // Build price map by date
    const priceMap = new Map<string, DayPrice>();

    for (const row of flightData) {
      const dateStr = row.departureDate;
      priceMap.set(dateStr, {
        date: dateStr,
        lowestPrice: row.minPrice ? Number(row.minPrice) : null,
        highestPrice: row.maxPrice ? Number(row.maxPrice) : null,
        averagePrice: row.avgPrice ? Math.round(Number(row.avgPrice)) : null,
        flightCount: Number(row.flightCount),
        hasFlights: true,
      });
    }

    // Generate all days in the month
    const daysInMonth = new Date(input.year, input.month, 0).getDate();
    const prices: DayPrice[] = [];
    let lowestMonthPrice: number | null = null;
    let highestMonthPrice: number | null = null;
    let cheapestDay: string | null = null;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${input.year}-${String(input.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayData = priceMap.get(dateStr);

      if (dayData) {
        prices.push(dayData);

        // Track lowest price in month
        if (
          dayData.lowestPrice !== null &&
          (lowestMonthPrice === null || dayData.lowestPrice < lowestMonthPrice)
        ) {
          lowestMonthPrice = dayData.lowestPrice;
          cheapestDay = dateStr;
        }

        // Track highest price in month
        if (
          dayData.highestPrice !== null &&
          (highestMonthPrice === null ||
            dayData.highestPrice > highestMonthPrice)
        ) {
          highestMonthPrice = dayData.highestPrice;
        }
      } else {
        // No flights on this day
        prices.push({
          date: dateStr,
          lowestPrice: null,
          highestPrice: null,
          averagePrice: null,
          flightCount: 0,
          hasFlights: false,
        });
      }
    }

    const result: MonthlyPriceResult = {
      originId: input.originId,
      destinationId: input.destinationId,
      month: input.month,
      year: input.year,
      cabinClass,
      prices,
      lowestMonthPrice,
      highestMonthPrice,
      cheapestDay,
    };

    // Cache the result for 5 minutes
    try {
      await redisCacheService.setRaw(cacheKey, result, CacheTTL.FLIGHT_SEARCH);
    } catch (error) {
      log.warn({ error }, "Failed to cache monthly prices");
    }

    return result;
  } catch (error) {
    log.error({ error }, "Error getting monthly prices");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get monthly prices",
    });
  }
}

/**
 * Get flexible date prices (+/- N days from a center date)
 * Useful for finding the cheapest dates around a preferred travel date
 */
export async function getFlexiblePrices(
  input: FlexiblePriceInput
): Promise<FlexiblePriceResult> {
  const cabinClass = input.cabinClass || "economy";
  const flexDays = input.flexDays ?? 3;

  // Create cache key
  const centerDateStr = input.date.toISOString().split("T")[0];
  const cacheKey = `price-calendar:flexible:${input.originId}:${input.destinationId}:${centerDateStr}:${flexDays}:${cabinClass}`;

  try {
    // Try to get from cache
    const cached =
      await redisCacheService.getRaw<FlexiblePriceResult>(cacheKey);
    if (cached) {
      return cached;
    }
  } catch (error) {
    log.warn({ error }, "Failed to get flexible prices from cache");
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    // Calculate date range
    const startDate = new Date(input.date);
    startDate.setDate(startDate.getDate() - flexDays);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(input.date);
    endDate.setDate(endDate.getDate() + flexDays);
    endDate.setHours(23, 59, 59, 999);

    // Get price column based on cabin class
    const priceColumn =
      cabinClass === "business" ? flights.businessPrice : flights.economyPrice;

    // Query flights for the date range with aggregations per day
    const flightData = await db
      .select({
        departureDate: sql<string>`DATE(${flights.departureTime})`.as(
          "departureDate"
        ),
        minPrice: sql<number>`MIN(${priceColumn})`.as("minPrice"),
        maxPrice: sql<number>`MAX(${priceColumn})`.as("maxPrice"),
        avgPrice: sql<number>`AVG(${priceColumn})`.as("avgPrice"),
        flightCount: sql<number>`COUNT(*)`.as("flightCount"),
      })
      .from(flights)
      .where(
        and(
          eq(flights.originId, input.originId),
          eq(flights.destinationId, input.destinationId),
          gte(flights.departureTime, startDate),
          lte(flights.departureTime, endDate),
          eq(flights.status, "scheduled")
        )
      )
      .groupBy(sql`DATE(${flights.departureTime})`)
      .orderBy(sql`DATE(${flights.departureTime})`);

    // Build price map by date
    const priceMap = new Map<string, DayPrice>();

    for (const row of flightData) {
      const dateStr = row.departureDate;
      priceMap.set(dateStr, {
        date: dateStr,
        lowestPrice: row.minPrice ? Number(row.minPrice) : null,
        highestPrice: row.maxPrice ? Number(row.maxPrice) : null,
        averagePrice: row.avgPrice ? Math.round(Number(row.avgPrice)) : null,
        flightCount: Number(row.flightCount),
        hasFlights: true,
      });
    }

    // Generate all days in the range
    const prices: DayPrice[] = [];
    let cheapestDay: { date: string; price: number } | null = null;
    let minPrice: number | null = null;
    let maxPrice: number | null = null;

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const dayData = priceMap.get(dateStr);

      if (dayData) {
        prices.push(dayData);

        // Track cheapest day
        if (
          dayData.lowestPrice !== null &&
          (cheapestDay === null || dayData.lowestPrice < cheapestDay.price)
        ) {
          cheapestDay = {
            date: dateStr,
            price: dayData.lowestPrice,
          };
        }

        // Track price range
        if (
          dayData.lowestPrice !== null &&
          (minPrice === null || dayData.lowestPrice < minPrice)
        ) {
          minPrice = dayData.lowestPrice;
        }
        if (
          dayData.highestPrice !== null &&
          (maxPrice === null || dayData.highestPrice > maxPrice)
        ) {
          maxPrice = dayData.highestPrice;
        }
      } else {
        // No flights on this day
        prices.push({
          date: dateStr,
          lowestPrice: null,
          highestPrice: null,
          averagePrice: null,
          flightCount: 0,
          hasFlights: false,
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    const result: FlexiblePriceResult = {
      originId: input.originId,
      destinationId: input.destinationId,
      centerDate: centerDateStr,
      cabinClass,
      prices,
      cheapestDay,
      priceRange: {
        min: minPrice,
        max: maxPrice,
      },
    };

    // Cache the result for 5 minutes
    try {
      await redisCacheService.setRaw(cacheKey, result, CacheTTL.FLIGHT_SEARCH);
    } catch (error) {
      log.warn({ error }, "Failed to cache flexible prices");
    }

    return result;
  } catch (error) {
    log.error({ error }, "Error getting flexible prices");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get flexible prices",
    });
  }
}

/**
 * Get a quick summary of available months with flights
 * Useful for showing which months have availability
 */
export async function getAvailableMonths(
  originId: number,
  destinationId: number,
  lookAheadMonths: number = 12
): Promise<{ year: number; month: number; hasFlights: boolean }[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + lookAheadMonths);

    const monthData = await db
      .select({
        year: sql<number>`YEAR(${flights.departureTime})`.as("year"),
        month: sql<number>`MONTH(${flights.departureTime})`.as("month"),
        flightCount: sql<number>`COUNT(*)`.as("flightCount"),
      })
      .from(flights)
      .where(
        and(
          eq(flights.originId, originId),
          eq(flights.destinationId, destinationId),
          gte(flights.departureTime, now),
          lte(flights.departureTime, endDate),
          eq(flights.status, "scheduled")
        )
      )
      .groupBy(
        sql`YEAR(${flights.departureTime})`,
        sql`MONTH(${flights.departureTime})`
      )
      .orderBy(
        sql`YEAR(${flights.departureTime})`,
        sql`MONTH(${flights.departureTime})`
      );

    // Build map of months with flights
    const monthMap = new Map<string, boolean>();
    for (const row of monthData) {
      monthMap.set(`${row.year}-${row.month}`, Number(row.flightCount) > 0);
    }

    // Generate all months in range
    const result: { year: number; month: number; hasFlights: boolean }[] = [];
    const current = new Date(now.getFullYear(), now.getMonth(), 1);

    for (let i = 0; i < lookAheadMonths; i++) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;
      result.push({
        year,
        month,
        hasFlights: monthMap.get(`${year}-${month}`) ?? false,
      });
      current.setMonth(current.getMonth() + 1);
    }

    return result;
  } catch (error) {
    log.error({ error }, "Error getting available months");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get available months",
    });
  }
}
