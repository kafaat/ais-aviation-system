/**
 * BullMQ Queue Configuration
 * 
 * Defines all queues used in the application.
 * Each queue handles a specific type of background job.
 */

import { Queue, QueueOptions } from "bullmq";
import IORedis from "ioredis";

// ============================================================================
// Redis Connection
// ============================================================================

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("[Queue] REDIS_URL not set, using default localhost:6379");
    return "redis://localhost:6379";
  }
  return url;
}

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    });
    
    connection.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });
    
    connection.on("connect", () => {
      console.log("[Redis] Connected successfully");
    });
  }
  return connection;
}

// ============================================================================
// Queue Definitions
// ============================================================================

const defaultQueueOptions: QueueOptions = {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      count: 1000, // Keep last 1000 completed jobs
      age: 24 * 60 * 60, // Keep for 24 hours
    },
    removeOnFail: {
      count: 5000, // Keep last 5000 failed jobs
      age: 7 * 24 * 60 * 60, // Keep for 7 days
    },
  },
};

/**
 * Reconciliation Queue
 * Handles Stripe payment reconciliation jobs
 */
export const reconciliationQueue = new Queue("reconciliation", {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    attempts: 3,
  },
});

/**
 * Email Queue
 * Handles all email sending jobs
 */
export const emailQueue = new Queue("email", {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    attempts: 5,
  },
});

/**
 * Webhook Retry Queue
 * Handles retrying failed webhook processing
 */
export const webhookRetryQueue = new Queue("webhook-retry", {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 5000, // Start with 5 seconds
    },
  },
});

/**
 * Cleanup Queue
 * Handles cleanup jobs (expired sessions, old idempotency keys, etc.)
 */
export const cleanupQueue = new Queue("cleanup", {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    attempts: 1, // Cleanup jobs don't need retries
  },
});

// ============================================================================
// Queue Management
// ============================================================================

/**
 * Initialize all queues and schedule recurring jobs
 */
export async function initializeQueues(): Promise<void> {
  console.log("[Queue] Initializing queues...");

  // Schedule daily reconciliation at 3:00 AM
  await reconciliationQueue.add(
    "daily-reconciliation",
    { limit: 200 },
    {
      repeat: {
        pattern: "0 3 * * *", // Every day at 3:00 AM
      },
      jobId: "daily-reconciliation", // Prevent duplicates
    }
  );

  // Schedule hourly cleanup
  await cleanupQueue.add(
    "hourly-cleanup",
    {},
    {
      repeat: {
        pattern: "0 * * * *", // Every hour
      },
      jobId: "hourly-cleanup",
    }
  );

  console.log("[Queue] Queues initialized with scheduled jobs");
}

/**
 * Gracefully close all queue connections
 */
export async function closeQueues(): Promise<void> {
  console.log("[Queue] Closing queues...");
  
  await Promise.all([
    reconciliationQueue.close(),
    emailQueue.close(),
    webhookRetryQueue.close(),
    cleanupQueue.close(),
  ]);

  if (connection) {
    await connection.quit();
    connection = null;
  }

  console.log("[Queue] All queues closed");
}

// ============================================================================
// Health Check
// ============================================================================

export async function checkQueueHealth(): Promise<{
  connected: boolean;
  queues: Record<string, { waiting: number; active: number; failed: number }>;
}> {
  try {
    const redis = getRedisConnection();
    await redis.ping();

    const [reconciliation, email, webhookRetry, cleanup] = await Promise.all([
      getQueueCounts(reconciliationQueue),
      getQueueCounts(emailQueue),
      getQueueCounts(webhookRetryQueue),
      getQueueCounts(cleanupQueue),
    ]);

    return {
      connected: true,
      queues: {
        reconciliation,
        email,
        webhookRetry,
        cleanup,
      },
    };
  } catch (error) {
    return {
      connected: false,
      queues: {},
    };
  }
}

async function getQueueCounts(queue: Queue): Promise<{ waiting: number; active: number; failed: number }> {
  const [waiting, active, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getFailedCount(),
  ]);
  return { waiting, active, failed };
}
