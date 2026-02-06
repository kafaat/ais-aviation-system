/**
 * Idempotency V2 Service - Production-Grade
 *
 * Features:
 * - DB-based (Source of Truth) - works even if Redis is down
 * - Request hash validation (detects payload changes)
 * - Response caching
 * - Proper error handling
 * - TTL-based cleanup
 *
 * @version 2.0.0
 * @date 2026-01-26
 */

import crypto from "crypto";
import { getDb } from "../db";
import { idempotencyRequests } from "../../drizzle/schema";
import { eq, and, lt, isNull } from "drizzle-orm";
import { AppError, ErrorCode } from "../_core/errors";

/**
 * Custom error for idempotency conflicts
 */
export class IdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyError";
  }
}

/**
 * Idempotency scopes for different operations
 */
export enum IdempotencyScope {
  BOOKING_CREATE = "booking.create",
  BOOKING_CANCEL = "booking.cancel",
  BOOKING_MODIFY = "booking.modify",
  PAYMENT_INTENT = "payment.intent",
  PAYMENT_CAPTURE = "payment.capture",
  REFUND_CREATE = "refund.create",
  WEBHOOK_STRIPE = "webhook.stripe",
  LOYALTY_AWARD = "loyalty.award",
  LOYALTY_REDEEM = "loyalty.redeem",
}

/**
 * Idempotency options
 */
export interface IdempotencyOptions<T> {
  /** Scope of the operation */
  scope: IdempotencyScope;
  /** Unique idempotency key */
  key: string;
  /** User ID (null for webhooks/system operations) */
  userId: number | null;
  /** Request payload for hash calculation */
  request: unknown;
  /** TTL in seconds (default: 3600 = 1 hour) */
  ttlSeconds?: number;
  /** Function to execute */
  run: () => Promise<T>;
}

/**
 * Calculate SHA256 hash of request payload
 */
function calculateRequestHash(request: unknown): string {
  if (request == null || typeof request !== "object") {
    return crypto
      .createHash("sha256")
      .update(String(request ?? ""))
      .digest("hex");
  }
  const normalized = JSON.stringify(
    request,
    Object.keys(request as object).sort()
  );
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Production-Grade Idempotency Wrapper
 *
 * Ensures that the same operation with the same idempotency key
 * is only executed once, even under concurrent requests.
 *
 * @example
 * ```typescript
 * const booking = await withIdempotency({
 *   scope: IdempotencyScope.BOOKING_CREATE,
 *   key: input.idempotencyKey,
 *   userId: input.userId,
 *   request: input,
 *   run: async () => {
 *     // Your booking creation logic
 *     return await createBookingInternal(input);
 *   },
 * });
 * ```
 */
export async function withIdempotency<T>(
  opts: IdempotencyOptions<T>
): Promise<T> {
  const db = await getDb();
  if (!db) {
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, "Database not available");
  }

  // 1. Calculate request hash
  const requestHash = calculateRequestHash(opts.request);
  const expiresAt = new Date(Date.now() + (opts.ttlSeconds ?? 3600) * 1000);

  // 2. Check for existing idempotency record first
  //    (MySQL unique indexes treat NULL as distinct, so we must SELECT first)
  const existingResults = await db
    .select()
    .from(idempotencyRequests)
    .where(
      and(
        eq(idempotencyRequests.scope, opts.scope),
        eq(idempotencyRequests.idempotencyKey, opts.key),
        opts.userId !== null
          ? eq(idempotencyRequests.userId, opts.userId)
          : isNull(idempotencyRequests.userId)
      )
    )
    .limit(1);

  const existing = existingResults[0];

  if (existing) {
    // Payload mismatch protection
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyError(
        "Idempotency key reused with different payload"
      );
    }

    // Return cached response if completed
    if (existing.status === "COMPLETED" && existing.responseJson) {
      try {
        return JSON.parse(existing.responseJson) as T;
      } catch {
        // If JSON parse fails, re-execute below
      }
    }

    // Operation in progress
    if (existing.status === "STARTED") {
      if (existing.expiresAt && existing.expiresAt < new Date()) {
        // Stale - allow retry
        await db
          .update(idempotencyRequests)
          .set({ status: "STARTED", expiresAt, updatedAt: new Date() })
          .where(eq(idempotencyRequests.id, existing.id));
      } else {
        throw new AppError(
          ErrorCode.IDEMPOTENCY_IN_PROGRESS,
          "Operation already in progress",
          { scope: opts.scope, key: opts.key }
        );
      }
    }

    // Failed - allow retry
    if (existing.status === "FAILED") {
      await db
        .update(idempotencyRequests)
        .set({
          status: "STARTED",
          errorMessage: null,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyRequests.id, existing.id));
    }
  } else {
    // 3. Insert new idempotency record
    await db.insert(idempotencyRequests).values({
      scope: opts.scope,
      idempotencyKey: opts.key,
      userId: opts.userId,
      requestHash,
      status: "STARTED",
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // 3. Execute operation
  try {
    const result = await opts.run();

    // 4. Store result
    await db
      .update(idempotencyRequests)
      .set({
        status: "COMPLETED",
        responseJson: JSON.stringify(result),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(idempotencyRequests.scope, opts.scope),
          eq(idempotencyRequests.idempotencyKey, opts.key),
          opts.userId !== null
            ? eq(idempotencyRequests.userId, opts.userId)
            : isNull(idempotencyRequests.userId)
        )
      );

    console.log(
      `[Idempotency] Operation completed for ${opts.scope}:${opts.key}`
    );
    return result;
  } catch (err: any) {
    // 5. Store error
    const errorMessage = err.message || "Unknown error";
    await db
      .update(idempotencyRequests)
      .set({
        status: "FAILED",
        errorMessage,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(idempotencyRequests.scope, opts.scope),
          eq(idempotencyRequests.idempotencyKey, opts.key),
          opts.userId !== null
            ? eq(idempotencyRequests.userId, opts.userId)
            : isNull(idempotencyRequests.userId)
        )
      );

    console.error(
      `[Idempotency] Operation failed for ${opts.scope}:${opts.key}:`,
      errorMessage
    );
    throw err;
  }
}

/**
 * Cleanup expired idempotency records
 * Should be run as a cron job (e.g., every hour)
 *
 * @returns Number of deleted records
 */
export async function cleanupExpiredIdempotencyRecords(): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[Idempotency] Database not available for cleanup");
    return 0;
  }

  const now = new Date();

  try {
    const result = await db
      .delete(idempotencyRequests)
      .where(lt(idempotencyRequests.expiresAt, now));

    const deletedCount = (result as any).rowsAffected || 0;
    console.log(`[Idempotency] Cleaned up ${deletedCount} expired records`);
    return deletedCount;
  } catch (err) {
    console.error("[Idempotency] Cleanup failed:", err);
    return 0;
  }
}

/**
 * Get idempotency record by key (for debugging/monitoring)
 */
export async function getIdempotencyRecord(
  scope: IdempotencyScope,
  key: string,
  userId: number | null
) {
  const db = await getDb();
  if (!db) {
    return null;
  }

  const results = await db
    .select()
    .from(idempotencyRequests)
    .where(
      and(
        eq(idempotencyRequests.scope, scope),
        eq(idempotencyRequests.idempotencyKey, key),
        userId !== null
          ? eq(idempotencyRequests.userId, userId)
          : isNull(idempotencyRequests.userId)
      )
    )
    .limit(1);

  return results[0] || null;
}

export default {
  withIdempotency,
  cleanupExpiredIdempotencyRecords,
  getIdempotencyRecord,
  IdempotencyScope,
};
