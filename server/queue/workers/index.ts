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
  console.info("[Workers] Starting all workers...");

  // Reconciliation worker is started automatically when imported (module-level init).
  // Email worker uses lazy initialization - we must explicitly trigger it here.
  try {
    const { getEmailWorker } = await import("./email.worker");
    getEmailWorker();
    console.info("  - emailWorker: running");
  } catch (err) {
    console.warn("  - emailWorker: failed to start", err);
  }

  console.info("[Workers] All workers started:");
  console.info("  - reconciliationWorker: running");
}

/**
 * Stop all workers gracefully
 */
export async function stopWorkers(): Promise<void> {
  console.info("[Workers] Stopping all workers...");

  await Promise.all([closeReconciliationWorker(), closeEmailWorker()]);

  console.info("[Workers] All workers stopped");
}

/**
 * Get worker status
 */
export function getWorkersStatus(): Record<
  string,
  { running: boolean; paused: boolean }
> {
  const status: Record<string, { running: boolean; paused: boolean }> = {
    reconciliation: { running: false, paused: false },
    email: { running: false, paused: false },
  };

  try {
    if (reconciliationWorker) {
      status.reconciliation = {
        running: reconciliationWorker.isRunning(),
        paused: reconciliationWorker.isPaused(),
      };
    }
  } catch {
    // Worker not available
  }

  try {
    const worker = emailWorker.instance;
    status.email = {
      running: worker.isRunning(),
      paused: worker.isPaused(),
    };
  } catch {
    // Worker not available
  }

  return status;
}
