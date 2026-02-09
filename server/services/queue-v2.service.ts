/**
 * Background Queue V2 Service - Production-Grade
 *
 * Features:
 * - BullMQ for reliable job processing
 * - Email confirmation jobs
 * - Webhook retry jobs
 * - Reconciliation jobs
 * - Idempotency cleanup jobs
 * - Graceful shutdown
 *
 * @version 2.0.0
 * @date 2026-01-26
 */

import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { getDb } from "../db";
import { stripeEvents, bookings, users } from "../../drizzle/schema";
import { eq, and, lt, gt, desc } from "drizzle-orm";
import * as schema from "../../drizzle/schema";

// ============================================================================
// CONFIGURATION
// ============================================================================

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379");
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const redisConnection = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required for BullMQ
};

// ============================================================================
// QUEUE DEFINITIONS
// ============================================================================

// Email queue
export const emailQueue = new Queue("ais:emails", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      count: 1000, // Keep last 1000 failed jobs for debugging
      age: 7 * 24 * 60 * 60, // 7 days
    },
  },
});

// Webhook retry queue
export const webhookRetryQueue = new Queue("ais:webhook-retry", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
    },
    removeOnFail: {
      count: 500,
      age: 7 * 24 * 60 * 60,
    },
  },
});

// Scheduled jobs queue (reconciliation, cleanup, etc.)
export const scheduledQueue = new Queue("ais:scheduled", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "fixed",
      delay: 60000, // 1 minute
    },
    removeOnComplete: {
      count: 50,
    },
    removeOnFail: {
      count: 100,
    },
  },
});

// ============================================================================
// JOB TYPES
// ============================================================================

export interface EmailJobData {
  type:
    | "booking-confirmation"
    | "booking-cancelled"
    | "payment-receipt"
    | "welcome";
  userId: number;
  bookingId?: number;
  email: string;
  data?: Record<string, unknown>;
}

export interface WebhookRetryJobData {
  eventId: string;
}

export interface ReconciliationJobData {
  startDate?: string;
  endDate?: string;
}

export interface CleanupJobData {
  type:
    | "idempotency"
    | "refresh-tokens"
    | "expired-bookings"
    | "seat-holds"
    | "waitlist-offers";
}

// ============================================================================
// JOB PRODUCERS
// ============================================================================

/**
 * Queue booking confirmation email
 */
export async function queueBookingConfirmationEmail(opts: {
  userId: number;
  bookingId: number;
  email: string;
}): Promise<void> {
  await emailQueue.add(
    "booking-confirmation",
    {
      type: "booking-confirmation",
      userId: opts.userId,
      bookingId: opts.bookingId,
      email: opts.email,
    } as EmailJobData,
    {
      jobId: `booking-confirmation-${opts.bookingId}`, // Idempotent
    }
  );
  console.log(
    `[Queue] Queued booking confirmation email for booking ${opts.bookingId}`
  );
}

/**
 * Queue booking cancellation email
 */
export async function queueBookingCancellationEmail(opts: {
  userId: number;
  bookingId: number;
  email: string;
}): Promise<void> {
  await emailQueue.add(
    "booking-cancelled",
    {
      type: "booking-cancelled",
      userId: opts.userId,
      bookingId: opts.bookingId,
      email: opts.email,
    } as EmailJobData,
    {
      jobId: `booking-cancelled-${opts.bookingId}`,
    }
  );
  console.log(
    `[Queue] Queued booking cancellation email for booking ${opts.bookingId}`
  );
}

/**
 * Queue webhook retry
 */
export async function queueWebhookRetry(opts: {
  eventId: string;
  delay?: number;
}): Promise<void> {
  await webhookRetryQueue.add(
    "retry-event",
    {
      eventId: opts.eventId,
    } as WebhookRetryJobData,
    {
      jobId: `webhook-retry-${opts.eventId}`,
      delay: opts.delay || 60000, // Default 1 minute delay
    }
  );
  console.log(`[Queue] Queued webhook retry for event ${opts.eventId}`);
}

/**
 * Schedule daily reconciliation
 */
