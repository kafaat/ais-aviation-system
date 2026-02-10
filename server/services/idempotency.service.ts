import crypto from "crypto";
import { getDb } from "../db";
import {
  idempotencyRequests,
  type InsertIdempotencyRequest,
} from "../../drizzle/schema";
import { eq, and, lt } from "drizzle-orm";
import { logger } from "../_core/logger";
import { Errors } from "../_core/errors";

/**
 * Idempotency scopes for different operations
 */
export enum IdempotencyScope {
  BOOKING_CREATE = "booking.create",
  BOOKING_CANCEL = "booking.cancel",
  PAYMENT_INTENT = "payment.intent",
  REFUND_REQUEST = "refund.request",
  WEBHOOK_STRIPE = "webhook.stripe",
}

/**
 * Idempotency status
 */
export type IdempotencyStatus = "STARTED" | "COMPLETED" | "FAILED";

/**
 * Calculate request hash from payload
 */
function calculateRequestHash(payload: unknown): string {
  const payloadString = JSON.stringify(payload);
  return crypto.createHash("sha256").update(payloadString).digest("hex");
}

/**
 * Check if idempotency key exists
 * Returns existing request if found
 */
export async function checkIdempotency(
  scope: IdempotencyScope,
  idempotencyKey: string,
  userId?: number,
  requestPayload?: unknown
): Promise<{
  exists: boolean;
  status?: IdempotencyStatus;
  response?: unknown;
  error?: string;
}> {
  // Build query conditions
  const conditions = [
    eq(idempotencyRequests.scope, scope),
    eq(idempotencyRequests.idempotencyKey, idempotencyKey),
  ];

  if (userId !== undefined) {
    conditions.push(eq(idempotencyRequests.userId, userId));
  }

  // Find existing request
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const existing = await database
    .select()
    .from(idempotencyRequests)
    .where(and(...conditions))
    .limit(1);

  if (existing.length === 0) {
    return { exists: false };
  }

  const record = existing[0];

  // Check if payload matches (if provided)
  if (requestPayload) {
    const requestHash = calculateRequestHash(requestPayload);
    if (record.requestHash !== requestHash) {
      // Same key, different payload = conflict
      logger.warn(
        {
          scope,
          idempotencyKey,
          userId,
        },
        "Idempotency key reused with different payload"
      );
      Errors.idempotencyConflict();
    }
  }

  // Return existing request
  return {
    exists: true,
    status: record.status as IdempotencyStatus,
    response: record.responseJson ? JSON.parse(record.responseJson) : undefined,
    error: record.errorMessage || undefined,
  };
}

/**
 * Create idempotency record
 * Returns false if already exists (race condition)
 */
