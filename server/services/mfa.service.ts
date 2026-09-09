/**
 * MFA (Multi-Factor Authentication) Service - TOTP Implementation
 *
 * Provides TOTP-based two-factor authentication using the HMAC-SHA1 algorithm
 * as defined in RFC 6238 (TOTP) and RFC 4226 (HOTP).
 *
 * Features:
 * - TOTP secret generation (base32 encoded, 20 bytes)
 * - QR code URI generation (otpauth:// protocol)
 * - TOTP token verification with +/-1 step tolerance
 * - Backup code generation, hashing, and verification
 *
 * @version 1.0.0
 */

import crypto from "crypto";
import { sql, eq, and, gt, isNull } from "drizzle-orm";
import {
  mfaChallenges,
  mfaSettings,
  refreshTokens,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { createServiceLogger } from "../_core/logger";

const log = createServiceLogger("mfa-service");

// ============================================================================
// Constants
// ============================================================================

const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const SECRET_BYTES = 20;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;
const ISSUER = "AIS Aviation";

// Base32 alphabet (RFC 4648)
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Encryption key for storing secrets (derive from JWT_SECRET)
const ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(
    process.env.JWT_SECRET ||
      (() => {
        throw new Error("JWT_SECRET is required for MFA encryption");
      })()
  )
  .digest();

// ============================================================================
// Types
// ============================================================================

export interface MfaSettings {
  id: number;
  userId: number;
  secret: string; // encrypted
  isEnabled: boolean;
  backupCodes: string; // JSON array of hashed codes
  enabledAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Base32 Encoding / Decoding
// ============================================================================

/**
 * Encode a Buffer to base32 string (RFC 4648)
 */
function base32Encode(buffer: Buffer): string {
  let result = "";
  let bits = 0;
  let value = 0;

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

/**
 * Decode a base32 string to Buffer (RFC 4648)
 */
function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/[=\s]/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid base32 character: ${cleaned[i]}`,
      });
    }
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

// ============================================================================
// Encryption / Decryption for Secret Storage
// ============================================================================

/**
 * Encrypt a TOTP secret for database storage using AES-256-GCM
 */
function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(secret, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a stored TOTP secret
 */
function decryptSecret(encryptedData: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Invalid encrypted secret format",
    });
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// ============================================================================
// TOTP Algorithm (RFC 6238 / RFC 4226)
// ============================================================================

/**
 * Generate HMAC-based One-Time Password (HOTP) per RFC 4226
 *
 * @param secret - The shared secret key (raw bytes)
 * @param counter - The counter value (8-byte big-endian)
 * @param digits - Number of digits in the OTP (default: 6)
 * @returns The OTP string, zero-padded to the specified number of digits
 */
function generateHOTP(
  secret: Buffer,
  counter: bigint,
  digits: number = TOTP_DIGITS
): string {
  // Step 1: Generate counter bytes (8-byte big-endian)
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  // Step 2: Compute HMAC-SHA1
  const hmac = crypto.createHmac("sha1", secret);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  // Step 3: Dynamic Truncation (DT)
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  // Step 4: Compute OTP value
  const otp = binary % Math.pow(10, digits);

  // Zero-pad to the required number of digits
  return otp.toString().padStart(digits, "0");
}

/**
 * Generate a TOTP value for the current time (or a given time)
 *
 * @param secret - Base32-encoded secret
 * @param timeStep - Time step offset (0 = current, -1 = previous, +1 = next)
 * @returns The TOTP string
 */
function generateTOTP(secret: string, timeStep: number = 0): string {
  const secretBuffer = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000);
  const counter = BigInt(Math.floor(now / TOTP_PERIOD) + timeStep);

  return generateHOTP(secretBuffer, counter);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a new TOTP secret (base32 encoded, 20 random bytes)
 */
export function generateSecret(): string {
  const buffer = crypto.randomBytes(SECRET_BYTES);
  return base32Encode(buffer);
}

/**
 * Generate an otpauth:// URI for QR code scanning
 *
 * Format: otpauth://totp/{issuer}:{email}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30
 *
 * @param email - User's email address (used as account name)
 * @param secret - Base32-encoded TOTP secret
 * @returns The otpauth URI
 */
export function generateQRCodeURL(email: string, secret: string): string {
  const encodedIssuer = encodeURIComponent(ISSUER);
  const encodedEmail = encodeURIComponent(email);

  return (
    `otpauth://totp/${encodedIssuer}:${encodedEmail}` +
    `?secret=${secret}` +
    `&issuer=${encodedIssuer}` +
    `&algorithm=SHA1` +
    `&digits=${TOTP_DIGITS}` +
    `&period=${TOTP_PERIOD}`
  );
}

/**
 * Verify a TOTP token against a secret with +/-1 step tolerance
 *
 * This checks the current time step and the adjacent steps to account
 * for clock drift between the server and the authenticator app.
 *
 * @param secret - Base32-encoded TOTP secret
 * @param token - The 6-digit token to verify
 * @returns true if the token is valid for any of the 3 time windows
 */
export function verifyTOTP(secret: string, token: string): boolean {
  return matchingTotpStep(secret, token) !== null;
}

function matchingTotpStep(secret: string, token: string): number | null {
  if (!token || token.length !== TOTP_DIGITS || !/^\d+$/.test(token)) {
    return null;
  }

  // Check current step and +/- 1 step for clock drift tolerance
  for (let step = -1; step <= 1; step++) {
    const expectedToken = generateTOTP(secret, step);
    if (
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
    ) {
      return Math.floor(Date.now() / 1000 / TOTP_PERIOD) + step;
    }
  }

  return null;
}

/**
 * Generate a set of random backup codes
 *
 * @returns Array of 10 random 8-character alphanumeric codes
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  const charset = "abcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    let code = "";
    const randomBytes = crypto.randomBytes(BACKUP_CODE_LENGTH);
    for (let j = 0; j < BACKUP_CODE_LENGTH; j++) {
      code += charset[randomBytes[j] % charset.length];
    }
    codes.push(code);
  }

  return codes;
}

/**
 * Hash a backup code using SHA-256 for secure storage
 *
 * @param code - The plaintext backup code
 * @returns The SHA-256 hex digest
 */
export function hashBackupCode(code: string): string {
  return crypto
    .createHash("sha256")
    .update(code.toLowerCase().trim())
    .digest("hex");
}

/**
 * Verify a backup code against an array of hashed codes.
 * If valid, returns the updated array with the used code removed (consumed).
 *
 * @param code - The plaintext backup code to verify
 * @param hashedCodes - Array of SHA-256 hashed backup codes
 * @returns Object with `valid` boolean and `remainingCodes` (hashed codes with used one removed)
 */
export function verifyBackupCode(
  code: string,
  hashedCodes: string[]
): { valid: boolean; remainingCodes: string[] } {
  const hashed = hashBackupCode(code);
  const index = hashedCodes.findIndex(stored =>
    crypto.timingSafeEqual(
      Buffer.from(stored, "hex"),
      Buffer.from(hashed, "hex")
    )
  );

  if (index === -1) {
    return { valid: false, remainingCodes: hashedCodes };
  }

  // Remove the used code (consume it)
  const remainingCodes = [...hashedCodes];
  remainingCodes.splice(index, 1);

  return { valid: true, remainingCodes };
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Get MFA settings for a user
 */
export async function getMfaSettings(
  userId: number
): Promise<MfaSettings | null> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const results = await db.execute(
    sql`SELECT id, userId, secret, isEnabled, backupCodes, enabledAt, lastUsedAt, createdAt, updatedAt
     FROM mfa_settings WHERE userId = ${userId} LIMIT 1`
  );

  const rows = (results as any)[0] as any[];
  if (!rows || rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    userId: row.userId,
    secret: row.secret,
    isEnabled: Boolean(row.isEnabled),
    backupCodes: row.backupCodes || "[]",
    enabledAt: row.enabledAt ? new Date(row.enabledAt) : null,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

/**
 * Create or update MFA settings for a user (setup phase - not yet enabled)
 */
export async function upsertMfaSetup(
  userId: number,
  encryptedSecret: string,
  hashedBackupCodes: string[]
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  await db.transaction(async tx => {
    await tx.select().from(users).where(eq(users.id, userId)).for("update");
    const [existing] = await tx
      .select()
      .from(mfaSettings)
      .where(eq(mfaSettings.userId, userId))
      .for("update");
    if (existing?.isEnabled)
      throw new TRPCError({
        code: "CONFLICT",
        message: "MFA is already enabled",
      });
    const values = {
      secret: encryptedSecret,
      backupCodes: JSON.stringify(hashedBackupCodes),
      isEnabled: false,
      enabledAt: null,
      lastUsedStep: null,
    };
    if (existing)
      await tx
        .update(mfaSettings)
        .set(values)
        .where(eq(mfaSettings.id, existing.id));
    else await tx.insert(mfaSettings).values({ userId, ...values });
  });
}

/** Changing MFA invalidates all previously issued sessions and challenges. */
async function changeMfa(
  userId: number,
  expectedSecret: string,
  enabled: boolean
): Promise<void> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable",
    });
  await db.transaction(async tx => {
    await tx.select().from(users).where(eq(users.id, userId)).for("update");
    const [settings] = await tx
      .select()
      .from(mfaSettings)
      .where(eq(mfaSettings.userId, userId))
      .for("update");
    if (!settings || settings.secret !== expectedSecret)
      throw new TRPCError({
        code: "CONFLICT",
        message: "MFA setup changed; retry verification",
      });
    if (enabled)
      await tx
        .update(mfaSettings)
        .set({ isEnabled: true, enabledAt: new Date() })
        .where(eq(mfaSettings.id, settings.id));
    else await tx.delete(mfaSettings).where(eq(mfaSettings.id, settings.id));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, userId));
    await tx
      .update(mfaChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(mfaChallenges.userId, userId));
  });
  log.info({ userId, enabled }, "MFA changed; sessions revoked");
}
export const enableMfa = (userId: number, expectedSecret: string) =>
  changeMfa(userId, expectedSecret, true);