export async function scheduleReconciliation(): Promise<void> {
  await scheduledQueue.add("reconciliation", {} as ReconciliationJobData, {
    repeat: {
      pattern: "0 2 * * *", // 2 AM daily
    },
    jobId: "daily-reconciliation",
  });
  console.log(`[Queue] Scheduled daily reconciliation`);
}

/**
 * Schedule cleanup jobs
 */
export async function scheduleCleanupJobs(): Promise<void> {
  // Idempotency cleanup - every hour
  await scheduledQueue.add(
    "cleanup",
    { type: "idempotency" } as CleanupJobData,
    {
      repeat: {
        pattern: "0 * * * *", // Every hour
      },
      jobId: "idempotency-cleanup",
    }
  );

  // Refresh tokens cleanup - every 6 hours
  await scheduledQueue.add(
    "cleanup",
    { type: "refresh-tokens" } as CleanupJobData,
    {
      repeat: {
        pattern: "0 */6 * * *", // Every 6 hours
      },
      jobId: "refresh-tokens-cleanup",
    }
  );

  // Expired bookings cleanup - every day at 3 AM
  await scheduledQueue.add(
    "cleanup",
    { type: "expired-bookings" } as CleanupJobData,
    {
      repeat: {
        pattern: "0 3 * * *", // 3 AM daily
      },
      jobId: "expired-bookings-cleanup",
    }
  );

  // Seat holds expiration - every 5 minutes
  await scheduledQueue.add(
    "cleanup",
    { type: "seat-holds" } as CleanupJobData,
    {
      repeat: {
        pattern: "*/5 * * * *", // Every 5 minutes
      },
      jobId: "seat-holds-cleanup",
    }
  );

  // Waitlist offers expiration - every hour
  await scheduledQueue.add(
    "cleanup",
    { type: "waitlist-offers" } as CleanupJobData,
    {
      repeat: {
        pattern: "30 * * * *", // Every hour at :30
      },
      jobId: "waitlist-offers-cleanup",
    }
  );

  console.log(`[Queue] Scheduled cleanup jobs`);
}

// ============================================================================
// WORKERS
// ============================================================================

let emailWorker: Worker | null = null;
let webhookRetryWorker: Worker | null = null;
let scheduledWorker: Worker | null = null;

/**
 * Start email worker
 */
