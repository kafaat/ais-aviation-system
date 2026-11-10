/**
 * Waits for the deployed web replica to answer its liveness endpoint.
 *
 * The acceptance one-shot and the web service roll out from the same commit at
 * the same moment. On 10 November 2026 the runner probed `ais-web` about one
 * second after the new web container started and every request failed with
 * `fetch failed`; the 171 acceptance checks passed, but the login journey could
 * not run and the deployment was recorded as crashed. This wait gives the web
 * replica a bounded window to come up before the probes and the login journey
 * are judged. It never passes anything: an unreachable web is still reported
 * as unreachable and the run is still not accepted.
 */

export interface WebWaitOptions {
  fetchImpl?: typeof fetch;
  /** Total time to keep trying. Default two minutes. */
  timeoutMs?: number;
  /** Pause between attempts. Default three seconds. */
  intervalMs?: number;
  /** Per-request budget. Default five seconds. */
  requestTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WebWaitReport {
  /** True once `/api/rest/health/live` answered with a 2xx status. */
  reachable: boolean;
  attempts: number;
  waitedMs: number;
  lastStatus: number | null;
  lastError: string | null;
}

export const LIVENESS_PATH = "/api/rest/health/live";

export async function waitForWeb(
  baseUrl: URL,
  options: WebWaitOptions = {}
): Promise<WebWaitReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  const started = now();
  const target = new URL(LIVENESS_PATH, baseUrl);
  const report: WebWaitReport = {
    reachable: false,
    attempts: 0,
    waitedMs: 0,
    lastStatus: null,
    lastError: null,
  };

  for (;;) {
    report.attempts += 1;
    try {
      const response = await fetchImpl(target, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      // Drain so the connection can be reused; the body itself is irrelevant.
      await response.text().catch(() => undefined);
      report.lastStatus = response.status;
      report.lastError = null;
      if (response.ok) {
        report.reachable = true;
        break;
      }
    } catch (error) {
      report.lastStatus = null;
      report.lastError = error instanceof Error ? error.message : String(error);
    }
    const elapsed = now() - started;
    if (elapsed + intervalMs > timeoutMs) break;
    await sleep(intervalMs);
  }

  report.waitedMs = now() - started;
  return report;
}
