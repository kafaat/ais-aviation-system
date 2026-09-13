import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import {
  operationalSamples,
  operationsAlerts,
  scheduledTasks,
  outbox,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { createServiceLogger } from "../_core/logger";
const log = createServiceLogger("operational-observations");
export const observationInstanceId = randomUUID();
type Sample = typeof operationalSamples.$inferInsert;
export async function recordOperationalSample(sample: Sample) {
  const db = getDb();
  if (!db) throw new Error("Observation storage unavailable");
  if (
    !Number.isFinite(sample.startedAt.getTime()) ||
    !Number.isFinite(sample.endedAt.getTime()) ||
    sample.endedAt < sample.startedAt ||
    !Number.isSafeInteger(sample.requests ?? 0) ||
    !Number.isSafeInteger(sample.errors ?? 0) ||
    (sample.errors ?? 0) < 0 ||
    (sample.errors ?? 0) > (sample.requests ?? 0) ||
    !Number.isFinite(Number(sample.totalDurationMs ?? 0)) ||
    Number(sample.totalDurationMs ?? 0) < 0
  )
    throw new Error("Invalid operational observation");
  await db
    .insert(operationalSamples)
    .values(sample)
    .onDuplicateKeyUpdate({ set: { id: sql`${operationalSamples.id}` } });
}
function bucket() {
  return { startedAt: new Date(), requests: 0, errors: 0, duration: 0 };
}
let current = bucket();
let pending: Sample | null = null;
let flushing: Promise<void> | undefined;
let timer: NodeJS.Timeout | undefined;
let lastAlertCheck = 0;
export function observeApiResponse(durationMs: number, status: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  current.requests++;
  current.errors += Number(status >= 500);
  current.duration += durationMs;
}
export function flushApiObservations(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (pending) {
      await recordOperationalSample(pending);
      pending = null;
    }
    const captured = current;
    current = bucket();
    pending = {
      id: randomUUID(),
      instanceId: observationInstanceId,
      component: "api",
      status: "healthy",
      startedAt: captured.startedAt,
      endedAt: new Date(),
      requests: captured.requests,
      errors: captured.errors,
      totalDurationMs: captured.duration.toFixed(3),
    };
    await recordOperationalSample(pending);
    pending = null;
  })().finally(() => {
    flushing = undefined;
  });
  return flushing;
}
export function startOperationalObservations() {
  if (timer) return;
  timer = setInterval(() => {
    void flushApiObservations()
      .then(async () => {
        // An API replica can detect a stopped worker even when worker cron is down.
        if (Date.now() - lastAlertCheck > 60000) {
          lastAlertCheck = Date.now();
          await refreshOperationalAlerts();
        }
      })
      .catch(err =>
        log.error({ err }, "Observation batch or alert refresh will retry")
      );
  }, 10000);
  timer.unref();
}
export async function stopOperationalObservations() {
  clearInterval(timer);
  timer = undefined;
  await flushApiObservations();
}
export async function readDurableHealth(now = new Date()) {
  const db = getDb();
  if (!db) throw new Error("Observation storage unavailable");
  const since = new Date(now.getTime() - 15 * 60000);
  const rows = await db
    .select()
    .from(operationalSamples)
    .where(gt(operationalSamples.endedAt, since))
    .orderBy(desc(operationalSamples.endedAt))
    .limit(20001);
  if (rows.length > 20000)
    throw new Error(
      "Observation window exceeds capacity; narrow deployment sampling interval"
    );
  const api = rows.filter(r => r.component === "api");
  const requests = api.reduce((n, r) => n + r.requests, 0),
    errors = api.reduce((n, r) => n + r.errors, 0);
  const instances = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if (!instances.has(row.instanceId)) instances.set(row.instanceId, row);
  return {
    windowStart: since,
    windowEnd: now,
    requests,
    errors,
    errorRate: requests ? (errors / requests) * 100 : null,
    meanResponseMs: requests
      ? api.reduce((n, r) => n + Number(r.totalDurationMs), 0) / requests
      : null,
    instances: [...instances.values()].map(r => ({
      instanceId: r.instanceId,
      component: r.component,
      lastSeenAt: r.endedAt,
      status:
        now.getTime() - r.endedAt.getTime() > 30000
          ? ("unknown" as const)
          : r.status,
    })),
    scope:
      "Persisted HTTP observations and worker dependency checks; not contractual uptime",
  };
}
export async function refreshOperationalAlerts() {
  const db = getDb();
  if (!db) throw new Error("Operations database unavailable");
  const health = await readDurableHealth();
  const tasks = await db.select().from(scheduledTasks);
  const [failed] = await db
    .select({ count: sql<number>`count(*)` })
    .from(outbox)
    .where(eq(outbox.status, "failed"));
  const { PERIODIC_JOB_CATALOG } = await import("./cron.service");
  const expected = PERIODIC_JOB_CATALOG.filter(
    t => t.name !== "operationalAlerts"
  );
  const checks = [
    {
      key: "worker-observation",
      bad: !health.instances.some(
        i => i.component === "worker" && i.status === "healthy"
      ),
      message: "No fresh healthy worker observation",
    },
    {
      key: "api-error-rate",
      bad: health.requests >= 20 && (health.errorRate ?? 0) > 5,
      message: "Observed API error rate exceeds 5% (minimum 20 responses)",
    },
    {
      key: "outbox-delivery",
      bad: Number(failed.count) > 0,
      message: "Event deliveries exhausted automatic retries",
    },
    ...expected.map(t => {
      const seen = tasks.find(s => s.name === t.name);
      return {
        key: `scheduler:${t.name}`,
        bad:
          !seen?.lastSuccessAt ||
          Boolean(seen.lastError) ||
          Date.now() - seen.lastSuccessAt.getTime() > t.periodMs * 2 + 60000,
        message: `Scheduled task ${t.name} lacks a fresh success receipt`,
      };
    }),
  ];
  for (const check of checks)
    await db.transaction(async tx => {
      const [prior] = await tx
        .select()
        .from(operationsAlerts)
        .where(eq(operationsAlerts.key, check.key))
        .for("update");
      if (!prior && !check.bad) return;
      const status = check.bad ? ("active" as const) : ("resolved" as const);
      if (prior?.status === status) return;
      await tx
        .insert(operationsAlerts)
        .values({ key: check.key, status, message: check.message })
        .onDuplicateKeyUpdate({
          set: {
            status,
            message: check.message,
            acknowledgedBy: null,
            acknowledgedAt: null,
            updatedAt: new Date(),
          },
        });
    });
  await db
    .delete(operationalSamples)
    .where(
      lt(operationalSamples.endedAt, new Date(Date.now() - 30 * 86400000))
    );
  return { checked: checks.length };
}
export async function acknowledgeOperationalAlert(
  key: string,
  actorId: number
) {
  const db = getDb();
  if (!db) throw new Error("Operations database unavailable");
  const [result] = await db
    .update(operationsAlerts)
    .set({ acknowledgedBy: actorId, acknowledgedAt: new Date() })
    .where(
      and(eq(operationsAlerts.key, key), eq(operationsAlerts.status, "active"))
    );
  if (result.affectedRows !== 1) throw new Error("Active alert not found");
  return { acknowledged: true };
}
