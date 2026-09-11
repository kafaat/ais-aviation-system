import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  forensicSql,
  inspectForensicData,
  forensicFindings,
} from "../../../scripts/ci/forensic-data-audit";

describe("forensic data evidence", () => {
  it("keeps the operator SQL generated from the executed findings", () => {
    expect(
      readFileSync("scripts/sql/forensic-data-preflight.sql", "utf8")
    ).toBe(forensicSql());
  });
  it("rejects unbounded samples before touching a connection", async () => {
    const connection = { query: vi.fn(), rollback: vi.fn() };
    await expect(inspectForensicData(connection as any, 201)).rejects.toThrow(
      "INVALID_SAMPLE_LIMIT"
    );
    expect(connection.query).not.toHaveBeenCalled();
  });
  it("does not misreport failed queries as zero or expose driver content", async () => {
    const connection = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith("SELECT"))
          throw new Error("mysql://private:password@host customer passport");
        return [];
      }),
      rollback: vi.fn(async () => undefined),
    };
    const report = await inspectForensicData(connection as any);
    expect(report.status).toBe("blocked");
    expect(report.findings).toHaveLength(forensicFindings.length);
    expect(
      report.findings.every(f => f.count === null && f.error === "QUERY_FAILED")
    ).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/password|passport|mysql:\/\//);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
  it("retains full counts, bounds identifiers and discards all other database columns", async () => {
    const connection = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("COUNT(*) AS total")) return [[{ total: 25 }]];
        if (sql.startsWith("SELECT"))
          return [[{ recordId: 1, firstName: "PRIVATE", passport: "PRIVATE" }]];
        return [];
      }),
      rollback: vi.fn(async () => undefined),
    };
    const report = await inspectForensicData(connection as any, 1);
    expect(report.status).toBe("review_required");
    expect(
      report.findings.every(
        f => f.count === 25 && f.truncated && f.recordIds.length === 1
      )
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("PRIVATE");
  });
});
