import cron from "node-cron";
import { getDb } from "../db";
import { inventoryLocks } from "../../drizzle/schema";
import { lt } from "drizzle-orm";
import { logger, logInfo, logError } from "../_core/logger";
import { runOutboxRelay } from "./outbox.service";

/**
 * Publish pending transactional-outbox events to the bus.
 * Runs every minute. Errors are swallowed so a relay hiccup never crashes cron.
 */
export async function relayOutboxEvents() {
  try {
    const { published, failed } = await runOutboxRelay();
    if (published > 0 || failed > 0) {
      logInfo(`Outbox relay: ${published} published, ${failed} failed`);
    }
  } catch (error) {
    logError(error as Error, { operation: "relayOutboxEvents" });
  }
}

/**
 * Clean up expired inventory locks
 * Runs every 5 minutes
 */
export async function cleanupExpiredLocks() {
  try {
    const db = await getDb();
    if (!db) {
      logError(new Error("Database not available"), {
        operation: "cleanupExpiredLocks",
      });
      return;
    }

    const result = await db
      .delete(inventoryLocks)
      .where(lt(inventoryLocks.expiresAt, new Date()));

    const deletedCount = (result as any)[0]?.affectedRows || 0;
    if (deletedCount > 0) {
      logInfo(`Cleaned up ${deletedCount} expired inventory locks`);
    }
  } catch (error) {
    logError(error as Error, { operation: "cleanupExpiredLocks" });
  }
}

const scheduledTasks: Array<{ stop: () => void | Promise<void> }> = [];
const runningJobs = new Set<string>();

/**
 * Run a cron tick with an in-process re-entrancy guard: if the previous tick
 * of the same job is still running (slow DB, large outbox backlog), skip this
 * tick instead of stacking overlapping runs.
 */
async function runGuarded(name: string, job: () => Promise<void>) {
  if (runningJobs.has(name)) {
    logger.warn({ job: name }, "Previous cron tick still running; skipping");
    return;
  }
  runningJobs.add(name);
  try {
    logger.debug({}, `Running cron job: ${name}`);
    await job();
  } finally {
    runningJobs.delete(name);
  }
}

/**
 * Initialize and start all cron jobs.
 *
 * Call this from ONE process only (the background worker, see
 * server/worker.ts) — not from every web replica — so periodic work such as
 * the outbox relay is not multiplied by the number of app instances.
 * Idempotent: a second call is a no-op.
 */
export function startCronJobs() {
  if (scheduledTasks.length > 0) {
    logger.warn({}, "Cron jobs already started; ignoring duplicate call");
    return;
  }
  logger.info({}, "Starting cron jobs...");

  // Clean up expired locks every 5 minutes
  scheduledTasks.push(
    cron.schedule("*/5 * * * *", () =>
      runGuarded("cleanupExpiredLocks", cleanupExpiredLocks)
    )
  );

  // Relay transactional-outbox events every minute
  scheduledTasks.push(
    cron.schedule("* * * * *", () =>
      runGuarded("relayOutboxEvents", relayOutboxEvents)
    )
  );

  logger.info({}, "Cron jobs started successfully");
}

/** Stop all scheduled cron jobs (graceful shutdown). */
export async function stopCronJobs() {
  if (scheduledTasks.length === 0) return;
  logger.info({}, "Stopping cron jobs...");
  for (const task of scheduledTasks.splice(0)) {
    await task.stop();
  }
}

/**
 * Manually trigger cron jobs (for testing)
 */
export async function triggerCronJobs() {
  logger.info({}, "Manually triggering cron jobs");
  await cleanupExpiredLocks();
  await relayOutboxEvents();
  logger.info({}, "Cron jobs completed");
}
