import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertApprovedSha,
  parseArgs,
  readGitSha,
  writePreflightReport,
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

describe("writePreflightReport", () => {
  it("writes a fail report with redacted database credentials", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "preflight-report-"));
    const password = "secret";
    const databaseUrl = [
      "mysql://reader",
      `${password}@example.com:3306/ais`,
    ].join(":");
    let queryCount = 0;
    const connection = {
      query: () => {
        queryCount += 1;
        if (queryCount === 1) return Promise.resolve([[{ name: "ais" }]]);
        if (queryCount === 2)
          return Promise.resolve([[{ TABLE_NAME: "__drizzle_migrations" }]]);
        if (queryCount === 3) return Promise.resolve([[]]);
        throw new Error("unexpected query");
      },
      end: () => Promise.resolve(),
    };

    const report = await writePreflightReport(
      {
        targetSha: "518342fa658f7c6d8029d7af87c402e9a2a74d8a",
        approvedSha: "518342fa658f7c6d8029d7af87c402e9a2a74d8a",
        context: "production",
        reportDir,
        toolRepo: "/tmp",
      },
      databaseUrl,
      {
        readGitSha: () => "518342fa658f7c6d8029d7af87c402e9a2a74d8a",
        createConnection: () => Promise.resolve(connection as never),
        loadToolModules: () =>
          Promise.resolve({
            migrate: {
              runMigration: () => {
                throw new Error(
                  `failed for ${databaseUrl} and reader:${password}@ against production`
                );
              },
            },
            schemaContract: {
              readHistory: () => [
                {
                  idx: 0,
                  tag: "0000_alpha",
                  when: 100,
                  hash: "abc",
                  snapshot: {},
                },
              ],
              appliedMigrationCount: () => Promise.resolve(0),
              readDatabaseContract: () => Promise.resolve({}),
              snapshotContract: () => ({}),
              differences: () => [],
            },
          }),
      }
    );

    const jsonReport = readFileSync(
      join(reportDir, "preflight-report.json"),
      "utf8"
    );

    expect(report.classification).toBe("fail");
    expect(report.preflight.status).toBe("FAIL");
    expect(report.preflight.error).not.toContain(databaseUrl);
    expect(report.preflight.error).not.toContain("secret");
    expect(report.database.migrationTablePresent).toBe(true);
    expect(report.database.actualMigrationCount).toBe(0);
    expect(report.database.verifiedAppliedCount).toBe(0);
    expect(jsonReport).not.toContain(databaseUrl);
    expect(jsonReport).not.toContain("reader:secret@");

    rmSync(reportDir, { recursive: true, force: true });
  });

  it("clears partial schema fields when schema inspection fails", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "preflight-report-"));
    let queryCount = 0;
    const connection = {
      query: () => {
        queryCount += 1;
        if (queryCount === 1) return Promise.resolve([[{ name: "ais" }]]);
        if (queryCount === 2) return Promise.resolve([[]]);
        throw new Error("unexpected query");
      },
      end: () => Promise.resolve(),
    };

    const report = await writePreflightReport(
      {
        targetSha: "518342fa658f7c6d8029d7af87c402e9a2a74d8a",
        approvedSha: null,
        context: "production",
        reportDir,
        toolRepo: "/tmp",
      },
      ["mysql://reader", "secret@example.com:3306/ais"].join(":"),
      {
        readGitSha: () => "518342fa658f7c6d8029d7af87c402e9a2a74d8a",
        createConnection: () => Promise.resolve(connection as never),
        loadToolModules: () =>
          Promise.resolve({
            migrate: {
              runMigration: () => Promise.resolve(),
            },
            schemaContract: {
              readHistory: () => [
                {
                  idx: 0,
                  tag: "0000_alpha",
                  when: 100,
                  hash: "abc",
                  snapshot: {},
                },
              ],
              appliedMigrationCount: () => Promise.resolve(0),
              readDatabaseContract: () => {
                throw new Error("schema inspection failed");
              },
              snapshotContract: () => ({}),
              differences: () => {
                throw new Error("should not be called");
              },
            },
          }),
      }
    );

    expect(report.schema.actualTableCount).toBeNull();
    expect(report.schema.appliedSnapshotTableCount).toBeNull();
    expect(report.schema.appliedSnapshotDiffCount).toBeNull();

    rmSync(reportDir, { recursive: true, force: true });
  });
});
