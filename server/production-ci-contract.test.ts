import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci-cd.yml", "utf8");

describe("production CI deployment contract", () => {
  it("fails Docker vulnerability scans on HIGH/CRITICAL findings", () => {
    expect(workflow).toContain('exit-code: "1"');
    expect(workflow).not.toContain('exit-code: "0"');
  });

  it("uses the public liveness probe for deployment verification", () => {
    expect(workflow).toContain("/api/trpc/health.live");
    expect(workflow).not.toContain("/api/trpc/health.check");
  });

  it("fails closed when the critical production E2E script is missing", () => {
    expect(workflow).toContain('echo "::error::E2E critical tests script not found"');
    expect(workflow).toContain("exit 1");
    expect(workflow).not.toContain("E2E critical tests script not found, skipping");
  });
});
