import cron from "node-cron";
import { getDb } from "../db";
import { inventoryLocks } from "../../drizzle/schema";
import { lt } from "drizzle-orm";
import { logger, logInfo, logError } from "../_core/logger";

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

    // Find expired locks
    const expiredLocks = await db
      .select()
      .from(inventoryLocks)
      .where(lt(inventoryLocks.expiresAt, new Date()));

    if (expiredLocks.length === 0) {
      return; // No expired locks, skip logging
    }

    // Delete expired locks
    await db
      .delete(inventoryLocks)
      .where(lt(inventoryLocks.expiresAt, new Date()));

    logInfo(`Cleaned up ${expiredLocks.length} expired inventory locks`);
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

  logger.info({}, "Cron jobs started successfully");
}

/**
 * Manually trigger cron jobs (for testing)
 */
export async function triggerCronJobs() {
  logger.info({}, "Manually triggering cron jobs");
  await cleanupExpiredLocks();
  logger.info({}, "Cron jobs completed");
}
