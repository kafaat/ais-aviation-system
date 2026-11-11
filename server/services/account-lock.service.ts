import { eq, and, gte, desc, lt, lte, gt, isNull, or, sql } from "drizzle-orm";
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

    // Expired rows are reusable even if no access check has cleared isActive yet.
    const existingLocks = await db
      .select()
      .from(accountLocks)
      .where(
        and(
          eq(accountLocks.userId, user.id),
          eq(accountLocks.isActive, true),
          or(
            isNull(accountLocks.autoUnlockAt),
            gt(accountLocks.autoUnlockAt, new Date())
          )
        )
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

  if (
    autoUnlockMinutes !== undefined &&
    (!Number.isFinite(autoUnlockMinutes) || autoUnlockMinutes <= 0)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Auto-unlock duration must be a positive number of minutes",
    });
  }

  const now = new Date();
  const autoUnlockAt =
    autoUnlockMinutes === undefined
      ? null
      : new Date(now.getTime() + autoUnlockMinutes * 60_000);

  const lock: InsertAccountLock = {
    userId,
    reason,
    lockedBy,
    autoUnlockAt,
    isActive: true,
    unlockedAt: null,
    unlockedBy: null,
    createdAt: now,
    updatedAt: now,
  };

  // userId is unique. Reuse the retained row atomically, and never let a stale
  // shorter request replace a stronger active lock. A permanent lock can only
  // be cleared by an explicit unlock, including when the request is automatic.
  const incomingDeadline = sql.param(autoUnlockAt, accountLocks.autoUnlockAt);
  const replace = sql`(
    ${accountLocks.isActive} = false
    or (${accountLocks.autoUnlockAt} is not null and (
      ${accountLocks.autoUnlockAt} <= ${sql.param(now, accountLocks.autoUnlockAt)}
      or ${incomingDeadline} is null
      or ${accountLocks.autoUnlockAt} < ${incomingDeadline}
    ))
  )`;

  await db
    .insert(accountLocks)
    .values(lock)
    .onDuplicateKeyUpdate({
      // MySQL evaluates assignments in order. Drizzle serializes in schema
      // column order, so schema.ts also keeps autoUnlockAt and isActive last.
      // This preserves the original predicate for every metadata assignment.
      set: {
        reason: sql`if(${replace}, ${reason}, ${accountLocks.reason})`,
        lockedBy: sql`if(${replace}, ${lockedBy}, ${accountLocks.lockedBy})`,
        unlockedAt: sql`if(${replace}, null, ${accountLocks.unlockedAt})`,
        unlockedBy: sql`if(${replace}, null, ${accountLocks.unlockedBy})`,
        createdAt: sql`if(${replace}, ${sql.param(now, accountLocks.createdAt)}, ${accountLocks.createdAt})`,
        updatedAt: sql`if(${replace}, ${sql.param(now, accountLocks.updatedAt)}, ${accountLocks.updatedAt})`,
        autoUnlockAt: sql`if(${replace}, ${incomingDeadline}, ${accountLocks.autoUnlockAt})`,
        isActive: true,
      },
    });

  logger.error(
    { userId, reason, lockedBy, autoUnlockAt },
    "Account lock requested; stronger active locks retained"
  );
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
    // Do not clear a renewal that committed after this read. The deadline is
    // part of the compare-and-set, and the follow-up read observes a renewal.
    await db
      .update(accountLocks)
      .set({ isActive: false, unlockedAt: now, unlockedBy: "system" })
      .where(
        and(
          eq(accountLocks.userId, userId),
          eq(accountLocks.isActive, true),
          eq(accountLocks.autoUnlockAt, lock.autoUnlockAt),
          lte(accountLocks.autoUnlockAt, now)
        )
      );
    const [current] = await db
      .select()
      .from(accountLocks)
      .where(
        and(eq(accountLocks.userId, userId), eq(accountLocks.isActive, true))
      )
      .limit(1);
    const stillLocked = Boolean(
      current && (!current.autoUnlockAt || current.autoUnlockAt > new Date())
    );
    if (!stillLocked) {
      logger.info({ userId, unlockedBy: "system" }, "Account lock expired");
    }
    return stillLocked;
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

  if (
    autoUnblockMinutes !== undefined &&
    (!Number.isFinite(autoUnblockMinutes) || autoUnblockMinutes <= 0)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Auto-unblock duration must be positive",
    });
  }
  const now = new Date();
  const autoUnblockAt =
    autoUnblockMinutes === undefined
      ? null
      : new Date(now.getTime() + autoUnblockMinutes * 60_000);
  const block: InsertIpBlacklist = {
    ipAddress,
    reason,
    blockedBy,
    autoUnblockAt,
    isActive: true,
    unblockedAt: null,
    unblockedBy: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction(async tx => {
    // The unique IP key serializes even concurrent first insertions. A no-op
    // upsert acquires the row without weakening an existing block.
    await tx
      .insert(ipBlacklist)
      .values(block)
      .onDuplicateKeyUpdate({
        set: { ipAddress: sql`${ipBlacklist.ipAddress}` },
      });
    const [current] = await tx
      .select()
      .from(ipBlacklist)
      .where(eq(ipBlacklist.ipAddress, ipAddress))
      .for("update");
    if (!current) throw new Error("IP block row missing");
    const replace =
      !current.isActive ||
      (current.autoUnblockAt !== null &&
        (current.autoUnblockAt <= now ||
          autoUnblockAt === null ||
          current.autoUnblockAt < autoUnblockAt));
    if (replace) {
      await tx
        .update(ipBlacklist)
        .set(block)
        .where(eq(ipBlacklist.id, current.id));
    }
  });

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
    // Expiry is a read predicate. Do not clear a row based on this stale
    // snapshot: a concurrent administrator may already have extended it.
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

  const deletedCount = result[0].affectedRows;

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
