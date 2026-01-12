import { eq, and, gte, desc, lte } from "drizzle-orm";
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
} from "../../drizzle/schema";
import { logAuth, logSecurity, logger } from "../_core/logger";

/**
 * Account Lock Service
 * Handles account security, failed login tracking, and automatic account locking
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;
const ATTEMPT_WINDOW_MINUTES = 15; // Check attempts in last 15 minutes

/**
 * Record a login attempt
 */
export async function recordLoginAttempt(data: {
  email?: string;
  openId?: string;
  userId?: number;
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
    logAuth("login", data.userId, { email: data.email, ip: data.ipAddress });
  } else {
    logAuth("failed_login", data.userId, {
      email: data.email,
      ip: data.ipAddress,
      reason: data.failureReason,
    });
  }

  // Check if account should be locked
  if (!data.success) {
    if (data.userId) {
      await checkAndLockAccount(data.userId, data.email, data.openId, data.ipAddress);
    } else {
      // For failed attempts without userId (e.g., invalid email), check IP-based rate limiting
      await checkAndBlockIp(data.ipAddress, data.email, data.openId);
    }
  }
}

/**
 * Check IP-based failed attempts and block if threshold exceeded
 */
async function checkAndBlockIp(
  ipAddress: string,
  email?: string,
  openId?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Calculate time window
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - ATTEMPT_WINDOW_MINUTES);

  // Count all failed attempts from this IP in the time window
  const failedAttempts = await db
    .select()
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ipAddress, ipAddress),
        eq(loginAttempts.success, false),
        gte(loginAttempts.attemptedAt, windowStart)
      )
    );

  // If threshold exceeded, block the IP
  if (failedAttempts.length >= MAX_FAILED_ATTEMPTS) {
    logSecurity(
      "IP blocked due to multiple failed login attempts",
      "high",
      {
        ipAddress,
        email,
        openId,
        attempts: failedAttempts.length,
      }
    );

    // Block the IP
    await blockIpAddress(
      ipAddress,
      `Automatic block after ${failedAttempts.length} failed login attempts`,
      "system",
      LOCKOUT_DURATION_MINUTES
    );

    // Create security event
    await recordSecurityEvent({
      eventType: "ip_blocked",
      severity: "high",
      ipAddress,
      description: `IP blocked after ${failedAttempts.length} failed login attempts`,
      metadata: JSON.stringify({ email, openId, attempts: failedAttempts.length }),
      actionTaken: `IP blocked for ${LOCKOUT_DURATION_MINUTES} minutes`,
    });
  }
}

/**
 * Check failed attempts and lock account if threshold exceeded
 */
async function checkAndLockAccount(
  userId: number,
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
    logSecurity(
      "Account locked due to multiple failed login attempts",
      "high",
      {
        userId,
        email,
        openId,
        attempts: failedAttempts.length,
        ipAddress,
      }
    );

    // Lock the account
    await lockAccount(
      userId,
      `Automatic lock after ${failedAttempts.length} failed login attempts`,
      "system",
      LOCKOUT_DURATION_MINUTES
    );

    // Create security event
    await recordSecurityEvent({
      eventType: "account_locked",
      severity: "high",
      userId,
      ipAddress,
      description: `Account locked after ${failedAttempts.length} failed login attempts`,
      metadata: JSON.stringify({ email, openId, attempts: failedAttempts.length }),
      actionTaken: `Account locked for ${LOCKOUT_DURATION_MINUTES} minutes`,
    });
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

  logSecurity("Account locked", "high", { userId, reason, lockedBy });
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
      and(
        eq(accountLocks.userId, userId),
        eq(accountLocks.isActive, true)
      )
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
export async function unlockAccount(userId: number, unlockedBy: string): Promise<void> {
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
      and(
        eq(accountLocks.userId, userId),
        eq(accountLocks.isActive, true)
      )
    );

  logSecurity("Account unlocked", "medium", { userId, unlockedBy });
}

/**
 * Get active lock for a user
 */
export async function getAccountLock(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const locks = await db
    .select()
    .from(accountLocks)
    .where(
      and(
        eq(accountLocks.userId, userId),
        eq(accountLocks.isActive, true)
      )
    )
    .orderBy(desc(accountLocks.createdAt))
    .limit(1);

  return locks.length > 0 ? locks[0] : null;
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

  logSecurity("IP address blocked", "high", { ipAddress, reason, blockedBy });
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
      and(
        eq(ipBlacklist.ipAddress, ipAddress),
        eq(ipBlacklist.isActive, true)
      )
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
export async function unblockIpAddress(ipAddress: string, unblockedBy: string): Promise<void> {
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
      and(
        eq(ipBlacklist.ipAddress, ipAddress),
        eq(ipBlacklist.isActive, true)
      )
    );

  logSecurity("IP address unblocked", "medium", { ipAddress, unblockedBy });
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
 * Get all locked accounts
 */
export async function getLockedAccounts() {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(accountLocks)
    .where(eq(accountLocks.isActive, true))
    .orderBy(desc(accountLocks.createdAt));
}

/**
 * Get all blocked IPs
 */
export async function getBlockedIps() {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(ipBlacklist)
    .where(eq(ipBlacklist.isActive, true))
    .orderBy(desc(ipBlacklist.createdAt));
}

/**
 * Clean up expired locks and blocks (run periodically)
 */
export async function cleanupExpiredLocks(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();

  // Auto-unlock expired account locks
  const expiredLocks = await db
    .select()
    .from(accountLocks)
    .where(
      and(
        eq(accountLocks.isActive, true),
        lte(accountLocks.autoUnlockAt!, now)
      )
    );

  for (const lock of expiredLocks) {
    await unlockAccount(lock.userId, "system");
  }

  // Auto-unblock expired IP blocks
  const expiredBlocks = await db
    .select()
    .from(ipBlacklist)
    .where(
      and(
        eq(ipBlacklist.isActive, true),
        lte(ipBlacklist.autoUnblockAt!, now)
      )
    );

  for (const block of expiredBlocks) {
    await unblockIpAddress(block.ipAddress, "system");
  }

  logger.info(`Cleaned up ${expiredLocks.length} expired locks and ${expiredBlocks.length} expired IP blocks`);
}
