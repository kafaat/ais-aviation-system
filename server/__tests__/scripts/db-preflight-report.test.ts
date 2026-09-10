import { describe, expect, it } from "vitest";
import {
  assertApprovedSha,
  parseArgs,
  readCheckedOutSha,
} from "../../../scripts/db/preflight-report";

describe("parseArgs", () => {
  it("requires a full target SHA and preserves optional context", () => {
    const options = parseArgs([
      "--target-sha=61754aedb29315949c8cc93b6895845974ccc608",
      "--context=production",
      "--report-dir=/tmp/report",
    ]);

    expect(options).toEqual({
      targetSha: "61754aedb29315949c8cc93b6895845974ccc608",
      approvedSha: null,
      context: "production",
      reportDir: "/tmp/report",
    });
  });

  it("rejects non-SHA refs", () => {
    expect(() => parseArgs(["--target-sha=refs/pull/129/head"])).toThrow(
      /TARGET_SHA_INVALID/
    );
  });
});

describe("readCheckedOutSha", () => {
  it("normalizes the current HEAD SHA", () => {
    const sha = readCheckedOutSha(() => "61754AEDB29315949C8CC93B6895845974CCC608\n");

    expect(sha).toBe("61754aedb29315949c8cc93b6895845974ccc608");
  });
});

describe("assertApprovedSha", () => {
  it("fails when the checked-out commit differs from the approved SHA", () => {
    expect(() =>
      assertApprovedSha(
        "APPROVED_SHA",
        "518342fa658f7c6d8029d7af87c402e9a2a74d8a",
        "61754aedb29315949c8cc93b6895845974ccc608"
      )
    ).toThrow(/APPROVED_SHA_MISMATCH/);
  });
});
