import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { refreshTokens, users, type InsertRefreshToken } from "../../drizzle/schema";
import { eq, and, gt } from "drizzle-orm";
import { logger } from "../_core/logger";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const ACCESS_TOKEN_EXPIRY = "15m"; // 15 minutes
const REFRESH_TOKEN_EXPIRY = "7d"; // 7 days

export interface TokenPayload {
  userId: number;
  email: string;
  role: string;
  type: "access" | "refresh";
}

export interface MobileLoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  user: {
    id: number;
    name: string | null;
    email: string | null;
    role: string;
  };
}

/**
 * Generate JWT token
 */
function generateToken(
  userId: number,
  email: string,
  role: string,
  type: "access" | "refresh",
  expiresIn: string
): string {
  const payload: TokenPayload = {
    userId,
    email,
    role,
    type,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: "ais-aviation",
    audience: "ais-mobile",
  });
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): TokenPayload {
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: "ais-aviation",
      audience: "ais-mobile",
    }) as TokenPayload;

    return payload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Token expired",
      });
    }

    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid token",
    });
  }
}

/**
 * Mobile login - returns access and refresh tokens
 */
export async function mobileLogin(
  email: string,
  password: string,
  deviceInfo?: {
    deviceType?: string;
    os?: string;
    appVersion?: string;
  },
  ipAddress?: string
): Promise<MobileLoginResponse> {
  // Authenticate user (implement your authentication logic)
  const user = await authenticateUser(email, password);

  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid credentials",
    });
  }

  // Generate tokens
  const accessToken = generateToken(
    user.id,
    user.email!,
    user.role,
    "access",
    ACCESS_TOKEN_EXPIRY
  );

  const refreshToken = generateToken(
    user.id,
    user.email!,
    user.role,
    "refresh",
    REFRESH_TOKEN_EXPIRY
  );

  // Store refresh token in database
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  const refreshTokenData: InsertRefreshToken = {
    userId: user.id,
    token: refreshToken,
    deviceInfo: deviceInfo ? JSON.stringify(deviceInfo) : undefined,
    ipAddress,
    expiresAt,
  };

  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database connection not available",
    });
  }
  
  await database.insert(refreshTokens).values(refreshTokenData);

  logger.info("Mobile login successful", {
    userId: user.id,
    email: user.email,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 minutes in seconds
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshTokenString: string
): Promise<{ accessToken: string; expiresIn: number }> {
  // Verify refresh token
  const payload = verifyToken(refreshTokenString);

  if (payload.type !== "refresh") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid token type",
    });
  }

  // Check if refresh token exists and is valid in database
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database connection not available",
    });
  }
  
  const tokenRecord = await database
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.token, refreshTokenString),
        eq(refreshTokens.userId, payload.userId),
        gt(refreshTokens.expiresAt, new Date())
      )
    )
    .limit(1);

  if (tokenRecord.length === 0) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid or expired refresh token",
    });
  }

  // Check if token is revoked
  if (tokenRecord[0].revokedAt) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Refresh token has been revoked",
    });
  }

  // Update last used timestamp
  await database
    .update(refreshTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(refreshTokens.token, refreshTokenString));

  // Generate new access token
  const accessToken = generateToken(
    payload.userId,
    payload.email,
    payload.role,
    "access",
    ACCESS_TOKEN_EXPIRY
  );

  logger.info("Access token refreshed", {
    userId: payload.userId,
  });

  return {
    accessToken,
    expiresIn: 900, // 15 minutes
  };
}

/**
 * Revoke refresh token (logout)
 */
export async function revokeRefreshToken(
  refreshTokenString: string
): Promise<void> {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database connection not available",
    });
  }
  
  await database
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.token, refreshTokenString));

  logger.info("Refresh token revoked");
}

/**
 * Revoke all refresh tokens for a user (logout from all devices)
 */
export async function revokeAllUserTokens(userId: number): Promise<void> {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database connection not available",
    });
  }
  
  await database
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.userId, userId));

  logger.info("All refresh tokens revoked for user", { userId });
}

/**
 * Clean up expired refresh tokens (run as cron job)
 */
export async function cleanupExpiredTokens(): Promise<void> {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database connection not available",
    });
  }
  
  const result = await database
    .delete(refreshTokens)
    .where(gt(new Date(), refreshTokens.expiresAt));

  logger.info("Expired refresh tokens cleaned up", {
    deletedCount: result.rowsAffected,
  });
}

/**
 * Authenticate user (placeholder - implement your logic)
 */
async function authenticateUser(
  email: string,
  password: string
): Promise<{
  id: number;
  name: string | null;
  email: string | null;
  role: string;
} | null> {
  // TODO: Implement actual authentication logic
  // This should:
  // 1. Find user by email
  // 2. Verify password (bcrypt.compare)
  // 3. Return user if valid, null otherwise

  // Placeholder implementation
  const database = await getDb();
  if (!database) {
    return null;
  }
  
  const result = await database
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user = result[0];
  
  if (!user) {
    return null;
  }

  // TODO: Verify password
  // const isValid = await bcrypt.compare(password, user.passwordHash);
  // if (!isValid) return null;

  return user;
}

/**
 * Authenticate request (supports both Cookie and Bearer token)
 */
export async function authenticateRequest(
  authHeader?: string,
  cookieToken?: string
): Promise<TokenPayload> {
  // Try Bearer token first
  let token: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "No authentication token provided",
    });
  }

  // Verify token
  const payload = verifyToken(token);

  if (payload.type !== "access") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid token type",
    });
  }

  return payload;
}
