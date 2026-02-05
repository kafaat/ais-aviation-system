/**
 * BullMQ Queue Configuration - Production Grade
 *
 * Features:
 * 1. Redis required in production, optional in development
 * 2. Graceful degradation - works without Redis in dev
 * 3. Structured logging with correlation
 * 4. Health checks
 */

import { Queue, QueueOptions } from "bullmq";
import IORedis from "ioredis";
import { createServiceLogger } from "../_core/logger";

// Create queue-specific logger
const log = createServiceLogger("queue");

// ============================================================================
// Redis Connection
// ============================================================================

const NODE_ENV = process.env.NODE_ENV || "development";
const REDIS_REQUIRED = NODE_ENV === "production";

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL;

  if (!url) {
    if (REDIS_REQUIRED) {
      throw new Error("REDIS_URL is required in production environment");
    }
    log.warn({ event: "redis_url_missing", env: NODE_ENV }, "REDIS_URL not set, queues will be disabled");
    return null;
  }

  return url;
}

let connection: IORedis | null = null;
let connectionFailed = false;

/**
 * Get Redis connection
 * ✅ Returns null in development if Redis not available
 * ✅ Throws error in production if Redis not available
 */
export function getRedisConnection(): IORedis | null {
  if (connectionFailed) {
    return null;
  }

  if (connection) {
    return connection;
  }

  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }

  try {
    connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
      retryStrategy: times => {
        if (times > 3) {
          log.error({ event: "redis_connection_failed", retryCount: times }, "Redis connection failed after 3 retries");
          if (!REDIS_REQUIRED) {
            connectionFailed = true;
            return null; // Stop retrying in dev
          }
          return 5000; // Keep trying in production
        }
        return Math.min(times * 1000, 5000);
      },
    });

    connection.on("error", err => {
      log.error({ event: "redis_error", error: err.message }, "Redis connection error");
      if (!REDIS_REQUIRED) {
        connectionFailed = true;
      }
    });

    connection.on("connect", () => {
      log.info({ event: "redis_connected" }, "Redis connected successfully");
      connectionFailed = false;
    });

    connection.on("close", () => {
      log.warn({ event: "redis_closed" }, "Redis connection closed");
    });

    return connection;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ event: "redis_creation_failed", error: errorMessage }, "Failed to create Redis connection");

    if (REDIS_REQUIRED) {
      throw error;
    }

    connectionFailed = true;
    return null;
  }
}

// ============================================================================
// Queue Factory
// ============================================================================

function createQueue(
  name: string,
  options: Partial<QueueOptions> = {}
): Queue | null {
  const conn = getRedisConnection();
  if (!conn) {
    log.warn({ event: "queue_not_created", queueName: name }, `Queue "${name}" not created - Redis not available`);
    return null;
  }

  const defaultJobOptions = {
    attempts: 3,
    backoff: {
      type: "exponential" as const,
      delay: 1000,
    },
    removeOnComplete: {
      count: 1000,
      age: 24 * 60 * 60,
    },
    removeOnFail: {
      count: 5000,
      age: 7 * 24 * 60 * 60,
    },
  };

  return new Queue(name, {
    connection: conn,
    defaultJobOptions: {
      ...defaultJobOptions,
      ...options.defaultJobOptions,
    },
    ...options,
  });
}

// ============================================================================
// Queue Definitions
// ============================================================================

/**
 * Reconciliation Queue
 * Handles Stripe payment reconciliation jobs
 */
export const reconciliationQueue = createQueue("reconciliation", {
  defaultJobOptions: { attempts: 3 },
});

/**
 * Email Queue
 * Handles all email sending jobs
 */
export const emailQueue = createQueue("email", {
  defaultJobOptions: { attempts: 5 },
});

/**
 * Webhook Retry Queue
 * Handles retrying failed webhook processing
 */
