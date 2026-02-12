/**
 * Redis Cache Service with Memory Fallback
 *
 * A comprehensive caching layer for the AIS Aviation System that provides:
 * - Redis as primary cache with automatic reconnection
 * - In-memory LRU cache as fallback when Redis is unavailable
 * - TTL management for different data types
 * - Cache invalidation strategies (namespace versioning, key-based, pattern-based)
 * - Comprehensive statistics tracking
 *
 * @version 3.0.0
 * @date 2026-02-05
 */

import crypto from "crypto";
import Redis from "ioredis";
import { logger } from "../_core/logger";

// ============================================================================
// CONFIGURATION
// ============================================================================

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CACHE_PREFIX = process.env.CACHE_PREFIX || "ais";
const MAX_RECONNECT_RETRIES = 10;
const RECONNECT_DELAY_MS = 1000;
const MEMORY_CACHE_MAX_SIZE = 10000; // Maximum items in memory cache

// TTL Configuration (in seconds)
export const CacheTTL = {
  // Short-lived caches (data changes frequently)
  FLIGHT_SEARCH: 120, // 2 minutes - search results change with availability
  PRICING: 60, // 1 minute - prices are dynamic
  AVAILABILITY: 30, // 30 seconds - seat availability changes rapidly

  // Medium-lived caches
  FLIGHT_DETAILS: 300, // 5 minutes
  USER_SESSION: 900, // 15 minutes
  POPULAR_ROUTES: 600, // 10 minutes

  // Long-lived caches (reference data, rarely changes)
  AIRPORTS: 3600, // 1 hour
  AIRLINES: 3600, // 1 hour
  CITIES: 3600, // 1 hour

  // Very long-lived caches
  STATIC_CONFIG: 86400, // 24 hours
} as const;

// Cache Namespaces
export const CacheNamespace = {
  SEARCH: "search",
  FLIGHT: "flight",
  PRICING: "pricing",
  AIRPORTS: "airports",
  AIRLINES: "airlines",
  CITIES: "cities",
  SESSION: "session",
  ROUTES: "routes",
  USER: "user",
} as const;

// ============================================================================
// TYPES
// ============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
  memoryFallbackUsed: number;
}

interface DetailedCacheStats extends CacheStats {
  hitRate: number;
  redisConnected: boolean;
  memoryEntries: number;
  namespaceVersions: Record<string, number>;
  uptime: number;
}

// ============================================================================
// MEMORY CACHE IMPLEMENTATION (LRU)
// ============================================================================

class LRUMemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private maxSize: number;

  constructor(maxSize: number = MEMORY_CACHE_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value as T;
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  deletePattern(pattern: string): number {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
    );
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    // Clean expired entries and return count
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    return this.cache.size;
  }

  /**
   * Periodically clean expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// ============================================================================
// REDIS CACHE SERVICE
// ============================================================================

class RedisCacheService {
  private redisClient: Redis | null = null;
  private memoryCache: LRUMemoryCache;
  private isRedisConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();

  // Statistics tracking
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    memoryFallbackUsed: 0,
  };

  constructor() {
    this.memoryCache = new LRUMemoryCache();
    this.initializeRedis();
    this.startCleanupInterval();
  }

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  private initializeRedis(): void {
    try {
      this.redisClient = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          if (times > MAX_RECONNECT_RETRIES) {
            logger.error(
              { times },
              "Redis max reconnection attempts reached, using memory fallback"
            );
            return null;
          }
          const delay = Math.min(times * RECONNECT_DELAY_MS, 30000);
          logger.info({ times, delay }, "Redis reconnecting...");
          return delay;
        },
        reconnectOnError: (err: Error) => {
          const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
          return targetErrors.some(e => err.message.includes(e));
        },
      });

      this.setupEventHandlers();

      // Attempt initial connection
      this.redisClient.connect().catch(err => {
        logger.warn(
          { error: err.message },
          "Initial Redis connection failed, using memory fallback"
        );
      });
    } catch (error) {
      logger.error({ error }, "Failed to initialize Redis client");
      this.redisClient = null;
    }
  }

  private setupEventHandlers(): void {
    if (!this.redisClient) return;

    this.redisClient.on("connect", () => {
      logger.info({}, "Redis client connecting...");
    });

    this.redisClient.on("ready", () => {
      this.isRedisConnected = true;
      this.reconnectAttempts = 0;
      logger.info({}, "Redis cache service ready");
    });

    this.redisClient.on("error", (err: Error) => {
      logger.error({ error: err.message }, "Redis client error");
      this.stats.errors++;
    });

    this.redisClient.on("close", () => {
      this.isRedisConnected = false;
      logger.warn({}, "Redis connection closed");
    });

    this.redisClient.on("reconnecting", () => {
      this.reconnectAttempts++;
      logger.info({ attempt: this.reconnectAttempts }, "Redis reconnecting...");
    });

    this.redisClient.on("end", () => {
      this.isRedisConnected = false;
      logger.warn({}, "Redis connection ended");
    });
  }

  private startCleanupInterval(): void {
    // Clean memory cache every 5 minutes
    this.cleanupTimer = setInterval(
      () => {
        const cleaned = this.memoryCache.cleanup();
        if (cleaned > 0) {
          logger.debug({ cleaned }, "Memory cache cleanup completed");
        }
      },
      5 * 60 * 1000
    );
  }

  /**
   * Check if Redis is available
   */
  isConnected(): boolean {
    return this.isRedisConnected && this.redisClient !== null;
  }

  /**
   * Force reconnection to Redis
   */
  async reconnect(): Promise<boolean> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.redisClient) {
      try {
        await this.redisClient.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.redisClient = null;
    }

    this.initializeRedis();

    // Wait for connection with timeout
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, 5000);

      if (this.redisClient) {
        this.redisClient.once("ready", () => {
          clearTimeout(timeout);
          resolve(true);
        });
      } else {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  // ============================================================================
  // CORE CACHE OPERATIONS
  // ============================================================================

  /**
   * Generate a unique cache key
   */
  private generateKey(
    namespace: string,
    version: number,
    identifier: string
  ): string {
    return `${CACHE_PREFIX}:${namespace}:v${version}:${identifier}`;
  }

  /**
   * Generate hash from parameters
   */
  private hashParams(params: unknown): string {
    const replacer =
      params && typeof params === "object" && !Array.isArray(params)
        ? Object.keys(params).sort()
        : undefined;
    const normalized = JSON.stringify(params, replacer);
    return crypto
      .createHash("sha256")
      .update(normalized)
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Get namespace version for O(1) invalidation
   */
  async getNamespaceVersion(namespace: string): Promise<number> {
    if (!this.isConnected()) {
      return 1;
    }

    try {
      const client = this.redisClient;
      if (!client) return 1;
      const versionKey = `${CACHE_PREFIX}:version:${namespace}`;
      const version = await client.get(versionKey);
      return version ? parseInt(version, 10) : 1;
    } catch (error) {
      logger.error({ namespace, error }, "Failed to get namespace version");
      return 1;
    }
  }

  /**
   * Invalidate namespace by incrementing version (O(1) operation)
   */
  async invalidateNamespace(namespace: string): Promise<void> {
    if (!this.isConnected()) {
      // For memory cache, we need to delete by pattern
      this.memoryCache.deletePattern(`${CACHE_PREFIX}:${namespace}:*`);
      logger.info({ namespace }, "Invalidated namespace in memory cache");
      return;
    }

    try {
      const client = this.redisClient;
      if (!client) return;
      const versionKey = `${CACHE_PREFIX}:version:${namespace}`;
      await client.incr(versionKey);
      // Also clear memory cache for this namespace
      this.memoryCache.deletePattern(`${CACHE_PREFIX}:${namespace}:*`);
      logger.info({ namespace }, "Invalidated namespace");
    } catch (error) {
      logger.error({ namespace, error }, "Failed to invalidate namespace");
    }
  }

  /**
   * Get value from cache
   */
  async get<T>(namespace: string, params: unknown): Promise<T | null> {
    const hash = this.hashParams(params);
    const version = await this.getNamespaceVersion(namespace);
    const key = this.generateKey(namespace, version, hash);

    // Try Redis first
    if (this.isConnected()) {
      try {
        const client = this.redisClient;
        if (client) {
          const cached = await client.get(key);
          if (cached) {
            this.stats.hits++;
            // Also store in memory for faster subsequent access
            const parsed = JSON.parse(cached) as T;
            const ttl = await client.ttl(key);
            if (ttl > 0) {
              this.memoryCache.set(key, parsed, ttl);
            }
            return parsed;
          }
        }
      } catch (error) {
        this.stats.errors++;
        logger.error({ key, error }, "Redis get error, trying memory cache");
      }
    }

    // Try memory cache as fallback
    const memoryResult = this.memoryCache.get<T>(key);
    if (memoryResult !== null) {
      this.stats.hits++;
      this.stats.memoryFallbackUsed++;
      return memoryResult;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Set value in cache
   */
  async set(
    namespace: string,
    params: unknown,
    value: unknown,
    ttlSeconds: number
  ): Promise<void> {
    const hash = this.hashParams(params);
    const version = await this.getNamespaceVersion(namespace);
    const key = this.generateKey(namespace, version, hash);
    const serialized = JSON.stringify(value);

    this.stats.sets++;

    // Always set in memory cache
    this.memoryCache.set(key, value, ttlSeconds);

    // Try to set in Redis
    if (this.isConnected()) {
      try {
        const client = this.redisClient;
        if (client) {
          await client.setex(key, ttlSeconds, serialized);
        }
      } catch (error) {
        this.stats.errors++;
        logger.error({ key, error }, "Redis set error");
      }
    } else {
      this.stats.memoryFallbackUsed++;
    }
  }

  /**
   * Delete a specific cache entry
   */
  async delete(namespace: string, params: unknown): Promise<void> {
    const hash = this.hashParams(params);
    const version = await this.getNamespaceVersion(namespace);
    const key = this.generateKey(namespace, version, hash);

    this.stats.deletes++;

    // Delete from memory
    this.memoryCache.delete(key);

    // Delete from Redis
    if (this.isConnected()) {
      try {
        const client = this.redisClient;
        if (client) {
          await client.del(key);
        }
      } catch (error) {
        this.stats.errors++;
        logger.error({ key, error }, "Redis delete error");
      }
    }
  }

  /**
   * Set a raw key-value pair (for direct key access like sessions)
   */
  async setRaw(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const fullKey = `${CACHE_PREFIX}:${key}`;
    const serialized = JSON.stringify(value);

    this.stats.sets++;
    this.memoryCache.set(fullKey, value, ttlSeconds);

    if (this.isConnected()) {
      try {
        const client = this.redisClient;
        if (client) {
          await client.setex(fullKey, ttlSeconds, serialized);
        }
      } catch (error) {
        this.stats.errors++;
        this.stats.memoryFallbackUsed++;
        logger.error({ key: fullKey, error }, "Redis setRaw error");
      }
    } else {
      this.stats.memoryFallbackUsed++;
    }
  }

  /**
   * Get a raw key-value pair
   */
  async getRaw<T>(key: string): Promise<T | null> {
    const fullKey = `${CACHE_PREFIX}:${key}`;

    if (this.isConnected()) {
      try {
        const client = this.redisClient;
        if (client) {
          const cached = await client.get(fullKey);
          if (cached) {
            this.stats.hits++;
            return JSON.parse(cached) as T;
          }
        }
      } catch (error) {
        this.stats.errors++;
        logger.error({ key: fullKey, error }, "Redis getRaw error");
      }
    }

    const memoryResult = this.memoryCache.get<T>(fullKey);
    if (memoryResult !== null) {
      this.stats.hits++;
      this.stats.memoryFallbackUsed++;
      return memoryResult;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Delete a raw key
   */
  async deleteRaw(key: string): Promise<void> {
    const fullKey = `${CACHE_PREFIX}:${key}`;

    this.stats.deletes++;
    this.memoryCache.delete(fullKey);

    if (this.isConnected()) {
      try {
        const client = this.redisClient;
        if (client) {
          await client.del(fullKey);
        }
      } catch (error) {
        this.stats.errors++;
        logger.error({ key: fullKey, error }, "Redis deleteRaw error");
      }
    }
  }

  // ============================================================================
  // FLIGHT SEARCH CACHING
  // ============================================================================

  /**
   * Cache flight search results
   */
  async cacheFlightSearch(
    params: {
      originId: number;
      destinationId: number;
      departureDate: string;
      cabinClass?: string;
      passengers?: number;
    },
    results: unknown,
    ttlSeconds: number = CacheTTL.FLIGHT_SEARCH
  ): Promise<void> {
    await this.set(CacheNamespace.SEARCH, params, results, ttlSeconds);
  }

  /**
   * Get cached flight search results
   */
  getCachedFlightSearch(params: {
    originId: number;
    destinationId: number;
    departureDate: string;
    cabinClass?: string;
    passengers?: number;
  }): Promise<unknown | null> {
    return this.get(CacheNamespace.SEARCH, params);
  }

  /**
   * Invalidate all flight search cache
   */
  async invalidateFlightSearchCache(): Promise<void> {
    await this.invalidateNamespace(CacheNamespace.SEARCH);
  }

  // ============================================================================
  // FLIGHT DETAILS CACHING
  // ============================================================================

  /**
   * Cache flight details
   */
  async cacheFlightDetails(
    flightId: number,
    details: unknown,
    ttlSeconds: number = CacheTTL.FLIGHT_DETAILS
  ): Promise<void> {
    await this.set(CacheNamespace.FLIGHT, { flightId }, details, ttlSeconds);
  }

  /**
   * Get cached flight details
   */
  getCachedFlightDetails(flightId: number): Promise<unknown | null> {
    return this.get(CacheNamespace.FLIGHT, { flightId });
  }

  /**
   * Invalidate flight details cache
   */
  async invalidateFlightDetailsCache(flightId?: number): Promise<void> {
    if (flightId) {
      await this.delete(CacheNamespace.FLIGHT, { flightId });
    } else {
      await this.invalidateNamespace(CacheNamespace.FLIGHT);
    }
  }

  // ============================================================================
  // AIRPORT/CITY CACHING (Reference Data)
  // ============================================================================

  /**
   * Cache airports list
   */
  async cacheAirports(
    airports: unknown,
    ttlSeconds: number = CacheTTL.AIRPORTS
  ): Promise<void> {
    await this.set(
      CacheNamespace.AIRPORTS,
      { key: "all" },
      airports,
      ttlSeconds
    );
  }

  /**
   * Get cached airports
   */
  getCachedAirports(): Promise<unknown | null> {
    return this.get(CacheNamespace.AIRPORTS, { key: "all" });
  }

  /**
   * Cache airlines list
   */
  async cacheAirlines(
    airlines: unknown,
    ttlSeconds: number = CacheTTL.AIRLINES
  ): Promise<void> {
    await this.set(
      CacheNamespace.AIRLINES,
      { key: "all" },
      airlines,
      ttlSeconds
    );
  }

  /**
   * Get cached airlines
   */
  getCachedAirlines(): Promise<unknown | null> {
    return this.get(CacheNamespace.AIRLINES, { key: "all" });
  }

  /**
   * Cache cities list
   */
  async cacheCities(
    cities: unknown,
    ttlSeconds: number = CacheTTL.CITIES
  ): Promise<void> {
    await this.set(CacheNamespace.CITIES, { key: "all" }, cities, ttlSeconds);
  }

  /**
   * Get cached cities
   */
  getCachedCities(): Promise<unknown | null> {
    return this.get(CacheNamespace.CITIES, { key: "all" });
  }

  /**
   * Invalidate reference data cache
   */
  async invalidateReferenceDataCache(): Promise<void> {
    await Promise.all([
      this.invalidateNamespace(CacheNamespace.AIRPORTS),
      this.invalidateNamespace(CacheNamespace.AIRLINES),
      this.invalidateNamespace(CacheNamespace.CITIES),
    ]);
  }

  // ============================================================================
  // USER SESSION CACHING
  // ============================================================================

  /**
   * Cache user session data
   */
  async cacheUserSession(
    userId: number,
    sessionData: unknown,
    ttlSeconds: number = CacheTTL.USER_SESSION
  ): Promise<void> {
    await this.setRaw(`session:${userId}`, sessionData, ttlSeconds);
  }

  /**
   * Get cached user session
   */
  getCachedUserSession(userId: number): Promise<unknown | null> {
    return this.getRaw(`session:${userId}`);
  }

  /**
   * Invalidate user session
   */
  async invalidateUserSession(userId: number): Promise<void> {
    await this.deleteRaw(`session:${userId}`);
  }

  /**
   * Extend user session TTL
   */
  async extendUserSession(
    userId: number,
    ttlSeconds: number = CacheTTL.USER_SESSION
  ): Promise<void> {
    const session = await this.getCachedUserSession(userId);
    if (session) {
      await this.cacheUserSession(userId, session, ttlSeconds);
    }
  }

  // ============================================================================
  // POPULAR ROUTES CACHING
  // ============================================================================

  /**
   * Cache popular routes
   */
  async cachePopularRoutes(
    routes: unknown,
    ttlSeconds: number = CacheTTL.POPULAR_ROUTES
  ): Promise<void> {
    await this.set(
      CacheNamespace.ROUTES,
      { key: "popular" },
      routes,
      ttlSeconds
    );
  }

  /**
   * Get cached popular routes
   */
  getCachedPopularRoutes(): Promise<unknown | null> {
    return this.get(CacheNamespace.ROUTES, { key: "popular" });
  }

  /**
   * Cache route-specific data
   */
  async cacheRoute(
    originId: number,
    destinationId: number,
    data: unknown,
    ttlSeconds: number = CacheTTL.POPULAR_ROUTES
  ): Promise<void> {
    await this.set(
      CacheNamespace.ROUTES,
      { originId, destinationId },
      data,
      ttlSeconds
    );
  }

  /**
   * Get cached route data
   */
  getCachedRoute(
    originId: number,
    destinationId: number
  ): Promise<unknown | null> {
    return this.get(CacheNamespace.ROUTES, { originId, destinationId });
  }

  /**
   * Invalidate popular routes cache
   */
  async invalidatePopularRoutesCache(): Promise<void> {
    await this.invalidateNamespace(CacheNamespace.ROUTES);
  }

  // ============================================================================
  // PRICING CACHING
  // ============================================================================

  /**
   * Cache pricing data
   */
  async cachePricing(
    flightId: number,
    cabinClass: string,
    pricing: unknown,
    ttlSeconds: number = CacheTTL.PRICING
  ): Promise<void> {
    await this.set(
      CacheNamespace.PRICING,
      { flightId, cabinClass },
      pricing,
      ttlSeconds
    );
  }

  /**
   * Get cached pricing
   */
  getCachedPricing(
    flightId: number,
    cabinClass: string
  ): Promise<unknown | null> {
    return this.get(CacheNamespace.PRICING, { flightId, cabinClass });
  }

  /**
   * Invalidate pricing cache
   */
  async invalidatePricingCache(flightId?: number): Promise<void> {
    if (flightId) {
      // Invalidate both economy and business pricing
      await Promise.all([
        this.delete(CacheNamespace.PRICING, {
          flightId,
          cabinClass: "economy",
        }),
        this.delete(CacheNamespace.PRICING, {
          flightId,
          cabinClass: "business",
        }),
      ]);
    } else {
      await this.invalidateNamespace(CacheNamespace.PRICING);
    }
  }

  // ============================================================================
  // RATE LIMITING
  // ============================================================================

  /**
   * Check and update rate limit
   */
  async checkRateLimit(
    identifier: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const key = `${CACHE_PREFIX}:ratelimit:${identifier}`;

    if (!this.isConnected()) {
      // If Redis is down, allow the request (fail open)
      return { allowed: true, remaining: limit, resetIn: windowSeconds };
    }

    try {
      const client = this.redisClient;
      if (!client)
        return { allowed: true, remaining: limit, resetIn: windowSeconds };

      await client.set(key, 0, "EX", windowSeconds, "NX");

      const multi = client.multi();
      multi.incr(key);
      multi.ttl(key);

      const results = await multi.exec();
      if (!results || results[0][0] || results[1][0]) {
        return { allowed: true, remaining: limit, resetIn: windowSeconds };
      }

      const current = results[0][1] as number;
      let ttl = results[1][1] as number;

      // Safety: if the key expired between SET NX and INCR, the INCR creates
      // a new key with no TTL (ttl === -1). Re-apply the expiry to prevent
      // a permanently stuck rate limit counter.
      if (ttl === -1) {
        await client.expire(key, windowSeconds);
        ttl = windowSeconds;
      }

      ttl = Math.max(ttl, 1);

      const allowed = current <= limit;
      const remaining = Math.max(0, limit - current);

      return { allowed, remaining, resetIn: ttl };
    } catch (error) {
      logger.error({ identifier, error }, "Rate limit check error");
      return { allowed: true, remaining: limit, resetIn: windowSeconds };
    }
  }

  // ============================================================================
  // HEALTH & STATISTICS
  // ============================================================================

  /**
   * Perform health check
   */
  async healthCheck(): Promise<{
    status: "ok" | "degraded" | "error";
    redis: { connected: boolean; latency?: number; error?: string };
    memory: { entries: number; maxSize: number };
  }> {
    const memoryEntries = this.memoryCache.size();

    if (!this.isConnected()) {
      return {
        status: "degraded",
        redis: { connected: false, error: "Not connected" },
        memory: { entries: memoryEntries, maxSize: MEMORY_CACHE_MAX_SIZE },
      };
    }

    try {
      const client = this.redisClient;
      if (!client) {
        return {
          status: "error" as const,
          redis: { connected: false, error: "Client not available" },
          memory: { entries: memoryEntries, maxSize: MEMORY_CACHE_MAX_SIZE },
        };
      }
      const start = Date.now();
      await client.ping();
      const latency = Date.now() - start;

      return {
        status: "ok",
        redis: { connected: true, latency },
        memory: { entries: memoryEntries, maxSize: MEMORY_CACHE_MAX_SIZE },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        status: "error",
        redis: { connected: false, error: errorMessage },
        memory: { entries: memoryEntries, maxSize: MEMORY_CACHE_MAX_SIZE },
      };
    }
  }

  /**
   * Get detailed cache statistics
   */
  async getStats(): Promise<DetailedCacheStats> {
    const namespaces = Object.values(CacheNamespace);
    const versions: Record<string, number> = {};

    for (const ns of namespaces) {
      versions[ns] = await this.getNamespaceVersion(ns);
    }

    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    return {
      ...this.stats,
      hitRate: Math.round(hitRate * 10000) / 100, // Percentage with 2 decimals
      redisConnected: this.isConnected(),
      memoryEntries: this.memoryCache.size(),
      namespaceVersions: versions,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      memoryFallbackUsed: 0,
    };
    logger.info({}, "Cache statistics reset");
  }

  /**
   * Get Redis info (when connected)
   */
  async getRedisInfo(): Promise<Record<string, string> | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const client = this.redisClient;
      if (!client) return null;
      const info = await client.info();
      const parsed: Record<string, string> = {};

      for (const line of info.split("\r\n")) {
        const [key, value] = line.split(":");
        if (key && value) {
          parsed[key] = value;
        }
      }

      return parsed;
    } catch (error) {
      logger.error({ error }, "Failed to get Redis info");
      return null;
    }
  }

  // ============================================================================
  // CACHE WARMING
  // ============================================================================

  /**
   * Warm cache with data (useful for startup)
   */
  async warmCache(
    items: Array<{
      namespace: string;
      params: unknown;
      data: unknown;
      ttl: number;
    }>
  ): Promise<number> {
    let warmed = 0;

    for (const item of items) {
      try {
        await this.set(item.namespace, item.params, item.data, item.ttl);
        warmed++;
      } catch (error) {
        logger.error(
          { namespace: item.namespace, error },
          "Failed to warm cache item"
        );
      }
    }

    logger.info({ warmed, total: items.length }, "Cache warming completed");
    return warmed;
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Gracefully shutdown the cache service
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        // Force disconnect if quit fails
        this.redisClient.disconnect();
      }
      this.redisClient = null;
    }

    this.isRedisConnected = false;
    this.memoryCache.clear();

    logger.info({}, "Cache service shutdown complete");
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    this.memoryCache.clear();

    if (this.isConnected()) {
      try {
        const client = this.redisClient;
        if (!client) return;
        // Use SCAN to safely delete all keys with our prefix
        let cursor = "0";
        do {
          const [newCursor, keys] = await client.scan(
            cursor,
            "MATCH",
            `${CACHE_PREFIX}:*`,
            "COUNT",
            "100"
          );
          cursor = newCursor;

          if (keys.length > 0) {
            await client.del(...keys);
          }
        } while (cursor !== "0");
      } catch (error) {
        logger.error({ error }, "Failed to clear Redis cache");
      }
    }

    logger.info({}, "All caches cleared");
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const redisCacheService = new RedisCacheService();

// Export types
export type { CacheStats, DetailedCacheStats };
