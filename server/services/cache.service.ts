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

import Redis from "ioredis";
import crypto from "crypto";
import { logger } from "../_core/logger";

const CACHE_PREFIX = process.env.CACHE_PREFIX || "ais";
const REQUEST_COMMAND_TIMEOUT_MS = 250;

// One round trip and one atomic mutation: a disconnect cannot split creation,
// increment and expiry, or leave an immortal counter at a window boundary.
const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/** Request deadlines belong to the transport that accepted the command. */
class RequestRedis extends Redis {
  override sendCommand(
    ...args: Parameters<Redis["sendCommand"]>
  ): ReturnType<Redis["sendCommand"]> {
    const result = super.sendCommand(...args);
    const transport = this.stream;
    void args[0].promise.catch((error: unknown) => {
      if (error instanceof Error && error.message === "Command timed out") {
        // ioredis commandTimeout rejects without removing commandQueue entries.
        // Closing their original socket flushes them (maxRetriesPerRequest: 0).
        // Never look up this.stream here: it may already be a recovered socket.
        transport?.destroy(error);
      }
    });
    return result;
  }
}

/**
 * Redis Cache Service
 * Provides caching for search results and other frequently accessed data
 */
class CacheService {
  private client: Redis | null = null;
  private connected: boolean = false;

  /**
   * Initialize Redis connection
   */
  connect(): void {
    if (this.connected) {
      return;
    }

    try {
      this.client = new RequestRedis(
        process.env.REDIS_URL || "redis://localhost:6379",
        {
          // This connection serves requests, not durable background jobs.
          // A failed mutation must never be replayed after its caller has
          // fallen back, especially after a rate-limit window has expired.
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
          autoResendUnfulfilledCommands: false,
          commandTimeout: REQUEST_COMMAND_TIMEOUT_MS,
          // Pinned ioredis's socketTimeout survives close and targets the
          // current stream. RequestRedis instead closes only the command's
          // captured transport, without a timer on an idle healthy connection.
          retryStrategy: (retries: number) => {
            if (retries > 10) {
              logger.error({}, "Redis reconnection failed after 10 retries");
              return null;
            }
            return Math.min(retries * 100, 3000);
          },
        }
      );

      this.client.on("error", (err: Error) => {
        logger.error({ error: err }, "Redis client error");
      });

      this.client.on("connect", () => {
        logger.info({}, "Redis client connected");
        // TCP can connect while Redis is still loading, authenticating or
        // about to disconnect. Commands would queue until readiness/retries;
        // callers must retain the memory fallback until the protocol is ready.
        this.connected = false;
      });

      this.client.on("ready", () => {
        logger.info({}, "Redis cache service initialized");
        this.connected = true;
      });

      this.client.on("close", () => {
        logger.warn({}, "Redis client disconnected");
        this.connected = false;
      });
    } catch (error) {
      logger.error({ error }, "Failed to connect to Redis");
      // Don't throw - allow app to run without cache
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Check if Redis is connected
   */
  isConnected(): boolean {
    const client = this.client;
    return (
      this.connected && client?.status === "ready" && !client.stream.destroyed
    );
  }

  /**
   * Generate cache key from query parameters
   */
  private generateCacheKey(
    prefix: string,
    params: Record<string, unknown>
  ): string {
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
      const client = this.client;
      if (!client) return 1;
      const versionKey = `${CACHE_PREFIX}:v:${namespace}`;
      const version = await client.get(versionKey);
      return version ? parseInt(version) : 1;
    } catch (error) {
      logger.error({ namespace, error }, "Failed to get version");
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
      const client = this.client;
      if (!client) return;
      const versionKey = `${CACHE_PREFIX}:v:${namespace}`;
      await client.incr(versionKey);
      logger.info({ namespace }, "Invalidated namespace");
    } catch (error) {
      logger.error({ namespace, error }, "Failed to invalidate namespace");
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
      const client = this.client;
      if (!client) return null;
      const value = await client.get(key);
      if (!value) {
        return null;
      }

      logger.debug({ key }, "Cache hit");
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error({ key, error }, "Cache get error");
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(
    key: string,
    value: unknown,
    ttlSeconds: number = 300
  ): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      const client = this.client;
      if (!client) return;
      const serialized = JSON.stringify(value);
      await client.setex(key, ttlSeconds, serialized);
      logger.debug({ key, ttl: ttlSeconds }, "Cache set");
    } catch (error) {
      logger.error({ key, error }, "Cache set error");
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
      const client = this.client;
      if (!client) return;
      await client.del(key);
      logger.debug({ key }, "Cache delete");
    } catch (error) {
      logger.error({ key, error }, "Cache delete error");
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
      const client = this.client;
      if (!client) return;
      let cursor = "0";
      let deletedCount = 0;

      do {
        const result = await client.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          "100"
        );

        cursor = result[0];
        const keys = result[1];

        if (keys.length > 0) {
          await client.del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== "0");

      logger.debug({ pattern, count: deletedCount }, "Cache delete pattern");
    } catch (error) {
      logger.error({ pattern, error }, "Cache delete pattern error");
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
    results: unknown,
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
      const client = this.client;
      if (!client) return;
      const tagKey = `${CACHE_PREFIX}:search:routes:${params.from}:${params.to}`;
      await client.sadd(tagKey, key);
      await client.expire(tagKey, ttlSeconds + 60);
    } catch (error) {
      logger.error({ params, error }, "Failed to cache flight search");
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
  }): Promise<unknown | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const paramsString = JSON.stringify(params, Object.keys(params).sort());
      const hash = crypto.createHash("md5").update(paramsString).digest("hex");
      const key = await this.buildVersionedKey("search", hash);

      return await this.get(key);
    } catch (error) {
      logger.error({ params, error }, "Failed to get cached flight search");
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
      const client = this.client;
      if (!client) return;
      // Get all cache keys for this route
      const cacheKeys = await client.smembers(tagKey);

      if (cacheKeys.length > 0) {
        // Delete all cache keys
        await client.del(...cacheKeys);
        // Delete the tag set
        await client.del(tagKey);

        logger.debug(
          {
            from,
            to,
            count: cacheKeys.length,
          },
          "Invalidated flight search cache"
        );
      }
    } catch (error) {
      logger.error(
        {
          from,
          to,
          error,
        },
        "Failed to invalidate flight search cache"
      );
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
    details: unknown,
    ttlSeconds: number = 300 // 5 minutes
  ): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      const key = await this.buildVersionedKey("flight", flightId.toString());
      await this.set(key, details, ttlSeconds);
    } catch (error) {
      logger.error({ flightId, error }, "Failed to cache flight details");
    }
  }

  /**
   * Get cached flight details
   */
  async getCachedFlightDetails(flightId: number): Promise<unknown | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const key = await this.buildVersionedKey("flight", flightId.toString());
      return await this.get(key);
    } catch (error) {
      logger.error({ flightId, error }, "Failed to get cached flight details");
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
    pricing: unknown,
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
      logger.error({ flightId, cabinClass, error }, "Failed to cache pricing");
    }
  }

  /**
   * Get cached pricing
   */
  async getCachedPricing(
    flightId: number,
    cabinClass: string
  ): Promise<unknown | null> {
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
      logger.error(
        {
          flightId,
          cabinClass,
          error,
        },
        "Failed to get cached pricing"
      );
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
    sessionData: unknown,
    ttlSeconds: number = 900 // 15 minutes
  ): Promise<void> {
    const key = `${CACHE_PREFIX}:session:${userId}`;
    await this.set(key, sessionData, ttlSeconds);
  }

  /**
   * Get cached user session
   */
  async getCachedUserSession(userId: number): Promise<unknown | null> {
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
  ): Promise<{ allowed: boolean; remaining: number; ttlMs: number }> {
    const client = this.client;
    if (!this.isConnected() || !client) {
      // Let the caller apply its bounded fallback or fail closed.
      throw new Error("Redis rate limiter unavailable");
    }
    const windowMs = windowSeconds * 1000;
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0)
      throw new Error("Invalid Redis rate limit window");

    try {
      const rateLimitKey = `${CACHE_PREFIX}:ratelimit:${key}`;
      const reply = await client.eval(
        RATE_LIMIT_SCRIPT,
        1,
        rateLimitKey,
        windowMs
      );
      if (
        !Array.isArray(reply) ||
        reply.length !== 2 ||
        !Number.isSafeInteger(reply[0]) ||
        reply[0] < 1 ||
        !Number.isSafeInteger(reply[1]) ||
        reply[1] < 0
      )
        throw new Error("Invalid Redis rate limit reply");
      const [current, ttlMs] = reply as [number, number];

      const allowed = current <= limit;
      const remaining = Math.max(0, limit - current);

      return { allowed, remaining, ttlMs };
    } catch (error) {
      logger.error({ key, error }, "Rate limit check error");
      throw error;
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
      const client = this.client;
      if (!client)
        return { status: "error" as const, error: "Client not available" };
      const start = Date.now();
      await client.ping();
      const latency = Date.now() - start;

      return { status: "ok", latency };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
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
    const client = this.client;
    this.client = null;
    this.connected = false;
    if (!client) return;
    try {
      if (client.status === "ready") await client.quit();
    } finally {
      // An unavailable transport cannot acknowledge QUIT. Stop reconnecting
      // and dispose of this owned socket even if a ready QUIT times out.
      client.disconnect();
      client.stream?.destroy();
    }
    logger.info({}, "Redis cache service disconnected");
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// Initialize on module load
try {
  cacheService.connect();
} catch (err) {
  logger.error({ error: err }, "Failed to initialize cache service");
}