export async function createIdempotencyRecord(
  scope: IdempotencyScope,
  idempotencyKey: string,
  requestPayload: unknown,
  userId?: number,
  ttlSeconds: number = 86400 // 24 hours default
): Promise<boolean> {
  const requestHash = calculateRequestHash(requestPayload);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  try {
    const database = await getDb();
    if (!database) {
      throw new Error("Database connection not available");
    }

    const record: InsertIdempotencyRequest = {
      scope,
      idempotencyKey,
      userId,
      requestHash,
      status: "STARTED",
      expiresAt,
    };

    await database.insert(idempotencyRequests).values(record);

    logger.info(
      {
        scope,
        idempotencyKey,
        userId,
      },
      "Idempotency record created"
    );

    return true;
  } catch (error) {
    // Check if it's a duplicate key error
    const dbError = error as { code?: string };
    if (
      dbError.code === "ER_DUP_ENTRY" ||
      dbError.code === "23505" ||
      dbError.code === "23000"
    ) {
      logger.info(
        {
          scope,
          idempotencyKey,
          userId,
        },
        "Idempotency record already exists (race condition)"
      );
      return false;
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Update idempotency record to COMPLETED
 */
export async function completeIdempotencyRecord(
  scope: IdempotencyScope,
  idempotencyKey: string,
  response: unknown,
  userId?: number
): Promise<void> {
  const conditions = [
    eq(idempotencyRequests.scope, scope),
    eq(idempotencyRequests.idempotencyKey, idempotencyKey),
  ];

  if (userId !== undefined) {
    conditions.push(eq(idempotencyRequests.userId, userId));
  }

  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  await database
    .update(idempotencyRequests)
    .set({
      status: "COMPLETED",
      responseJson: JSON.stringify(response),
      updatedAt: new Date(),
    })
    .where(and(...conditions));

  logger.info(
    {
      scope,
      idempotencyKey,
      userId,
    },
    "Idempotency record completed"
  );
}

/**
 * Update idempotency record to FAILED
 */
export async function failIdempotencyRecord(
  scope: IdempotencyScope,
  idempotencyKey: string,
  error: string,
  userId?: number
): Promise<void> {
  const conditions = [
    eq(idempotencyRequests.scope, scope),
    eq(idempotencyRequests.idempotencyKey, idempotencyKey),
  ];

  if (userId !== undefined) {
    conditions.push(eq(idempotencyRequests.userId, userId));
  }

  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  await database
    .update(idempotencyRequests)
    .set({
      status: "FAILED",
      errorMessage: error,
      updatedAt: new Date(),
    })
    .where(and(...conditions));

  logger.info(
    {
      scope,
      idempotencyKey,
      userId,
      error,
    },
    "Idempotency record failed"
  );
}

/**
 * Idempotency guard wrapper
 * Wraps a function with idempotency logic
 */
export async function withIdempotency<T>(
  scope: IdempotencyScope,
  idempotencyKey: string,
  requestPayload: any,
  fn: () => Promise<T>,
  userId?: number,
  ttlSeconds?: number
): Promise<T> {
  // 1. Check if already processed
  const existing = await checkIdempotency(
    scope,
    idempotencyKey,
    userId,
    requestPayload
  );

  if (existing.exists) {
    if (existing.status === "COMPLETED") {
      // Return cached response
      logger.info(
        {
          scope,
          idempotencyKey,
          userId,
        },
        "Returning cached idempotent response"
      );
      return existing.response as T;
    }

    if (existing.status === "STARTED") {
      // Request is in progress
      logger.warn(
        {
          scope,
          idempotencyKey,
          userId,
        },
        "Idempotent request already in progress"
      );
      Errors.idempotencyInProgress();
    }

    if (existing.status === "FAILED") {
      // Previous attempt failed - allow retry or return error
      logger.info(
        {
          scope,
          idempotencyKey,
          userId,
        },
        "Previous idempotent request failed, allowing retry"
      );
      // Could either throw the previous error or allow retry
      // For now, we'll allow retry by continuing
    }
  }

  // 2. Create idempotency record
  const created = await createIdempotencyRecord(
    scope,
    idempotencyKey,
    requestPayload,
    userId,
    ttlSeconds
  );

  if (!created) {
    // Race condition - another request created the record
    // Check existing status instead of recursing
    const existing = await checkIdempotency(
      scope,
      idempotencyKey,
      userId,
      requestPayload
    );

    if (existing.exists && existing.status === "COMPLETED") {
      return existing.response as T;
    }

    if (existing.exists && existing.status === "STARTED") {
      Errors.idempotencyInProgress();
    }

    // If FAILED, allow retry by continuing
  }

  // 3. Execute the function
  try {
    const result = await fn();

    // 4. Mark as completed
    await completeIdempotencyRecord(scope, idempotencyKey, result, userId);

    return result;
  } catch (error: any) {
    // 5. Mark as failed
    await failIdempotencyRecord(
      scope,
      idempotencyKey,
      error.message || "Unknown error",
      userId
    );

    throw error;
  }
}

/**
 * Clean up expired idempotency records
 * Should be run as a cron job
 */
export async function cleanupExpiredIdempotencyRecords(): Promise<void> {
  const now = new Date();

  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const result = await database
    .delete(idempotencyRequests)
    .where(lt(idempotencyRequests.expiresAt, now));

  const affectedRows = (result as any)[0]?.affectedRows || 0;
  logger.info(
    {
      deletedCount: affectedRows,
    },
    "Cleaned up expired idempotency records"
  );
}
