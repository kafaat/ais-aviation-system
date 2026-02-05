/**
 * Popular Routes Service
 *
 * Tracks and caches popular flight routes based on search and booking patterns.
 * Uses Redis for both caching and tracking route popularity.
 *
 * @version 1.0.0
 * @date 2026-02-05
 */

import {
  redisCacheService,
  CacheTTL,
} from "./redis-cache.service";
import { getDb } from "../db";
import { bookings, flights, airports } from "../../drizzle/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { logger } from "../_core/logger";

// Types
export interface PopularRoute {
  originId: number;
  destinationId: number;
  originCode: string;
  originCity: string;
  originCountry: string;
  destinationCode: string;
  destinationCity: string;
  destinationCountry: string;
  searchCount: number;
  bookingCount: number;
  score: number;
}

export interface RouteStats {
  totalSearches: number;
  totalBookings: number;
  popularRoutes: PopularRoute[];
}

// In-memory tracking for route searches (used when Redis is unavailable)
const searchTracking = new Map<string, number>();

/**
 * Generate a unique key for a route
 */
function getRouteKey(originId: number, destinationId: number): string {
  return `${originId}:${destinationId}`;
}

/**
 * Track a route search
 * Increments the search count for a specific route
 */
export async function trackRouteSearch(
  originId: number,
  destinationId: number
): Promise<void> {
  const routeKey = getRouteKey(originId, destinationId);

  try {
    // Track in Redis if connected (using sorted set for efficient ranking)
    if (redisCacheService.isConnected()) {
      await redisCacheService["redisClient"]?.zincrby(
        `ais:routes:searches`,
        1,
        routeKey
      );
    } else {
      // Fallback to memory tracking
      const current = searchTracking.get(routeKey) || 0;
      searchTracking.set(routeKey, current + 1);
    }
  } catch (error) {
    logger.error({ originId, destinationId, error }, "Failed to track route search");
  }
}

/**
 * Get popular routes from database based on booking history
 * This queries actual booking data for accurate popularity metrics
 */
export async function getPopularRoutesFromDb(
  limit: number = 10
): Promise<PopularRoute[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    // Get booking counts per route for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const results = await db
      .select({
        originId: flights.originId,
        destinationId: flights.destinationId,
        originCode: sql<string>`origin.code`,
        originCity: sql<string>`origin.city`,
        originCountry: sql<string>`origin.country`,
        destinationCode: sql<string>`dest.code`,
        destinationCity: sql<string>`dest.city`,
        destinationCountry: sql<string>`dest.country`,
        bookingCount: sql<number>`COUNT(${bookings.id})`,
      })
      .from(bookings)
      .innerJoin(flights, eq(bookings.flightId, flights.id))
      .innerJoin(
        sql`${airports} as origin`,
        sql`${flights.originId} = origin.id`
      )
      .innerJoin(
        sql`${airports} as dest`,
        sql`${flights.destinationId} = dest.id`
      )
      .where(
        and(
          gte(bookings.createdAt, thirtyDaysAgo),
          eq(bookings.status, "confirmed")
        )
      )
      .groupBy(
        flights.originId,
        flights.destinationId,
        sql`origin.code`,
        sql`origin.city`,
        sql`origin.country`,
        sql`dest.code`,
        sql`dest.city`,
        sql`dest.country`
      )
      .orderBy(desc(sql`COUNT(${bookings.id})`))
      .limit(limit);

    return results.map((r) => ({
      originId: r.originId,
      destinationId: r.destinationId,
      originCode: r.originCode,
      originCity: r.originCity,
      originCountry: r.originCountry,
      destinationCode: r.destinationCode,
      destinationCity: r.destinationCity,
      destinationCountry: r.destinationCountry,
      searchCount: 0, // Would need search tracking data
      bookingCount: r.bookingCount,
      score: r.bookingCount * 10, // Simple scoring based on bookings
    }));
  } catch (error) {
    logger.error({ error }, "Failed to get popular routes from database");
    return [];
  }
}

/**
 * Get popular routes with caching
 */
