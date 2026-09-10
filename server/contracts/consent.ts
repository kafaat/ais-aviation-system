// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  recordConsent: z.object({
    id: outputNumber,
    createdAt: z.date(),
    userId: z.union([z.null(), outputNumber]),
    userAgent: z.union([z.null(), z.string()]),
    preferences: z.boolean(),
    consentVersion: z.string(),
    essential: z.boolean(),
    analytics: z.boolean(),
    marketing: z.boolean(),
    ipAddress: z.union([z.null(), z.string()]),
  }),
  getMyConsent: z.object({
    consent: z.union([
      z.null(),
      z.object({
        id: outputNumber,
        createdAt: z.date(),
        userId: z.union([z.null(), outputNumber]),
        userAgent: z.union([z.null(), z.string()]),
        preferences: z.boolean(),
        consentVersion: z.string(),
        essential: z.boolean(),
        analytics: z.boolean(),
        marketing: z.boolean(),
        ipAddress: z.union([z.null(), z.string()]),
      }),
    ]),
    needsReconsent: z.boolean(),
    currentVersion: z.string(),
  }),
  updateConsent: z.object({
    id: outputNumber,
    createdAt: z.date(),
    userId: z.union([z.null(), outputNumber]),
    userAgent: z.union([z.null(), z.string()]),
    preferences: z.boolean(),
    consentVersion: z.string(),
    essential: z.boolean(),
    analytics: z.boolean(),
    marketing: z.boolean(),
    ipAddress: z.union([z.null(), z.string()]),
  }),
  getConsentStats: z.object({
    totalRecords: outputNumber,
    uniqueUsers: outputNumber,
    essentialCount: outputNumber,
    analyticsCount: outputNumber,
    marketingCount: outputNumber,
    preferencesCount: outputNumber,
    currentVersion: z.string(),
    versionBreakdown: z.array(
      z.object({ version: z.string(), count: outputNumber })
    ),
  }),
};
