/**
 * Travel Agent API Authentication Middleware
 *
 * Express middleware for authenticating travel agent API requests.
 * Supports authentication via:
 * - X-API-Key and X-API-Secret headers
 * - Authorization header (Basic auth with apiKey:apiSecret)
 *
 * Also provides rate limiting specific to agent API.
 *
 * @version 1.0.0
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { validateApiKey } from "../../services/travel-agent.service";
import type { TravelAgent } from "../../../drizzle/schema";
import { logger } from "../logger";
import { cacheService } from "../../services/cache.service";

const log = logger.child({ service: "agent-api-middleware" });

// Rate limit configuration for agent API
const AGENT_RATE_LIMIT = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60, // 60 requests per minute per agent
};

// Extend Express Request to include agent
declare global {
  namespace Express {
    interface Request {
      agent?: TravelAgent;
    }
  }
}

/**
 * Extract API credentials from request
 */
function extractCredentials(
  req: Request
): { apiKey: string; apiSecret: string } | null {
  // Method 1: X-API-Key and X-API-Secret headers
  const apiKeyHeader = req.headers["x-api-key"];
  const apiSecretHeader = req.headers["x-api-secret"];

  if (apiKeyHeader && apiSecretHeader) {
    return {
      apiKey: Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader,
      apiSecret: Array.isArray(apiSecretHeader)
        ? apiSecretHeader[0]
        : apiSecretHeader,
    };
  }

  // Method 2: Authorization header (Basic auth)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Basic ")) {
    try {
      const base64Credentials = authHeader.slice(6);
      const credentials = Buffer.from(base64Credentials, "base64").toString(
        "utf-8"
      );
      const [apiKey, apiSecret] = credentials.split(":");

      if (apiKey && apiSecret) {
        return { apiKey, apiSecret };
      }
    } catch {
      // Invalid base64 or format
    }
  }

  // Method 3: Bearer token (apiKey:apiSecret combined)
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      const [apiKey, apiSecret] = token.split(":");

      if (apiKey && apiSecret) {
        return { apiKey, apiSecret };
      }
    } catch {
      // Invalid format
    }
  }

  return null;
}

/**
 * Get client IP from request
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(",")[0];
    return ips.trim();
  }

  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return req.socket?.remoteAddress || req.ip || "unknown";
}

/**
 * Create agent API authentication middleware
 *
 * @param options Configuration options
 * @returns Express middleware
 */
