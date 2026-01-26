/**
 * BullMQ Queue Configuration - Production Grade
 *
 * التحسينات:
 * 1. ✅ Redis إلزامي - يرمي خطأ إذا غير متاح
 * 2. ✅ Graceful degradation - يعمل بدون Redis في dev
 * 3. ✅ Structured logging
 * 4. ✅ Health checks
 */

import { Queue, QueueOptions } from "bullmq";
import IORedis from "ioredis";

// ============================================================================
// Logger - Structured JSON
// ============================================================================

function log(
  level: "info" | "warn" | "error",
  message: string,
  context: Record<string, unknown> = {}
) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    service: "queue",
    message,
    ...context,
  };

  if (level === "error") {
    console.error(JSON.stringify(logEntry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
}

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
    log("warn", "REDIS_URL not set, queues will be disabled", {
      env: NODE_ENV,
    });
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
          log("error", "Redis connection failed after 3 retries", { times });
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
      log("error", "Redis connection error", { error: err.message });
      if (!REDIS_REQUIRED) {
        connectionFailed = true;
      }
    });

    connection.on("connect", () => {
      log("info", "Redis connected successfully");
      connectionFailed = false;
    });

    connection.on("close", () => {
      log("warn", "Redis connection closed");
    });

    return connection;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("error", "Failed to create Redis connection", { error: errorMessage });

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
    log("warn", `Queue "${name}" not created - Redis not available`);
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
    log("warn", "Queues not available - skipping initialization");
    return;
  }

  log("info", "Initializing queues...");

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
      log("info", "Scheduled daily reconciliation job");
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
      log("info", "Scheduled hourly cleanup job");
    }

    log("info", "Queues initialized successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("error", "Failed to initialize queues", { error: errorMessage });

    if (REDIS_REQUIRED) {
      throw error;
    }
  }
}

/**
 * Gracefully close all queue connections
 */
export async function closeQueues(): Promise<void> {
  log("info", "Closing queues...");

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
          log("error", `Error closing queue ${q.name}`, { error: err.message });
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

  log("info", "All queues closed");
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
    log("error", "Queue health check failed", { error: errorMessage });

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
    log("warn", `Cannot add job "${name}" - queue not available`);
    return null;
  }

  const job = await queue.add(name, data, options);
  return job.id ?? null;
}
