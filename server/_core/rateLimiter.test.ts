/**
 * Rate Limiter Configuration Tests
 *
 * Tests for both IP-based and per-user rate limiting configurations.
 *
 * @version 2.0.0
 */

import { describe, it, expect, vi } from "vitest";
import {
  apiLimiter,
  webhookLimiter,
  authLimiter,
  strictLimiter,
  bookingLimiter,
  paymentLimiter,
} from "./rateLimiter";

// Mock the middleware imports to avoid circular dependencies in tests
vi.mock("./middleware/user-rate-limit.middleware", () => ({
  createUserRateLimitMiddleware: vi.fn(),
  createStrictRateLimitMiddleware: vi.fn(),
  rateLimitHeadersMiddleware: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("../services/rate-limit.service", () => ({
  rateLimitService: {},
  RATE_LIMIT_TIERS: {
    anonymous: { name: "anonymous", requestsPerWindow: 60, windowMs: 60000 },
    authenticated: {
      name: "authenticated",
      requestsPerWindow: 120,
      windowMs: 60000,
    },
  },
  STRICT_RATE_LIMITS: {
    auth: { name: "auth", requestsPerWindow: 5, windowMs: 900000 },
  },
}));

describe("Rate Limiter Configuration", () => {
  describe("apiLimiter", () => {
    it("should be defined and be a function", () => {
      expect(apiLimiter).toBeDefined();
      expect(typeof apiLimiter).toBe("function");
    });
  });

  describe("webhookLimiter", () => {
    it("should be defined and be a function", () => {
      expect(webhookLimiter).toBeDefined();
      expect(typeof webhookLimiter).toBe("function");
    });
  });

  describe("authLimiter", () => {
    it("should be defined and be a function", () => {
      expect(authLimiter).toBeDefined();
      expect(typeof authLimiter).toBe("function");
    });
  });

  describe("strictLimiter", () => {
    it("should be defined and be a function", () => {
      expect(strictLimiter).toBeDefined();
      expect(typeof strictLimiter).toBe("function");
    });
  });

  describe("bookingLimiter", () => {
    it("should be defined and be a function", () => {
      expect(bookingLimiter).toBeDefined();
      expect(typeof bookingLimiter).toBe("function");
    });
  });

  describe("paymentLimiter", () => {
    it("should be defined and be a function", () => {
      expect(paymentLimiter).toBeDefined();
      expect(typeof paymentLimiter).toBe("function");
    });
  });
});

describe("Rate Limiter Exports", () => {
  it("should export all IP-based limiters", () => {
    expect(apiLimiter).toBeDefined();
    expect(webhookLimiter).toBeDefined();
    expect(authLimiter).toBeDefined();
    expect(strictLimiter).toBeDefined();
    expect(bookingLimiter).toBeDefined();
    expect(paymentLimiter).toBeDefined();
  });
});
