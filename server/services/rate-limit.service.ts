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
import { loyaltyAccounts } from "../../drizzle/schema";
import { getDb } from "../db";
import { eq } from "drizzle-orm";

// Minimal user type for rate limiting (only needs id and role)
export type RateLimitUser = {
  id: number;
  role:
    | "user"
    | "admin"
    | "super_admin"
    | "airline_admin"
    | "finance"
    | "ops"
    | "support";
};

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
  // Public reference/surname lookup: limit both IPs and references, regardless
  // of account/loyalty tier. Successes count as well as failed attempts.
  kioskBagReceipt: {
    name: "kioskBagReceipt",
    requestsPerWindow: 30,
    windowMs: 60 * 1000,
  },
  manageBookingLookup: {
    name: "manageBookingLookup",
    requestsPerWindow: 10,
    windowMs: 15 * 60 * 1000,
  },
  manageBookingReference: {
    name: "manageBookingReference",
    requestsPerWindow: 5,
    windowMs: 15 * 60 * 1000,
  },
  // Login/authentication attempts
  auth: {
    name: "auth",
    requestsPerWindow: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
  },

  accountStepUp: {
    name: "accountStepUp",
    requestsPerWindow: 5,
    windowMs: 15 * 60 * 1000,
  },

  // Password reset
  passwordReset: {
    name: "passwordReset",
    requestsPerWindow: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
  },

  // Payment/refund status reads, shared across the financial routers.
  paymentRead: {
    name: "paymentRead",
    requestsPerWindow: 120,
    windowMs: 60 * 1000,
  },

  // Financial writes have a separate quota from status polling.
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
 * Per-process quota shadow, retained across Redis failures and recovery.
 * It cannot provide a globally shared quota while Redis is unavailable.
 */
interface InMemoryRateLimitEntry {
  count: number;
  expiresAt: number;
  sequence: number;
  windowSequence: number;
  acknowledgedSequence: number;
  acknowledgedCount: number;
  redisExpiresNotBefore: number | null;
  redisExpiresNotAfter: number | null;
  fallback: boolean;
}

const inMemoryStore = new Map<string, InMemoryRateLimitEntry>();

// Cleanup expired entries every 5 minutes
const cleanupInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of inMemoryStore.entries()) {
      if (entry.expiresAt < now) {
        inMemoryStore.delete(key);
      }
    }
  },
  5 * 60 * 1000
);
// Housekeeping must not keep a drained HTTP server or CLI caller alive.
cleanupInterval.unref();

/**
 * Per-User Rate Limit Service
 */
