/**
 * Auth Router - JWT Token Management
 *
 * Provides endpoints for:
 * - Login (username/password -> access + refresh tokens)
 * - Token refresh (refresh token -> new access token + rotated refresh token)
 * - Logout (revoke refresh token)
 * - Logout all devices (revoke all refresh tokens for user)
 * - Get active sessions
 *
 * @version 1.0.0
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { mobileAuthServiceV2 } from "../services/mobile-auth-v2.service";
import { getDb } from "../db";
import { logger } from "../_core/logger";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
// bcrypt will be used when password authentication is fully implemented
// import bcrypt from "bcryptjs";

// ============================================================================
// Input Schemas
// ============================================================================

const loginInputSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
  deviceInfo: z
    .object({
      userAgent: z.string().optional(),
      deviceId: z.string().optional(),
      platform: z.string().optional(),
      appVersion: z.string().optional(),
    })
    .optional(),
});

const refreshTokenInputSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
  deviceInfo: z
    .object({
      userAgent: z.string().optional(),
      deviceId: z.string().optional(),
    })
    .optional(),
});

const logoutInputSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Authenticate user with email and password
 */
async function authenticateWithPassword(
  email: string,
  password: string
): Promise<{
  id: number;
  name: string | null;
  email: string | null;
  role: string;
  openId: string;
} | null> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Find user by email
  const user = await db.query.users.findFirst({
    where: (t, { eq }) => eq(t.email, email),
  });

  if (!user) {
    return null;
  }

  // For demo purposes - in production you'd have a password hash stored
  // and compare with bcrypt.compare(password, user.passwordHash)
  // Here we're doing a simple check for development/testing

  // TODO: Add passwordHash column to users table and implement proper password verification
  // const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  // if (!isValidPassword) return null;

  // For now, we'll accept any password for existing users (REMOVE IN PRODUCTION)
  if (process.env.NODE_ENV === "production") {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Password authentication not fully configured",
    });
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    openId: user.openId,
  };
}

// ============================================================================
// Router
// ============================================================================