export function startEmailWorker(): Worker {
  if (emailWorker) {
    return emailWorker;
  }

  emailWorker = new Worker<EmailJobData>(
    "ais:emails",
    async (job: Job<EmailJobData>) => {
      console.log(`[Worker] Processing email job: ${job.name} (${job.id})`);

      const { type, userId, bookingId, email, data } = job.data;

      try {
        // Import email service dynamically to avoid circular dependencies
        const { sendBookingConfirmation } = await import("./email.service");

        switch (type) {
          case "booking-confirmation":
            if (bookingId && data) {
              await sendBookingConfirmation(data as any);
            }
            break;

          case "booking-cancelled": {
            // Create in-app notification + email via notification service
            const { createNotification } =
              await import("./notification.service");
            if (userId) {
              await createNotification(
                userId,
                "booking",
                "Booking Cancelled",
                `Your booking has been cancelled.${bookingId ? ` (Booking ID: ${bookingId})` : ""}`
              );
            }
            console.log(
              `[Worker] Booking cancellation notification sent for booking ${bookingId}`
            );
            break;
          }

          default:
            console.log(`[Worker] Unknown email type: ${type}`);
        }

        console.log(`[Worker] Email job completed: ${job.id}`);
      } catch (err: any) {
        console.error(`[Worker] Email job failed: ${job.id}`, err.message);
        throw err; // Re-throw to trigger retry
      }
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );

  emailWorker.on("completed", job => {
    console.log(`[Worker] Email job ${job.id} completed`);
  });

  emailWorker.on("failed", (job, err) => {
    console.error(`[Worker] Email job ${job?.id} failed:`, err.message);
  });

  console.log(`[Worker] Email worker started`);
  return emailWorker;
}

/**
 * Start webhook retry worker
 */
export function startWebhookRetryWorker(): Worker {
  if (webhookRetryWorker) {
    return webhookRetryWorker;
  }

  webhookRetryWorker = new Worker<WebhookRetryJobData>(
    "ais:webhook-retry",
    async (job: Job<WebhookRetryJobData>) => {
      console.log(`[Worker] Processing webhook retry: ${job.data.eventId}`);

      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const { eventId } = job.data;

      // Get event from database
      const event = await db.query.stripeEvents.findFirst({
        where: (t, { eq }) => eq(t.id, eventId),
      });

      if (!event) {
        console.log(`[Worker] Event ${eventId} not found, skipping`);
        return;
      }

      if (event.processed) {
        console.log(`[Worker] Event ${eventId} already processed, skipping`);
        return;
      }

      // Check retry count
      if (event.retryCount >= 5) {
        console.log(
          `[Worker] Event ${eventId} exceeded max retries, marking as failed`
        );
        await db
          .update(stripeEvents)
          .set({
            error: "Max retries exceeded",
          })
          .where(eq(stripeEvents.id, eventId));
        return;
      }

      // Retry processing
      try {
        if (!event.data) {
          console.error(
            `[Worker] Event ${eventId} has no data payload, skipping`
          );
          return;
        }

        const { stripeWebhookServiceV2 } =
          await import("./stripe-webhook-v2.service");

        const eventData = JSON.parse(event.data);
        await db.transaction(async tx => {
          await stripeWebhookServiceV2.processEvent(tx, {
            id: event.id,
            type: event.type,
            data: { object: eventData },
          } as any);

          await tx
            .update(stripeEvents)
            .set({
              processed: true,
              processedAt: new Date(),
              error: null,
            })
            .where(eq(stripeEvents.id, eventId));
        });

        console.log(
          `[Worker] Event ${eventId} processed successfully on retry`
        );
      } catch (err: any) {
        console.error(
          `[Worker] Webhook retry failed for ${eventId}:`,
          err.message
        );
        throw err;
      }
    },
    {
      connection: redisConnection,
      concurrency: 3,
    }
  );

  console.log(`[Worker] Webhook retry worker started`);
  return webhookRetryWorker;
}

/**
 * Start scheduled jobs worker
 */
export function startScheduledWorker(): Worker {
  if (scheduledWorker) {
    return scheduledWorker;
  }

  scheduledWorker = new Worker<ReconciliationJobData | CleanupJobData>(
    "ais:scheduled",
    async (job: Job<ReconciliationJobData | CleanupJobData>) => {
      console.log(`[Worker] Processing scheduled job: ${job.name} (${job.id})`);

      switch (job.name) {
        case "reconciliation":
          await runReconciliation(job.data as ReconciliationJobData);
          break;

        case "cleanup":
          await runCleanup(job.data as CleanupJobData);
          break;

        default:
          console.log(`[Worker] Unknown scheduled job: ${job.name}`);
      }
    },
    {
      connection: redisConnection,
      concurrency: 1, // Run one at a time
    }
  );

  console.log(`[Worker] Scheduled worker started`);
  return scheduledWorker;
}

/**
 * Run reconciliation job
 */
async function runReconciliation(data: ReconciliationJobData): Promise<void> {
  console.log(`[Reconciliation] Starting reconciliation`);

  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // Find unprocessed events from last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const unprocessedEvents = await db.query.stripeEvents.findMany({
    where: (t, { and, eq, gt }) =>
      and(eq(t.processed, false), gt(t.createdAt, oneDayAgo)),
    limit: 100,
  });

  console.log(
    `[Reconciliation] Found ${unprocessedEvents.length} unprocessed events`
  );

  // Queue retries for each
  for (const event of unprocessedEvents) {
    await queueWebhookRetry({ eventId: event.id, delay: 0 });
  }

  console.log(`[Reconciliation] Completed`);
}

/**
 * Run cleanup job
 */
