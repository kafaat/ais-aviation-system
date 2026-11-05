import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Every workflow is scanned. There is deliberately no exemption list: a name
// the guard skips would be a way to reintroduce an unpinned action or a
// fail-open job without the test noticing.
const workflowDir = join(process.cwd(), ".github", "workflows");
const workflowFiles = readdirSync(workflowDir).filter(name =>
  /\.ya?ml$/.test(name)
);

function workflow(name: string) {
  return readFileSync(join(workflowDir, name), "utf8");
}

// Isolate job and step blocks so a matching command in an unrelated job cannot
// satisfy a release safety contract. Behavior is exercised by the release
// helper tests; these assertions guard the workflow wiring around those helpers.
function job(text: string, id: string) {
  const jobs = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  const block = jobs
    .split(/(?=^ {2}[\w-]+:\s*$)/m)
    .find(value => value.startsWith(`  ${id}:\n`));
  if (!block) throw new Error(`Workflow job ${id} was not found`);
  return block;
}

function steps(text: string) {
  return text
    .split(/(?=^ {6}- )/m)
    .filter(value => value.startsWith("      - "));
}

function step(text: string, name: string) {
  const block = steps(text).find(value =>
    value.startsWith(`      - name: ${name}\n`)
  );
  if (!block) throw new Error(`Workflow step ${name} was not found`);
  return block;
}

function dependencies(text: string) {
  const value = /^ {4}needs:\s*(.+)$/m.exec(text)?.[1];
  if (!value) return [];
  return value.replace(/^\[|\]$/g, "").split(/,\s*/);
}

