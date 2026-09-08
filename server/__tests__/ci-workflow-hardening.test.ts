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
});
