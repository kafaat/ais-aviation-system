import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  getRecentSecurityEvents,
  getLockedAccounts,
  unlockAccount,
  blockIpAddress,
  unblockIpAddress,
  getUserLoginAttempts,
  isAccountLocked,
  isIpBlocked,
} from "../services/account-lock.service";

/**
 * Security Router
 * Admin endpoints for security monitoring and management
 */
export const securityRouter = router({
  /**
   * Get recent security events (admin only)
   */
  getSecurityEvents: adminProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(200).optional().default(50),
      })
    )
    .query(async ({ input }) => {
      return await getRecentSecurityEvents(input.limit);
    }),

  /**
   * Get all locked accounts (admin only)
   */
  getLockedAccounts: adminProcedure.query(async () => {
    return await getLockedAccounts();
  }),

  /**
   * Unlock a user account (admin only)
   */
  unlockAccount: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await unlockAccount(input.userId, `admin-${ctx.user.id}`);
      return { success: true };
    }),

  /**
   * Check if account is locked (admin only)
   */
  checkAccountLock: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      const isLocked = await isAccountLocked(input.userId);
      return { isLocked };
    }),

  /**
   * Get login attempts for a user (admin only)
   */
  getUserLoginAttempts: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        limit: z.number().int().positive().max(100).optional().default(20),
      })
    )
    .query(async ({ input }) => {
      return await getUserLoginAttempts(input.userId, input.limit);
    }),

  /**
   * Block an IP address (admin only)
   */
  blockIp: adminProcedure
    .input(
      z.object({
        ipAddress: z.string().regex(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i, "Invalid IP address"),
        reason: z.string().min(1).max(500),
        autoUnblockMinutes: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await blockIpAddress(
        input.ipAddress,
        input.reason,
        `admin-${ctx.user.id}`,
        input.autoUnblockMinutes
      );
      return { success: true };
    }),

  /**
   * Unblock an IP address (admin only)
   */
  unblockIp: adminProcedure
    .input(
      z.object({
        ipAddress: z.string().regex(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i, "Invalid IP address"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await unblockIpAddress(input.ipAddress, `admin-${ctx.user.id}`);
      return { success: true };
    }),

  /**
   * Check if IP is blocked (admin only)
   */
  checkIpBlock: adminProcedure
    .input(
      z.object({
        ipAddress: z.string().regex(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i, "Invalid IP address"),
      })
    )
    .query(async ({ input }) => {
      const isBlocked = await isIpBlocked(input.ipAddress);
      return { isBlocked };
    }),
});