export const disableMfa = (userId: number, expectedSecret: string) =>
  changeMfa(userId, expectedSecret, false);

/**
 * Update last used timestamp for MFA
 */
export async function updateLastUsed(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const now = new Date();
  await db.execute(
    sql`UPDATE mfa_settings SET lastUsedAt = ${now}, updatedAt = ${now} WHERE userId = ${userId}`
  );
}

/**
 * Update backup codes for a user
 */
export async function updateBackupCodes(
  userId: number,
  hashedCodes: string[]
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const now = new Date();
  const codesJson = JSON.stringify(hashedCodes);
  await db.execute(
    sql`UPDATE mfa_settings SET backupCodes = ${codesJson}, updatedAt = ${now} WHERE userId = ${userId}`
  );
}

/**
 * Get the decrypted TOTP secret for a user
 */
export async function getDecryptedSecret(
  userId: number
): Promise<string | null> {
  const settings = await getMfaSettings(userId);
  if (!settings) {
    return null;
  }

  try {
    return decryptSecret(settings.secret);
  } catch (error) {
    log.error({ userId, error }, "Failed to decrypt MFA secret");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to decrypt MFA secret",
    });
  }
}

/**
 * Check if MFA is enabled for a user
 */
export async function isMfaEnabled(userId: number): Promise<boolean> {
  const settings = await getMfaSettings(userId);
  return settings?.isEnabled ?? false;
}

