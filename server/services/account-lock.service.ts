import { eq, and, gte, desc, lt } from "drizzle-orm";
import { getDb, getUserByEmail, getUserByOpenId } from "../db";
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
import { TRPCError } from "@trpc/server";
import { createServiceLogger } from "./logger.service";

/**
 * Account Lock Service
 * Handles account security, failed login tracking, and automatic account locking
 */

const logger = createServiceLogger("account-lock");

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
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

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
    logger.info(
      {
        email: data.email,
        openId: data.openId,
        ip: data.ipAddress,
      },
      "Successful login attempt"
    );
  } else {
    logger.warn(
      {
        email: data.email,
        openId: data.openId,
        ip: data.ipAddress,
        reason: data.failureReason,
      },
      "Failed login attempt"
    );
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
    // Get user ID from email or openId
    let user;
    if (email) {
      user = await getUserByEmail(email);
    } else if (openId) {
      user = await getUserByOpenId(openId);
    }

    if (!user) {
      logger.warn(
        {
          email,
          openId,
          attempts: failedAttempts.length,
        },
        "Cannot lock account: user not found"
      );
      return;
    }

    // Check if account is already locked
    const existingLocks = await db
      .select()
      .from(accountLocks)
      .where(
        and(eq(accountLocks.userId, user.id), eq(accountLocks.isActive, true))
      );

    if (existingLocks.length > 0) {
      logger.info(
        {
          userId: user.id,
          email,
          openId,
        },
        "Account already locked"
      );
      return;
    }

    // Lock the account
    await lockAccount(
      user.id,
      `Account locked after ${failedAttempts.length} failed login attempts`,
      "system",
      LOCKOUT_DURATION_MINUTES
    );

    logger.error(
      {
        userId: user.id,
        email,
        openId,
        attempts: failedAttempts.length,
        ipAddress,
      },
      "Account locked due to multiple failed login attempts"
    );

    // Create security event
    await recordSecurityEvent({
      eventType: "account_locked",
      severity: "high",
      userId: user.id,
      ipAddress,
      description: `Account locked after ${failedAttempts.length} failed login attempts`,
      metadata: JSON.stringify({
        email,
        openId,
        attempts: failedAttempts.length,
      }),
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
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

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

  logger.error({ userId, reason, lockedBy, autoUnlockAt }, "Account locked");
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
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

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

  logger.info({ userId, unlockedBy }, "Account unlocked");
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
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

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
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

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

  logger.error(
    {
      ipAddress,
      reason,
      blockedBy,
      autoUnblockAt,
    },
    "IP address blocked"
  );
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
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

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

  logger.info(
    {
      ipAddress,
      unblockedBy,
    },
    "IP address unblocked"
  );
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
): Promise<number> {
  const db = await getDb();
  if (!db) {
    logger.warn("Cannot cleanup login attempts: database not available");
    return 0;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, cutoffDate));

  const deletedCount = (result as any).rowsAffected || 0;

  logger.info(
    {
      daysToKeep,
      cutoffDate: cutoffDate.toISOString(),
      deletedCount,
    },
    "Cleaned up old login attempts"
  );

  return deletedCount;
}
