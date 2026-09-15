import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { missingMainRules } from "../../../scripts/ci/verify-main-protection.mjs";
const policy = JSON.parse(
  readFileSync(
    new URL("../../../.github/main-ruleset.json", import.meta.url),
    "utf8"
  )
);
const checks = policy.rules
  .find((r: { type: string }) => r.type === "required_status_checks")
  .parameters.required_status_checks.map((c: { context: string }) => c.context);
describe("main protection evidence", () => {
  it("accepts the declared policy but identifies every missing rule", () => {
    expect(missingMainRules(policy.rules, checks)).toEqual([]);
    for (const type of [
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ])
      expect(
        missingMainRules(
          policy.rules.filter((r: { type: string }) => r.type !== type),
          checks
        ).length
      ).toBeGreaterThan(0);
  });
  it("does not accept a similarly named status from another integration", () => {
    const copy = structuredClone(policy);
    copy.rules.find(
      (r: { type: string }) => r.type === "required_status_checks"
    ).parameters.required_status_checks[0].integration_id = 99;
    expect(missingMainRules(copy.rules, checks)).toContain(
      "check:" + checks[0]
    );
  });
});
