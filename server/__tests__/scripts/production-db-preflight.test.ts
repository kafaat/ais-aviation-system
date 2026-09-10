import { describe, expect, it } from "vitest";
import {
  assertApprovedSha,
  parseArgs,
  readGitSha,
} from "../../../scripts/ci/production-db-preflight";

describe("parseArgs", () => {
  it("requires a full target SHA and tool repository", () => {
    const options = parseArgs([
      "--target-sha=61754aedb29315949c8cc93b6895845974ccc608",
      "--tool-repo=/tmp/approved",
      "--context=production",
      "--report-dir=/tmp/report",
    ]);

    expect(options).toEqual({
      targetSha: "61754aedb29315949c8cc93b6895845974ccc608",
      approvedSha: null,
      context: "production",
      reportDir: "/tmp/report",
      toolRepo: "/tmp/approved",
    });
  });

  it("rejects non-SHA refs", () => {
    expect(() =>
      parseArgs([
        "--target-sha=refs/pull/129/head",
        "--tool-repo=/tmp/approved",
      ])
    ).toThrow(/TARGET_SHA_INVALID/);
  });
});

describe("readGitSha", () => {
  it("reads the approved checkout SHA from the requested repository", () => {
    const sha = readGitSha("/tmp/approved", (_command, args) => {
      expect(args).toEqual(["-C", "/tmp/approved", "rev-parse", "HEAD"]);
      return "61754AEDB29315949C8CC93B6895845974CCC608\n";
    });

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
