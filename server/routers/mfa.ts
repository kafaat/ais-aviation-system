/**
 * MFA Router - Multi-Factor Authentication Endpoints
 *
 * Provides TOTP-based two-factor authentication management:
 * - Setup: Generate secret and backup codes
 * - Verify: Confirm TOTP setup by verifying a token
 * - Disable: Turn off MFA after token verification
 * - Login verification: Verify TOTP during login flow
 * - Backup codes: Use and regenerate backup codes
 * - Status: Check MFA enrollment status
 *
 * @version 1.0.0
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";
import {
  generateSecret,
  generateQRCodeURL,
  verifyTOTP,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  encryptSecret,
  getMfaSettings,
  upsertMfaSetup,
  enableMfa,
  disableMfa,
  updateLastUsed,
  updateBackupCodes,
  decryptSecret,
} from "../services/mfa.service";

// ============================================================================
// Input Schemas
// ============================================================================

const verifyTokenSchema = z.object({
  token: z
    .string()
    .length(6, "Token must be exactly 6 digits")
    .regex(/^\d{6}$/, "Token must contain only digits"),
});

const verifyLoginSchema = z.object({
  userId: z.number().int().positive(),
  token: z
    .string()
    .length(6, "Token must be exactly 6 digits")
    .regex(/^\d{6}$/, "Token must contain only digits"),
});

const backupCodeSchema = z.object({
  userId: z.number().int().positive(),
  code: z
    .string()
    .length(8, "Backup code must be exactly 8 characters")
    .regex(/^[a-z0-9]+$/, "Backup code must be lowercase alphanumeric"),
});

// ============================================================================
// Router
// ============================================================================

export const mfaRouter = router({
  /**
   * Setup MFA - Generate TOTP secret and backup codes
   * Returns the QR code URI and plaintext backup codes for initial display
   */
  setup: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/mfa/setup",
        tags: ["MFA"],
        summary: "Setup MFA",
        description:
          "Generate a new TOTP secret and backup codes for MFA enrollment. Returns the QR code URI for scanning and plaintext backup codes for saving. MFA is not active until verified.",
        protect: true,
      },
    })
    .mutation(async ({ ctx }) => {
      const userId = ctx.user.id;
      const email = ctx.user.email || `user-${userId}@ais-aviation.com`;

      // Check if MFA is already enabled
      const existing = await getMfaSettings(userId);
      if (existing?.isEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "MFA is already enabled. Disable it first to reconfigure.",
        });
      }

      // Generate new secret and backup codes
      const secret = generateSecret();
      const qrCodeUrl = generateQRCodeURL(email, secret);
      const backupCodes = generateBackupCodes();

      // Hash backup codes for storage
      const hashedBackupCodes = backupCodes.map(hashBackupCode);

      // Encrypt secret and store in database
      const encrypted = encryptSecret(secret);
      await upsertMfaSetup(userId, encrypted, hashedBackupCodes);

      logger.info({ userId }, "MFA setup initiated");

      return {
        secret,
        qrCodeUrl,
        backupCodes,
      };
    }),

  /**
   * Verify MFA setup - Confirm the user can generate valid TOTP tokens
   * This activates MFA on the account
   */
  verify: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/mfa/verify",
        tags: ["MFA"],
        summary: "Verify and enable MFA",
        description:
          "Verify a TOTP token to confirm the authenticator app is set up correctly. On success, MFA is enabled on the account.",
        protect: true,
      },
    })
    .input(verifyTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Get the pending MFA settings
      const settings = await getMfaSettings(userId);
      if (!settings) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No MFA setup found. Please initiate setup first.",
        });
      }

      if (settings.isEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "MFA is already enabled.",
        });
      }

      // Decrypt and verify the token
      const secret = decryptSecret(settings.secret);
      const isValid = verifyTOTP(secret, input.token);

      if (!isValid) {
        logger.warn({ userId }, "MFA verification failed - invalid token");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid verification code. Please try again.",
        });
      }

      // Enable MFA
      await enableMfa(userId);

      logger.info({ userId }, "MFA verified and enabled");

      return {
        success: true,
        message: "MFA has been enabled successfully.",
      };
    }),

  /**
   * Disable MFA - Requires a valid TOTP token for security
   */
  disable: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/mfa/disable",
        tags: ["MFA"],
        summary: "Disable MFA",
        description:
          "Disable MFA on the account. Requires a valid TOTP token to confirm the action.",
        protect: true,
      },
    })
    .input(verifyTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify MFA is currently enabled
      const settings = await getMfaSettings(userId);
      if (!settings || !settings.isEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "MFA is not currently enabled.",
        });
      }

      // Verify the token before disabling
      const secret = decryptSecret(settings.secret);
      const isValid = verifyTOTP(secret, input.token);

      if (!isValid) {
        logger.warn({ userId }, "MFA disable attempt failed - invalid token");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid verification code. MFA was not disabled.",
        });
      }

      await disableMfa(userId);

      logger.info({ userId }, "MFA disabled by user");

      return {
        success: true,
        message: "MFA has been disabled.",
      };
    }),

  /**
   * Verify TOTP during login flow
   * This is a public procedure since the user is not yet fully authenticated
   */
  verifyLogin: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/mfa/verify-login",
        tags: ["MFA"],
        summary: "Verify MFA during login",
        description:
          "Verify a TOTP token during the login flow. Called after successful password authentication when MFA is enabled.",
      },
    })
    .input(verifyLoginSchema)
    .mutation(async ({ input }) => {
      const { userId, token } = input;

      // Verify MFA is enabled
      const settings = await getMfaSettings(userId);
      if (!settings || !settings.isEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "MFA is not enabled for this account.",
        });
      }

      // Decrypt and verify
      const secret = decryptSecret(settings.secret);
      const isValid = verifyTOTP(secret, token);

      if (!isValid) {
        logger.warn({ userId }, "MFA login verification failed");
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid verification code.",
        });
      }

      // Update last used timestamp
      await updateLastUsed(userId);

      logger.info({ userId }, "MFA login verification successful");

      return {
        success: true,
        verified: true,
      };
    }),

  /**
   * Use a backup code during login
   * Consumes the backup code (one-time use)
   */
  useBackupCode: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/mfa/backup-code",
        tags: ["MFA"],
        summary: "Verify with backup code",
        description:
          "Use a backup code to authenticate when the authenticator app is unavailable. Each backup code can only be used once.",
      },
    })
    .input(backupCodeSchema)
    .mutation(async ({ input }) => {
      const { userId, code } = input;

      // Verify MFA is enabled
      const settings = await getMfaSettings(userId);
      if (!settings || !settings.isEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "MFA is not enabled for this account.",
        });
      }

      // Parse stored hashed backup codes
      let hashedCodes: string[];
      try {
        hashedCodes = JSON.parse(settings.backupCodes);
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to read backup codes.",
        });
      }

      // Verify and consume the backup code
      const result = verifyBackupCode(code, hashedCodes);

      if (!result.valid) {
        logger.warn({ userId }, "Invalid backup code attempt");
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid backup code.",
        });
      }

      // Update stored backup codes (remove the used one)
      await updateBackupCodes(userId, result.remainingCodes);
      await updateLastUsed(userId);

      const remainingCount = result.remainingCodes.length;

      logger.info(
        { userId, remainingBackupCodes: remainingCount },
        "Backup code used successfully"
      );

      return {
        success: true,
        verified: true,
        remainingCodes: remainingCount,
      };
    }),

  /**
   * Regenerate backup codes
   * Requires authentication and a valid TOTP token
   */
  regenerateBackupCodes: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/mfa/regenerate-backup-codes",
        tags: ["MFA"],
        summary: "Regenerate backup codes",
        description:
          "Generate a new set of backup codes. Invalidates all previous backup codes. Requires a valid TOTP token for security.",
        protect: true,
      },
    })
    .input(verifyTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify MFA is enabled
      const settings = await getMfaSettings(userId);
      if (!settings || !settings.isEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "MFA is not enabled.",
        });
      }

      // Verify the TOTP token
      const secret = decryptSecret(settings.secret);
      const isValid = verifyTOTP(secret, input.token);

      if (!isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid verification code.",
        });
      }

      // Generate new backup codes
      const newCodes = generateBackupCodes();
      const hashedCodes = newCodes.map(hashBackupCode);

      // Store hashed codes
      await updateBackupCodes(userId, hashedCodes);

      logger.info({ userId }, "Backup codes regenerated");

      return {
        backupCodes: newCodes,
      };
    }),

  /**
   * Get MFA status for the current user
   */
  getStatus: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/mfa/status",
        tags: ["MFA"],
        summary: "Get MFA status",
        description:
          "Check whether MFA is enabled for the current user and retrieve metadata like when it was enabled and last used.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      const userId = ctx.user.id;

      const settings = await getMfaSettings(userId);

      if (!settings) {
        return {
          enabled: false,
          enabledAt: null,
          lastUsedAt: null,
          backupCodesRemaining: 0,
        };
      }

      let backupCodesRemaining = 0;
      try {
        const codes = JSON.parse(settings.backupCodes);
        backupCodesRemaining = Array.isArray(codes) ? codes.length : 0;
      } catch {
        backupCodesRemaining = 0;
      }

      return {
        enabled: settings.isEnabled,
        enabledAt: settings.enabledAt,
        lastUsedAt: settings.lastUsedAt,
        backupCodesRemaining,
      };
    }),
});

export type MfaRouter = typeof mfaRouter;
