import Redis from "ioredis";

/**
 * Redis Cache Service
 * Provides caching layer for frequently accessed data
 */

let redis: Redis | null = null;

/**
 * Initialize Redis connection with connection pooling
 */
export function initializeRedis(): void {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // Connection pooling settings
      lazyConnect: false,
      enableReadyCheck: true,
      connectTimeout: 10000,
      keepAlive: 30000,
    });

    redis.on("connect", () => {
      console.log("[Cache] Redis connected successfully");
    });

    redis.on("error", err => {
      console.error("[Cache] Redis error:", err);
    });

    redis.on("close", () => {
      console.log("[Cache] Redis connection closed");
    });
  } catch (error) {
    console.error("[Cache] Failed to initialize Redis:", error);
    redis = null;
  }
}

/**
 * Get Redis instance
 */
export function getRedis(): Redis | null {
  return redis;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/**
 * Get value from cache
 */
export async function get<T>(key: string): Promise<T | null> {
  if (!redis) return null;

  try {
    const value = await redis.get(key);
    if (!value) return null;

    return JSON.parse(value) as T;
  } catch (error) {
    console.error(`[Cache] Error getting key ${key}:`, error);
    return null;
  }
}

/**
 * Set value in cache with TTL (in seconds)
 */
export async function set<T>(
  key: string,
  value: T,
  ttl: number = 3600
): Promise<boolean> {
  if (!redis) return false;

  try {
    const serialized = JSON.stringify(value);
    await redis.setex(key, ttl, serialized);
    return true;
  } catch (error) {
    console.error(`[Cache] Error setting key ${key}:`, error);
    return false;
  }
}

/**
 * Delete value from cache
 */
export async function del(key: string): Promise<boolean> {
  if (!redis) return false;

  try {
    await redis.del(key);
    return true;
  } catch (error) {
    console.error(`[Cache] Error deleting key ${key}:`, error);
    return false;
  }
}

/**
 * Delete multiple keys matching a pattern
 */
export async function delPattern(pattern: string): Promise<number> {
  if (!redis) return 0;

  try {
    const keys = await redis.keys(pattern);
    if (keys.length === 0) return 0;

    await redis.del(...keys);
    return keys.length;
  } catch (error) {
    console.error(`[Cache] Error deleting pattern ${pattern}:`, error);
    return 0;
  }
}

/**
 * Check if key exists
 */
export async function exists(key: string): Promise<boolean> {
  if (!redis) return false;

  try {
    const result = await redis.exists(key);
    return result === 1;
  } catch (error) {
    console.error(`[Cache] Error checking existence of key ${key}:`, error);
    return false;
  }
}

/**
 * Get or set pattern (cache-aside)
 * If value exists in cache, return it. Otherwise, fetch from source and cache it.
 */
export async function getOrSet<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number = 3600
): Promise<T | null> {
  // Try to get from cache first
  const cached = await get<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Fetch from source
  try {
    const value = await fetchFn();

    // Cache the result
    await set(key, value, ttl);

    return value;
  } catch (error) {
    console.error(`[Cache] Error in getOrSet for key ${key}:`, error);
    return null;
  }
}

/**
 * Increment a counter
 */
export async function increment(
  key: string,
  amount: number = 1
): Promise<number> {
  if (!redis) return 0;

  try {
    const result = await redis.incrby(key, amount);
    return result;
  } catch (error) {
    console.error(`[Cache] Error incrementing key ${key}:`, error);
    return 0;
  }
}

/**
 * Set expiration time for a key (in seconds)
 */
export async function expire(key: string, ttl: number): Promise<boolean> {
  if (!redis) return false;

  try {
    await redis.expire(key, ttl);
    return true;
  } catch (error) {
    console.error(`[Cache] Error setting expiration for key ${key}:`, error);
    return false;
  }
}

/**
 * Get TTL (time to live) for a key
 */
export async function ttl(key: string): Promise<number> {
  if (!redis) return -1;

  try {
    return await redis.ttl(key);
  } catch (error) {
    console.error(`[Cache] Error getting TTL for key ${key}:`, error);
    return -1;
  }
}

/**
 * Cache key generators
 */
export const CacheKeys = {
  flight: (id: number) => `flight:${id}`,
  flightSearch: (params: string) => `flight:search:${params}`,
  airport: (id: number) => `airport:${id}`,
  airline: (id: number) => `airline:${id}`,
  booking: (id: number) => `booking:${id}`,
  userBookings: (userId: number) => `user:${userId}:bookings`,
  exchangeRate: (currency: string) => `exchange:${currency}`,
  popularRoutes: () => `analytics:popular_routes`,
  dashboardMetrics: (startDate: string, endDate: string) =>
    `analytics:dashboard:${startDate}:${endDate}`,
};

/**
 * Cache TTL constants (in seconds)
 */
export const CacheTTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 3600, // 1 hour
  DAY: 86400, // 24 hours
  WEEK: 604800, // 7 days
};