export const authRouter = router({
  /**
   * Get current authenticated user
   * Works with both cookie and JWT bearer token auth
   */
  me: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/auth/me",
        tags: ["Authentication"],
        summary: "Get current user",
        description:
          "Returns the currently authenticated user's profile information. Works with both JWT bearer tokens and session cookies.",
      },
    })
    .output(
      z
        .object({
          id: z.number(),
          name: z.string().nullable(),
          email: z.string().nullable(),
          role: z.string(),
        })
        .nullable()
    )
    .query(({ ctx }) => ctx.user),

  /**
   * Logout - clear session cookie (for web clients)
   */
  logoutCookie: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/logout-cookie",
        tags: ["Authentication"],
        summary: "Logout (cookie-based)",
        description:
          "Clears the session cookie for web clients. Use this endpoint when the user is authenticated via cookies.",
      },
    })
    .output(z.object({ success: z.literal(true) }))
    .mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

  /**
   * Login with email and password
   * Returns access token and refresh token
   */
  login: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/login",
        tags: ["Authentication"],
        summary: "Login with credentials",
        description:
          "Authenticate with email and password. Returns JWT access token and refresh token for subsequent API calls. The refresh token can be used to obtain new access tokens.",
      },
    })
    .input(loginInputSchema)
    .output(
      z.object({
        accessToken: z.string(),
        refreshToken: z.string(),
        expiresIn: z.number(),
        tokenType: z.literal("Bearer"),
        user: z.object({
          id: z.number(),
          name: z.string().nullable(),
          email: z.string().nullable(),
          role: z.string(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { email, password, deviceInfo } = input;

      // Authenticate user
      const user = await authenticateWithPassword(email, password);

      if (!user) {
        logger.warn({ email }, "Failed login attempt - invalid credentials");
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }

      // Get IP address from request
      const ipAddress =
        (ctx.req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
        ctx.req.socket.remoteAddress ||
        undefined;

      // Generate tokens
      const tokens = await mobileAuthServiceV2.login(user.id, {
        userAgent: deviceInfo?.userAgent || ctx.req.headers["user-agent"],
        ipAddress,
        deviceId: deviceInfo?.deviceId,
      });

      logger.info(
        { userId: user.id, email: user.email },
        "User logged in successfully"
      );

      return {
        ...tokens,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      };
    }),

  /**
   * Refresh access token using refresh token
   * Implements token rotation for security
   */
  refreshToken: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/refresh",
        tags: ["Authentication"],
        summary: "Refresh access token",
        description:
          "Exchange a valid refresh token for a new access token. Implements token rotation - the old refresh token is invalidated and a new one is returned for enhanced security.",
      },
    })
    .input(refreshTokenInputSchema)
    .output(
      z.object({
        accessToken: z.string(),
        refreshToken: z.string(),
        expiresIn: z.number(),
        tokenType: z.literal("Bearer"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { refreshToken, deviceInfo } = input;

      try {
        // Get IP address from request
        const ipAddress =
          (ctx.req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
          ctx.req.socket.remoteAddress ||
          undefined;

        // Refresh tokens (implements rotation)
        const result = await mobileAuthServiceV2.refreshTokens(refreshToken, {
          userAgent: deviceInfo?.userAgent || ctx.req.headers["user-agent"],
          ipAddress,
          deviceId: deviceInfo?.deviceId,
        });

        logger.info("Token refreshed successfully");

        return {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          tokenType: "Bearer" as const,
        };
      } catch (error: any) {
        logger.warn({ error: error.message }, "Token refresh failed");

        // Map service errors to TRPC errors
        if (error.code === "UNAUTHORIZED") {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: error.message || "Invalid or expired refresh token",
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to refresh token",
        });
      }
    }),

  /**
   * Logout - revoke the current refresh token
   */
  logout: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/logout",
        tags: ["Authentication"],
        summary: "Logout (token-based)",
        description:
          "Revoke the specified refresh token. Use this endpoint when the user wants to logout from a specific device/session. The refresh token will no longer be valid for obtaining new access tokens.",
      },
    })
    .input(logoutInputSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input }) => {
      const { refreshToken } = input;

      try {
        await mobileAuthServiceV2.logout(refreshToken);
        logger.info("User logged out successfully");

        return { success: true };
      } catch (error: any) {
        // Even if logout fails, we don't want to expose errors
        logger.warn({ error: error.message }, "Logout error (ignored)");
        return { success: true };
      }
    }),

  /**
   * Logout from all devices - revoke all refresh tokens
   * Requires authentication
   */
  logoutAllDevices: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/logout-all",
        tags: ["Authentication"],
        summary: "Logout from all devices",
        description:
          "Revoke all refresh tokens for the authenticated user, effectively logging them out from all devices and sessions. Requires authentication.",
        protect: true,
      },
    })
    .output(z.object({ success: z.boolean(), revokedCount: z.number() }))
    .mutation(async ({ ctx }) => {
      const userId = ctx.user.id;

      try {
        const revokedCount = await mobileAuthServiceV2.logoutAllDevices(userId);

        logger.info(
          { userId, revokedCount },
          "User logged out from all devices"
        );

        return {
          success: true,
          revokedCount,
        };
      } catch (error: any) {
        logger.error(
          { userId, error: error.message },
          "Logout all devices failed"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to logout from all devices",
        });
      }
    }),

  /**
   * Get active sessions for the current user
   * Useful for account security page
   */
  getActiveSessions: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/auth/sessions",
        tags: ["Authentication"],
        summary: "Get active sessions",
        description:
          "Retrieve a list of all active sessions for the authenticated user. Includes device information, IP address, and session creation time. Useful for account security monitoring.",
        protect: true,
      },
    })
    .output(
      z.array(
        z.object({
          id: z.number(),
          deviceInfo: z.object({
            userAgent: z.string(),
            deviceId: z.string().optional(),
            platform: z.string().optional(),
          }),
          ipAddress: z.string(),
          createdAt: z.date(),
          expiresAt: z.date(),
        })
      )
    )
    .query(async ({ ctx }) => {
      const userId = ctx.user.id;

      try {
        const sessions = await mobileAuthServiceV2.getActiveSessions(userId);

        // Parse device info and format for display
        return sessions.map(session => {
          let deviceInfo: {
            userAgent?: string;
            deviceId?: string;
            platform?: string;
          } = {};

          if (session.deviceInfo) {
            try {
              deviceInfo = JSON.parse(session.deviceInfo);
            } catch {
              // Ignore parse errors
            }
          }

          return {
            id: session.id,
            deviceInfo: {
              userAgent: deviceInfo.userAgent || "Unknown device",
              deviceId: deviceInfo.deviceId,
              platform: deviceInfo.platform,
            },
            ipAddress: session.ipAddress || "Unknown",
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
          };
        });
      } catch (error: any) {
        logger.error({ userId, error: error.message }, "Get sessions failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get active sessions",
        });
      }
    }),

  /**
   * Revoke a specific session (by session ID)
   * Requires authentication
   */
  revokeSession: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/auth/sessions/{sessionId}",
        tags: ["Authentication"],
        summary: "Revoke a specific session",
        description:
          "Revoke a specific session by its ID. This allows users to remotely logout from individual devices. The session must belong to the authenticated user.",
        protect: true,
      },
    })
    .input(z.object({ sessionId: z.number().describe("Session ID to revoke") }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { sessionId } = input;

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      }

      // Import refreshTokens from schema
      const { refreshTokens } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");

      // Verify the session belongs to the user and revoke it
      const result = await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(refreshTokens.id, sessionId), eq(refreshTokens.userId, userId))
        );

      const affected =
        (result as any).rowsAffected || (result as any)[0]?.affectedRows || 0;

      if (affected === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found or already revoked",
        });
      }

      logger.info({ userId, sessionId }, "Session revoked");

      return { success: true };
    }),

  /**
   * Verify access token (for debugging/validation)
   * Returns the decoded token payload if valid
   */
  verifyToken: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/auth/verify",
        tags: ["Authentication"],
        summary: "Verify access token",
        description:
          "Verify an access token and return its decoded payload. Useful for debugging and validating tokens. Returns validation status and token details if valid.",
      },
    })
    .input(
      z.object({
        accessToken: z.string().describe("JWT access token to verify"),
      })
    )
    .output(
      z.union([
        z.object({
          valid: z.literal(true),
          payload: z.object({
            userId: z.number(),
            email: z.string().optional(),
            role: z.string(),
            issuedAt: z.string(),
            expiresAt: z.string(),
          }),
        }),
        z.object({
          valid: z.literal(false),
          error: z.string(),
        }),
      ])
    )
    .query(async ({ input }) => {
      const { accessToken } = input;

      try {
        const payload = mobileAuthServiceV2.verifyAccessToken(accessToken);

        return {
          valid: true,
          payload: {
            userId: payload.userId,
            email: payload.email,
            role: payload.role,
            issuedAt: new Date(payload.iat * 1000).toISOString(),
            expiresAt: new Date(payload.exp * 1000).toISOString(),
          },
        };
      } catch (error: any) {
        return {
          valid: false,
          error: error.message || "Token verification failed",
        };
      }
    }),
});

export type AuthRouter = typeof authRouter;
