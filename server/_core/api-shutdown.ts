import type { Server } from "node:http";

type Cleanup = () => void | Promise<unknown>;

interface ShutdownOptions {
  server: Pick<Server, "close">;
  log: {
    info: (fields: Record<string, unknown>, message: string) => void;
    error: (fields: Record<string, unknown>, message: string) => void;
  };
  stopSLAMonitoring: Cleanup;
  stopOperationalObservations: Cleanup;
  stopSystemMetricsCollection: Cleanup;
  flushSentry: Cleanup;
  stopTracing: Cleanup;
  closePool: Cleanup;
  exit: (code: number) => void;
  timeoutMs?: number;
}

/** Stop accepting requests, drain producers, and close the resources they own. */
export function createApiShutdown(options: ShutdownOptions) {
  let shutdown: Promise<void> | undefined;

  async function perform(signal: string) {
    const { log } = options;
    let finished = false;
    let failed = false;
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      options.exit(code);
    };
    const timeout = setTimeout(() => {
      log.error(
        { event: "forced_shutdown", signal },
        "Forceful shutdown after timeout."
      );
      finish(1);
    }, options.timeoutMs ?? 10_000);

    // Each cleanup is independent: a telemetry failure must not prevent pool
    // closure, and a close failure must never be reported as a successful exit.
    async function step(event: string, message: string, cleanup: Cleanup) {
      if (finished) return;
      try {
        await cleanup();
        if (!finished) log.info({ event }, message);
      } catch (error) {
        failed = true;
        if (!finished)
          log.error(
            { event: `${event}_error`, error },
            `Shutdown step failed: ${event}`
          );
      }
    }

    log.info(
      { event: "shutdown_initiated", signal },
      `${signal} received. Starting graceful shutdown...`
    );
    await step(
      "sla_stopped",
      "SLA monitoring stopped.",
      options.stopSLAMonitoring
    );
    await step(
      "http_server_closed",
      "HTTP server closed.",
      () =>
        new Promise<void>((resolve, reject) => {
          options.server.close(error => (error ? reject(error) : resolve()));
        })
    );
    await step(
      "observations_stopped",
      "Final operational observations flushed.",
      options.stopOperationalObservations
    );
    await step(
      "apm_stopped",
      "APM metrics collection stopped.",
      options.stopSystemMetricsCollection
    );
    await step("sentry_flushed", "Sentry events flushed.", async () => {
      if ((await options.flushSentry()) === false)
        throw new Error("Sentry flush timed out");
    });
    await step("tracing_stopped", "Tracing stopped.", options.stopTracing);
    await step(
      "database_closed",
      "Database connections closed.",
      options.closePool
    );
    if (finished) return;
    if (failed)
      log.error({ event: "shutdown_failed" }, "Graceful shutdown failed.");
    else
      log.info({ event: "shutdown_completed" }, "Graceful shutdown completed.");
    finish(failed ? 1 : 0);
  }

  return (signal: string) => {
    // Assign before running user callbacks so repeated signals share one drain.
    shutdown ??= Promise.resolve().then(() => perform(signal));
    return shutdown;
  };
}
