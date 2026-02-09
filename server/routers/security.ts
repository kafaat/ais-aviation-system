import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import * as accountLockService from "../services/account-lock.service";

/**
 * Security Router
 * Admin endpoints for account lockout and security event management
 */
export const securityRouter = router({
  /**
   * Get recent security events
   */
  getRecentSecurityEvents: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional().default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      return await accountLockService.getRecentSecurityEvents(limit);
    }),

  /**
   * Lock a user account
   */
  lockAccount: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        reason: z.string().min(1).max(500),
        autoUnlockMinutes: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await accountLockService.lockAccount(
        input.userId,
        input.reason,
        `admin:${ctx.user.email}`,
        input.autoUnlockMinutes
      );

      return {
        success: true,
        message: "Account locked successfully",
      };
    }),

  /**
   * Unlock a user account
   */
  unlockAccount: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await accountLockService.unlockAccount(
        input.userId,
        `admin:${ctx.user.email}`
      );

      return {
        success: true,
        message: "Account unlocked successfully",
      };
    }),

  /**
   * Check if an account is locked
   */
  isAccountLocked: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      const locked = await accountLockService.isAccountLocked(input.userId);

      return {
        locked,
      };
    }),

  /**
   * Block an IP address
   */
  blockIp: adminProcedure
    .input(
      z.object({
        ipAddress: z.string().min(1).max(45), // IPv4 or IPv6
        reason: z.string().min(1).max(500),
        autoUnblockMinutes: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await accountLockService.blockIpAddress(
        input.ipAddress,
        input.reason,
        `admin:${ctx.user.email}`,
        input.autoUnblockMinutes
      );

      return {
        success: true,
        message: "IP address blocked successfully",
      };
    }),

  /**
   * Unblock an IP address
   */
  unblockIp: adminProcedure
    .input(
      z.object({
        ipAddress: z.string().min(1).max(45), // IPv4 or IPv6
      })
    )
    .mutation(async ({ input, ctx }) => {
      await accountLockService.unblockIpAddress(
        input.ipAddress,
        `admin:${ctx.user.email}`
      );

      return {
        success: true,
        message: "IP address unblocked successfully",
      };
    }),

  /**
   * Check if an IP address is blocked
   */
  isIpBlocked: adminProcedure
    .input(
      z.object({
        ipAddress: z.string().min(1).max(45), // IPv4 or IPv6
      })
    )
    .query(async ({ input }) => {
      const blocked = await accountLockService.isIpBlocked(input.ipAddress);

      return {
        blocked,
      };
    }),

  /**
   * Clean up old login attempts
   */
  cleanupOldAttempts: adminProcedure
    .input(
      z
        .object({
          daysToKeep: z.number().int().min(1).max(365).optional().default(30),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const daysToKeep = input?.daysToKeep ?? 30;
      const deletedCount =
        await accountLockService.cleanupOldLoginAttempts(daysToKeep);

      return {
        success: true,
        deletedCount,
        message: `Cleaned up ${deletedCount} old login attempts`,
      };
    }),
});
