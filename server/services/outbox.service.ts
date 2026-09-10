/**
 * Outbox Service — transactional outbox pattern.
 *
 * Producers call {@link recordEvent} INSIDE their business DB transaction so an
 * event is persisted atomically with the state change. A relay
 * ({@link relayOutbox}) later reads pending rows, hands them to a pluggable
 * {@link OutboxPublisher}, and marks them published/failed. Swapping the
 * publisher for Kafka/NATS later requires no producer changes.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { getDb } from "../db";
import { outbox, type OutboxEvent } from "../../drizzle/schema";
import type * as schema from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

/** Accepts either the db handle or a transaction handle (both expose `insert`). */
type DbOrTx = Pick<MySql2Database<typeof schema>, "insert">;

const DEFAULT_RELAY_LIMIT = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
/**
 * A row claimed (`processing`) longer than this is assumed orphaned by a
 * crashed worker and becomes claimable again.
 */
export const OUTBOX_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

export interface NewEvent {
  aggregateType: string;
  aggregateId: string | number;
  eventType: string;
  tenantId?: number | null;
  payload: Record<string, unknown>;
}

/** A function that ships one event to the bus. Throwing marks the event failed. */
export type OutboxPublisher = (event: OutboxEvent) => Promise<void>;

/**
 * Record a domain event. MUST be called with the same `db`/`tx` used for the
 * business write so the event and the state change commit (or roll back)
 * together. Returns the generated eventId.
 */
export async function recordEvent(
  db: DbOrTx,
  event: NewEvent
): Promise<string> {
  const eventId = randomUUID();
  await db.insert(outbox).values({
    eventId,
    aggregateType: event.aggregateType,
    aggregateId: String(event.aggregateId),
    eventType: event.eventType,
    tenantId: event.tenantId ?? null,
    payload: event.payload,
    status: "pending",
  });
  return eventId;
}

function getDbOrThrow() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }
  return db;
}

/**
 * Condition for rows a relay worker may claim: pending, or `processing` rows
 * whose claim is older than {@link OUTBOX_CLAIM_TIMEOUT_MS} (orphaned).
 */
function claimableCondition(maxAttempts: number, now: Date) {
  const staleBefore = new Date(now.getTime() - OUTBOX_CLAIM_TIMEOUT_MS);
  return and(
    or(
      eq(outbox.status, "pending"),
      and(eq(outbox.status, "processing"), lt(outbox.lockedAt, staleBefore))
    ),
    lt(outbox.attempts, maxAttempts)
  );
}

/** Oldest claimable events first (FIFO), capped at `limit`. Read-only peek. */
export async function getPendingEvents(
  limit = DEFAULT_RELAY_LIMIT,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<OutboxEvent[]> {
  const db = getDbOrThrow();
  return await db
    .select()
    .from(outbox)
    .where(claimableCondition(maxAttempts, new Date()))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);
}

/**
 * Atomically CLAIM a batch of events for this worker.
 *
 * Runs `SELECT ... FOR UPDATE SKIP LOCKED` + `UPDATE status='processing'` in
 * one transaction, so concurrent relay instances (multiple app replicas, cron
 * overlap) each get a disjoint set of rows and no two workers initially own the same claim.
 * Rows left in `processing` by a crashed worker are reclaimed after
 * {@link OUTBOX_CLAIM_TIMEOUT_MS}.
 */
