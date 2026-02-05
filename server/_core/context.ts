import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { mobileAuthServiceV2 } from "../services/mobile-auth-v2.service";
import * as db from "../db";
import {
  redisCacheService,
  CacheTTL,
} from "../services/redis-cache.service";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  authMethod: "cookie" | "bearer" | null;
};

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Get user with caching support
 * Cache user data to reduce database lookups during a session
 */
async function getCachedUser(userId: number): Promise<User | null> {
  // Try cache first
  const cached = await redisCacheService.getCachedUserSession(userId);
  if (cached) {
    return cached as User;
  }

  // Fetch from database
  const user = await db.getUserById(userId);
  if (user) {
    // Cache the user session
    await redisCacheService.cacheUserSession(
      userId,
      user,
      CacheTTL.USER_SESSION
    );
  }

  return user || null;
}

/**
 * Authenticate request using Bearer token (JWT)
 */
async function authenticateWithBearerToken(
  token: string
): Promise<User | null> {
  try {
    // Verify the JWT access token
    const payload = mobileAuthServiceV2.verifyAccessToken(token);

    // Get user from cache or database
    const user = await getCachedUser(payload.userId);
    return user;
  } catch (error) {
    // Token is invalid or expired
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let authMethod: "cookie" | "bearer" | null = null;

  // 1. Try Bearer token authentication first (for mobile/API clients)
  const bearerToken = extractBearerToken(opts.req.headers.authorization);
  if (bearerToken) {
    try {
      user = await authenticateWithBearerToken(bearerToken);
      if (user) {
        authMethod = "bearer";
      }
    } catch (error) {
      // Bearer token auth failed, will try cookie auth next
      user = null;
    }
  }

  // 2. Fall back to cookie-based authentication (for web clients)
  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
      if (user) {
        authMethod = "cookie";
      }
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authMethod,
  };
}
