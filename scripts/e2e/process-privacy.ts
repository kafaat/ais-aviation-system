import { disposableDatabaseUrl } from "../../e2e/disposable-database";
import { processPrivacyRequests } from "../../server/services/gdpr.service";
import { closePool } from "../../server/db";
import { closeLogger } from "../../server/_core/logger";

const startedAt = performance.now();
function markPhase(
  phase:
    | "processPrivacyRequests:start"
    | "processPrivacyRequests:return"
    | "closePool:start"
    | "closePool:return"
    | "closeLogger:start"
    | "closeLogger:return"
    | "closeLogger:error",
  resourceTypes?: string[],
  failure?: "timeout" | "transport"
) {
  // Direct stderr preserves phase evidence independently of logger cleanup.
  process.stderr.write(
    "[ais-privacy-worker]" +
      JSON.stringify({
        phase,
        elapsedMs: Math.round(performance.now() - startedAt),
        ...(resourceTypes && {
          resourceTypes: [...new Set(resourceTypes)].sort(),
        }),
        ...(failure && { failure }),
      }) +
      "\n"
  );
}

disposableDatabaseUrl();
try {
  markPhase("processPrivacyRequests:start");
  await processPrivacyRequests();
  markPhase("processPrivacyRequests:return");
} finally {
  try {
    markPhase("closePool:start");
    await closePool();
    markPhase("closePool:return", process.getActiveResourcesInfo());
  } finally {
    markPhase("closeLogger:start");
    try {
      await closeLogger();
    } catch (error) {
      // A fixed category preserves diagnosis without exposing arbitrary logs.
      markPhase(
        "closeLogger:error",
        undefined,
        error instanceof Error && error.message === "Logger shutdown timed out"
          ? "timeout"
          : "transport"
      );
      throw error;
    }
    markPhase("closeLogger:return", process.getActiveResourcesInfo());
  }
}
