/**
 * Redis Cache Service - Production-Grade
 *
 * Features:
 * - Versioned keys for O(1) invalidation
 * - Tag-based invalidation (fallback)
 * - SCAN instead of KEYS (production safe)
 * - Graceful degradation when Redis is down
 *
 * @version 2.0.0
 * @date 2026-01-26
 */

import { createClient, RedisClientType } from "redis";
import crypto from "crypto";
import { logger } from "./logger.service";

const CACHE_PREFIX = process.env.CACHE_PREFIX || "ais";

/**
 * Redis Cache Service
 * Provides caching for search results and other frequently accessed data
 */
class CacheService {
  private client: RedisClientType | null = null;
  private connected: boolean = false;

  /**
   * Initialize Redis connection
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      this.client = createClient({
        url: process.env.REDIS_URL || "redis://localhost:6379",
        socket: {
          reconnectStrategy: retries => {
            if (retries > 10) {
              logger.error("Redis reconnection failed after 10 retries");
              return new Error("Redis reconnection limit exceeded");
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.client.on("error", err => {
        logger.error("Redis client error", { error: err });
      });

      this.client.on("connect", () => {
        logger.info("Redis client connected");
      });

      this.client.on("disconnect", () => {
        logger.warn("Redis client disconnected");
        this.connected = false;
      });

      await this.client.connect();
      this.connected = true;

      logger.info("Redis cache service initialized");
    } catch (error) {
      logger.error("Failed to connect to Redis", { error });
      // Don't throw - allow app to run without cache
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Check if Redis is connected
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * Generate cache key from query parameters
   */
  private generateCacheKey(prefix: string, params: any): string {
    const paramsString = JSON.stringify(params, Object.keys(params).sort());
    const hash = crypto.createHash("md5").update(paramsString).digest("hex");
    return `${CACHE_PREFIX}:${prefix}:${hash}`;
  }

  // ============================================================================
  // VERSIONED KEYS - O(1) Invalidation
  // ============================================================================

  /**
   * Get current version for a namespace
   */
  private async getVersion(namespace: string): Promise<number> {
    if (!this.isConnected()) {
      return 1;
    }

    try {
      const versionKey = `${CACHE_PREFIX}:v:${namespace}`;
      const version = await this.client!.get(versionKey);
      return version ? parseInt(version) : 1;
    } catch (error) {
      logger.error("Failed to get version", { namespace, error });
      return 1;
    }
  }

