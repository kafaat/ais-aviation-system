import cron from "node-cron";
import { releaseExpiredLocks } from "./inventory-lock.service";
import { runScheduledTask } from "./scheduled-task.service";
import { logger, logInfo, logError } from "../_core/logger";
import { runOutboxRelay } from "./outbox.service";

/**
 * Publish pending transactional-outbox events to the bus.
 * Runs every minute. Errors are swallowed so a relay hiccup never crashes cron.
 */
export async function relayOutboxEvents() {
  try {
    const { published, failed } = await runOutboxRelay();
    if (published > 0 || failed > 0) {
      logInfo(`Outbox relay: ${published} published, ${failed} failed`);
    }
  } catch (error) {
    logError(error as Error, { operation: "relayOutboxEvents" });
  }
}

/**
 * Clean up expired inventory locks
 * Runs every 5 minutes
 */
export async function cleanupExpiredLocks() {
  await releaseExpiredLocks();
}

export const PERIODIC_JOB_CATALOG = [
  {
    name: "operationalAlerts",
    cron: "* * * * *",
    periodMs: 60000,
    run: async () => {
      const { refreshOperationalAlerts } =
        await import("./operational-observations.service");
      await refreshOperationalAlerts();
    },
  },
  {
    name: "flightCancellationRefunds",
    cron: "* * * * *",
    periodMs: 60000,
    run: async () => {
      const { processFlightCancellations } =
        await import("./flight-cancellation.service");
      await processFlightCancellations();
    },
  },
  {
    name: "channelAllocationExpiry",
    cron: "* * * * *",
    periodMs: 60000,
    run: async () => {
      const { processExpiredOffers } = await import("./waitlist.service");
      const { expireGroupAllocations } =
        await import("./group-booking.service");
      const results = await Promise.allSettled([
        processExpiredOffers(),
        expireGroupAllocations(),
      ]);
      const failed = results.filter(r => r.status === "rejected");
      if (failed.length)
        throw new AggregateError(
          failed.map(r => r.reason),
          "Allocation expiration failed"
        );
    },
  },
  {
    name: "orderServiceRefunds",
    cron: "* * * * *",
    periodMs: 60000,
    run: async () => {
      const { processPendingOrderRefunds } =
        await import("./order-refunds.service");
      await processPendingOrderRefunds();
    },
  },
  {
    name: "splitRefunds",
    cron: "* * * * *",
    periodMs: 60_000,
    run: async () => {
      const { processPendingSplitRefunds } =
        await import("./split-refund.service");
      await processPendingSplitRefunds();
    },
  },
  {
    name: "bagDropExpiry",
    cron: "* * * * *",
    periodMs: 60_000,
    run: async () => {
      const { expireBagDropSessions } = await import("./bag-drop.service");
      await expireBagDropSessions();
    },
  },
  {
    name: "cleanupExpiredLocks",
    cron: "*/5 * * * *",
    periodMs: 5 * 60_000,
    run: cleanupExpiredLocks,
  },
  {
    name: "relayOutboxEvents",
    cron: "* * * * *",
    periodMs: 60_000,
    run: async () => {
      const result = await runOutboxRelay();
      if (result.failed)
        throw new Error(`${result.failed} outbox deliveries failed`);
    },
  },
  {
    name: "checkInReminders",
    cron: "0 * * * *",
    periodMs: 60 * 60_000,
    run: async () => {
      const { runCheckInReminderJob } =
        await import("../jobs/check-in-reminder.job");
      const result = await runCheckInReminderJob();
      if (result.errors.length) throw new Error(result.errors.join("; "));
    },
  },
  {
    name: "loyaltyExpiry",
    cron: "0 0 * * *",
    periodMs: 86400000,
    run: async () => {
      const { runMilesExpirationJob } =
        await import("../jobs/loyalty-cleanup.job");
      const result = await runMilesExpirationJob();
      if (!result.success) throw new Error(result.error);
    },
  },
  {
    name: "priceAlerts",
    cron: "*/15 * * * *",
    periodMs: 15 * 60_000,
    run: async () => {
      const { checkAlerts } = await import("./price-alerts.service");
      await checkAlerts();
    },
  },
  {
    name: "warehouseExports",
    cron: "* * * * *",
    periodMs: 60_000,
    run: async () => {
      const { processScheduledExports } =
        await import("./data-warehouse.service");
      await processScheduledExports();
    },
  },
] as const;

const scheduledTasks: Array<{ stop: () => void | Promise<void> }> = [];
const runningJobs = new Set<string>();

/**
 * Run a cron tick with an in-process re-entrancy guard: if the previous tick
 * of the same job is still running (slow DB, large outbox backlog), skip this
 * tick instead of stacking overlapping runs.
 */
async function runGuarded(name: string, job: () => Promise<void>) {
  if (runningJobs.has(name)) {
    logger.warn({ job: name }, "Previous cron tick still running; skipping");
    return;
  }
  runningJobs.add(name);
  try {
    logger.debug({}, `Running cron job: ${name}`);
    await runScheduledTask(
      name,
      String(
        Math.floor(
          Date.now() /
            (PERIODIC_JOB_CATALOG.find(j => j.name === name)?.periodMs ?? 60000)
        )
      ),
      job
    );
  } finally {
    runningJobs.delete(name);
  }
}

/**
 * Initialize and start all cron jobs.
 *
 * Call this from ONE process only (the background worker, see
 * server/worker.ts) — not from every web replica — so periodic work such as
 * the outbox relay is not multiplied by the number of app instances.
 * Idempotent: a second call is a no-op.
 */
export function startCronJobs() {
  if (scheduledTasks.length > 0) {
    logger.warn({}, "Cron jobs already started; ignoring duplicate call");
    return;
  }
  logger.info({}, "Starting cron jobs...");

  for (const job of PERIODIC_JOB_CATALOG)
    scheduledTasks.push(
      cron.schedule(
        job.cron,
        () =>
          runGuarded(job.name, job.run).catch(error =>
            logError(error as Error, { operation: job.name })
          ),
        { timezone: "UTC" }
      )
    );

  logger.info({}, "Cron jobs started successfully");
}

/** Stop all scheduled cron jobs (graceful shutdown). */
export async function stopCronJobs() {
  if (scheduledTasks.length === 0) return;
  logger.info({}, "Stopping cron jobs...");
  for (const task of scheduledTasks.splice(0)) {
    await task.stop();
  }
}

/**
 * Manually trigger cron jobs (for testing)
 */
export async function triggerCronJobs() {
  logger.info({}, "Manually triggering cron jobs");
  await cleanupExpiredLocks();
  await relayOutboxEvents();
  logger.info({}, "Cron jobs completed");
}