class RateLimitService {
  /**
   * Get the rate limit key for a user/IP
   */
  private getKey(identifier: string, scope: string = "api"): string {
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
  async getRateLimitTier(user: RateLimitUser | null): Promise<RateLimitTier> {
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
    startedAt: number;
    expiresNotBefore: number;
    expiresAt: number;
  }> {
    try {
      const startedAt = Date.now();
      const windowSeconds = Math.ceil(windowMs / 1000);

      const strippedKey = key.startsWith(`${RATE_LIMIT_PREFIX}:ratelimit:`)
        ? key.substring(`${RATE_LIMIT_PREFIX}:ratelimit:`.length)
        : key;

      const result = await cacheService.checkRateLimit(
        strippedKey,
        limit,
        windowSeconds
      );

      const count = result.allowed ? limit - result.remaining : limit + 1;
      const ttl = result.ttlMs ?? windowMs;

      return {
        count,
        startedAt,
        // Redis executes between send and reply receipt. These bounds let us
        // recognize a new server window without relying on equal client/server
        // clocks or sliding an old expiry forward by every round trip.
        expiresNotBefore: startedAt + ttl,
        expiresAt: Date.now() + ttl,
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
    windowMs: number
  ): InMemoryRateLimitEntry {
    const now = Date.now();
    const entry = inMemoryStore.get(key);

    if (!entry || now >= entry.expiresAt) {
      // First request or window expired
      const newEntry: InMemoryRateLimitEntry = {
        count: 1,
        expiresAt: now + windowMs,
        sequence: 1,
        windowSequence: 0,
        acknowledgedSequence: 0,
        acknowledgedCount: 0,
        redisExpiresNotBefore: null,
        redisExpiresNotAfter: null,
        fallback: false,
      };
      inMemoryStore.set(key, newEntry);
      return newEntry;
    }

    // Increment count
    entry.count++;
    entry.sequence++;
    return entry;
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

    // Reserve synchronously before awaiting Redis. Concurrent failures cannot
    // each see an empty fallback bucket. Once used, the fallback ceiling keeps
    // its fixed expiry; successful recovery must not slide an exhausted window.
    const local = this.checkRateLimitInMemory(key, windowMs);
    const sequence = local.sequence;
    const windowSequence = local.windowSequence;
    const reservedCount = local.count;
    let count = reservedCount;
    let expiresAt = local.expiresAt;
    const projectReservation = () => {
      const observedCount =
        local.acknowledgedCount +
        Math.max(0, sequence - local.acknowledgedSequence);
      // An earlier response may have advanced all concurrent reservations into
      // a fresh Redis window. Their old-window snapshots must not follow them.
      return local.windowSequence !== windowSequence &&
        sequence >= local.windowSequence
        ? observedCount
        : Math.max(reservedCount, observedCount);
    };

    if (cacheService.isConnected()) {
      try {
        const result = await this.checkRateLimitRedis(
          key,
          requestsPerWindow,
          windowMs
        );
        const startsNewWindow =
          local.redisExpiresNotBefore !== null &&
          local.redisExpiresNotAfter !== null &&
          result.startedAt >= local.redisExpiresNotBefore &&
          result.expiresNotBefore > local.redisExpiresNotAfter;
        // A proven fresh server window may replace a healthy shadow despite
        // reply-latency overlap. A counter reset before the known old window
        // could expire must not erase consumption; active fallback also keeps
        // its own finite ceiling through recovery.
        count =
          !local.fallback && startsNewWindow
            ? result.count
            : Math.max(projectReservation(), result.count);
        expiresAt =
          !local.fallback && startsNewWindow
            ? result.expiresAt
            : Math.max(expiresAt, result.expiresAt);
        // A healthy reply rebases the shadow to this acknowledged count plus
        // subsequent reservations. Older replies cannot erase later evidence,
        // a new local window, or an admin reset.
        if (inMemoryStore.get(key) === local) {
          if (sequence > local.acknowledgedSequence) {
            local.acknowledgedSequence = sequence;
            local.acknowledgedCount = result.count;
            const reservedCount = result.count + local.sequence - sequence;
            local.count =
              !local.fallback && startsNewWindow
                ? reservedCount
                : Math.max(local.count, reservedCount);
            if (!local.fallback) {
              if (local.redisExpiresNotAfter === null || startsNewWindow) {
                local.windowSequence = sequence;
                local.redisExpiresNotBefore = result.expiresNotBefore;
                local.redisExpiresNotAfter = result.expiresAt;
                local.expiresAt = result.expiresAt;
              } else if (
                local.redisExpiresNotBefore !== null &&
                result.expiresNotBefore <= local.redisExpiresNotAfter &&
                result.expiresAt >= local.redisExpiresNotBefore
              ) {
                // Intersect observations of this same window. Its deadline
                // can become more precise but can never move farther away.
                local.redisExpiresNotBefore = Math.max(
                  local.redisExpiresNotBefore,
                  result.expiresNotBefore
                );
                local.redisExpiresNotAfter = Math.min(
                  local.redisExpiresNotAfter,
                  result.expiresAt
                );
                local.expiresAt = local.redisExpiresNotAfter;
              }
            }
          }
        }
      } catch {
        // An earlier in-flight acknowledgement may have revealed additional
        // shared consumption after this request reserved its local slot.
        count = projectReservation();
        local.fallback = true;
        local.count = Math.max(local.count, count);
        expiresAt = local.expiresAt;
      }
    } else {
      local.fallback = true;
    }

    const allowed = count <= requestsPerWindow;
    const remaining = Math.max(0, requestsPerWindow - count);
    const resetAt = new Date(expiresAt);

    const result: RateLimitResult = {
      allowed,
      limit: requestsPerWindow,
      remaining,
      resetAt,
      tier: name,
    };

    if (!allowed) {
      result.retryAfterSeconds = Math.max(
        1,
        Math.ceil((expiresAt - Date.now()) / 1000)
      );
    }

    return result;
  }

  /**
   * Check rate limit for a user (combines user ID + IP for extra security)
   */
  async checkUserRateLimit(
    user: RateLimitUser | null,
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
    user: RateLimitUser | null,
    ip: string,
    scope: string = "api"
  ): Promise<RateLimitResult & { tierInfo: RateLimitTier }> {
    const tier = await this.getRateLimitTier(user);
    const identifier = user ? `user:${user.id}` : `ip:${ip}`;
    const key = this.getKey(identifier, scope);

    const now = Date.now();
    const local = inMemoryStore.get(key);
    const activeLocal = local && local.expiresAt > now ? local : undefined;
    let count = activeLocal?.count ?? 0;
    let expiresAt = activeLocal?.expiresAt ?? now + tier.windowMs;

    // Try to get current count without incrementing
    if (cacheService.isConnected()) {
      try {
        const currentCount = await cacheService.get<number>(key);
        const currentWindowStart = await cacheService.get<number>(
          `${key}:window`
        );
        if (currentCount !== null && currentCount > count) {
          count = currentCount;
          expiresAt = Math.max(
            expiresAt,
            (currentWindowStart ?? Date.now()) + tier.windowMs
          );
        }
      } catch {
        // The active local ceiling still governs while Redis is unavailable.
      }
    }

    const remaining = Math.max(0, tier.requestsPerWindow - count);
    const resetAt = new Date(expiresAt);

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
      "X-RateLimit-Reset": Math.floor(
        result.resetAt.getTime() / 1000
      ).toString(),
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
  getIdentifier(user: RateLimitUser | null, ip: string): string {
    return user ? `user:${user.id}` : `ip:${ip}`;
  }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();
