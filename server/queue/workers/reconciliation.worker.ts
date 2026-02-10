/**
 * Reconciliation Worker
 *
 * BullMQ worker that processes reconciliation jobs.
 * Runs Stripe payment reconciliation on schedule or on-demand.
 */

import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../queues";
import { reconciliationJob } from "../../jobs/reconciliation.job";

// ============================================================================
// Worker Configuration
// ============================================================================

const WORKER_CONFIG = {
  name: "reconciliation",
  concurrency: 1, // Only one reconciliation at a time
};

// ============================================================================
// Job Types
// ============================================================================

interface ReconciliationJobData {
  limit?: number;
  triggeredBy?: string;
}

// ============================================================================
// Worker Definition
// ============================================================================

const redisConnection = getRedisConnection();

if (!redisConnection) {
  console.warn(
    "[ReconciliationWorker] Redis connection not available, worker disabled"
  );
}

export const reconciliationWorker = redisConnection
  ? new Worker<ReconciliationJobData>(
      WORKER_CONFIG.name,
      async (job: Job<ReconciliationJobData>) => {
        console.info(`[ReconciliationWorker] Processing job ${job.id}...`);

        const { limit = 200, triggeredBy = "scheduler" } = job.data;

        try {
          // Update progress
          await job.updateProgress(10);

          // Run reconciliation
          const result = await reconciliationJob({ limit });

          // Update progress
          await job.updateProgress(100);

          // Log summary
          console.info(`[ReconciliationWorker] Job ${job.id} completed:`, {
            triggeredBy,
            scanned: result.scanned,
            fixed: result.fixed,
            errors: result.errors,
            durationMs: result.durationMs,
          });

          return result;
        } catch (error) {
          console.error(`[ReconciliationWorker] Job ${job.id} failed:`, error);
          throw error;
        }
      },
      {
        connection: redisConnection,
        concurrency: WORKER_CONFIG.concurrency,
        limiter: {
          max: 1,
          duration: 60000, // Max 1 job per minute
        },
      }
    )
  : (null as any); // Fallback when Redis is not available

// ============================================================================
// Event Handlers
// ============================================================================

if (reconciliationWorker) {
  reconciliationWorker.on("completed", (job: Job, result: any) => {
    console.info(`[ReconciliationWorker] Job ${job.id} completed successfully`);
  });

  reconciliationWorker.on("failed", (job: Job | undefined, error: Error) => {
    console.error(
      `[ReconciliationWorker] Job ${job?.id} failed:`,
      error.message
    );
  });

  reconciliationWorker.on("error", (error: Error) => {
    console.error("[ReconciliationWorker] Worker error:", error);
  });
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

export async function closeReconciliationWorker(): Promise<void> {
  if (!reconciliationWorker) {
    console.info(
      "[ReconciliationWorker] Worker not initialized, skipping close"
    );
    return;
  }
  console.info("[ReconciliationWorker] Closing worker...");
  await reconciliationWorker.close();
  console.info("[ReconciliationWorker] Worker closed");
}

// ============================================================================
// Manual Trigger
// ============================================================================

/**
 * Manually trigger a reconciliation job
 */
export async function triggerReconciliation(options?: {
  limit?: number;
  triggeredBy?: string;
}): Promise<string> {
  const { reconciliationQueue } = await import("../queues");

  if (!reconciliationQueue) {
    throw new Error("Reconciliation queue not available (Redis not connected)");
  }

  const job = await reconciliationQueue.add(
    "manual-reconciliation",
    {
      limit: options?.limit ?? 200,
      triggeredBy: options?.triggeredBy ?? "manual",
    },
    {
      priority: 1, // High priority for manual triggers
    }
  );

  console.info(
    `[ReconciliationWorker] Manual reconciliation triggered: ${job.id}`
  );
  return job.id!;
}
