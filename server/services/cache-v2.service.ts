/**
 * Redis Cache V2 Service - Production-Grade
 *
 * Features:
 * - Versioned keys (no KEYS command needed)
 * - O(1) invalidation
 * - Safe for production with millions of keys
 * - Graceful degradation when Redis is down
 *
 * @version 2.0.0
 * @date 2026-01-26
 */

import crypto from "crypto";
import Redis from "ioredis";

// ============================================================================
// CONFIGURATION
// ============================================================================

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CACHE_PREFIX = process.env.CACHE_PREFIX || "ais";
const DEFAULT_TTL = 120; // 2 minutes

// ============================================================================
// REDIS CLIENT
// ============================================================================

let redisClient: Redis | null = null;
let isConnected = false;

/**
 * Get or create Redis client
 */
function getRedisClient(): Redis | null {
  if (redisClient) {
    return isConnected ? redisClient : null;
  }

  try {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: times => {
        if (times > 3) {
          console.error("[Cache] Max retries reached, giving up");
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });

    redisClient.on("connect", () => {
      console.info("[Cache] Redis connected");
      isConnected = true;
    });

    redisClient.on("error", err => {
      console.error("[Cache] Redis error:", err.message);
      isConnected = false;
    });

    redisClient.on("close", () => {
      console.info("[Cache] Redis connection closed");
      isConnected = false;
    });

    // Connect
    redisClient.connect().catch(err => {
      console.error("[Cache] Failed to connect to Redis:", err.message);
    });

    return isConnected ? redisClient : null;
  } catch (err) {
    console.error("[Cache] Failed to create Redis client:", err);
    return null;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate MD5 hash for cache key
 */
function hashParams(params: unknown): string {
  const replacer =
    params && typeof params === "object" && !Array.isArray(params)
      ? Object.keys(params).sort()
      : undefined;
  const normalized = JSON.stringify(params, replacer);
  return crypto.createHash("md5").update(normalized).digest("hex");
}

/**
 * Build versioned cache key
 */
function buildKey(namespace: string, version: number, hash: string): string {
  return `${CACHE_PREFIX}:${namespace}:${version}:${hash}`;
}

/**
 * Build version key
 */
function buildVersionKey(namespace: string): string {
  return `${CACHE_PREFIX}:v:${namespace}`;
}

// ============================================================================
// CACHE SERVICE
// ============================================================================

export const cacheServiceV2 = {
  /**
   * Get current version for a namespace
   */
  async getVersion(namespace: string): Promise<number> {
    const client = getRedisClient();
    if (!client) {
      return 1; // Default version when Redis is down
    }

    try {
      const version = await client.get(buildVersionKey(namespace));
      return version ? parseInt(version) : 1;
    } catch (err) {
      console.error(`[Cache] Failed to get version for ${namespace}:`, err);
      return 1;
    }
  },

  /**
   * Increment version to invalidate all keys in namespace
   * This is O(1) - no matter how many keys exist!
   */
  async invalidateNamespace(namespace: string): Promise<void> {
    const client = getRedisClient();
    if (!client) {
      console.warn(`[Cache] Redis not available, skipping invalidation`);
      return;
    }

    try {
      await client.incr(buildVersionKey(namespace));
      console.info(`[Cache] Invalidated namespace: ${namespace}`);
    } catch (err) {
      console.error(`[Cache] Failed to invalidate ${namespace}:`, err);
    }
  },

  /**
   * Get cached value
   */
  async get<T>(namespace: string, params: unknown): Promise<T | null> {
    const client = getRedisClient();
    if (!client) {
      return null; // Cache miss when Redis is down
    }

    try {
      const version = await this.getVersion(namespace);
      const hash = hashParams(params);
      const key = buildKey(namespace, version, hash);

      const cached = await client.get(key);
      if (!cached) {
        return null;
      }

      return JSON.parse(cached) as T;
    } catch (err) {
      console.error(`[Cache] Failed to get from ${namespace}:`, err);
      return null;
    }
  },

  /**
   * Set cached value
   */
  async set(
    namespace: string,
    params: unknown,
    value: unknown,
    ttlSeconds: number = DEFAULT_TTL
  ): Promise<void> {
    const client = getRedisClient();
    if (!client) {
      return; // Skip caching when Redis is down
    }

    try {
      const version = await this.getVersion(namespace);
      const hash = hashParams(params);
      const key = buildKey(namespace, version, hash);

      await client.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (err) {
      console.error(`[Cache] Failed to set in ${namespace}:`, err);
    }
  },

  /**
   * Delete specific cached value
   */
  async delete(namespace: string, params: unknown): Promise<void> {
    const client = getRedisClient();
    if (!client) {
      return;
    }

    try {
      const version = await this.getVersion(namespace);
      const hash = hashParams(params);
      const key = buildKey(namespace, version, hash);

      await client.del(key);
    } catch (err) {
      console.error(`[Cache] Failed to delete from ${namespace}:`, err);
    }
  },

  // ============================================================================
  // FLIGHT SEARCH SPECIFIC METHODS
  // ============================================================================

  /**
   * Cache flight search results
   */
  async cacheFlightSearch(
    params: {
      origin: string;
      destination: string;
      departureDate: string;
      returnDate?: string;
      passengers: number;
      cabinClass?: string;
    },
    results: unknown,
    ttlSeconds: number = 120
  ): Promise<void> {
    await this.set("search", params, results, ttlSeconds);
  },

  /**
   * Get cached flight search results
   */
  getCachedFlightSearch(params: {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate?: string;
    passengers: number;
    cabinClass?: string;
  }): Promise<unknown | null> {
    return this.get("search", params);
  },

  /**
   * Invalidate all flight search cache
   * Call this when flight data changes (e.g., new flights added, prices updated)
   */
  async invalidateFlightSearchCache(): Promise<void> {
    await this.invalidateNamespace("search");
  },

  // ============================================================================
  // FLIGHT DETAILS SPECIFIC METHODS
  // ============================================================================

  /**
   * Cache flight details
   */
  async cacheFlightDetails(
    flightId: number,
    details: unknown,
    ttlSeconds: number = 300
  ): Promise<void> {
    await this.set("flight", { flightId }, details, ttlSeconds);
  },

  /**
   * Get cached flight details
   */
  getCachedFlightDetails(flightId: number): Promise<unknown | null> {
    return this.get("flight", { flightId });
  },

  /**
   * Invalidate flight details cache
   */
  async invalidateFlightDetailsCache(flightId?: number): Promise<void> {
    if (flightId) {
      await this.delete("flight", { flightId });
    } else {
      await this.invalidateNamespace("flight");
    }
  },

  // ============================================================================
  // PRICING SPECIFIC METHODS
  // ============================================================================

  /**
   * Cache pricing data
   */
  async cachePricing(
    flightId: number,
    cabinClass: string,
    pricing: unknown,
    ttlSeconds: number = 60
  ): Promise<void> {
    await this.set("pricing", { flightId, cabinClass }, pricing, ttlSeconds);
  },

  /**
   * Get cached pricing
   */
  getCachedPricing(
    flightId: number,
    cabinClass: string
  ): Promise<unknown | null> {
    return this.get("pricing", { flightId, cabinClass });
  },

  /**
   * Invalidate pricing cache
   */
  async invalidatePricingCache(): Promise<void> {
    await this.invalidateNamespace("pricing");
  },

  // ============================================================================
  // USER SPECIFIC METHODS
  // ============================================================================

  /**
   * Cache user data
   */
  async cacheUser(
    userId: number,
    userData: unknown,
    ttlSeconds: number = 300
  ): Promise<void> {
    await this.set("user", { userId }, userData, ttlSeconds);
  },

  /**
   * Get cached user data
   */
  getCachedUser(userId: number): Promise<unknown | null> {
    return this.get("user", { userId });
  },

  /**
   * Invalidate user cache
   */
  async invalidateUserCache(userId: number): Promise<void> {
    await this.delete("user", { userId });
  },

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  /**
   * Check Redis health
   */
  async healthCheck(): Promise<{
    status: "ok" | "error";
    latency?: number;
    error?: string;
  }> {
    const client = getRedisClient();
    if (!client) {
      return { status: "error", error: "Redis client not available" };
    }

    try {
      const start = Date.now();
      await client.ping();
      const latency = Date.now() - start;

      return { status: "ok", latency };
    } catch (err: any) {
      return { status: "error", error: err.message };
    }
  },

  /**
   * Get cache stats
   */
  async getStats(): Promise<{
    connected: boolean;
    namespaceVersions: Record<string, number>;
  }> {
    const namespaces = ["search", "flight", "pricing", "user"];
    const versions: Record<string, number> = {};

    for (const ns of namespaces) {
      versions[ns] = await this.getVersion(ns);
    }

    return {
      connected: isConnected,
      namespaceVersions: versions,
    };
  },

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (redisClient) {
      await redisClient.quit();
      redisClient = null;
      isConnected = false;
      console.info("[Cache] Redis connection closed");
    }
  },
};

export default cacheServiceV2;
