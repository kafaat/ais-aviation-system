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
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { getDb } from "../db";
import { outbox, type OutboxEvent } from "../../drizzle/schema";
import type * as schema from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

/** Accepts either the db handle or a transaction handle (both expose `insert`). */
type DbOrTx = Pick<MySql2Database<typeof schema>, "insert">;

const DEFAULT_RELAY_LIMIT = 100;
const DEFAULT_MAX_ATTEMPTS = 5;

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

/** Oldest pending events first (FIFO), capped at `limit`. */
export async function getPendingEvents(
  limit = DEFAULT_RELAY_LIMIT,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<OutboxEvent[]> {
  const db = getDbOrThrow();
  return await db
    .select()
    .from(outbox)
    .where(and(eq(outbox.status, "pending"), lt(outbox.attempts, maxAttempts)))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);
}

export async function markPublished(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDbOrThrow();
  await db
    .update(outbox)
    .set({ status: "published", publishedAt: new Date() })
    .where(inArray(outbox.id, ids));
}

export async function markFailed(
  id: number,
  error: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<void> {
  const db = getDbOrThrow();
  // Increment attempts; flip to 'failed' once attempts reach the cap.
  await db
    .update(outbox)
    .set({
      attempts: sql`${outbox.attempts} + 1`,
      lastError: error.slice(0, 1000),
      status: sql`CASE WHEN ${outbox.attempts} + 1 >= ${maxAttempts} THEN 'failed' ELSE 'pending' END`,
    })
    .where(eq(outbox.id, id));
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
 * Fetch pending events, publish them, and persist the outcome. Intended to be
 * invoked periodically (cron/worker). Returns counts for observability.
 */
export async function relayOutbox(
  publisher: OutboxPublisher,
  opts: { limit?: number; maxAttempts?: number } = {}
): Promise<{ published: number; failed: number }> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const events = await getPendingEvents(opts.limit, maxAttempts);
  if (events.length === 0) return { published: 0, failed: 0 };

  const { publishedIds, failed } = await processEvents(events, publisher);

  await markPublished(publishedIds);
  for (const f of failed) {
    await markFailed(f.id, f.error, maxAttempts);
  }

  return { published: publishedIds.length, failed: failed.length };
}
