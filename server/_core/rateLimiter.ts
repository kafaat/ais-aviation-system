/**
 * Rate Limiter Configuration
 *
 * This module provides both IP-based (express-rate-limit) and per-user rate limiting.
 *
 * IP-Based Rate Limiters (Legacy):
 * - apiLimiter: General API rate limiting (100 req/15min)
 * - strictLimiter: Sensitive endpoints (5 req/15min)
 * - webhookLimiter: Webhook endpoints (50 req/min)
 * - authLimiter: Authentication endpoints (10 req/15min)
 *
 * Per-User Rate Limiting (New):
 * See ./middleware/user-rate-limit.middleware.ts and ../services/rate-limit.service.ts
 * for the new per-user rate limiting system that tracks by user ID and
 * provides different limits based on loyalty tier.
 *
 * @version 2.0.0
 */

import rateLimit from "express-rate-limit";

/**
 * Helper function to check if request should skip rate limiting
 */
function shouldSkipRateLimit(req: { ip?: string }): boolean {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const ip = req.ip || "";
  const isLocalhost =
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1";
  return isDevelopment && isLocalhost;
}

/**
 * General API rate limiter (IP-based)
 * Limits: 100 requests per 15 minutes per IP
 *
 * Note: For per-user rate limiting with loyalty tier support,
 * use createUserRateLimitMiddleware instead.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: true, // Enable legacy X-RateLimit-* headers for compatibility
  skip: shouldSkipRateLimit,
  // Use default key generator which handles IPv6 properly
  validate: { xForwardedForHeader: false },
});

/**
 * Strict rate limiter for sensitive endpoints (IP-based)
 * Limits: 5 requests per 15 minutes per IP
 * Used for: Login, payment webhooks, etc.
 */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Too many attempts from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: true,
  skip: shouldSkipRateLimit,
  validate: { xForwardedForHeader: false },
});

/**
 * Webhook rate limiter (IP-based)
 * Limits: 50 requests per minute per IP
 * Used for: Stripe webhooks, payment callbacks
 *
 * Note: Webhook endpoints typically come from known IP ranges.
 * Consider whitelisting Stripe IPs in production.
 */
export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50, // Limit each IP to 50 requests per minute
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Too many webhook requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: true,
  skip: shouldSkipRateLimit,
  validate: { xForwardedForHeader: false },
});

/**
 * Auth rate limiter (IP-based)
 * Limits: 10 login attempts per 15 minutes per IP
 *
 * Note: For per-user auth rate limiting,
 * use createStrictRateLimitMiddleware("auth") instead.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login attempts per windowMs
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Too many login attempts from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: true,
  skip: shouldSkipRateLimit,
  validate: { xForwardedForHeader: false },
});

/**
 * Booking rate limiter (IP-based)
 * Limits: 20 booking attempts per minute per IP
 */
export const bookingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // Limit each IP to 20 booking attempts per minute
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Too many booking requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: true,
  skip: shouldSkipRateLimit,
  validate: { xForwardedForHeader: false },
});

/**
 * Payment rate limiter (IP-based)
 * Limits: 10 payment attempts per minute per IP
 */
export const paymentLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 payment attempts per minute
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Too many payment requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: true,
  skip: shouldSkipRateLimit,
  validate: { xForwardedForHeader: false },
});

// Re-export per-user rate limiting components for convenience
export {
  createUserRateLimitMiddleware,
  createStrictRateLimitMiddleware,
  rateLimitHeadersMiddleware,
  getClientIp,
} from "./middleware/user-rate-limit.middleware";

export {
  rateLimitService,
  RATE_LIMIT_TIERS,
  STRICT_RATE_LIMITS,
} from "../services/rate-limit.service";

export type { RateLimitTier, RateLimitResult } from "../services/rate-limit.service";
