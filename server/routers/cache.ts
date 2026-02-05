import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import {
  redisCacheService,
  CacheNamespace,
  CacheTTL,
} from "../services/redis-cache.service";

/**
 * Cache Router
 * Provides endpoints for cache management and statistics
 */
export const cacheRouter = router({
  /**
   * Get cache health status
   * Public endpoint for monitoring
   */
  health: publicProcedure.query(async () => {
    return await redisCacheService.healthCheck();
  }),

  /**
   * Get detailed cache statistics
   * Public endpoint for monitoring dashboards
   */
  stats: publicProcedure.query(async () => {
    return await redisCacheService.getStats();
  }),

  /**
   * Get Redis server info (admin only)
   */
  redisInfo: adminProcedure.query(async () => {
    const info = await redisCacheService.getRedisInfo();
    if (!info) {
      return {
        available: false,
        message: "Redis is not connected",
      };
    }

    // Return selected useful metrics
    return {
      available: true,
      version: info.redis_version,
      uptimeSeconds: parseInt(info.uptime_in_seconds || "0"),
      connectedClients: parseInt(info.connected_clients || "0"),
      usedMemory: info.used_memory_human,
      usedMemoryPeak: info.used_memory_peak_human,
      totalKeys: parseInt(info.db0?.split(",")[0]?.split("=")[1] || "0"),
      expiredKeys: parseInt(info.expired_keys || "0"),
      evictedKeys: parseInt(info.evicted_keys || "0"),
      hitRate:
        parseInt(info.keyspace_hits || "0") /
          (parseInt(info.keyspace_hits || "0") +
            parseInt(info.keyspace_misses || "1")) || 0,
    };
  }),

  /**
   * Invalidate a specific cache namespace (admin only)
   */
  invalidateNamespace: adminProcedure
    .input(
      z.object({
        namespace: z.enum([
          CacheNamespace.SEARCH,
          CacheNamespace.FLIGHT,
          CacheNamespace.PRICING,
          CacheNamespace.AIRPORTS,
          CacheNamespace.AIRLINES,
          CacheNamespace.CITIES,
          CacheNamespace.SESSION,
          CacheNamespace.ROUTES,
          CacheNamespace.USER,
        ]),
      })
    )
    .mutation(async ({ input }) => {
      await redisCacheService.invalidateNamespace(input.namespace);
      return {
        success: true,
        message: `Namespace '${input.namespace}' invalidated`,
      };
    }),

  /**
   * Invalidate flight search cache (admin only)
   */
  invalidateFlightSearch: adminProcedure.mutation(async () => {
    await redisCacheService.invalidateFlightSearchCache();
    return {
      success: true,
      message: "Flight search cache invalidated",
    };
  }),

  /**
   * Invalidate reference data cache (airports, airlines, cities) (admin only)
   */
  invalidateReferenceData: adminProcedure.mutation(async () => {
    await redisCacheService.invalidateReferenceDataCache();
    return {
      success: true,
      message: "Reference data cache invalidated (airports, airlines, cities)",
    };
  }),

  /**
   * Invalidate pricing cache (admin only)
   */
  invalidatePricing: adminProcedure
    .input(
      z.object({
        flightId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await redisCacheService.invalidatePricingCache(input.flightId);
      return {
        success: true,
        message: input.flightId
          ? `Pricing cache for flight ${input.flightId} invalidated`
          : "All pricing cache invalidated",
      };
    }),

  /**
   * Invalidate user session cache (admin only)
   */
  invalidateUserSession: adminProcedure
    .input(
      z.object({
        userId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      await redisCacheService.invalidateUserSession(input.userId);
      return {
        success: true,
        message: `Session cache for user ${input.userId} invalidated`,
      };
    }),

  /**
   * Reset cache statistics (admin only)
   */
  resetStats: adminProcedure.mutation(async () => {
    redisCacheService.resetStats();
    return {
      success: true,
      message: "Cache statistics reset",
    };
  }),

  /**
   * Clear all caches (admin only)
   * USE WITH CAUTION - this will clear all cached data
   */
  clearAll: adminProcedure.mutation(async () => {
    await redisCacheService.clearAll();
    return {
      success: true,
      message: "All caches cleared",
    };
  }),

  /**
   * Force reconnect to Redis (admin only)
   */
  reconnect: adminProcedure.mutation(async () => {
    const success = await redisCacheService.reconnect();
    return {
      success,
      message: success
        ? "Successfully reconnected to Redis"
        : "Failed to reconnect to Redis, using memory fallback",
    };
  }),

  /**
   * Get cache configuration (admin only)
   */
  config: adminProcedure.query(() => {
    return {
      ttl: CacheTTL,
      namespaces: CacheNamespace,
      redisUrl: process.env.REDIS_URL ? "[configured]" : "[not configured]",
      cachePrefix: process.env.CACHE_PREFIX || "ais",
    };
  }),
});
