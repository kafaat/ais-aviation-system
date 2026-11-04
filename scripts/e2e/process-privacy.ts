import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { disposableDatabaseUrl } from "../../e2e/disposable-database";

// This process must not import the database or logger: thread-stream.end() can
// block its caller synchronously, so that caller cannot enforce its own timer.
// Keep this helper's total budget below the browser's existing 30-second limit.
const defaultBudgetMs = 20_000;
const configuredBudget = process.env.AIS_PRIVACY_WORKER_TIMEOUT_MS;
const budgetMs =
  configuredBudget === undefined ? defaultBudgetMs : Number(configuredBudget);
if (
  (configuredBudget !== undefined && !/^[1-9]\d*$/.test(configuredBudget)) ||
  !Number.isSafeInteger(budgetMs) ||
  budgetMs < 100 ||
  budgetMs > defaultBudgetMs
)
  throw new Error(
    "AIS_PRIVACY_WORKER_TIMEOUT_MS must be an integer between 100 and 20000"
  );
disposableDatabaseUrl();

const startedAt = performance.now();
function markPhase(
  phase: "supervisor:deadline" | "supervisor:signal" | "supervisor:error"
) {
  process.stderr.write(
    "[ais-privacy-worker]" +
      JSON.stringify({
        phase,
        elapsedMs: Math.round(performance.now() - startedAt),
      }) +
      "\n"
  );
}

process.exitCode = await new Promise<number>(resolve => {
  const child = spawn(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      fileURLToPath(new URL("./process-privacy-task.ts", import.meta.url)),
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  let failed = false;
  let stopping = false;
  const stop = (phase: "supervisor:deadline" | "supervisor:signal") => {
    if (stopping) return;
    stopping = true;
    failed = true;
    markPhase(phase);
    // The only process we terminate is this owned child. SIGKILL also stops a
    // blocked transport thread; graceful cleanup cannot run on its stuck loop.
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  };
  const onSignal = () => stop("supervisor:signal");
  const onError = () => {
    failed = true;
    markPhase("supervisor:error");
  };
  const deadline = setTimeout(
    () => stop("supervisor:deadline"),
    Math.max(0, budgetMs - (performance.now() - startedAt))
  );
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  child.on("error", onError);
  child.once("close", code => {
    clearTimeout(deadline);
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    child.off("error", onError);
    // A successful kill request is not proof of exit. Wait for actual closure
    // and retain every timeout, cancellation, spawn failure, or task failure.
    resolve(failed ? 1 : (code ?? 1));
  });
});