export async function claimPendingEvents(
  limit = DEFAULT_RELAY_LIMIT,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<OutboxEvent[]> {
  const db = getDbOrThrow();
  const now = new Date();
  const leaseToken = randomUUID();

  return await db.transaction(async tx => {
    const rows = await tx
      .select()
      .from(outbox)
      .where(claimableCondition(maxAttempts, now))
      .orderBy(asc(outbox.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];

    await tx
      .update(outbox)
      .set({ status: "processing", lockedAt: now, leaseToken })
      .where(
        inArray(
          outbox.id,
          rows.map(r => r.id)
        )
      );

    return rows.map(r => ({
      ...r,
      status: "processing" as const,
      lockedAt: now,
      leaseToken,
    }));
  });
}

export async function markPublished(
  events: Pick<OutboxEvent, "id" | "leaseToken">[]
): Promise<number> {
  const db = getDbOrThrow();
  let published = 0;
  for (const event of events) {
    if (!event.leaseToken) continue;
    const [result] = await db
      .update(outbox)
      .set({
        status: "published",
        publishedAt: new Date(),
        lockedAt: null,
        leaseToken: null,
      })
      .where(
        and(
          eq(outbox.id, event.id),
          eq(outbox.status, "processing"),
          eq(outbox.leaseToken, event.leaseToken)
        )
      );
    published += result.affectedRows;
  }
  return published;
}

export async function markFailed(
  id: number,
  error: string,
  leaseToken: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<void> {
  const db = getDbOrThrow();
  await db
    .update(outbox)
    .set({
      // MySQL evaluates single-table assignments left to right: inspect the old
      // count before incrementing it, so the fifth failure consumes five tries.
      status: sql`CASE WHEN ${outbox.attempts} + 1 >= ${maxAttempts} THEN 'failed' ELSE 'pending' END`,
      attempts: sql`${outbox.attempts} + 1`,
      lastError: error.slice(0, 1000),
      lockedAt: null,
      leaseToken: null,
    })
    .where(
      and(
        eq(outbox.id, id),
        eq(outbox.status, "processing"),
        eq(outbox.leaseToken, leaseToken)
      )
    );
}

export interface RelayResult {
  publishedIds: number[];
  failed: Array<{ id: number; error: string }>;
}

/**
 * Pure relay core (no DB): publish each event, partition into published vs
 * failed. Unit-testable without a database.
 */
export async function processEvents(
  events: OutboxEvent[],
  publisher: OutboxPublisher
): Promise<RelayResult> {
  const publishedIds: number[] = [];
  const failed: Array<{ id: number; error: string }> = [];

  for (const event of events) {
    try {
      await publisher(event);
      publishedIds.push(event.id);
    } catch (err) {
      failed.push({
        id: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { publishedIds, failed };
}

/**
 * Claim pending events, publish them, and persist the outcome. Intended to be
 * invoked periodically (cron/worker) and safe to run on several instances at
 * once (see {@link claimPendingEvents}). Returns counts for observability.
 */
export async function relayOutbox(
  publisher: OutboxPublisher,
  opts: { limit?: number; maxAttempts?: number } = {}
): Promise<{ published: number; failed: number }> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const events = await claimPendingEvents(opts.limit, maxAttempts);
  if (events.length === 0) return { published: 0, failed: 0 };

  const { publishedIds, failed } = await processEvents(events, publisher);

  const published = await markPublished(
    events.filter(event => publishedIds.includes(event.id))
  );
  for (const f of failed) {
    const claim = events.find(event => event.id === f.id);
    if (claim?.leaseToken)
      await markFailed(f.id, f.error, claim.leaseToken, maxAttempts);
  }

  return { published, failed: failed.length };
}

/** Delivery is at least once; downstream receivers deduplicate the stable eventId. */
export const configuredPublisher: OutboxPublisher = async event => {
  if (event.eventType === "booking.confirmed") {
    const { sendConfirmationAndAwardMiles } =
      await import("../webhooks/stripe");
    await sendConfirmationAndAwardMiles(Number(event.aggregateId));
    return;
  }
  const endpoint = process.env.OUTBOX_PUBLISH_URL;
  const token = process.env.OUTBOX_PUBLISH_TOKEN;
  if (!endpoint) {
    const { consumeLocalEvent } = await import("./event-inbox.service");
    await consumeLocalEvent(event);
    return;
  }
  if (!token)
    throw new Error("Configured outbox receiver requires authentication");
  if (
    process.env.NODE_ENV === "production" &&
    new URL(endpoint).protocol !== "https:"
  )
    throw new Error("Outbox receiver requires HTTPS");
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": event.eventId,
    },
    body: JSON.stringify(event),
  });
  if (!response.ok)
    throw new Error(
      `Outbox receiver rejected delivery: HTTP ${response.status}`
    );
};

/** Retained only to make legacy callers fail visibly instead of discarding events. */
export const loggingPublisher: OutboxPublisher = async () => {
  throw new Error("Logging is not event delivery");
};

/** Convenience entry point for the cron/worker tick. */
export async function runOutboxRelay(): Promise<{
  published: number;
  failed: number;
}> {
  return await relayOutbox(configuredPublisher);
}
