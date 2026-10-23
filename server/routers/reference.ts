import { z } from "zod";
import { responseContracts } from "../contracts/reference";
import { publicProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { redisCacheService, CacheTTL } from "../services/redis-cache.service";

// Redis JSON serialization turns Date objects into ISO strings. Parse only the
// cache boundary; the public output contract and DB producer remain strict.
const cachedDate = z.union([
  z.date(),
  z.iso.datetime().transform(value => new Date(value)),
]);
const cachedAirports = responseContracts.airports.element
  .extend({ createdAt: cachedDate })
  .array();
const cachedAirlines = responseContracts.airlines.element
  .extend({ createdAt: cachedDate })
  .array();

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
  airlines: publicProcedure
    .output(responseContracts["airlines"])
    .query(async () => {
      // Try to get from cache
      const cached = await redisCacheService.getCachedAirlines();
      const parsed = cachedAirlines.safeParse(cached);
      if (parsed.success) return parsed.data;

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
  airports: publicProcedure
    .output(responseContracts["airports"])
    .query(async () => {
      // Try to get from cache
      const cached = await redisCacheService.getCachedAirports();
      const parsed = cachedAirports.safeParse(cached);
      if (parsed.success) return parsed.data;

      // Fetch from database
      const airports = await db.getAllAirports();

      // Cache the results
      await redisCacheService.cacheAirports(airports, CacheTTL.AIRPORTS);

      return airports;
    }),
});
