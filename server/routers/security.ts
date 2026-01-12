import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as accountLockService from "../services/account-lock.service";

/**
 * Admin-only procedure for security operations
 * Ensures only users with admin role can access these routes
 */
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

/**
 * Security Router
 * Handles security-related operations (admin only)
 */

export const securityRouter = router({
  /**
   * Get all locked accounts (admin only)
   */
  getLockedAccounts: adminProcedure.query(async () => {
    try {
      return await accountLockService.getLockedAccounts();
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get locked accounts",
      });
    }
  }),

  /**
   * Get all blocked IPs (admin only)
   */
  getBlockedIps: adminProcedure.query(async () => {
    try {
      return await accountLockService.getBlockedIps();
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get blocked IPs",
      });
    }
  }),

  /**
   * Get recent security events (admin only)
   */
  getSecurityEvents: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).optional().default(50),
      })
    )
    .query(async ({ input }) => {
      try {
        return await accountLockService.getRecentSecurityEvents(input.limit);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get security events",
        });
      }
    }),

  /**
   * Check if account is locked (protected, user can check their own account)
   */
  isAccountLocked: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      try {
        const isLocked = await accountLockService.isAccountLocked(input.userId);
        const lock = isLocked ? await accountLockService.getAccountLock(input.userId) : null;
        return {
          isLocked,
          lock,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check account lock status",
        });
      }
    }),

  /**
   * Unlock an account (admin only)
   */
  unlockAccount: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        unlockedBy: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await accountLockService.unlockAccount(input.userId, input.unlockedBy);
        return { success: true, message: "Account unlocked successfully" };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to unlock account",
        });
      }
    }),

  /**
   * Lock an account (admin only)
   */
  lockAccount: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        reason: z.string().min(1).max(255),
        lockedBy: z.string(),
        autoUnlockMinutes: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await accountLockService.lockAccount(
          input.userId,
          input.reason,
          input.lockedBy,
          input.autoUnlockMinutes
        );
        return { success: true, message: "Account locked successfully" };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to lock account",
        });
      }
    }),

  /**
   * Check if IP is blocked (admin only)
   */
  isIpBlocked: adminProcedure
    .input(
      z.object({
        ipAddress: z.string(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await accountLockService.isIpBlocked(input.ipAddress);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check IP block status",
        });
      }
    }),

  /**
   * Block an IP address (admin only)
   */
  blockIp: adminProcedure
    .input(
      z.object({
        ipAddress: z.string(),
        reason: z.string().min(1),
        blockedBy: z.string(),
        autoUnblockMinutes: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await accountLockService.blockIpAddress(
          input.ipAddress,
          input.reason,
          input.blockedBy,
          input.autoUnblockMinutes
        );
        return { success: true, message: "IP address blocked successfully" };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to block IP address",
        });
      }
    }),

  /**
   * Unblock an IP address (admin only)
   */
  unblockIp: adminProcedure
    .input(
      z.object({
        ipAddress: z.string(),
        unblockedBy: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await accountLockService.unblockIpAddress(input.ipAddress, input.unblockedBy);
        return { success: true, message: "IP address unblocked successfully" };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to unblock IP address",
        });
      }
    }),
});
