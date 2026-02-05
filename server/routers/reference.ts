import { publicProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { redisCacheService, CacheTTL } from "../services/redis-cache.service";

/**
 * Reference Data Router
 * Handles all reference data operations (airlines, airports, etc.)
 * Results are cached for 1 hour as this data rarely changes
 */
export const referenceRouter = router({
  /**
   * Get all active airlines
   * Cached for 1 hour
   */
  airlines: publicProcedure.query(async () => {
    // Try to get from cache
    const cached = await redisCacheService.getCachedAirlines();
    if (cached) {
      return cached as Awaited<ReturnType<typeof db.getAllAirlines>>;
    }

    // Fetch from database
    const airlines = await db.getAllAirlines();

    // Cache the results
    await redisCacheService.cacheAirlines(airlines, CacheTTL.AIRLINES);

    return airlines;
  }),

  /**
   * Get all airports
   * Cached for 1 hour
   */
  airports: publicProcedure.query(async () => {
    // Try to get from cache
    const cached = await redisCacheService.getCachedAirports();
    if (cached) {
      return cached as Awaited<ReturnType<typeof db.getAllAirports>>;
    }

    // Fetch from database
    const airports = await db.getAllAirports();

    // Cache the results
    await redisCacheService.cacheAirports(airports, CacheTTL.AIRPORTS);

    return airports;
  }),
});
