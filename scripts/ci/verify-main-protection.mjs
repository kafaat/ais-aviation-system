import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
/** The approval count is read from the policy rather than assumed: the
 * repository has two collaborators and chose zero required approvals, keeping
 * the pull-request rule for its other guarantees (stale-review dismissal,
 * last-push approval when a review exists, thread resolution) and relying on
 * the twelve required checks. Passing 1 restores the stricter reading. */
export function missingMainRules(rules, required, minimumApprovals = 0) {
  const missing = [];
  for (const type of ["deletion", "non_fast_forward"])
    if (!rules.some(r => r.type === type)) missing.push(type);
  const review = rules
    .filter(r => r.type === "pull_request")
    .map(r => r.parameters ?? {});
  for (const key of [
    "dismiss_stale_reviews_on_push",
    "require_last_push_approval",
    "required_review_thread_resolution",
  ])
    if (!review.some(r => r[key] === true)) missing.push(key);
  if (
    !review.some(
      r =>
        Number.isInteger(r.required_approving_review_count) &&
        r.required_approving_review_count >= minimumApprovals
    )
  )
    missing.push("approving_review");
  const checks = rules
    .filter(r => r.type === "required_status_checks")
    .map(r => r.parameters ?? {});
  if (!checks.some(r => r.strict_required_status_checks_policy === true))
    missing.push("current_base");
  for (const name of required)
    if (
      !checks.some(r =>
        r.required_status_checks?.some(
          c => c.context === name && c.integration_id === 15368
        )
      )
    )
      missing.push("check:" + name);
  return missing;
}
export function policyApprovals(policy) {
  const count = policy.rules.find(r => r.type === "pull_request")?.parameters
    ?.required_approving_review_count;
  if (!Number.isInteger(count) || count < 0)
    throw new Error("Policy must declare required_approving_review_count");
  return count;
}
async function main() {
  const policy = JSON.parse(
    readFileSync(
      new URL("../../.github/main-ruleset.json", import.meta.url),
      "utf8"
    )
  );
  const expected = policy.rules
    .find(r => r.type === "required_status_checks")
    .parameters.required_status_checks.map(c => c.context);
  const repository =
    process.env.GITHUB_REPOSITORY ?? "kafaat/ais-aviation-system";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid repository");
  const read = async path => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: "Bearer " + process.env.GITHUB_TOKEN }
            : {}),
        },
      }
    );
    if (!response.ok)
      throw new Error(`GitHub read unavailable (HTTP ${response.status})`);
    return response.json();
  };
  const before = await read("branches/main");
  const rules = await read("rules/branches/main");
  const after = await read("branches/main");
  if (before.commit.sha !== after.commit.sha)
    throw new Error("main changed during inspection; retry");
  const missing = missingMainRules(rules, expected, policyApprovals(policy));
  const releaseWorkflowCompatible = !/git push origin HEAD:main/.test(
    readFileSync(
      new URL("../../.github/workflows/release.yml", import.meta.url),
      "utf8"
    )
  );
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        sha: after.commit.sha,
        protected: after.protected,
        requiredRulesPresent: missing.length === 0,
        missing,
        releaseWorkflowCompatible,
        bypassPolicy:
          "Must separately inspect repository/organization ruleset bypass actors with administration read access",
      },
      null,
      2
    )
  );
  if (missing.length || !releaseWorkflowCompatible) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => {
    console.error(
      error instanceof Error ? error.message : "Protection verification failed"
    );
    process.exitCode = 1;
  });