export const webhookRetryQueue = createQueue("webhook-retry", {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

/**
 * Cleanup Queue
 * Handles cleanup jobs (expired sessions, old idempotency keys, etc.)
 */
export const cleanupQueue = createQueue("cleanup", {
  defaultJobOptions: { attempts: 1 },
});

// ============================================================================
// Queue Management
// ============================================================================

/**
 * Check if queues are available
 */
export function queuesAvailable(): boolean {
  return reconciliationQueue !== null;
}

/**
 * Initialize all queues and schedule recurring jobs
 */
export async function initializeQueues(): Promise<void> {
  if (!queuesAvailable()) {
    log.warn({ event: "queues_unavailable" }, "Queues not available - skipping initialization");
    return;
  }

  log.info({ event: "queues_initializing" }, "Initializing queues...");

  try {
    // Schedule daily reconciliation at 3:00 AM
    if (reconciliationQueue) {
      await reconciliationQueue.add(
        "daily-reconciliation",
        { limit: 200, dryRun: false },
        {
          repeat: { pattern: "0 3 * * *" },
          jobId: "daily-reconciliation",
        }
      );
      log.info({ event: "job_scheduled", jobName: "daily-reconciliation" }, "Scheduled daily reconciliation job");
    }

    // Schedule hourly cleanup
    if (cleanupQueue) {
      await cleanupQueue.add(
        "hourly-cleanup",
        {},
        {
          repeat: { pattern: "0 * * * *" },
          jobId: "hourly-cleanup",
        }
      );
      log.info({ event: "job_scheduled", jobName: "hourly-cleanup" }, "Scheduled hourly cleanup job");
    }

    log.info({ event: "queues_initialized" }, "Queues initialized successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ event: "queues_init_failed", error: errorMessage }, "Failed to initialize queues");

    if (REDIS_REQUIRED) {
      throw error;
    }
  }
}

/**
 * Gracefully close all queue connections
 */
export async function closeQueues(): Promise<void> {
  log.info({ event: "queues_closing" }, "Closing queues...");

  const queues = [
    reconciliationQueue,
    emailQueue,
    webhookRetryQueue,
    cleanupQueue,
  ];

  await Promise.all(
    queues
      .filter((q): q is Queue => q !== null)
      .map(q =>
        q.close().catch(err => {
          log.error({ event: "queue_close_error", queueName: q.name, error: err.message }, `Error closing queue ${q.name}`);
        })
      )
  );

  if (connection) {
    try {
      await connection.quit();
    } catch (error) {
      // Ignore quit errors
    }
    connection = null;
  }

  log.info({ event: "queues_closed" }, "All queues closed");
}

// ============================================================================
// Health Check
// ============================================================================

export interface QueueHealthStatus {
  available: boolean;
  connected: boolean;
  queues: Record<string, { waiting: number; active: number; failed: number }>;
}

export async function checkQueueHealth(): Promise<QueueHealthStatus> {
  if (!queuesAvailable()) {
    return {
      available: false,
      connected: false,
      queues: {},
    };
  }

  try {
    const redis = getRedisConnection();
    if (!redis) {
      return {
        available: false,
        connected: false,
        queues: {},
      };
    }

    await redis.ping();

    const queues = [
      { name: "reconciliation", queue: reconciliationQueue },
      { name: "email", queue: emailQueue },
      { name: "webhookRetry", queue: webhookRetryQueue },
      { name: "cleanup", queue: cleanupQueue },
    ];

    const counts: Record<
      string,
      { waiting: number; active: number; failed: number }
    > = {};

    for (const { name, queue } of queues) {
      if (queue) {
        const [waiting, active, failed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getFailedCount(),
        ]);
        counts[name] = { waiting, active, failed };
      }
    }

    return {
      available: true,
      connected: true,
      queues: counts,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ event: "queue_health_check_failed", error: errorMessage }, "Queue health check failed");

    return {
      available: true,
      connected: false,
      queues: {},
    };
  }
}

// ============================================================================
// Job Helpers
// ============================================================================

/**
 * Add a job to a queue safely (handles null queue)
 */
export async function addJob<T>(
  queue: Queue | null,
  name: string,
  data: T,
  options?: Parameters<Queue["add"]>[2]
): Promise<string | null> {
  if (!queue) {
    log.warn({ event: "job_not_added", jobName: name }, `Cannot add job "${name}" - queue not available`);
    return null;
  }

  const job = await queue.add(name, data, options);
  return job.id ?? null;
}
