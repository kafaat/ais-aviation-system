/**
 * Background Job Worker Entry Point
 *
 * Standalone process that runs BullMQ workers for background job processing.
 * Separate from the main web server so that job processing does not block
 * HTTP request handling.
 *
 * Usage:
 *   Development:  pnpm workers        (tsx server/queue/workers/index.ts)
 *   Production:   node dist/worker.js
 *
 * Features:
 * - Initializes database connection pool
 * - Initializes Redis connection
 * - Starts BullMQ workers for all job queues
 * - Schedules recurring jobs (reconciliation, cleanup)
 * - Graceful shutdown on SIGTERM / SIGINT
 */

import "dotenv/config";
import { getDb, closePool } from "./db";
import { createServiceLogger } from "./_core/logger";
import {
  getRedisConnection,
  initializeQueues,
  closeQueues,
} from "./queue/queues";
import { startWorkers, stopWorkers } from "./queue/workers/index";
import {
  startAllWorkers as startV2Workers,
  stopAllWorkers as stopV2Workers,
  closeAllQueues as closeV2Queues,
  scheduleReconciliation,
  scheduleCleanupJobs,
} from "./services/queue-v2.service";

const log = createServiceLogger("worker");

let isShuttingDown = false;

// ============================================================================
// Initialization
// ============================================================================

async function initialize(): Promise<void> {
  log.info({}, "Worker process starting...");

  // 1. Initialize database connection
  log.info({}, "Initializing database connection...");
  const db = await getDb();
  if (!db) {
    log.warn(
      {},
      "Database connection not available - some jobs may fail at runtime"
    );
  } else {
    log.info({}, "Database connection established");
  }

  // 2. Initialize Redis connection
  log.info({}, "Initializing Redis connection...");
  const redis = getRedisConnection();
  if (!redis) {
    log.error(
      {},
      "Redis connection not available - workers cannot start without Redis"
    );
    process.exit(1);
  }
  log.info({}, "Redis connection established");

  // 3. Initialize queues and schedule recurring jobs
  log.info({}, "Initializing queues...");
  await initializeQueues();

  // 4. Start queue/workers (production-grade workers from server/queue/)
  log.info({}, "Starting queue workers...");
  await startWorkers();

  // 5. Start V2 workers (from queue-v2.service)
  log.info({}, "Starting V2 workers...");
  startV2Workers();

  // 6. Schedule recurring jobs via V2 queues
  try {
    await scheduleReconciliation();
    await scheduleCleanupJobs();
    log.info({}, "Recurring jobs scheduled");
  } catch (err) {
    log.warn(
      { error: err },
      "Failed to schedule some recurring jobs - they may already be scheduled"
    );
  }

  log.info({}, "Worker process started successfully - processing jobs");
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    log.warn({}, `Received ${signal} again during shutdown, forcing exit`);
    process.exit(1);
  }

  isShuttingDown = true;
  log.info({ signal }, `Received ${signal}, starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    log.error({}, "Shutdown timed out after 30 seconds, forcing exit");
    process.exit(1);
  }, 30_000);

  try {
    // 1. Stop V2 workers (stop accepting new jobs, finish in-progress ones)
    log.info({}, "Stopping V2 workers...");
    await stopV2Workers();

    // 2. Close V2 queues
    log.info({}, "Closing V2 queues...");
    await closeV2Queues();

    // 3. Stop queue/ workers
    log.info({}, "Stopping queue workers...");
    await stopWorkers();

    // 4. Close queue/ queues and Redis
    log.info({}, "Closing queues and Redis connection...");
    await closeQueues();

    // 5. Close database connection pool
    log.info({}, "Closing database connection pool...");
    await closePool();

    clearTimeout(shutdownTimeout);
    log.info({}, "Graceful shutdown completed");
    process.exit(0);
  } catch (err) {
    clearTimeout(shutdownTimeout);
    log.error({ error: err }, "Error during shutdown");
    process.exit(1);
  }
}

// Register signal handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (err: Error) => {
  log.error(
    { error: err.message, stack: err.stack },
    "Uncaught exception in worker process"
  );
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error({ reason }, "Unhandled rejection in worker process");
  shutdown("unhandledRejection");
});

// ============================================================================
// Start
// ============================================================================

initialize().catch(err => {
  log.error({ error: err }, "Failed to initialize worker process");
  process.exit(1);
});
