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

  it("does not fall back to GITHUB_TOKEN for optional release deployment dispatch", () => {
    const text = readFileSync(join(workflowDir, "release.yml"), "utf8");
    expect(text).not.toContain(
      "secrets.DEPLOYMENT_PAT || secrets.GITHUB_TOKEN"
    );
    expect(text).toContain("DEPLOYMENT_PAT: ${{ secrets.DEPLOYMENT_PAT }}");
    expect(text).toContain(
      "if: steps.deployment-credential.outputs.configured == 'true'"
    );
    expect(text).toContain("token: ${{ secrets.DEPLOYMENT_PAT }}");
  });

  // The release bot's commit is the tip of main and the one commit no workflow
  // runs against, because a GITHUB_TOKEN push starts no new run. It is only safe
  // while it carries nothing but the version bump, so the proof must run before
  // the push and must not become a separate optional step.
  it("proves the release commit carries no code before pushing it to main", () => {
    const text = readFileSync(join(workflowDir, "release.yml"), "utf8");
    const verify = text.indexOf("Verify the release commit changes no code");
    const push = text.indexOf("name: Push version bump");
    expect(verify).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(verify);
    expect(text).toContain(
      "git diff --name-only HEAD~1 HEAD | grep -vxE 'CHANGELOG\\.md|package\\.json'"
    );
    expect(text).toContain("jq -S 'del(.version)'");
    // The bump must no longer be committed and pushed in one unguarded step.
    expect(text).not.toMatch(
      /git commit -m "chore\(release\)[^\n]*\n\s*git push/
    );
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
