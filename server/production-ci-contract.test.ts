import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci-cd.yml", "utf8");

// Bound assertions to one step: the SARIF reporting step intentionally succeeds
// while separate scans enforce the vulnerability threshold. Stop at the next
// step or job instead of allowing a different scan to satisfy the assertion.
const steps = [
  ...workflow.matchAll(/^ {6}- name: (.+)\n((?:(?: {8,}.*|[ \t]*)\n)*)/gm),
].map(match => ({ name: match[1], text: match[0] }));

function stepNamed(name: string): string {
  const matches = steps.filter(step => step.name === name);
  expect(matches, `Expected exactly one CI step named ${name}`).toHaveLength(1);
  return matches[0].text;
}

describe("production CI deployment contract", () => {
  it("fails each filesystem and Docker vulnerability scan on HIGH/CRITICAL findings", () => {
    const blockingScans = [
      "Reject high or critical filesystem vulnerabilities",
      "Scan Docker image for vulnerabilities",
      "Scan migrator image for vulnerabilities",
      "Scan auth service image for vulnerabilities",
    ];
    const trivySteps = steps.filter(step =>
      /^ {8}uses: aquasecurity\/trivy-action@/m.test(step.text)
    );
    expect(trivySteps.map(step => step.name).sort()).toEqual(
      ["Run Trivy vulnerability scanner", ...blockingScans].sort()
    );

    for (const name of blockingScans) {
      const step = stepNamed(name);
      expect(step, name).toMatch(/^ {10}exit-code: "1"$/m);
      expect(step, name).toMatch(/^ {10}severity: "CRITICAL,HIGH"$/m);
      expect(step, name).toMatch(/^ {10}format: "table"$/m);
      expect(step, name).not.toMatch(/^ {8}(?:continue-on-error|if):/m);
    }

    for (const step of trivySteps) {
      expect(step.text, step.name).not.toMatch(
        /^ {10}(?:ignore-unfixed|ignore-policy|trivyignores|skip-dirs|skip-files):/m
      );
    }

    const filesystem = stepNamed(blockingScans[0]);
    expect(filesystem).toMatch(/^ {10}scan-type: "fs"$/m);
    expect(filesystem).toMatch(/^ {10}scan-ref: "\."$/m);

    for (const [name, suffix] of [
      [blockingScans[1], ""],
      [blockingScans[2], "-migrator"],
      [blockingScans[3], "-auth"],
    ]) {
      expect(stepNamed(name)).toContain(
        "          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}" +
          suffix +
          ":sha-${{ needs.build.outputs.sha_short }}\n"
      );
    }
  });

  it("keeps complete SARIF reporting separate from the blocking scans", () => {
    const report = stepNamed("Run Trivy vulnerability scanner");
    expect(report).toMatch(/^ {10}scan-type: "fs"$/m);
    expect(report).toMatch(/^ {10}scan-ref: "\."$/m);
    expect(report).toMatch(/^ {10}format: "sarif"$/m);
    expect(report).toMatch(/^ {10}output: "trivy-results\.sarif"$/m);
    expect(report).toMatch(/^ {10}exit-code: "0"$/m);
    expect(report).not.toMatch(
      /^ {10}(?:severity|limit-severities-for-sarif):/m
    );
    expect(report).not.toMatch(/^ {8}(?:continue-on-error|if):/m);

    const upload = stepNamed("Upload Trivy scan results");
    expect(upload).toMatch(/^ {8}uses: github\/codeql-action\/upload-sarif@/m);
    expect(upload).toMatch(/^ {8}if: always\(\)$/m);
    expect(upload).toMatch(/^ {10}sarif_file: "trivy-results\.sarif"$/m);
    expect(upload).not.toMatch(/^ {8}continue-on-error:/m);
  });

  it("uses the public liveness probe for deployment verification", () => {
    expect(workflow).toContain("/api/trpc/health.live");
    expect(workflow).not.toContain("/api/trpc/health.check");
  });

  it("fails closed when the critical production E2E script is missing", () => {
    expect(workflow).toContain(
      'echo "::error::E2E critical tests script not found"'
    );
    expect(workflow).toContain("exit 1");
    expect(workflow).not.toContain(
      "E2E critical tests script not found, skipping"
    );
  });
});
