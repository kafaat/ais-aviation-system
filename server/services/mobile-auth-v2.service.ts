/**
 * Mobile Auth V2 Service - Production-Grade
 * 
 * Features:
 * - JWT_SECRET is required (fail fast)
 * - Refresh tokens are hashed (SHA256 + pepper)
 * - Token rotation on refresh
 * - Proper cleanup of expired tokens
 * - Rate limiting support
 * 
 * @version 2.0.0
 * @date 2026-01-26
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import { getDb } from "../db";
import { refreshTokens, users } from "../../drizzle/schema";
import { eq, and, lt, isNull } from "drizzle-orm";
import { AppError, ErrorCode } from "../_core/errors";

// ============================================================================
// CONFIGURATION - Fail Fast
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_TOKEN_PEPPER = process.env.REFRESH_TOKEN_PEPPER || "";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_EXPIRES_DAYS = parseInt(
  process.env.REFRESH_TOKEN_EXPIRES_DAYS || "30"
);

// Fail fast if JWT_SECRET is missing in production
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET environment variable is required in production");
}

// Warn if REFRESH_TOKEN_PEPPER is missing
if (!REFRESH_TOKEN_PEPPER && process.env.NODE_ENV === "production") {
  console.warn(
    "[Auth] REFRESH_TOKEN_PEPPER is not set. Using empty pepper (not recommended for production)"
  );
}

// ============================================================================
// TYPES
// ============================================================================

export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Hash refresh token for secure storage
 * Uses SHA256 with pepper for added security
 */
function hashRefreshToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(token + REFRESH_TOKEN_PEPPER)
    .digest("hex");
}

/**
 * Generate a cryptographically secure random token
 */
function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Calculate expiration date for refresh token
 */
function calculateRefreshTokenExpiry(): Date {
  return new Date(
    Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000
  );
}

// ============================================================================
// SERVICE
// ============================================================================