  /**
   * Increment version to invalidate all keys in namespace
   * This is O(1) - no matter how many keys exist!
   */
  async invalidateNamespace(namespace: string): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      const versionKey = `${CACHE_PREFIX}:v:${namespace}`;
      await this.client!.incr(versionKey);
      logger.info("Invalidated namespace", { namespace });
    } catch (error) {
      logger.error("Failed to invalidate namespace", { namespace, error });
    }
  }

  /**
   * Build versioned cache key
   */
  private async buildVersionedKey(
    namespace: string,
    hash: string
  ): Promise<string> {
    const version = await this.getVersion(namespace);
    return `${CACHE_PREFIX}:${namespace}:${version}:${hash}`;
  }

  // ============================================================================
  // CORE METHODS
  // ============================================================================

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const value = await this.client!.get(key);
      if (!value) {
        return null;
      }

      logger.debug("Cache hit", { key });
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error("Cache get error", { key, error });
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      const serialized = JSON.stringify(value);
      await this.client!.setEx(key, ttlSeconds, serialized);
      logger.debug("Cache set", { key, ttl: ttlSeconds });
    } catch (error) {
      logger.error("Cache set error", { key, error });
    }
  }

  /**
   * Delete value from cache
   */
  async del(key: string): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      await this.client!.del(key);
      logger.debug("Cache delete", { key });
    } catch (error) {
      logger.error("Cache delete error", { key, error });
    }
  }

  /**
   * Delete multiple keys matching pattern
   * Note: Uses SCAN instead of KEYS for production safety
   */
  async delPattern(pattern: string): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      let cursor = 0;
      let deletedCount = 0;

      do {
        const result = await this.client!.scan(cursor, {
          MATCH: pattern,
          COUNT: 100,
        });

        cursor = result.cursor;
        const keys = result.keys;

        if (keys.length > 0) {
          await this.client!.del(keys);
          deletedCount += keys.length;
        }
      } while (cursor !== 0);

      logger.debug("Cache delete pattern", { pattern, count: deletedCount });
    } catch (error) {
      logger.error("Cache delete pattern error", { pattern, error });
    }
  }

  // ============================================================================
  // FLIGHT SEARCH - Using Versioned Keys
  // ============================================================================

  /**
   * Cache flight search results using versioned keys
   */
  async cacheFlightSearch(
    params: {
      from: string;
      to: string;
      date: string;
      passengers?: number;
      cabinClass?: string;
    },
    results: any,
    ttlSeconds: number = 120 // 2 minutes default
  ): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      const paramsString = JSON.stringify(params, Object.keys(params).sort());
      const hash = crypto.createHash("md5").update(paramsString).digest("hex");
      const key = await this.buildVersionedKey("search", hash);

      await this.set(key, results, ttlSeconds);

      // Also add to route tag set (for backward compatibility)
      const tagKey = `${CACHE_PREFIX}:search:routes:${params.from}:${params.to}`;
      await this.client!.sAdd(tagKey, key);
      await this.client!.expire(tagKey, ttlSeconds + 60);
    } catch (error) {
      logger.error("Failed to cache flight search", { params, error });
    }
  }

  /**
   * Get cached flight search results
   */
  async getCachedFlightSearch(params: {
    from: string;
    to: string;
    date: string;
    passengers?: number;
    cabinClass?: string;
  }): Promise<any | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const paramsString = JSON.stringify(params, Object.keys(params).sort());
      const hash = crypto.createHash("md5").update(paramsString).digest("hex");
      const key = await this.buildVersionedKey("search", hash);

      return await this.get(key);
    } catch (error) {
      logger.error("Failed to get cached flight search", { params, error });
      return null;
    }
  }

  /**
   * Invalidate ALL flight search cache - O(1) operation
   */
  async invalidateAllFlightSearchCache(): Promise<void> {
    await this.invalidateNamespace("search");
  }

  /**
   * Invalidate flight search cache for a specific route
   * Uses tag-based approach for route-specific invalidation
   */
  async invalidateFlightSearchCache(from: string, to: string): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    const tagKey = `${CACHE_PREFIX}:search:routes:${from}:${to}`;

    try {
      // Get all cache keys for this route
      const cacheKeys = await this.client!.sMembers(tagKey);

      if (cacheKeys.length > 0) {
        // Delete all cache keys
        await this.client!.del(cacheKeys);
        // Delete the tag set
        await this.client!.del(tagKey);

        logger.debug("Invalidated flight search cache", {
          from,
          to,
          count: cacheKeys.length,
        });
      }
    } catch (error) {
      logger.error("Failed to invalidate flight search cache", {
        from,
        to,
        error,
      });
    }
  }

  // ============================================================================
  // FLIGHT DETAILS - Using Versioned Keys
  // ============================================================================

  /**
   * Cache flight details
   */
  async cacheFlightDetails(
    flightId: number,
    details: any,
    ttlSeconds: number = 300 // 5 minutes
  ): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      const key = await this.buildVersionedKey("flight", flightId.toString());
      await this.set(key, details, ttlSeconds);
    } catch (error) {
      logger.error("Failed to cache flight details", { flightId, error });
    }
  }

  /**
   * Get cached flight details
   */
  async getCachedFlightDetails(flightId: number): Promise<any | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const key = await this.buildVersionedKey("flight", flightId.toString());
      return await this.get(key);
    } catch (error) {
      logger.error("Failed to get cached flight details", { flightId, error });
      return null;
    }
  }

  /**
   * Invalidate flight details cache - O(1) operation
   */
  async invalidateFlightDetailsCache(flightId?: number): Promise<void> {
    if (flightId) {
      // Invalidate specific flight (delete key directly)
      const key = await this.buildVersionedKey("flight", flightId.toString());
      await this.del(key);
    } else {
      // Invalidate all flights - O(1)
      await this.invalidateNamespace("flight");
    }
  }

  // ============================================================================
  // PRICING - Using Versioned Keys
  // ============================================================================

  /**
   * Cache pricing data
   */
  async cachePricing(
    flightId: number,
    cabinClass: string,
    pricing: any,
    ttlSeconds: number = 60 // 1 minute (prices change frequently)
  ): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      const hash = crypto
        .createHash("md5")
        .update(`${flightId}:${cabinClass}`)
        .digest("hex");
      const key = await this.buildVersionedKey("pricing", hash);
      await this.set(key, pricing, ttlSeconds);
    } catch (error) {
      logger.error("Failed to cache pricing", { flightId, cabinClass, error });
    }
  }

  /**
   * Get cached pricing
   */
  async getCachedPricing(
    flightId: number,
    cabinClass: string
  ): Promise<any | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const hash = crypto
        .createHash("md5")
        .update(`${flightId}:${cabinClass}`)
        .digest("hex");
      const key = await this.buildVersionedKey("pricing", hash);
      return await this.get(key);
    } catch (error) {
      logger.error("Failed to get cached pricing", {
        flightId,
        cabinClass,
        error,
      });
      return null;
    }
  }

  /**
   * Invalidate all pricing cache - O(1) operation
   */
  async invalidatePricingCache(): Promise<void> {
    await this.invalidateNamespace("pricing");
  }

  // ============================================================================
  // USER SESSION
  // ============================================================================

  /**
   * Cache user session data
   */
  async cacheUserSession(
    userId: number,
    sessionData: any,
    ttlSeconds: number = 900 // 15 minutes
  ): Promise<void> {
    const key = `${CACHE_PREFIX}:session:${userId}`;
    await this.set(key, sessionData, ttlSeconds);
  }

  /**
   * Get cached user session
   */
  async getCachedUserSession(userId: number): Promise<any | null> {
    const key = `${CACHE_PREFIX}:session:${userId}`;
    return await this.get(key);
  }

  /**
   * Invalidate user session cache
   */
  async invalidateUserSession(userId: number): Promise<void> {
    const key = `${CACHE_PREFIX}:session:${userId}`;
    await this.del(key);
  }

  // ============================================================================
  // RATE LIMITING
  // ============================================================================

  /**
   * Rate limiting using Redis
   */
  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    if (!this.isConnected()) {
      // If Redis is down, allow the request
      return { allowed: true, remaining: limit };
    }

    try {
      const rateLimitKey = `${CACHE_PREFIX}:ratelimit:${key}`;
      const current = await this.client!.incr(rateLimitKey);

      if (current === 1) {
        // First request in window, set expiry
        await this.client!.expire(rateLimitKey, windowSeconds);
      }

      const allowed = current <= limit;
      const remaining = Math.max(0, limit - current);

      return { allowed, remaining };
    } catch (error) {
      logger.error("Rate limit check error", { key, error });
      // On error, allow the request
      return { allowed: true, remaining: limit };
    }
  }

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  /**
   * Health check for Redis
   */
  async healthCheck(): Promise<{
    status: "ok" | "error";
    latency?: number;
    error?: string;
  }> {
    if (!this.isConnected()) {
      return { status: "error", error: "Not connected" };
    }

    try {
      const start = Date.now();
      await this.client!.ping();
      const latency = Date.now() - start;

      return { status: "ok", latency };
    } catch (error: any) {
      return { status: "error", error: error.message };
    }
  }

  /**
   * Get cache stats
   */
  async getStats(): Promise<{
    connected: boolean;
    namespaceVersions: Record<string, number>;
  }> {
    const namespaces = ["search", "flight", "pricing"];
    const versions: Record<string, number> = {};

    for (const ns of namespaces) {
      versions[ns] = await this.getVersion(ns);
    }

    return {
      connected: this.connected,
      namespaceVersions: versions,
    };
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
      logger.info("Redis cache service disconnected");
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// Initialize on module load
cacheService.connect().catch(err => {
  logger.error("Failed to initialize cache service", { error: err });
});
