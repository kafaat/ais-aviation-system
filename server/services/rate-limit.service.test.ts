/**
 * Rate Limit Service Tests
 *
 * Tests for the per-user rate limiting service including:
 * - Rate limit tier determination
 * - Rate limit checking (Redis and in-memory)
 * - Rate limit headers generation
 * - Different limits for different user types
 *
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  rateLimitService,
  RATE_LIMIT_TIERS,
  STRICT_RATE_LIMITS,
} from "./rate-limit.service";
import type { User } from "../../drizzle/schema";

// Mock the cache service
vi.mock("./cache.service", () => ({
  cacheService: {
    isConnected: vi.fn(() => false), // Default to in-memory mode
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

// Mock the database
vi.mock("../db", () => ({
  getDb: vi.fn(() => null),
}));

// Mock the logger
vi.mock("../_core/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Rate Limit Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("RATE_LIMIT_TIERS", () => {
    it("should have correct tier configurations", () => {
      expect(RATE_LIMIT_TIERS.anonymous).toBeDefined();
      expect(RATE_LIMIT_TIERS.authenticated).toBeDefined();
      expect(RATE_LIMIT_TIERS.bronze).toBeDefined();
      expect(RATE_LIMIT_TIERS.silver).toBeDefined();
      expect(RATE_LIMIT_TIERS.gold).toBeDefined();
      expect(RATE_LIMIT_TIERS.platinum).toBeDefined();
      expect(RATE_LIMIT_TIERS.admin).toBeDefined();
    });

    it("should have increasing limits for higher tiers", () => {
      expect(RATE_LIMIT_TIERS.anonymous.requestsPerWindow).toBeLessThan(
        RATE_LIMIT_TIERS.authenticated.requestsPerWindow
      );
      expect(RATE_LIMIT_TIERS.authenticated.requestsPerWindow).toBeLessThan(
        RATE_LIMIT_TIERS.bronze.requestsPerWindow
      );
      expect(RATE_LIMIT_TIERS.bronze.requestsPerWindow).toBeLessThan(
        RATE_LIMIT_TIERS.silver.requestsPerWindow
      );
      expect(RATE_LIMIT_TIERS.silver.requestsPerWindow).toBeLessThan(
        RATE_LIMIT_TIERS.gold.requestsPerWindow
      );
      expect(RATE_LIMIT_TIERS.gold.requestsPerWindow).toBeLessThan(
        RATE_LIMIT_TIERS.platinum.requestsPerWindow
      );
      expect(RATE_LIMIT_TIERS.platinum.requestsPerWindow).toBeLessThan(
        RATE_LIMIT_TIERS.admin.requestsPerWindow
      );
    });

    it("should have window duration of 1 minute for all tiers", () => {
      const oneMinute = 60 * 1000;
      Object.values(RATE_LIMIT_TIERS).forEach(tier => {
        expect(tier.windowMs).toBe(oneMinute);
      });
    });
  });

  describe("STRICT_RATE_LIMITS", () => {
    it("should have strict limits for sensitive endpoints", () => {
      expect(STRICT_RATE_LIMITS.auth).toBeDefined();
      expect(STRICT_RATE_LIMITS.passwordReset).toBeDefined();
      expect(STRICT_RATE_LIMITS.payment).toBeDefined();
      expect(STRICT_RATE_LIMITS.booking).toBeDefined();
    });

    it("should have lower limits than standard tiers", () => {
      expect(STRICT_RATE_LIMITS.auth.requestsPerWindow).toBeLessThan(
        RATE_LIMIT_TIERS.anonymous.requestsPerWindow
      );
    });

    it("should have longer windows for auth and password reset", () => {
      const fifteenMinutes = 15 * 60 * 1000;
      const oneHour = 60 * 60 * 1000;

      expect(STRICT_RATE_LIMITS.auth.windowMs).toBe(fifteenMinutes);
      expect(STRICT_RATE_LIMITS.passwordReset.windowMs).toBe(oneHour);
    });
  });

  describe("getRateLimitTier", () => {
    it("should return anonymous tier for null user", async () => {
      const tier = await rateLimitService.getRateLimitTier(null);
      expect(tier.name).toBe("anonymous");
    });

    it("should return admin tier for admin users", async () => {
      const adminUser = { id: 1, role: "admin" } as User;
      const tier = await rateLimitService.getRateLimitTier(adminUser);
      expect(tier.name).toBe("admin");
    });

    it("should return admin tier for super_admin users", async () => {
      const superAdminUser = { id: 1, role: "super_admin" } as User;
      const tier = await rateLimitService.getRateLimitTier(superAdminUser);
      expect(tier.name).toBe("admin");
    });

    it("should return admin tier for airline_admin users", async () => {
      const airlineAdminUser = { id: 1, role: "airline_admin" } as User;
      const tier = await rateLimitService.getRateLimitTier(airlineAdminUser);
      expect(tier.name).toBe("admin");
    });

    it("should return authenticated tier for regular users without loyalty", async () => {
      const regularUser = { id: 1, role: "user" } as User;
      const tier = await rateLimitService.getRateLimitTier(regularUser);
      // Without loyalty tier lookup (mocked db returns null), falls back to authenticated
      expect(tier.name).toBe("authenticated");
    });
  });

  describe("checkRateLimit", () => {
    it("should allow first request", async () => {
      const result = await rateLimitService.checkRateLimit(
        "test-user-1",
        RATE_LIMIT_TIERS.anonymous,
        "test"
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(
        RATE_LIMIT_TIERS.anonymous.requestsPerWindow - 1
      );
      expect(result.limit).toBe(RATE_LIMIT_TIERS.anonymous.requestsPerWindow);
      expect(result.tier).toBe("anonymous");
    });

    it("should decrement remaining count on subsequent requests", async () => {
      const identifier = "test-user-2";
      const tier = RATE_LIMIT_TIERS.anonymous;

      // First request
      const result1 = await rateLimitService.checkRateLimit(
        identifier,
        tier,
        "test"
      );
      expect(result1.remaining).toBe(tier.requestsPerWindow - 1);

      // Second request
      const result2 = await rateLimitService.checkRateLimit(
        identifier,
        tier,
        "test"
      );
      expect(result2.remaining).toBe(tier.requestsPerWindow - 2);
    });

    it("should block requests when limit is exceeded", async () => {
      const identifier = "test-user-3";
      const tier = { ...RATE_LIMIT_TIERS.anonymous, requestsPerWindow: 2 };

      // Use up the limit
      await rateLimitService.checkRateLimit(identifier, tier, "test");
      await rateLimitService.checkRateLimit(identifier, tier, "test");

      // Third request should be blocked
      const result = await rateLimitService.checkRateLimit(
        identifier,
        tier,
        "test"
      );
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterSeconds).toBeDefined();
    });
  });

  describe("checkUserRateLimit", () => {
    it("should use user ID for authenticated users", async () => {
      const user = { id: 123, role: "user" } as User;
      const ip = "192.168.1.1";

      const result = await rateLimitService.checkUserRateLimit(user, ip, "api");

      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("authenticated");
    });

    it("should use IP for anonymous users", async () => {
      const ip = "192.168.1.2";

      const result = await rateLimitService.checkUserRateLimit(null, ip, "api");

      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("anonymous");
    });
  });

  describe("checkStrictRateLimit", () => {
    it("should apply auth rate limits", async () => {
      const result = await rateLimitService.checkStrictRateLimit(
        "user:123",
        "auth"
      );

      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("auth");
      expect(result.limit).toBe(STRICT_RATE_LIMITS.auth.requestsPerWindow);
    });

    it("should apply payment rate limits", async () => {
      const result = await rateLimitService.checkStrictRateLimit(
        "user:123",
        "payment"
      );

      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("payment");
      expect(result.limit).toBe(STRICT_RATE_LIMITS.payment.requestsPerWindow);
    });

    it("should throw for unknown endpoint", async () => {
      await expect(
        rateLimitService.checkStrictRateLimit("user:123", "unknown" as any)
      ).rejects.toThrow("Unknown strict rate limit endpoint");
    });
  });

  describe("getRateLimitStatus", () => {
    it("should return current status without incrementing counter", async () => {
      const user = { id: 456, role: "user" } as User;
      const ip = "192.168.1.3";

      // Make a request to set up some state
      await rateLimitService.checkUserRateLimit(user, ip, "api");

      // Get status (should not increment)
      const status1 = await rateLimitService.getRateLimitStatus(
        user,
        ip,
        "api"
      );
      const status2 = await rateLimitService.getRateLimitStatus(
        user,
        ip,
        "api"
      );

      // Status calls should not change remaining count
      expect(status1.remaining).toBe(status2.remaining);
      expect(status1.tierInfo).toBeDefined();
    });
  });

  describe("resetRateLimit", () => {
    it("should reset rate limit for identifier", async () => {
      const identifier = "test-reset-user";
      const tier = RATE_LIMIT_TIERS.anonymous;

      // Make some requests
      await rateLimitService.checkRateLimit(identifier, tier, "test");
      await rateLimitService.checkRateLimit(identifier, tier, "test");

      // Reset
      await rateLimitService.resetRateLimit(identifier, "test");

      // Should be back to full limit
      const result = await rateLimitService.checkRateLimit(
        identifier,
        tier,
        "test"
      );
      expect(result.remaining).toBe(tier.requestsPerWindow - 1);
    });
  });

  describe("getRateLimitHeaders", () => {
    it("should generate correct headers for allowed request", () => {
      const result = {
        allowed: true,
        limit: 100,
        remaining: 50,
        resetAt: new Date("2026-02-05T12:00:00Z"),
        tier: "authenticated",
      };

      const headers = rateLimitService.getRateLimitHeaders(result);

      expect(headers["X-RateLimit-Limit"]).toBe("100");
      expect(headers["X-RateLimit-Remaining"]).toBe("50");
      expect(headers["X-RateLimit-Reset"]).toBeDefined();
      expect(headers["X-RateLimit-Tier"]).toBe("authenticated");
      expect(headers["Retry-After"]).toBeUndefined();
    });

    it("should include Retry-After header when blocked", () => {
      const result = {
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: new Date("2026-02-05T12:00:00Z"),
        tier: "authenticated",
        retryAfterSeconds: 30,
      };

      const headers = rateLimitService.getRateLimitHeaders(result);

      expect(headers["Retry-After"]).toBe("30");
    });
  });

  describe("getIdentifier", () => {
    it("should return user-based identifier for authenticated users", () => {
      const user = { id: 789, role: "user" } as User;
      const identifier = rateLimitService.getIdentifier(user, "192.168.1.1");
      expect(identifier).toBe("user:789");
    });

    it("should return IP-based identifier for anonymous users", () => {
      const identifier = rateLimitService.getIdentifier(null, "192.168.1.1");
      expect(identifier).toBe("ip:192.168.1.1");
    });
  });
});

describe("Rate Limit Tier Values", () => {
  it("should have expected values for anonymous tier", () => {
    const tier = RATE_LIMIT_TIERS.anonymous;
    expect(tier.requestsPerWindow).toBe(60);
    expect(tier.windowMs).toBe(60000);
    expect(tier.burstLimit).toBe(10);
  });

  it("should have expected values for authenticated tier", () => {
    const tier = RATE_LIMIT_TIERS.authenticated;
    expect(tier.requestsPerWindow).toBe(120);
    expect(tier.windowMs).toBe(60000);
    expect(tier.burstLimit).toBe(20);
  });

  it("should have expected values for platinum tier", () => {
    const tier = RATE_LIMIT_TIERS.platinum;
    expect(tier.requestsPerWindow).toBe(500);
    expect(tier.windowMs).toBe(60000);
    expect(tier.burstLimit).toBe(100);
  });

  it("should have expected values for admin tier", () => {
    const tier = RATE_LIMIT_TIERS.admin;
    expect(tier.requestsPerWindow).toBe(1000);
    expect(tier.windowMs).toBe(60000);
    expect(tier.burstLimit).toBe(200);
  });
});

describe("Strict Rate Limit Values", () => {
  it("should have expected values for auth endpoint", () => {
    const tier = STRICT_RATE_LIMITS.auth;
    expect(tier.requestsPerWindow).toBe(5);
    expect(tier.windowMs).toBe(15 * 60 * 1000); // 15 minutes
  });

  it("should have expected values for password reset endpoint", () => {
    const tier = STRICT_RATE_LIMITS.passwordReset;
    expect(tier.requestsPerWindow).toBe(3);
    expect(tier.windowMs).toBe(60 * 60 * 1000); // 1 hour
  });

  it("should have expected values for payment endpoint", () => {
    const tier = STRICT_RATE_LIMITS.payment;
    expect(tier.requestsPerWindow).toBe(10);
    expect(tier.windowMs).toBe(60 * 1000); // 1 minute
  });

  it("should have expected values for booking endpoint", () => {
    const tier = STRICT_RATE_LIMITS.booking;
    expect(tier.requestsPerWindow).toBe(20);
    expect(tier.windowMs).toBe(60 * 1000); // 1 minute
  });
});
