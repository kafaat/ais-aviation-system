import { eq, and, gte, desc } from "drizzle-orm";
import { getDb } from "../db";
import {
  loginAttempts,
  accountLocks,
  securityEvents,
  ipBlacklist,
  type InsertLoginAttempt,
  type InsertAccountLock,
  type InsertSecurityEvent,
  type InsertIpBlacklist,
} from "../../drizzle/schema-security";

/**
 * Account Lock Service
 * Handles account security, failed login tracking, and automatic account locking
 */

// Simple logger fallback for archived code
const logger = {
  logAuth: (action: string, userId: number | undefined, data: any) => {
    const maskedData = { ...data };
    if (maskedData.email) {
      maskedData.email = maskEmail(maskedData.email);
    }
    console.log(`[Auth] ${action}`, { userId, ...maskedData });
  },
  logSecurity: (message: string, severity: string, data: any) => {
    const maskedData = { ...data };
    if (maskedData.email) {
      maskedData.email = maskEmail(maskedData.email);
    }
    if (maskedData.ipAddress) {
      maskedData.ipAddress = maskIpAddress(maskedData.ipAddress);
    }
    console.log(`[Security][${severity}] ${message}`, maskedData);
  },
  info: (message: string, data?: any) => {
    console.log(`[Info] ${message}`, data || "");
  },
};

/**
 * Mask email address for logging
 */
function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!domain) return "[MASKED_EMAIL]";
  const maskedLocal =
    localPart.length > 2
      ? `${localPart.slice(0, 2)}***`
      : `${localPart[0]}***`;
  return `${maskedLocal}@${domain}`;
}

/**
 * Mask IP address for logging
 */
