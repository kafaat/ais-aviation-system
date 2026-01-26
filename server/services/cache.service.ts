import { createClient, RedisClientType } from "redis";
import crypto from "crypto";
import { logger } from "./logger.service";

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
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error("Redis reconnection failed after 10 retries");
              return new Error("Redis reconnection limit exceeded");
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.client.on("error", (err) => {
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
    const paramsString = JSON.stringify(params);
    const hash = crypto.createHash("md5").update(paramsString).digest("hex");
    return `${prefix}:${hash}`;
  }

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
   */
  async delPattern(pattern: string): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      const keys = await this.client!.keys(pattern);
      if (keys.length > 0) {
        await this.client!.del(keys);
        logger.debug("Cache delete pattern", { pattern, count: keys.length });
      }
    } catch (error) {
      logger.error("Cache delete pattern error", { pattern, error });
    }
  }

  /**
   * Cache flight search results
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
    const key = this.generateCacheKey("search:flights", params);
    await this.set(key, results, ttlSeconds);
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
    const key = this.generateCacheKey("search:flights", params);
    return await this.get(key);
  }

  /**
   * Invalidate flight search cache for a route
   */
  async invalidateFlightSearchCache(from: string, to: string): Promise<void> {
    const pattern = `search:flights:*${from}*${to}*`;
    await this.delPattern(pattern);
  }

  /**
   * Cache flight details
   */
  async cacheFlightDetails(
    flightId: number,
    details: any,
    ttlSeconds: number = 300 // 5 minutes
  ): Promise<void> {
    const key = `flight:${flightId}`;
    await this.set(key, details, ttlSeconds);
  }

  /**
   * Get cached flight details
   */
  async getCachedFlightDetails(flightId: number): Promise<any | null> {
    const key = `flight:${flightId}`;
    return await this.get(key);
  }

  /**
   * Invalidate flight details cache
   */
  async invalidateFlightDetailsCache(flightId: number): Promise<void> {
    const key = `flight:${flightId}`;
    await this.del(key);
  }

  /**
   * Cache user session data
   */
  async cacheUserSession(
    userId: number,
    sessionData: any,
    ttlSeconds: number = 900 // 15 minutes
  ): Promise<void> {
    const key = `session:${userId}`;
    await this.set(key, sessionData, ttlSeconds);
  }

  /**
   * Get cached user session
   */
  async getCachedUserSession(userId: number): Promise<any | null> {
    const key = `session:${userId}`;
    return await this.get(key);
  }

  /**
   * Invalidate user session cache
   */
  async invalidateUserSession(userId: number): Promise<void> {
    const key = `session:${userId}`;
    await this.del(key);
  }

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
      const rateLimitKey = `ratelimit:${key}`;
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
cacheService.connect().catch((err) => {
  logger.error("Failed to initialize cache service", { error: err });
});