describe("CI workflow hardening", () => {
  it("pins every external GitHub Action to an immutable commit SHA", () => {
    const violations: string[] = [];
    for (const name of workflowFiles) {
      const text = readFileSync(join(workflowDir, name), "utf8");
      for (const match of text.matchAll(/^\s*uses:\s*([^\s#]+)@([^\s#]+)/gm)) {
        const action = match[1];
        const ref = match[2];
        if (action.startsWith("./")) continue;
        if (!/^[0-9a-f]{40}$/i.test(ref))
          violations.push(`${name}: ${action}@${ref}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("dispatches the deployment consumer on the exact published tag with the explicit PAT", () => {
    const release = workflow("release.yml");
    const trigger = job(release, "trigger-deployment");
    const detect = step(trigger, "Detect deployment credential");
    const dispatch = step(trigger, "Trigger deployment workflow");
    const consumer = workflow("ci-cd.yml");
    const verify = step(
      job(consumer, "release-deployment"),
      "Verify deployment provenance"
    );
    expect(dependencies(trigger)).toEqual(["check-release", "release"]);
    expect(trigger).toContain(
      "needs.check-release.outputs.mode == 'publish' && !contains(needs.check-release.outputs.tag, '-')"
    );
    expect(release).not.toContain(
      "secrets.DEPLOYMENT_PAT || secrets.GITHUB_TOKEN"
    );
    expect(detect).toContain("DEPLOYMENT_PAT: ${{ secrets.DEPLOYMENT_PAT }}");
    expect(dispatch).toContain(
      "if: steps.deployment-credential.outputs.configured == 'true'"
    );
    expect(dispatch).toContain("GH_TOKEN: ${{ secrets.DEPLOYMENT_PAT }}");
    expect(dispatch).not.toContain("secrets.GITHUB_TOKEN");
    expect(dispatch).toContain(
      "RELEASE_TAG: ${{ needs.check-release.outputs.tag }}"
    );
    expect(dispatch).toContain("RELEASE_COMMIT: ${{ github.sha }}");
    expect(dispatch).toContain(
      'gh workflow run ci-cd.yml --repo "$GITHUB_REPOSITORY" --ref "$RELEASE_TAG"'
    );
    for (const [input, env] of [
      ["release_tag", "RELEASE_TAG"],
      ["release_commit", "RELEASE_COMMIT"],
    ]) {
      expect(dispatch).toContain(`--raw-field ${input}="$${env}"`);
      expect(consumer).toMatch(new RegExp(`^ {6}${input}:$`, "m"));
      expect(verify).toContain(`\${{ inputs.${input} }}`);
    }
    expect(release).not.toMatch(/uses:.*repository-dispatch@/);
  });

  it("verifies the source-bound proposal before a non-forced push to its release branch", () => {
    const propose = job(workflow("release.yml"), "propose");
    const prepare = step(propose, "Prepare or refresh the release proposal");
    const commit = step(propose, "Verify and commit the release proposal");
    const push = step(propose, "Push the verified proposal");
    expect(prepare).toContain("node scripts/ci/release-proposal.mjs prepare");
    expect(commit).toContain("node scripts/ci/release-proposal.mjs commit");
    expect(propose.indexOf(commit)).toBeLessThan(propose.indexOf(push));
    expect(prepare).toContain("RELEASE_SOURCE_SHA: ${{ github.sha }}");
    expect(commit).toContain("RELEASE_SOURCE_SHA: ${{ github.sha }}");
    expect(push).toContain(
      "RELEASE_BRANCH: ${{ steps.proposal.outputs.branch }}"
    );
    expect(push).toContain("RELEASE_HEAD: ${{ steps.commit.outputs.head }}");
    expect(push).toContain('test "$current_main" = "$RELEASE_SOURCE_SHA"');
    expect(push).toContain('test "$current_head" = "$RELEASE_PREVIOUS_HEAD"');
    expect(push).toContain('git push origin "HEAD:refs/heads/$RELEASE_BRANCH"');
    expect(propose).not.toMatch(
      /git push[^\n]*(?:--force|\s-f(?:\s|$)|HEAD:main)/
    );
    const helper = readFileSync(
      join(process.cwd(), "scripts", "ci", "release-proposal.mjs"),
      "utf8"
    );
    expect(helper).toContain("const branch = `release/v${version}`");
    expect(helper).toContain(
      "verifyProposalChanges(git, source, commit, version)"
    );
  });

  // The release commit used to be pushed straight to main with GITHUB_TOKEN,
  // which no ruleset could allow without a bypass. It now travels through a
  // release branch and a pull request, and the checks the ruleset requires are
  // started explicitly because a token-pushed branch starts none by itself.
  it("opens a release PR, selects checks for its current head, and publishes the merged SHA", () => {
    const text = workflow("release.yml");
    const propose = job(text, "propose");
    const pr = step(propose, "Open or update the release pull request");
    const checks = step(
      propose,
      "Start the required checks on the release branch"
    );
    expect(text).not.toContain("git push origin HEAD:main");
    expect(pr).toContain("gh pr create --base main");
    expect(pr).toContain(
      'gh pr edit "$RELEASE_PR" --body-file "$RELEASE_BODY_FILE"'
    );
    expect(checks).toContain("RELEASE_HEAD: ${{ steps.commit.outputs.head }}");
    expect(checks).toContain(
      'RELEASE_WORKFLOW="$workflow" node scripts/ci/release-proposal.mjs checks'
    );
    const helper = readFileSync(
      join(process.cwd(), "scripts", "ci", "release-proposal.mjs"),
      "utf8"
    );
    expect(helper).toMatch(/"--commit",\s*head/);
    expect(helper).toContain("run.headSha === head");
    expect(helper).toContain('run.conclusion !== "action_required"');
    expect(helper).toContain(
      '["pull_request", "workflow_dispatch"].includes(run.event)'
    );
    for (const name of [
      "ci-cd.yml",
      "production-gates.yml",
      "component-labs.yml",
      "docker-image-validation.yml",
    ]) {
      expect(checks).toContain(name);
      expect(workflow(name)).toMatch(/^\s*workflow_dispatch:/m);
    }
    // Publication tags the merged commit itself, not whatever main points at
    // by the time the job runs.
    const publishTarget = step(
      job(text, "release"),
      "Verify the merged release commit"
    );
    expect(publishTarget).toContain("RELEASE_MERGED_SHA: ${{ github.sha }}");
    expect(publishTarget).toContain("release-publication.js prepare");
  });

  // The later push event has no manual inputs. The choice must enter the
  // version calculation and be persisted in the reviewed version suffix.
  it("passes prerelease intent into version calculation and reads the persisted suffix when publishing", () => {
    const release = workflow("release.yml");
    const version = job(release, "version");
    const calculate = step(version, "Calculate new version");
    expect(calculate).toContain("node scripts/ci/release-version.mjs");
    expect(calculate).toContain("CUSTOM_VERSION: ${{ inputs.custom_version }}");
    expect(calculate).toContain("RELEASE_PRERELEASE: ${{ inputs.prerelease }}");
    expect(step(version, "Reuse the active proposal version")).toContain(
      "CANDIDATE_VERSION: ${{ steps.version.outputs.new_version }}"
    );
    expect(job(release, "propose")).toContain(
      "RELEASE_VERSION: ${{ needs.version.outputs.new_version }}"
    );
    const publish = step(job(release, "release"), "Create GitHub Release");
    expect(publish).toContain("release-publication.js publish");
    expect(publish).toContain(
      "RELEASE_TAG: ${{ needs.check-release.outputs.tag }}"
    );
    const publisher = readFileSync(
      join(process.cwd(), "scripts", "ci", "release-publication.js"),
      "utf8"
    );
    expect(publisher).toContain('process.env.RELEASE_PRERELEASE === "true"');
    expect(publisher).toContain('tag.includes("-")');
  });

  it("keeps release deployment behind provenance, normal CI gates and browser acceptance", () => {
    const ci = workflow("ci-cd.yml");
    const verifier = job(ci, "release-deployment");
    expect(verifier).toContain("contents: read");
    expect(verifier).toContain(
      "requested: ${{ steps.verify.outputs.requested }}"
    );
    expect(step(verifier, "Verify deployment provenance")).toContain(
      "run: node scripts/ci/release-deployment.mjs"
    );
    expect(dependencies(job(ci, "lint"))).toContain("release-deployment");
    expect(dependencies(job(ci, "test"))).toContain("lint");
    expect(dependencies(job(ci, "security"))).toContain("lint");
    expect(dependencies(job(ci, "build"))).toEqual(
      expect.arrayContaining(["lint", "test", "security"])
    );
    for (const name of [
      "docker",
      "deploy-production",
      "deploy-docker-compose",
    ]) {
      const deployment = job(ci, name);
      expect(dependencies(deployment)).toContain("release-deployment");
      expect(deployment).toContain(
        "needs.release-deployment.outputs.requested == 'true'"
      );
      expect(deployment).not.toContain(
        "github.event_name == 'workflow_dispatch'"
      );
      if (name !== "docker") {
        expect(dependencies(deployment)).toEqual(
          expect.arrayContaining(["build", "docker", "e2e"])
        );
        expect(deployment).toMatch(/^ {4}environment:$/m);
        expect(deployment).toMatch(/^ {4}concurrency:$/m);
        expect(deployment).toContain("cancel-in-progress: false");
      }
    }
    // Default checkout uses the event SHA. Any explicit override must keep it;
    // checking out main or a mutable tag would invalidate the verified source.
    for (const checkout of steps(ci).filter(value =>
      value.includes("uses: actions/checkout@")
    )) {
      const explicitRef = /^ {10}ref:\s*(.+)$/m.exec(checkout)?.[1];
      if (explicitRef) expect(explicitRef).toBe("${{ github.sha }}");
    }
  });

  it("reports an unconfigured production deployment without sending a success notification", () => {
    const production = job(workflow("ci-cd.yml"), "deploy-production");
    const unconfigured = step(
      production,
      "Report unconfigured Kubernetes deployment"
    );
    expect(unconfigured).toContain(
      "steps.kube-config.outputs.configured != 'true'"
    );
    expect(unconfigured).toContain("no Kubernetes deployment was performed");
    expect(unconfigured).toContain("GITHUB_STEP_SUMMARY");
    expect(step(production, "Notify deployment success")).toContain(
      "steps.kube-config.outputs.configured == 'true'"
    );
  });

  it("rechecks current main inside each production job immediately before mutation", () => {
    const ci = workflow("ci-cd.yml");
    for (const [name, firstMutation] of [
      ["deploy-production", "Create deployment namespace"],
      ["deploy-docker-compose", "Deploy to server"],
    ]) {
      const production = job(ci, name);
      const ordered = steps(production);
      const guard = step(production, "Verify current production source");
      const mutation = step(production, firstMutation);
      expect(production).toMatch(/^ {4}concurrency:$/m);
      expect(guard).toContain(
        "run: node scripts/ci/release-deployment.mjs current-main"
      );
      expect(ordered.indexOf(guard) + 1).toBe(ordered.indexOf(mutation));
      if (name === "deploy-production") {
        expect(guard).toContain(
          "if: steps.kube-config.outputs.configured == 'true'"
        );
      }
    }
  });

  // A bare `eslint .` exits 0 on any number of warnings, so the backlog grew
  // unnoticed. CI must run the capped script, and the cap must be a real bound.
  it("caps ESLint warnings in CI instead of accepting any number", () => {
    const workflow = readFileSync(join(workflowDir, "ci-cd.yml"), "utf8");
    expect(workflow).toContain("run: pnpm lint:ci");
    expect(workflow).not.toMatch(/run:\s*pnpm lint\s*$/m);
    const scripts = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    ).scripts as Record<string, string>;
    const cap = /--max-warnings\s+(\d+)/.exec(scripts["lint:ci"] ?? "");
    expect(cap).not.toBeNull();
    expect(Number(cap?.[1])).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("does not allow literal fail-open jobs or high-severity audit bypasses", () => {
    const violations: string[] = [];
    for (const name of workflowFiles) {
      const text = readFileSync(join(workflowDir, name), "utf8");
      if (/^\s*continue-on-error:\s*true\b/m.test(text))
        violations.push(`${name}: continue-on-error: true`);
      if (/pnpm\s+audit[^\n]*\|\|\s*true/.test(text))
        violations.push(`${name}: pnpm audit || true`);
    }
    expect(violations).toEqual([]);
  });

  it("quotes manual preflight context instead of interpolating it directly into shell commands", () => {
    const text = readFileSync(
      join(workflowDir, "production-db-preflight.yml"),
      "utf8"
    );

    expect(text).toContain(
      "PREFLIGHT_CONTEXT: ${{ inputs.production_context }}"
    );
    expect(text).toContain('--context="$PREFLIGHT_CONTEXT"');
    expect(text).not.toContain("--context=${{ inputs.production_context }}");
  });

  it("verifies the approved detached checkout before invoking preflight tooling", () => {
    const text = readFileSync(
      join(workflowDir, "production-db-preflight.yml"),
      "utf8"
    );

    expect(text).toContain("git fetch --no-tags --depth=1 origin");
    expect(text).toContain("working-directory: /tmp/ais-approved-preflight");
    expect(text).toContain("test -f scripts/db/replay-acceptance.ts");
    expect(text).toContain("test -f scripts/db/migrate.ts");
    expect(text).toContain("test -f scripts/db/schema-contract.ts");
  });
});
