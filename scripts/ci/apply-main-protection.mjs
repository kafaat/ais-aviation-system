/** Apply the prepared main ruleset to GitHub and verify it took effect.
 *
 * `.github/main-ruleset.json` is a prepared policy; this is the one place that
 * turns it into an enforced repository ruleset. It needs a token with
 * repository administration write access, which the CI token never has, so it
 * is run by an operator, not by a workflow:
 *
 *   read -rsp "GitHub admin token: " GITHUB_TOKEN && echo
 *   export GITHUB_TOKEN
 *   node scripts/ci/apply-main-protection.mjs
 *   node scripts/ci/apply-main-protection.mjs --dry-run
 *
 * It creates the ruleset when none of that name exists and updates it in place
 * otherwise; it never deletes or touches any other ruleset. After writing it
 * reads the live rules for main back and reports every required rule that is
 * still missing, using the same check as verify-main-protection.mjs.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  missingMainRules,
  policyApprovals,
} from "./verify-main-protection.mjs";

/** Decide whether the policy is created or updates the existing ruleset of the
 * same name. Pure, so the decision is testable without the API. */
export function planRulesetRequest(existing, policy) {
  if (!policy || policy.target !== "branch" || !Array.isArray(policy.rules))
    throw new Error("Policy must be a branch ruleset with rules");
  const matches = (existing ?? []).filter(r => r.name === policy.name);
  if (matches.length > 1)
    throw new Error(`More than one ruleset is named "${policy.name}"`);
  const [current] = matches;
  return current
    ? { method: "PUT", path: `rulesets/${current.id}`, body: policy }
    : { method: "POST", path: "rulesets", body: policy };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const policy = JSON.parse(
    readFileSync(
      new URL("../../.github/main-ruleset.json", import.meta.url),
      "utf8"
    )
  );
  const repository =
    process.env.GITHUB_REPOSITORY ?? "kafaat/ais-aviation-system";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid repository");
  const token = process.env.GITHUB_TOKEN;
  if (!token)
    throw new Error("GITHUB_TOKEN with administration write is required");
  const api = async (path, options = {}) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        ...options,
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: "Bearer " + token,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
      }
    );
    if (!response.ok)
      throw new Error(
        `GitHub ${options.method ?? "GET"} ${path} failed (HTTP ${response.status})`
      );
    return response.json();
  };
  const existing = await api("rulesets");
  const plan = planRulesetRequest(existing, policy);
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, plan }, null, 2));
    return;
  }
  const written = await api(plan.path, {
    method: plan.method,
    body: JSON.stringify(plan.body),
  });
  const rules = await api("rules/branches/main");
  const expected = policy.rules
    .find(r => r.type === "required_status_checks")
    .parameters.required_status_checks.map(c => c.context);
  const missing = missingMainRules(rules, expected, policyApprovals(policy));
  console.log(
    JSON.stringify(
      {
        appliedAt: new Date().toISOString(),
        ruleset: {
          id: written.id,
          name: written.name,
          enforcement: written.enforcement,
        },
        requiredRulesPresent: missing.length === 0,
        missing,
      },
      null,
      2
    )
  );
  if (missing.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Apply failed");
    process.exitCode = 1;
  });