export async function getPopularRoutes(
  limit: number = 10
): Promise<PopularRoute[]> {
  // Try cache first
  const cached = await redisCacheService.getCachedPopularRoutes();
  if (cached && Array.isArray(cached)) {
    return (cached as PopularRoute[]).slice(0, limit);
  }

  // Fetch from database
  const routes = await getPopularRoutesFromDb(limit);

  // Cache the results
  if (routes.length > 0) {
    await redisCacheService.cachePopularRoutes(routes, CacheTTL.POPULAR_ROUTES);
  }

  return routes;
}

/**
 * Get route statistics
 */
export async function getRouteStats(): Promise<RouteStats> {
  const popularRoutes = await getPopularRoutes(20);

  const totalBookings = popularRoutes.reduce(
    (sum, r) => sum + r.bookingCount,
    0
  );
  const totalSearches = popularRoutes.reduce(
    (sum, r) => sum + r.searchCount,
    0
  );

  return {
    totalSearches,
    totalBookings,
    popularRoutes,
  };
}

/**
 * Refresh popular routes cache
 * Call this periodically or when booking data changes significantly
 */
export async function refreshPopularRoutesCache(): Promise<void> {
  try {
    // Invalidate existing cache
    await redisCacheService.invalidatePopularRoutesCache();

    // Prefetch and cache popular routes
    await getPopularRoutes(20);

    logger.info({}, "Popular routes cache refreshed");
  } catch (error) {
    logger.error({ error }, "Failed to refresh popular routes cache");
  }
}

/**
 * Get suggested routes for a specific origin
 */
export async function getSuggestedDestinations(
  originId: number,
  limit: number = 5
): Promise<PopularRoute[]> {
  // Check cache first
  const cacheKey = `suggestions:${originId}`;
  const cached = await redisCacheService.getCachedRoute(originId, 0);
  if (cached && Array.isArray(cached)) {
    return (cached as PopularRoute[]).slice(0, limit);
  }

  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    // Get top destinations from this origin based on bookings
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const results = await db
      .select({
        originId: flights.originId,
        destinationId: flights.destinationId,
        originCode: sql<string>`origin.code`,
        originCity: sql<string>`origin.city`,
        originCountry: sql<string>`origin.country`,
        destinationCode: sql<string>`dest.code`,
        destinationCity: sql<string>`dest.city`,
        destinationCountry: sql<string>`dest.country`,
        bookingCount: sql<number>`COUNT(${bookings.id})`,
      })
      .from(bookings)
      .innerJoin(flights, eq(bookings.flightId, flights.id))
      .innerJoin(
        sql`${airports} as origin`,
        sql`${flights.originId} = origin.id`
      )
      .innerJoin(
        sql`${airports} as dest`,
        sql`${flights.destinationId} = dest.id`
      )
      .where(
        and(
          eq(flights.originId, originId),
          gte(bookings.createdAt, thirtyDaysAgo),
          eq(bookings.status, "confirmed")
        )
      )
      .groupBy(
        flights.originId,
        flights.destinationId,
        sql`origin.code`,
        sql`origin.city`,
        sql`origin.country`,
        sql`dest.code`,
        sql`dest.city`,
        sql`dest.country`
      )
      .orderBy(desc(sql`COUNT(${bookings.id})`))
      .limit(limit);

    const routes: PopularRoute[] = results.map((r) => ({
      originId: r.originId,
      destinationId: r.destinationId,
      originCode: r.originCode,
      originCity: r.originCity,
      originCountry: r.originCountry,
      destinationCode: r.destinationCode,
      destinationCity: r.destinationCity,
      destinationCountry: r.destinationCountry,
      searchCount: 0,
      bookingCount: r.bookingCount,
      score: r.bookingCount * 10,
    }));

    // Cache the suggestions
    if (routes.length > 0) {
      await redisCacheService.cacheRoute(originId, 0, routes, CacheTTL.POPULAR_ROUTES);
    }

    return routes;
  } catch (error) {
    logger.error({ originId, error }, "Failed to get suggested destinations");
    return [];
  }
}
