/**
 * Shared Auth Types
 *
 * Types used for JWT token-based authentication across client and server.
 */

/**
 * Response from login endpoint
 */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
  tokenType: "Bearer";
  user: {
    id: number;
    name: string | null;
    email: string | null;
    role: string;
  };
}

/**
 * Response from refresh token endpoint
 */
export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
  tokenType: "Bearer";
}

/**
 * JWT access token payload
 */
export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
  iat: number; // issued at (timestamp)
  exp: number; // expires at (timestamp)
}

/**
 * Device info sent with authentication requests
 */
export interface DeviceInfo {
  userAgent?: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
}

/**
 * Active session info
 */
export interface ActiveSession {
  id: number;
  deviceInfo: {
    userAgent: string;
    deviceId?: string;
    platform?: string;
  };
  ipAddress: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Token verification result
 */
export interface TokenVerificationResult {
  valid: boolean;
  payload?: {
    userId: number;
    email: string;
    role: string;
    issuedAt: string;
    expiresAt: string;
  };
  error?: string;
}

/**
 * Auth error codes
 */
export enum AuthErrorCode {
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  TOKEN_INVALID = "TOKEN_INVALID",
  REFRESH_TOKEN_EXPIRED = "REFRESH_TOKEN_EXPIRED",
  REFRESH_TOKEN_REVOKED = "REFRESH_TOKEN_REVOKED",
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
}

/**
 * Token storage keys for client-side storage
 */
export const AUTH_STORAGE_KEYS = {
  ACCESS_TOKEN: "ais_access_token",
  REFRESH_TOKEN: "ais_refresh_token",
  TOKEN_EXPIRES_AT: "ais_token_expires_at",
  USER: "ais_user",
} as const;

/**
 * Token timing constants (in milliseconds)
 */
export const TOKEN_TIMING = {
  // Refresh token 5 minutes before expiry
  REFRESH_BUFFER_MS: 5 * 60 * 1000,
  // Access token lifetime (15 minutes)
  ACCESS_TOKEN_LIFETIME_MS: 15 * 60 * 1000,
  // Refresh token lifetime (30 days)
  REFRESH_TOKEN_LIFETIME_MS: 30 * 24 * 60 * 60 * 1000,
} as const;
