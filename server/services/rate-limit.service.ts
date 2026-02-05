/**
 * Per-User Rate Limiting Service
 *
 * Features:
 * - User ID-based rate limiting (not just IP)
 * - Different limits for authenticated vs anonymous users
 * - Higher limits for premium/loyalty tier users
 * - Redis storage with in-memory fallback
 * - Rate limit headers support
 *
 * @version 1.0.0
 */

import { cacheService } from "./cache.service";
import { logger } from "../_core/logger";
import { loyaltyAccounts, type User } from "../../drizzle/schema";
import { getDb } from "../db";
import { eq } from "drizzle-orm";

const RATE_LIMIT_PREFIX = process.env.CACHE_PREFIX || "ais";

/**
 * Rate limit tiers with their configurations
 */
export interface RateLimitTier {
  name: string;
  requestsPerWindow: number;
  windowMs: number;
  burstLimit?: number; // Optional burst allowance
}

/**
 * Rate limit configuration by user type
 */
export const RATE_LIMIT_TIERS: Record<string, RateLimitTier> = {
  // Anonymous users (IP-based)
  anonymous: {
    name: "anonymous",
    requestsPerWindow: 60,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 10,
  },

  // Authenticated users (base tier)
  authenticated: {
    name: "authenticated",
    requestsPerWindow: 120,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 20,
  },

  // Bronze loyalty tier
  bronze: {
    name: "bronze",
    requestsPerWindow: 150,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 25,
  },

  // Silver loyalty tier
  silver: {
    name: "silver",
    requestsPerWindow: 200,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 30,
  },

  // Gold loyalty tier
  gold: {
    name: "gold",
    requestsPerWindow: 300,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 50,
  },

  // Platinum loyalty tier
  platinum: {
    name: "platinum",
    requestsPerWindow: 500,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 100,
  },

  // Admin users (highest limits)
  admin: {
    name: "admin",
    requestsPerWindow: 1000,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 200,
  },
};

/**
 * Strict rate limits for sensitive endpoints
 */
export const STRICT_RATE_LIMITS: Record<string, RateLimitTier> = {
  // Login/authentication attempts
  auth: {
    name: "auth",
    requestsPerWindow: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
  },

  // Password reset
  passwordReset: {
    name: "passwordReset",
    requestsPerWindow: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
  },

  // Payment operations
  payment: {
    name: "payment",
    requestsPerWindow: 10,
    windowMs: 60 * 1000, // 1 minute
  },

  // Booking creation
  booking: {
    name: "booking",
    requestsPerWindow: 20,
    windowMs: 60 * 1000, // 1 minute
  },
};

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds?: number;
  tier: string;
}

/**
 * In-memory storage for rate limits (fallback when Redis is unavailable)
 */
interface InMemoryRateLimitEntry {
  count: number;
  windowStart: number;
  expiresAt: number;
}