export const mobileAuthServiceV2 = {
  /**
   * Generate access token (JWT)
   */
  generateAccessToken(user: {
    id: number;
    email: string | null;
    role: string;
  }): string {
    if (!JWT_SECRET) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "JWT_SECRET is not configured"
      );
    }

    const payload = {
      userId: user.id,
      email: user.email || "",
      role: user.role,
    };

    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
  },

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): JwtPayload {
    if (!JWT_SECRET) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "JWT_SECRET is not configured"
      );
    }

    try {
      return jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (err: any) {
      if (err.name === "TokenExpiredError") {
        throw new AppError(ErrorCode.UNAUTHORIZED, "Access token expired");
      }
      if (err.name === "JsonWebTokenError") {
        throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid access token");
      }
      throw new AppError(ErrorCode.UNAUTHORIZED, "Token verification failed");
    }
  },

  /**
   * Create refresh token and store hash in database
   * 
   * @returns Plain text refresh token (to be sent to client)
   */
  async createRefreshToken(
    userId: number,
    deviceInfo?: {
      userAgent?: string;
      ipAddress?: string;
      deviceId?: string;
    }
  ): Promise<string> {
    const db = await getDb();
    if (!db) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, "Database not available");
    }

    // Generate secure random token
    const token = generateSecureToken();
    const tokenHash = hashRefreshToken(token);
    const expiresAt = calculateRefreshTokenExpiry();

    // Store hash in database (never store plain token!)
    await db.insert(refreshTokens).values({
      userId,
      tokenHash,
      expiresAt,
      userAgent: deviceInfo?.userAgent || null,
      ipAddress: deviceInfo?.ipAddress || null,
      deviceId: deviceInfo?.deviceId || null,
      createdAt: new Date(),
    });

    console.log(`[Auth] Created refresh token for user ${userId}`);
    return token; // Return plain token to client
  },

  /**
   * Verify refresh token and return user info
   * 
   * @returns User ID if valid, null if invalid
   */
  async verifyRefreshToken(
    token: string
  ): Promise<{ userId: number; tokenId: number } | null> {
    const db = await getDb();
    if (!db) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, "Database not available");
    }

    const tokenHash = hashRefreshToken(token);

    const record = await db.query.refreshTokens.findFirst({
      where: (t, { and, eq, gt, isNull }) =>
        and(
          eq(t.tokenHash, tokenHash),
          gt(t.expiresAt, new Date()),
          isNull(t.revokedAt)
        ),
    });

    if (!record) {
      return null;
    }

    return { userId: record.userId, tokenId: record.id };
  },

  /**
   * Refresh tokens (rotate refresh token for security)
   * 
   * This implements token rotation:
   * 1. Verify old refresh token
   * 2. Revoke old refresh token
   * 3. Create new refresh token
   * 4. Generate new access token
   */
  async refreshTokens(
    refreshToken: string,
    deviceInfo?: {
      userAgent?: string;
      ipAddress?: string;
      deviceId?: string;
    }
  ): Promise<RefreshResult> {
    const db = await getDb();
    if (!db) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, "Database not available");
    }

    // 1. Verify refresh token
    const verified = await this.verifyRefreshToken(refreshToken);
    if (!verified) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid or expired refresh token");
    }

    // 2. Get user
    const user = await db.query.users.findFirst({
      where: (t, { eq }) => eq(t.id, verified.userId),
    });

    if (!user) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "User not found");
    }

    // 3. Revoke old refresh token (token rotation)
    await db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
      })
      .where(eq(refreshTokens.id, verified.tokenId));

    // 4. Create new refresh token
    const newRefreshToken = await this.createRefreshToken(
      user.id,
      deviceInfo
    );

    // 5. Generate new access token
    const accessToken = this.generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    console.log(`[Auth] Refreshed tokens for user ${user.id}`);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  },

  /**
   * Login and generate tokens
   */
  async login(
    userId: number,
    deviceInfo?: {
      userAgent?: string;
      ipAddress?: string;
      deviceId?: string;
    }
  ): Promise<AuthTokens> {
    const db = await getDb();
    if (!db) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, "Database not available");
    }

    // Get user
    const user = await db.query.users.findFirst({
      where: (t, { eq }) => eq(t.id, userId),
    });

    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, "User not found");
    }

    // Generate tokens
    const accessToken = this.generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const refreshToken = await this.createRefreshToken(user.id, deviceInfo);

    // Update last signed in
    await db
      .update(users)
      .set({
        lastSignedIn: new Date(),
      })
      .where(eq(users.id, userId));

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
      tokenType: "Bearer",
    };
  },

  /**
   * Logout - revoke refresh token
   */
  async logout(refreshToken: string): Promise<void> {
    const db = await getDb();
    if (!db) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, "Database not available");
    }

    const tokenHash = hashRefreshToken(refreshToken);

    await db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
      })
      .where(eq(refreshTokens.tokenHash, tokenHash));

    console.log(`[Auth] Logged out (revoked refresh token)`);
  },

  /**
   * Logout from all devices - revoke all refresh tokens for user
   */
  async logoutAllDevices(userId: number): Promise<number> {
    const db = await getDb();
    if (!db) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, "Database not available");
    }

    const result = await db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
      })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt)
        )
      );

    const revokedCount = (result as any).rowsAffected || 0;
    console.log(`[Auth] Revoked ${revokedCount} tokens for user ${userId}`);
    return revokedCount;
  },

  /**
   * Cleanup expired and revoked tokens
   * Should be run as a cron job
   */
  async cleanupExpiredTokens(): Promise<number> {
    const db = await getDb();
    if (!db) {
      console.warn("[Auth] Database not available for cleanup");
      return 0;
    }

    const now = new Date();

    try {
      // Delete expired tokens
      const result = await db
        .delete(refreshTokens)
        .where(lt(refreshTokens.expiresAt, now));

      const deletedCount = (result as any).rowsAffected || 0;
      console.log(`[Auth] Cleaned up ${deletedCount} expired tokens`);
      return deletedCount;
    } catch (err) {
      console.error("[Auth] Cleanup failed:", err);
      return 0;
    }
  },

  /**
   * Get active sessions for user (for account security page)
   */
  async getActiveSessions(userId: number) {
    const db = await getDb();
    if (!db) {
      return [];
    }

    const sessions = await db.query.refreshTokens.findMany({
      where: (t, { and, eq, gt, isNull }) =>
        and(
          eq(t.userId, userId),
          gt(t.expiresAt, new Date()),
          isNull(t.revokedAt)
        ),
      columns: {
        id: true,
        userAgent: true,
        ipAddress: true,
        deviceId: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: (t, { desc }) => desc(t.createdAt),
    });

    return sessions;
  },
};

export default mobileAuthServiceV2;
