/**
 * Rate Limit Router
 *
 * Provides endpoints for checking and managing rate limit status
 *
 * @version 1.0.0
 */

import { z } from "zod";
import type { Request } from "express";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import {
  rateLimitService,
  RATE_LIMIT_TIERS,
  STRICT_RATE_LIMITS,
} from "../services/rate-limit.service";

/**
 * Rate Limit Router
 */
export const rateLimitRouter = router({
  /**
   * Get current rate limit status for the requesting user/IP
   * Returns remaining requests, limits, and tier information
   */
  status: publicProcedure.query(async ({ ctx }) => {
    // Get IP from request
    const ip = getClientIpFromContext(ctx);

    // Get rate limit status
    const status = await rateLimitService.getRateLimitStatus(
      ctx.user,
      ip,
      "api"
    );

    return {
      tier: status.tier,
      limit: status.limit,
      remaining: status.remaining,
      resetAt: status.resetAt.toISOString(),
      allowed: status.allowed,
      tierInfo: {
        name: status.tierInfo.name,
        requestsPerWindow: status.tierInfo.requestsPerWindow,
        windowMs: status.tierInfo.windowMs,
        windowSeconds: Math.floor(status.tierInfo.windowMs / 1000),
        burstLimit: status.tierInfo.burstLimit,
      },
      isAuthenticated: ctx.user !== null,
      userId: ctx.user?.id ?? null,
    };
  }),

  /**
   * Get rate limit status for a specific scope
   */
  statusForScope: publicProcedure
    .input(
      z.object({
        scope: z.enum(["api", "auth", "payment", "booking"]),
      })
    )
    .query(async ({ ctx, input }) => {
      const ip = getClientIpFromContext(ctx);
      const status = await rateLimitService.getRateLimitStatus(
        ctx.user,
        ip,
        input.scope
      );

      return {
        scope: input.scope,
        tier: status.tier,
        limit: status.limit,
        remaining: status.remaining,
        resetAt: status.resetAt.toISOString(),
        allowed: status.allowed,
      };
    }),

  /**
   * Get all available rate limit tiers and their configurations
   * Useful for documentation and client-side display
   */
  tiers: publicProcedure.query(() => {
    return {
      standard: Object.entries(RATE_LIMIT_TIERS).map(([key, tier]) => ({
        key,
        name: tier.name,
        requestsPerWindow: tier.requestsPerWindow,
        windowMs: tier.windowMs,
        windowSeconds: Math.floor(tier.windowMs / 1000),
        burstLimit: tier.burstLimit,
      })),
      strict: Object.entries(STRICT_RATE_LIMITS).map(([key, tier]) => ({
        key,
        name: tier.name,
        requestsPerWindow: tier.requestsPerWindow,
        windowMs: tier.windowMs,
        windowSeconds: Math.floor(tier.windowMs / 1000),
      })),
    };
  }),

  /**
   * Get the user's current rate limit tier based on their account
   */
  myTier: protectedProcedure.query(async ({ ctx }) => {
    const tier = await rateLimitService.getRateLimitTier(ctx.user);

    // Get loyalty tier if exists
    const loyaltyTier = await rateLimitService.getUserLoyaltyTier(ctx.user.id);

    return {
      currentTier: tier.name,
      loyaltyTier,
      userRole: ctx.user.role,
      limits: {
        requestsPerWindow: tier.requestsPerWindow,
        windowMs: tier.windowMs,
        windowSeconds: Math.floor(tier.windowMs / 1000),
        burstLimit: tier.burstLimit,
      },
      tierBenefits: getTierBenefits(tier.name),
    };
  }),

  // ============================================================================
  // Admin Endpoints
  // ============================================================================

  /**
   * Reset rate limit for a specific user (admin only)
   */
  resetUser: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        scope: z.string().optional().default("api"),
      })
    )
    .mutation(async ({ input }) => {
      await rateLimitService.resetRateLimit(
        `user:${input.userId}`,
        input.scope
      );

      return {
        success: true,
        message: `Rate limit reset for user ${input.userId} in scope ${input.scope}`,
      };
    }),

  /**
   * Reset rate limit for a specific IP (admin only)
   */
  resetIp: adminProcedure
    .input(
      z.object({
        ip: z.string(),
        scope: z.string().optional().default("api"),
      })
    )
    .mutation(async ({ input }) => {
      await rateLimitService.resetRateLimit(`ip:${input.ip}`, input.scope);

      return {
        success: true,
        message: `Rate limit reset for IP ${input.ip} in scope ${input.scope}`,
      };
    }),

  /**
   * Get rate limit status for a specific user (admin only)
   */
  getUserStatus: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        scope: z.string().optional().default("api"),
      })
    )
    .query(async ({ input }) => {
      // Create a minimal user object for rate limit lookup
      const mockUser = { id: input.userId, role: "user" as const };
      const tier = await rateLimitService.getRateLimitTier(mockUser);
      const loyaltyTier = await rateLimitService.getUserLoyaltyTier(
        input.userId
      );

      return {
        userId: input.userId,
        scope: input.scope,
        tier: tier.name,
        loyaltyTier,
        limits: {
          requestsPerWindow: tier.requestsPerWindow,
          windowMs: tier.windowMs,
          burstLimit: tier.burstLimit,
        },
      };
    }),

  /**
   * Get rate limit configuration summary (admin only)
   */
  config: adminProcedure.query(() => {
    return {
      tiers: Object.entries(RATE_LIMIT_TIERS).map(([key, tier]) => ({
        key,
        ...tier,
        windowSeconds: Math.floor(tier.windowMs / 1000),
      })),
      strictLimits: Object.entries(STRICT_RATE_LIMITS).map(([key, tier]) => ({
        key,
        ...tier,
        windowSeconds: Math.floor(tier.windowMs / 1000),
      })),
      environment: process.env.NODE_ENV,
    };
  }),
});

/**
 * Extract client IP from tRPC context
 */
function getClientIpFromContext(ctx: { req: Request }): string {
  const req = ctx.req;

  // Check for forwarded headers
  const forwardedFor = req.headers?.["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(",")[0];
    return ips.trim();
  }

  const realIp = req.headers?.["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return req.socket?.remoteAddress || req.ip || "unknown";
}

/**
 * Get benefits description for a tier
 */
function getTierBenefits(tierName: string): string[] {
  const benefits: Record<string, string[]> = {
    anonymous: [
      "60 requests per minute",
      "Basic API access",
      "Standard support",
    ],
    authenticated: [
      "120 requests per minute",
      "Full API access",
      "Email support",
    ],
    bronze: [
      "150 requests per minute",
      "Loyalty program access",
      "Priority email support",
    ],
    silver: [
      "200 requests per minute",
      "25% bonus miles earning",
      "Priority support",
    ],
    gold: [
      "300 requests per minute",
      "50% bonus miles earning",
      "24/7 priority support",
    ],
    platinum: [
      "500 requests per minute",
      "100% bonus miles earning",
      "Dedicated support line",
    ],
    admin: [
      "1000 requests per minute",
      "Full administrative access",
      "Technical support",
    ],
  };

  return benefits[tierName] || ["Standard API access"];
}