export function createAgentApiAuthMiddleware(options?: {
  /**
   * Skip authentication for certain paths
   */
  skipPaths?: string[];

  /**
   * Enable rate limiting (default: true)
   */
  enableRateLimit?: boolean;

  /**
   * Custom rate limit configuration
   */
  rateLimit?: {
    windowMs: number;
    maxRequests: number;
  };
}): RequestHandler {
  const {
    skipPaths = [],
    enableRateLimit = true,
    rateLimit = AGENT_RATE_LIMIT,
  } = options || {};

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const path = req.path;

    // Skip authentication for certain paths
    if (skipPaths.some(p => path.startsWith(p))) {
      return next();
    }

    // Skip if path is for documentation
    if (path.includes("/docs")) {
      return next();
    }

    const ip = getClientIp(req);

    try {
      // Extract credentials
      const credentials = extractCredentials(req);

      if (!credentials) {
        log.warn({ ip, path }, "Missing API credentials");
        res.status(401).json({
          error: "UNAUTHORIZED",
          message:
            "API credentials required. Use X-API-Key and X-API-Secret headers or Authorization header.",
        });
        return;
      }

      // Validate credentials
      const agent = await validateApiKey(
        credentials.apiKey,
        credentials.apiSecret
      );

      if (!agent) {
        log.warn(
          { ip, path, apiKey: credentials.apiKey.substring(0, 20) + "..." },
          "Invalid API credentials"
        );
        res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Invalid API credentials",
        });
        return;
      }

      // Check if agent is active
      if (!agent.isActive) {
        log.warn(
          { ip, agentId: agent.id },
          "Inactive agent attempted API call"
        );
        res.status(403).json({
          error: "FORBIDDEN",
          message: "Agent account is inactive",
        });
        return;
      }

      // Rate limiting
      if (enableRateLimit) {
        const rateLimitKey = `agent_api_rate:${agent.id}`;
        const windowSeconds = Math.ceil(rateLimit.windowMs / 1000);
        const { allowed, remaining } = await cacheService.checkRateLimit(
          rateLimitKey,
          rateLimit.maxRequests,
          windowSeconds
        );

        // Set rate limit headers
        res.setHeader("X-RateLimit-Limit", rateLimit.maxRequests);
        res.setHeader("X-RateLimit-Remaining", remaining);

        if (!allowed) {
          res.setHeader("Retry-After", windowSeconds);

          log.warn(
            { agentId: agent.id, limit: rateLimit.maxRequests },
            "Agent API rate limit exceeded"
          );

          res.status(429).json({
            error: "TOO_MANY_REQUESTS",
            message: "API rate limit exceeded",
            retryAfter: windowSeconds,
          });
          return;
        }
      }

      // Attach agent to request
      req.agent = agent;

      // Set response headers
      res.setHeader("X-Agent-ID", agent.id);
      res.setHeader("X-Agent-Name", agent.agencyName);

      log.debug(
        { agentId: agent.id, agencyName: agent.agencyName, path },
        "Agent API request authenticated"
      );

      next();
    } catch (error) {
      log.error({ ip, path, error }, "Agent API authentication error");
      res.status(500).json({
        error: "INTERNAL_SERVER_ERROR",
        message: "Authentication error",
      });
    }
  };
}

/**
 * Middleware to require agent authentication
 * Use after createAgentApiAuthMiddleware to ensure agent is present
 */
export function requireAgent(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.agent) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Agent authentication required",
      });
      return;
    }
    next();
  };
}

/**
 * Middleware to check agent booking limits
 */
export function checkAgentLimits(): RequestHandler {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const agent = req.agent;

    if (!agent) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Agent authentication required",
      });
      return;
    }

    // Check daily booking limit
    const todayKey = `agent_daily_bookings:${agent.id}:${new Date().toISOString().split("T")[0]}`;
    const dailyBookings = (await cacheService.get<number>(todayKey)) ?? 0;

    if (dailyBookings >= agent.dailyBookingLimit) {
      res.status(429).json({
        error: "DAILY_LIMIT_EXCEEDED",
        message: `Daily booking limit (${agent.dailyBookingLimit}) exceeded`,
        limit: agent.dailyBookingLimit,
        current: dailyBookings,
      });
      return;
    }

    // Check monthly booking limit
    const monthKey = `agent_monthly_bookings:${agent.id}:${new Date().toISOString().slice(0, 7)}`;
    const monthlyBookings = (await cacheService.get<number>(monthKey)) ?? 0;

    if (monthlyBookings >= agent.monthlyBookingLimit) {
      res.status(429).json({
        error: "MONTHLY_LIMIT_EXCEEDED",
        message: `Monthly booking limit (${agent.monthlyBookingLimit}) exceeded`,
        limit: agent.monthlyBookingLimit,
        current: monthlyBookings,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to increment booking counters after successful booking
 */
export async function incrementBookingCounters(agentId: number): Promise<void> {
  const todayKey = `agent_daily_bookings:${agentId}:${new Date().toISOString().split("T")[0]}`;
  const monthKey = `agent_monthly_bookings:${agentId}:${new Date().toISOString().slice(0, 7)}`;

  // Atomic increment for daily counter (24 hours TTL)
  await cacheService.checkRateLimit(
    todayKey,
    Number.MAX_SAFE_INTEGER,
    24 * 60 * 60
  );

  // Atomic increment for monthly counter (31 days TTL)
  await cacheService.checkRateLimit(
    monthKey,
    Number.MAX_SAFE_INTEGER,
    31 * 24 * 60 * 60
  );
}

export { getClientIp };