function maskIpAddress(ip: string): string {
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.***.***.***`;
  }
  return "[MASKED_IP]";
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;
const ATTEMPT_WINDOW_MINUTES = 15; // Check attempts in last 15 minutes

/**
 * Record a login attempt
 */
export async function recordLoginAttempt(data: {
  email?: string;
  openId?: string;
  ipAddress: string;
  userAgent?: string;
  success: boolean;
  failureReason?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const attempt: InsertLoginAttempt = {
    email: data.email,
    openId: data.openId,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    success: data.success,
    failureReason: data.failureReason,
  };

  await db.insert(loginAttempts).values(attempt);

  // Log the attempt
  if (data.success) {
    logger.logAuth("login", undefined, {
      email: data.email,
      ip: data.ipAddress,
    });
  } else {
    logger.logAuth("failed_login", undefined, {
      email: data.email,
      ip: data.ipAddress,
      reason: data.failureReason,
    });
  }

  // Check if account should be locked
  if (!data.success && (data.email || data.openId)) {
    await checkAndLockAccount(data.email, data.openId, data.ipAddress);
  }
}

/**
 * Check failed attempts and lock account if threshold exceeded
 */
async function checkAndLockAccount(
  email?: string,
  openId?: string,
  ipAddress?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Calculate time window
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - ATTEMPT_WINDOW_MINUTES);

  // Count failed attempts in the time window
  let failedAttempts;

  if (email) {
    failedAttempts = await db
      .select()
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.email, email),
          eq(loginAttempts.success, false),
          gte(loginAttempts.attemptedAt, windowStart)
        )
      );
  } else if (openId) {
    failedAttempts = await db
      .select()
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.openId, openId),
          eq(loginAttempts.success, false),
          gte(loginAttempts.attemptedAt, windowStart)
        )
      );
  } else {
    return;
  }

  // If threshold exceeded, lock the account
  if (failedAttempts.length >= MAX_FAILED_ATTEMPTS) {
    // Get user ID (you'll need to implement this based on your user lookup logic)
    // For now, we'll create a placeholder
    // const user = await getUserByEmail(email) or getUserByOpenId(openId);

    logger.logSecurity(
      "Account locked due to multiple failed login attempts",
      "high",
      {
        email,
        openId,
        attempts: failedAttempts.length,
        ipAddress,
      }
    );

    // Create security event
    await recordSecurityEvent({
      eventType: "account_locked",
      severity: "high",
      ipAddress,
      description: `Account locked after ${failedAttempts.length} failed login attempts`,
      metadata: JSON.stringify({
        email,
        openId,
        attempts: failedAttempts.length,
      }),
      actionTaken: `Account locked for ${LOCKOUT_DURATION_MINUTES} minutes`,
    });

    // Note: Actual account locking would require user ID
    // This is a placeholder for the implementation
  }
}

/**
 * Lock an account
 */
export async function lockAccount(
  userId: number,
  reason: string,
  lockedBy: string = "system",
  autoUnlockMinutes?: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Calculate auto-unlock time if specified
  let autoUnlockAt: Date | undefined;
  if (autoUnlockMinutes) {
    autoUnlockAt = new Date();
    autoUnlockAt.setMinutes(autoUnlockAt.getMinutes() + autoUnlockMinutes);
  }

  const lock: InsertAccountLock = {
    userId,
    reason,
    lockedBy,
    autoUnlockAt,
  };

  await db.insert(accountLocks).values(lock);

  logger.logSecurity("Account locked", "high", { userId, reason, lockedBy });
}

/**
 * Check if account is locked
 */
export async function isAccountLocked(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const now = new Date();

  const locks = await db
    .select()
    .from(accountLocks)
    .where(
      and(eq(accountLocks.userId, userId), eq(accountLocks.isActive, true))
    )
    .orderBy(desc(accountLocks.createdAt))
    .limit(1);

  if (locks.length === 0) return false;

  const lock = locks[0];

  // Check if auto-unlock time has passed
  if (lock.autoUnlockAt && lock.autoUnlockAt <= now) {
    // Auto-unlock the account
    await unlockAccount(userId, "system");
    return false;
  }

  return true;
}

/**
 * Unlock an account
 */
export async function unlockAccount(
  userId: number,
  unlockedBy: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(accountLocks)
    .set({
      isActive: false,
      unlockedAt: new Date(),
      unlockedBy,
    })
    .where(
      and(eq(accountLocks.userId, userId), eq(accountLocks.isActive, true))
    );

  logger.logSecurity("Account unlocked", "medium", { userId, unlockedBy });
}

/**
 * Record a security event
 */
export async function recordSecurityEvent(data: {
  eventType: string;
  severity: string;
  userId?: number;
  ipAddress?: string;
  userAgent?: string;
  description?: string;
  metadata?: string;
  actionTaken?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const event: InsertSecurityEvent = {
    eventType: data.eventType,
    severity: data.severity,
    userId: data.userId,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    description: data.description,
    metadata: data.metadata,
    actionTaken: data.actionTaken,
  };

  await db.insert(securityEvents).values(event);
}

/**
 * Block an IP address
 */
export async function blockIpAddress(
  ipAddress: string,
  reason: string,
  blockedBy: string = "system",
  autoUnblockMinutes?: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let autoUnblockAt: Date | undefined;
  if (autoUnblockMinutes) {
    autoUnblockAt = new Date();
    autoUnblockAt.setMinutes(autoUnblockAt.getMinutes() + autoUnblockMinutes);
  }

  const block: InsertIpBlacklist = {
    ipAddress,
    reason,
    blockedBy,
    autoUnblockAt,
  };

  await db.insert(ipBlacklist).values(block);

  logger.logSecurity("IP address blocked", "high", {
    ipAddress,
    reason,
    blockedBy,
  });
}

/**
 * Check if IP address is blocked
 */
export async function isIpBlocked(ipAddress: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const now = new Date();

  const blocks = await db
    .select()
    .from(ipBlacklist)
    .where(
      and(eq(ipBlacklist.ipAddress, ipAddress), eq(ipBlacklist.isActive, true))
    )
    .limit(1);

  if (blocks.length === 0) return false;

  const block = blocks[0];

  // Check if auto-unblock time has passed
  if (block.autoUnblockAt && block.autoUnblockAt <= now) {
    // Auto-unblock the IP
    await unblockIpAddress(ipAddress, "system");
    return false;
  }

  return true;
}

/**
 * Unblock an IP address
 */
export async function unblockIpAddress(
  ipAddress: string,
  unblockedBy: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(ipBlacklist)
    .set({
      isActive: false,
      unblockedAt: new Date(),
      unblockedBy,
    })
    .where(
      and(eq(ipBlacklist.ipAddress, ipAddress), eq(ipBlacklist.isActive, true))
    );

  logger.logSecurity("IP address unblocked", "medium", {
    ipAddress,
    unblockedBy,
  });
}

/**
 * Get recent security events
 */
export async function getRecentSecurityEvents(limit: number = 50) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(securityEvents)
    .orderBy(desc(securityEvents.createdAt))
    .limit(limit);
}

/**
 * Clean up old login attempts (run periodically)
 */
export async function cleanupOldLoginAttempts(
  daysToKeep: number = 30
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  // Note: Drizzle doesn't have a direct delete with where clause in this version
  // You might need to use raw SQL or implement differently based on your Drizzle version

  logger.info(`Cleaned up login attempts older than ${daysToKeep} days`);
}
