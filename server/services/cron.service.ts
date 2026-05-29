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

/**
 * Initialize and start all cron jobs
 */
export function startCronJobs() {
  logger.info({}, "Starting cron jobs...");

  // Clean up expired locks every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    logger.debug({}, "Running cron job: cleanupExpiredLocks");
    await cleanupExpiredLocks();
  });

  // Relay transactional-outbox events every minute
  cron.schedule("* * * * *", async () => {
    logger.debug({}, "Running cron job: relayOutboxEvents");
    await relayOutboxEvents();
  });

  logger.info({}, "Cron jobs started successfully");
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
