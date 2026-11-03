import { disposableDatabaseUrl } from "../../e2e/disposable-database";
import { processPrivacyRequests } from "../../server/services/gdpr.service";
import { closePool } from "../../server/db";

const startedAt = performance.now();
function markPhase(
  phase:
    | "processPrivacyRequests:start"
    | "processPrivacyRequests:return"
    | "closePool:start"
    | "closePool:return",
  resourceTypes?: string[]
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
  markPhase("closePool:start");
  await closePool();
  markPhase("closePool:return", process.getActiveResourcesInfo());
}