async function runCleanup(data: CleanupJobData): Promise<void> {
  console.log(`[Cleanup] Starting ${data.type} cleanup`);

  switch (data.type) {
    case "idempotency":
      const { cleanupExpiredIdempotencyRecords } =
        await import("./idempotency-v2.service");
      await cleanupExpiredIdempotencyRecords();
      break;

    case "refresh-tokens":
      const { mobileAuthServiceV2 } = await import("./mobile-auth-v2.service");
      await mobileAuthServiceV2.cleanupExpiredTokens();
      break;

    case "expired-bookings":
      await cleanupExpiredBookings();
      break;

    case "seat-holds": {
      const { expireOldHolds } = await import("./inventory/inventory.service");
      await expireOldHolds();
      break;
    }

    case "waitlist-offers": {
      const { expireWaitlistOffers } =
        await import("./inventory/inventory.service");
      await expireWaitlistOffers();
      break;
    }
  }

  console.log(`[Cleanup] ${data.type} cleanup completed`);
}

/**
 * Cleanup expired pending bookings
 */
async function cleanupExpiredBookings(): Promise<void> {
  const db = await getDb();
  if (!db) {
    return;
  }

  // Find bookings that have been pending for more than 30 minutes
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  const result = await db
    .update(bookings)
    .set({
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bookings.status, "pending"),
        lt(bookings.createdAt, thirtyMinutesAgo)
      )
    );

  const expiredCount = (result as any)[0]?.affectedRows || 0;
  console.log(`[Cleanup] Expired ${expiredCount} pending bookings`);
}

// ============================================================================
// LIFECYCLE
// ============================================================================

/**
 * Start all workers
 */
export function startAllWorkers(): void {
  startEmailWorker();
  startWebhookRetryWorker();
  startScheduledWorker();
  console.log(`[Queue] All workers started`);
}

/**
 * Stop all workers gracefully
 */
export async function stopAllWorkers(): Promise<void> {
  console.log(`[Queue] Stopping all workers...`);

  const workers = [emailWorker, webhookRetryWorker, scheduledWorker];

  const results = await Promise.allSettled(
    workers.map(async worker => {
      if (worker) {
        await worker.close();
      }
    })
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[Queue] Failed to stop a worker:`, result.reason);
    }
  }

  emailWorker = null;
  webhookRetryWorker = null;
  scheduledWorker = null;

  console.log(`[Queue] All workers stopped`);
}

/**
 * Close all queues
 */
export async function closeAllQueues(): Promise<void> {
  console.log(`[Queue] Closing all queues...`);

  const results = await Promise.allSettled([
    emailQueue.close(),
    webhookRetryQueue.close(),
    scheduledQueue.close(),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[Queue] Failed to close a queue:`, result.reason);
    }
  }

  console.log(`[Queue] All queues closed`);
}

/**
 * Get queue health status
 */
export async function getQueueHealth(): Promise<{
  email: { waiting: number; active: number; failed: number };
  webhookRetry: { waiting: number; active: number; failed: number };
  scheduled: { waiting: number; active: number; failed: number };
}> {
  const [emailCounts, webhookRetryCounts, scheduledCounts] = await Promise.all([
    emailQueue.getJobCounts(),
    webhookRetryQueue.getJobCounts(),
    scheduledQueue.getJobCounts(),
  ]);

  return {
    email: {
      waiting: emailCounts.waiting,
      active: emailCounts.active,
      failed: emailCounts.failed,
    },
    webhookRetry: {
      waiting: webhookRetryCounts.waiting,
      active: webhookRetryCounts.active,
      failed: webhookRetryCounts.failed,
    },
    scheduled: {
      waiting: scheduledCounts.waiting,
      active: scheduledCounts.active,
      failed: scheduledCounts.failed,
    },
  };
}

export default {
  emailQueue,
  webhookRetryQueue,
  scheduledQueue,
  queueBookingConfirmationEmail,
  queueBookingCancellationEmail,
  queueWebhookRetry,
  scheduleReconciliation,
  scheduleCleanupJobs,
  startAllWorkers,
  stopAllWorkers,
  closeAllQueues,
  getQueueHealth,
};