const inMemoryStore = new Map<string, InMemoryRateLimitEntry>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of inMemoryStore.entries()) {
    if (entry.expiresAt < now) {
      inMemoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Per-User Rate Limit Service
 */
class RateLimitService {
  /**
   * Get the rate limit key for a user/IP
   */
  private getKey(
    identifier: string,
    scope: string = "api"
  ): string {
    return `${RATE_LIMIT_PREFIX}:ratelimit:${scope}:${identifier}`;
  }

  /**
   * Get user's loyalty tier from database
   */
  async getUserLoyaltyTier(
    userId: number
  ): Promise<"bronze" | "silver" | "gold" | "platinum" | null> {
    try {
      const database = await getDb();
      if (!database) return null;

      const [account] = await database
        .select({ tier: loyaltyAccounts.tier })
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.userId, userId))
        .limit(1);

      return account?.tier ?? null;
    } catch (error) {
      logger.error({ userId, error }, "Failed to get user loyalty tier");
      return null;
    }
  }

  /**
   * Determine the rate limit tier for a user
   */
  async getRateLimitTier(user: User | null): Promise<RateLimitTier> {
    // Anonymous user
    if (!user) {
      return RATE_LIMIT_TIERS.anonymous;
    }

    // Admin users get highest limits
    if (
      user.role === "admin" ||
      user.role === "super_admin" ||
      user.role === "airline_admin"
    ) {
      return RATE_LIMIT_TIERS.admin;
    }

    // Check loyalty tier for authenticated users
    const loyaltyTier = await this.getUserLoyaltyTier(user.id);

    if (loyaltyTier && RATE_LIMIT_TIERS[loyaltyTier]) {
      return RATE_LIMIT_TIERS[loyaltyTier];
    }

    // Default authenticated user tier
    return RATE_LIMIT_TIERS.authenticated;
  }

  /**
   * Check rate limit using Redis
   */
  private async checkRateLimitRedis(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<{
    count: number;
    windowStart: number;
    ttl: number;
  }> {
    const rateLimitKey = key;
    const windowKey = `${key}:window`;

    try {
      // Use Redis pipeline for atomic operations
      const now = Date.now();
      const windowSeconds = Math.ceil(windowMs / 1000);

      // Increment counter
      const count = await cacheService.get<number>(rateLimitKey);
      const windowStart = await cacheService.get<number>(windowKey);

      if (count === null || windowStart === null) {
        // First request in window
        await cacheService.set(rateLimitKey, 1, windowSeconds);
        await cacheService.set(windowKey, now, windowSeconds);
        return { count: 1, windowStart: now, ttl: windowSeconds * 1000 };
      }

      // Check if window has expired
      if (now - windowStart >= windowMs) {
        // Reset window
        await cacheService.set(rateLimitKey, 1, windowSeconds);
        await cacheService.set(windowKey, now, windowSeconds);
        return { count: 1, windowStart: now, ttl: windowSeconds * 1000 };
      }

      // Increment count
      const newCount = count + 1;
      const remainingTtl = windowMs - (now - windowStart);
      const remainingSeconds = Math.max(1, Math.ceil(remainingTtl / 1000));

      await cacheService.set(rateLimitKey, newCount, remainingSeconds);

      return {
        count: newCount,
        windowStart,
        ttl: remainingTtl,
      };
    } catch (error) {
      logger.error({ key, error }, "Redis rate limit check failed");
      throw error;
    }
  }

  /**
   * Check rate limit using in-memory storage (fallback)
   */
  private checkRateLimitInMemory(
    key: string,
    limit: number,
    windowMs: number
  ): {
    count: number;
    windowStart: number;
    ttl: number;
  } {
    const now = Date.now();
    const entry = inMemoryStore.get(key);

    if (!entry || now >= entry.expiresAt) {
      // First request or window expired
      const newEntry: InMemoryRateLimitEntry = {
        count: 1,
        windowStart: now,
        expiresAt: now + windowMs,
      };
      inMemoryStore.set(key, newEntry);
      return { count: 1, windowStart: now, ttl: windowMs };
    }

    // Increment count
    entry.count++;
    return {
      count: entry.count,
      windowStart: entry.windowStart,
      ttl: entry.expiresAt - now,
    };
  }

  /**
   * Check if a request is allowed under rate limits
   */
  async checkRateLimit(
    identifier: string,
    tier: RateLimitTier,
    scope: string = "api"
  ): Promise<RateLimitResult> {
    const key = this.getKey(identifier, scope);
    const { requestsPerWindow, windowMs, name } = tier;

    let count: number;
    let windowStart: number;
    let ttl: number;

    // Try Redis first, fall back to in-memory
    if (cacheService.isConnected()) {
      try {
        const result = await this.checkRateLimitRedis(
          key,
          requestsPerWindow,
          windowMs
        );
        count = result.count;
        windowStart = result.windowStart;
        ttl = result.ttl;
      } catch {
        // Fall back to in-memory
        const result = this.checkRateLimitInMemory(
          key,
          requestsPerWindow,
          windowMs
        );
        count = result.count;
        windowStart = result.windowStart;
        ttl = result.ttl;
      }
    } else {
      const result = this.checkRateLimitInMemory(
        key,
        requestsPerWindow,
        windowMs
      );
      count = result.count;
      windowStart = result.windowStart;
      ttl = result.ttl;
    }

    const allowed = count <= requestsPerWindow;
    const remaining = Math.max(0, requestsPerWindow - count);
    const resetAt = new Date(windowStart + windowMs);

    const result: RateLimitResult = {
      allowed,
      limit: requestsPerWindow,
      remaining,
      resetAt,
      tier: name,
    };

    if (!allowed) {
      result.retryAfterSeconds = Math.ceil(ttl / 1000);
    }

    return result;
  }

  /**
   * Check rate limit for a user (combines user ID + IP for extra security)
   */
  async checkUserRateLimit(
    user: User | null,
    ip: string,
    scope: string = "api"
  ): Promise<RateLimitResult> {
    const tier = await this.getRateLimitTier(user);

    // Use user ID if authenticated, otherwise IP
    const identifier = user ? `user:${user.id}` : `ip:${ip}`;

    return this.checkRateLimit(identifier, tier, scope);
  }

  /**
   * Check strict rate limit for sensitive endpoints
   */
  async checkStrictRateLimit(
    identifier: string,
    endpoint: keyof typeof STRICT_RATE_LIMITS
  ): Promise<RateLimitResult> {
    const tier = STRICT_RATE_LIMITS[endpoint];
    if (!tier) {
      throw new Error(`Unknown strict rate limit endpoint: ${endpoint}`);
    }

    return await this.checkRateLimit(identifier, tier, `strict:${endpoint}`);
  }

  /**
   * Get current rate limit status without incrementing counter
   */
  async getRateLimitStatus(
    user: User | null,
    ip: string,
    scope: string = "api"
  ): Promise<RateLimitResult & { tierInfo: RateLimitTier }> {
    const tier = await this.getRateLimitTier(user);
    const identifier = user ? `user:${user.id}` : `ip:${ip}`;
    const key = this.getKey(identifier, scope);

    let count = 0;
    let windowStart = Date.now();

    // Try to get current count without incrementing
    if (cacheService.isConnected()) {
      try {
        const currentCount = await cacheService.get<number>(key);
        const currentWindowStart = await cacheService.get<number>(
          `${key}:window`
        );
        if (currentCount !== null) count = currentCount;
        if (currentWindowStart !== null) windowStart = currentWindowStart;
      } catch {
        // Use in-memory fallback
        const entry = inMemoryStore.get(key);
        if (entry) {
          count = entry.count;
          windowStart = entry.windowStart;
        }
      }
    } else {
      const entry = inMemoryStore.get(key);
      if (entry) {
        count = entry.count;
        windowStart = entry.windowStart;
      }
    }

    const remaining = Math.max(0, tier.requestsPerWindow - count);
    const resetAt = new Date(windowStart + tier.windowMs);

    return {
      allowed: count < tier.requestsPerWindow,
      limit: tier.requestsPerWindow,
      remaining,
      resetAt,
      tier: tier.name,
      tierInfo: tier,
    };
  }

  /**
   * Reset rate limit for a specific identifier (admin function)
   */
  async resetRateLimit(
    identifier: string,
    scope: string = "api"
  ): Promise<void> {
    const key = this.getKey(identifier, scope);

    if (cacheService.isConnected()) {
      await cacheService.del(key);
      await cacheService.del(`${key}:window`);
    }

    inMemoryStore.delete(key);

    logger.info({ identifier, scope }, "Rate limit reset");
  }

  /**
   * Get rate limit headers for HTTP response
   */
  getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
    const headers: Record<string, string> = {
      "X-RateLimit-Limit": result.limit.toString(),
      "X-RateLimit-Remaining": result.remaining.toString(),
      "X-RateLimit-Reset": Math.floor(result.resetAt.getTime() / 1000).toString(),
      "X-RateLimit-Tier": result.tier,
    };

    if (result.retryAfterSeconds) {
      headers["Retry-After"] = result.retryAfterSeconds.toString();
    }

    return headers;
  }

  /**
   * Generate identifier from user/IP
   */
  getIdentifier(user: User | null, ip: string): string {
    return user ? `user:${user.id}` : `ip:${ip}`;
  }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();
