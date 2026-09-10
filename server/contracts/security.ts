// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getRecentSecurityEvents: z.array(
    z.object({
      id: outputNumber,
      eventType: z.string(),
      severity: z.string(),
      userId: z.union([z.null(), outputNumber]),
      ipAddress: z.union([z.null(), z.string()]),
      userAgent: z.union([z.null(), z.string()]),
      description: z.union([z.null(), z.string()]),
      metadata: z.union([z.null(), z.string()]),
      actionTaken: z.union([z.null(), z.string()]),
      createdAt: z.date(),
    })
  ),
  lockAccount: z.object({ success: z.boolean(), message: z.string() }),
  unlockAccount: z.object({ success: z.boolean(), message: z.string() }),
  isAccountLocked: z.object({ locked: z.boolean() }),
  blockIp: z.object({ success: z.boolean(), message: z.string() }),
  unblockIp: z.object({ success: z.boolean(), message: z.string() }),
  isIpBlocked: z.object({ blocked: z.boolean() }),
  cleanupOldAttempts: z.object({
    success: z.boolean(),
    deletedCount: outputNumber,
    message: z.string(),
  }),
};
