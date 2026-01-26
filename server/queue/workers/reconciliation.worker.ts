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

export const reconciliationWorker = new Worker<ReconciliationJobData>(
  WORKER_CONFIG.name,
  async (job: Job<ReconciliationJobData>) => {
    console.log(`[ReconciliationWorker] Processing job ${job.id}...`);

    const { limit = 200, triggeredBy = "scheduler" } = job.data;

    try {
      // Update progress
      await job.updateProgress(10);

      // Run reconciliation
      const result = await reconciliationJob({ limit });

      // Update progress
      await job.updateProgress(100);

      // Log summary
      console.log(`[ReconciliationWorker] Job ${job.id} completed:`, {
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
    connection: getRedisConnection(),
    concurrency: WORKER_CONFIG.concurrency,
    limiter: {
      max: 1,
      duration: 60000, // Max 1 job per minute
    },
  }
);

// ============================================================================
// Event Handlers
// ============================================================================

reconciliationWorker.on("completed", (job, result) => {
  console.log(`[ReconciliationWorker] Job ${job.id} completed successfully`);
});

reconciliationWorker.on("failed", (job, error) => {
  console.error(`[ReconciliationWorker] Job ${job?.id} failed:`, error.message);
});

reconciliationWorker.on("error", error => {
  console.error("[ReconciliationWorker] Worker error:", error);
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

export async function closeReconciliationWorker(): Promise<void> {
  console.log("[ReconciliationWorker] Closing worker...");
  await reconciliationWorker.close();
  console.log("[ReconciliationWorker] Worker closed");
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

  console.log(
    `[ReconciliationWorker] Manual reconciliation triggered: ${job.id}`
  );
  return job.id!;
}
