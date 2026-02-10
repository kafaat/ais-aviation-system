/**
 * Reconciliation Job
 *
 * Scheduled job that runs Stripe reconciliation.
 * Can be triggered by cron, queue, or manually via admin API.
 */

import {
  runStripeReconciliation,
  ReconciliationResult,
} from "../services/stripe/stripe-reconciliation.service";

// ============================================================================
// Job Configuration
// ============================================================================

const JOB_CONFIG = {
  name: "stripe-reconciliation",
  defaultLimit: 200,
  maxRetries: 3,
  retryDelayMs: 5000,
};

// ============================================================================
// Main Job Function
// ============================================================================

/**
 * Execute the reconciliation job.
 *
 * @param options.limit - Maximum records to process
 * @param options.dryRun - If true, only log what would be done (not implemented yet)
 */
export async function reconciliationJob(options?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<ReconciliationResult> {
  const limit = options?.limit ?? JOB_CONFIG.defaultLimit;

  console.info(`[${JOB_CONFIG.name}] Starting reconciliation job...`);
  console.info(`[${JOB_CONFIG.name}] Config: limit=${limit}`);

  const startTime = Date.now();

  try {
    const result = await runStripeReconciliation({ limit });

    const duration = Date.now() - startTime;

    console.info(`[${JOB_CONFIG.name}] Completed in ${duration}ms`);
    console.info(`[${JOB_CONFIG.name}] Results:`, {
      scanned: result.scanned,
      fixed: result.fixed,
      errors: result.errors,
    });

    // Log details for debugging
    if (result.details.length > 0) {
      console.info(`[${JOB_CONFIG.name}] Details:`);
      for (const detail of result.details) {
        console.info(`  - Booking #${detail.bookingId}: ${detail.action}`);
        if (detail.error) {
          console.warn(`    Error: ${detail.error}`);
        }
      }
    }

    return result;
  } catch (error) {
    console.error(`[${JOB_CONFIG.name}] Fatal error:`, error);
    throw error;
  }
}

// ============================================================================
// CLI Runner (for manual execution)
// ============================================================================

/**
 * Run reconciliation from command line.
 * Usage: npx ts-node server/jobs/reconciliation.job.ts
 */
async function main(): Promise<void> {
  console.info("=".repeat(60));
  console.info("Stripe Reconciliation Job - Manual Run");
  console.info("=".repeat(60));

  try {
    const result = await reconciliationJob();

    console.info("\n" + "=".repeat(60));
    console.info("Final Summary:");
    console.info("=".repeat(60));
    console.info(`  Scanned: ${result.scanned}`);
    console.info(`  Fixed: ${result.fixed}`);
    console.info(`  Errors: ${result.errors}`);
    console.info(`  Duration: ${result.durationMs}ms`);

    process.exit(result.errors > 0 ? 1 : 0);
  } catch (error) {
    console.error("Job failed:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
