/**
 * Per-User Rate Limiting Middleware
 *
 * Express middleware that applies rate limits based on:
 * - User authentication status
 * - User loyalty tier (bronze, silver, gold, platinum)
 * - User role (admin gets higher limits)
 *
 * Features:
 * - Sets X-RateLimit-* headers on all responses
 * - Returns 429 Too Many Requests when limit exceeded
 * - Supports both user ID and IP-based limiting
 *
 * @version 1.0.0
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  rateLimitService,
  STRICT_RATE_LIMITS,
  type RateLimitResult,
} from "../../services/rate-limit.service";
import type { User } from "../../../drizzle/schema";
import { sdk } from "../sdk";
import { logger } from "../logger";

/**
 * Extended Request with user info
 */
interface RateLimitRequest extends Request {
  user?: User | null;
  rateLimitResult?: RateLimitResult;
}

/**
 * Extract client IP from request
 */
function getClientIp(req: Request): string {
  // Check for forwarded headers (when behind proxy/load balancer)
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(",")[0];
    return ips.trim();
  }

  // Check for real IP header (nginx)
  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // Fall back to socket address
  return req.socket?.remoteAddress || req.ip || "unknown";
}

/**
 * Set rate limit headers on response
 */
function setRateLimitHeaders(res: Response, result: RateLimitResult): void {
  const headers = rateLimitService.getRateLimitHeaders(result);

  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

/**
 * Create per-user rate limiting middleware
 *
 * @param options Configuration options
 * @returns Express middleware
 */
export function createUserRateLimitMiddleware(options?: {
  /**
   * Skip rate limiting in development mode
   * Default: true for localhost in development
   */
  skipInDevelopment?: boolean;

  /**
   * Custom scope for rate limiting (e.g., "api", "auth", "booking")
   */
  scope?: string;

  /**
   * Custom error message when rate limited
   */
  errorMessage?: string;

  /**
   * Whether to authenticate user for rate limit tier determination
   * Default: true
   */
  authenticateUser?: boolean;
}): RequestHandler {
  const {
    skipInDevelopment = true,
    scope = "api",
    errorMessage = "Too many requests. Please try again later.",
    authenticateUser = true,
  } = options || {};

  return async (
    req: RateLimitRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const ip = getClientIp(req);

    // Skip rate limiting in development for localhost
    if (skipInDevelopment) {
      const isDevelopment = process.env.NODE_ENV !== "production";
      const isLocalhost =
        ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

      if (isDevelopment && isLocalhost) {
        return next();
      }
    }

    try {
      // Get user if not already authenticated
      let user: User | null = req.user || null;

      if (!user && authenticateUser) {
        try {
          user = await sdk.authenticateRequest(req);
          req.user = user;
        } catch {
          // User not authenticated, continue as anonymous
          user = null;
        }
      }

      // Check rate limit
      const result = await rateLimitService.checkUserRateLimit(user, ip, scope);

      // Store result for potential use in handlers
      req.rateLimitResult = result;

      // Always set rate limit headers
      setRateLimitHeaders(res, result);

      if (!result.allowed) {
        logger.warn(
          {
            ip,
            userId: user?.id,
            tier: result.tier,
            limit: result.limit,
            scope,
          },
          "Rate limit exceeded"
        );

        res.status(429).json({
          error: "TOO_MANY_REQUESTS",
          message: errorMessage,
          retryAfter: result.retryAfterSeconds,
          limit: result.limit,
          resetAt: result.resetAt.toISOString(),
        });
        return;
      }

      next();
    } catch (error) {
      // On error, allow the request to continue (fail open)
      logger.error({ ip, error }, "Rate limit middleware error");
      next();
    }
  };
}

/**
 * Create strict rate limiting middleware for sensitive endpoints
 *
 * @param endpoint The endpoint type (auth, payment, booking, passwordReset)
 * @returns Express middleware
 */
export function createStrictRateLimitMiddleware(
  endpoint: keyof typeof STRICT_RATE_LIMITS
): RequestHandler {
  const tierConfig = STRICT_RATE_LIMITS[endpoint];

  if (!tierConfig) {
    throw new Error(`Unknown strict rate limit endpoint: ${endpoint}`);
  }

  return async (
    req: RateLimitRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const ip = getClientIp(req);

    // Skip in development for localhost
    const isDevelopment = process.env.NODE_ENV !== "production";
    const isLocalhost =
      ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

    if (isDevelopment && isLocalhost) {
      return next();
    }

    try {
      // For strict limits, use IP + user ID (if available) for the identifier
      let user: User | null = req.user || null;

      if (!user) {
        try {
          user = await sdk.authenticateRequest(req);
          req.user = user;
        } catch {
          user = null;
        }
      }

      const identifier = user ? `user:${user.id}` : `ip:${ip}`;
      const result = await rateLimitService.checkStrictRateLimit(
        identifier,
        endpoint
      );

      // Store result
      req.rateLimitResult = result;

      // Set headers
      setRateLimitHeaders(res, result);

      if (!result.allowed) {
        logger.warn(
          {
            ip,
            userId: user?.id,
            endpoint,
            limit: result.limit,
          },
          `Strict rate limit exceeded for ${endpoint}`
        );

        res.status(429).json({
          error: "TOO_MANY_REQUESTS",
          message: `Too many ${endpoint} attempts. Please try again later.`,
          retryAfter: result.retryAfterSeconds,
          limit: result.limit,
          resetAt: result.resetAt.toISOString(),
        });
        return;
      }

      next();
    } catch (error) {
      logger.error(
        { ip, endpoint, error },
        "Strict rate limit middleware error"
      );
      next();
    }
  };
}

/**
 * Middleware to only add rate limit headers without blocking
 * Useful for monitoring rate limit usage
 */
export function rateLimitHeadersMiddleware(): RequestHandler {
  return async (
    req: RateLimitRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const ip = getClientIp(req);

    try {
      let user: User | null = req.user || null;

      if (!user) {
        try {
          user = await sdk.authenticateRequest(req);
          req.user = user;
        } catch {
          user = null;
        }
      }

      const status = await rateLimitService.getRateLimitStatus(user, ip);
      setRateLimitHeaders(res, status);
      req.rateLimitResult = status;
    } catch (error) {
      // Silently fail - headers are optional
      logger.debug({ ip, error }, "Failed to get rate limit status");
    }

    next();
  };
}

// Export utility function
export { getClientIp };
