// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  status: z.object({
    tier: z.string(),
    limit: outputNumber,
    remaining: outputNumber,
    resetAt: z.string(),
    allowed: z.boolean(),
    tierInfo: z.object({
      name: z.string(),
      requestsPerWindow: outputNumber,
      windowMs: outputNumber,
      windowSeconds: outputNumber,
      burstLimit: z.union([z.undefined(), outputNumber]),
    }),
    isAuthenticated: z.boolean(),
    userId: z.union([z.null(), outputNumber]),
  }),
  statusForScope: z.object({
    scope: z.enum(["booking", "payment", "auth", "api"]),
    tier: z.string(),
    limit: outputNumber,
    remaining: outputNumber,
    resetAt: z.string(),
    allowed: z.boolean(),
  }),
  tiers: z.object({
    standard: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        requestsPerWindow: outputNumber,
        windowMs: outputNumber,
        windowSeconds: outputNumber,
        burstLimit: z.union([z.undefined(), outputNumber]),
      })
    ),
    strict: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        requestsPerWindow: outputNumber,
        windowMs: outputNumber,
        windowSeconds: outputNumber,
      })
    ),
  }),
  myTier: z.object({
    currentTier: z.string(),
    loyaltyTier: z.union([
      z.null(),
      z.literal("bronze"),
      z.literal("silver"),
      z.literal("gold"),
      z.literal("platinum"),
    ]),
    userRole: z.enum([
      "user",
      "admin",
      "super_admin",
      "airline_admin",
      "finance",
      "ops",
      "support",
    ]),
    limits: z.object({
      requestsPerWindow: outputNumber,
      windowMs: outputNumber,
      windowSeconds: outputNumber,
      burstLimit: z.union([z.undefined(), outputNumber]),
    }),
    tierBenefits: z.array(z.string()),
  }),
  resetUser: z.object({ success: z.boolean(), message: z.string() }),
  resetIp: z.object({ success: z.boolean(), message: z.string() }),
  getUserStatus: z.object({
    userId: outputNumber,
    scope: z.string(),
    tier: z.string(),
    loyaltyTier: z.union([
      z.null(),
      z.literal("bronze"),
      z.literal("silver"),
      z.literal("gold"),
      z.literal("platinum"),
    ]),
    limits: z.object({
      requestsPerWindow: outputNumber,
      windowMs: outputNumber,
      burstLimit: z.union([z.undefined(), outputNumber]),
    }),
  }),
  config: z.object({
    tiers: z.array(
      z.object({
        windowSeconds: outputNumber,
        name: z.string(),
        requestsPerWindow: outputNumber,
        windowMs: outputNumber,
        burstLimit: z.union([z.undefined(), outputNumber]).optional(),
        key: z.string(),
      })
    ),
    strictLimits: z.array(
      z.object({
        windowSeconds: outputNumber,
        name: z.string(),
        requestsPerWindow: outputNumber,
        windowMs: outputNumber,
        burstLimit: z.union([z.undefined(), outputNumber]).optional(),
        key: z.string(),
      })
    ),
    environment: z.union([z.undefined(), z.string()]),
  }),
};