// Re-export encryption function for use by the router
export { encryptSecret, decryptSecret };

/** Created only after password or OAuth identity verification; grants no API access. */
export async function createMfaChallenge(userId: number): Promise<string> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable",
    });
  const token = crypto.randomBytes(32).toString("hex");
  await db.insert(mfaChallenges).values({
    userId,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return token;
}

/** Consume both the login challenge and factor under locks, with a five-attempt budget. */
export type MfaProof = { userId: number; secret: string };

export async function completeMfaChallenge(
  challengeToken: string,
  code: string
): Promise<MfaProof> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable",
    });
  const tokenHash = crypto
    .createHash("sha256")
    .update(challengeToken)
    .digest("hex");
  const result = await db.transaction(async tx => {
    const [challenge] = await tx
      .select()
      .from(mfaChallenges)
      .where(
        and(
          eq(mfaChallenges.tokenHash, tokenHash),
          gt(mfaChallenges.expiresAt, new Date()),
          isNull(mfaChallenges.consumedAt)
        )
      )
      .limit(1)
      .for("update");
    if (!challenge || challenge.attempts >= 5) return null;
    const [settings] = await tx
      .select()
      .from(mfaSettings)
      .where(eq(mfaSettings.userId, challenge.userId))
      .limit(1)
      .for("update");
    let factorUpdate: { lastUsedStep?: number; backupCodes?: string } | null =
      null;
    if (settings?.isEnabled) {
      if (/^\d{6}$/.test(code)) {
        const step = matchingTotpStep(decryptSecret(settings.secret), code);
        if (
          step !== null &&
          (settings.lastUsedStep == null || step > settings.lastUsedStep)
        )
          factorUpdate = { lastUsedStep: step };
      } else if (/^[a-z0-9]{8}$/i.test(code)) {
        const backup = verifyBackupCode(code, JSON.parse(settings.backupCodes));
        if (backup.valid)
          factorUpdate = { backupCodes: JSON.stringify(backup.remainingCodes) };
      }
    }
    const attempts = challenge.attempts + 1;
    await tx
      .update(mfaChallenges)
      .set({
        attempts,
        consumedAt: factorUpdate || attempts >= 5 ? new Date() : null,
      })
      .where(eq(mfaChallenges.id, challenge.id));
    if (!factorUpdate || !settings) return null;
    await tx
      .update(mfaSettings)
      .set({ ...factorUpdate, lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(mfaSettings.id, settings.id));
    return { userId: challenge.userId, secret: settings.secret };
  });
  // Throw after committing the failed-attempt counter.
  if (result === null)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid, expired or already used MFA challenge/code",
    });
  return result;
}
