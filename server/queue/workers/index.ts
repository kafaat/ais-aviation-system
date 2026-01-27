/**
 * Queue Workers Index
 *
 * Exports all workers and provides initialization/shutdown functions.
 */

import {
  reconciliationWorker,
  closeReconciliationWorker,
} from "./reconciliation.worker";
import { emailWorker, closeEmailWorker } from "./email.worker";

// Re-export workers
export { reconciliationWorker } from "./reconciliation.worker";
export { emailWorker } from "./email.worker";

// Re-export helper functions
export { triggerReconciliation } from "./reconciliation.worker";
export {
  queueBookingConfirmationEmail,
  queueBookingCancellationEmail,
  queueFlightReminderEmail,
} from "./email.worker";

/**
 * Start all workers
 */
export async function startWorkers(): Promise<void> {
  console.log("[Workers] Starting all workers...");

  // Workers are started automatically when imported
  // This function is for explicit initialization if needed

  console.log("[Workers] All workers started:");
  console.log("  - reconciliationWorker: running");
  console.log("  - emailWorker: running");
}

/**
 * Stop all workers gracefully
 */
export async function stopWorkers(): Promise<void> {
  console.log("[Workers] Stopping all workers...");

  await Promise.all([closeReconciliationWorker(), closeEmailWorker()]);

  console.log("[Workers] All workers stopped");
}

/**
 * Get worker status
 */
export function getWorkersStatus(): Record<
  string,
  { running: boolean; paused: boolean }
> {
  return {
    reconciliation: {
      running: reconciliationWorker.isRunning?.() ?? false,
      paused: reconciliationWorker.isPaused?.() ?? false,
    },
    email: {
      running: emailWorker.instance.isRunning?.() ?? false,
      paused: emailWorker.instance.isPaused?.() ?? false,
    },
  };
}
