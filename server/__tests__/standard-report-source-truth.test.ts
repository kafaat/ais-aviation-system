import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StandardReportDefinition } from "../../shared/standard-reports";
const state = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: state.getDb }));
import {
  authorizeStandardReport,
  getStandardReportDefinitions,
  runStandardReport,
} from "../services/standard-reports.service";
import { getOperationsStandardReport } from "../services/standard-reports-ops.service";
import { getFinanceStandardReport } from "../services/standard-reports-finance.service";
import { getCommercialStandardReport } from "../services/standard-reports-commercial.service";
import { availableReportCases } from "./fixtures/standard-reports-available.fixture";

const definitions = getStandardReportDefinitions();
const baseline = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/audits/reporting-completion-20261104/catalog.json",
      import.meta.url
    ),
    "utf8"
  )
) as { rows: StandardReportDefinition[] };
const ledger = readFileSync(
  new URL(
    "../../docs/remediation/20261104-report-source-acceptance-ledger.md",
    import.meta.url
  ),
  "utf8"
);
const dependencies = new Map<
  number,
  {
    availability: "partial" | "blocked";
    missingSource: string;
    acceptance: string;
  }
>();
let section: "partial" | "blocked" | undefined;
for (const line of ledger.split("\n")) {
  if (line.startsWith("## 28 ")) section = "blocked";
  else if (line.startsWith("## 35 ")) section = "partial";
  else if (line.startsWith("## ")) section = undefined;
  if (!section || !/^\|\s*\d+\s*\|/.test(line)) continue;
  const fields = line.split("|").map(value => value.trim());
  const id = Number(fields[1]);
  if (dependencies.has(id))
    throw new Error(`Duplicate report dependency ${id}`);
  dependencies.set(id, {
    availability: section,
    missingSource: fields[3],
    acceptance: fields[4],
  });
}
beforeEach(() => {
  state.getDb.mockReset().mockImplementation(() => {
    throw new Error("A blocked report must not query an unavailable source");
  });
});

describe("all 99 report source and capability declarations", () => {
  it("accounts for every available fixture and every partial/blocked source dependency exactly once", () => {
    expect(definitions.map(report => report.id)).toEqual(
      Array.from({ length: 99 }, (_, i) => i + 1)
    );
    expect(
      definitions.filter(report => report.availability === "available")
    ).toHaveLength(36);
    expect(
      definitions.filter(report => report.availability === "partial")
    ).toHaveLength(35);
    expect(
      definitions.filter(report => report.availability === "blocked")
    ).toHaveLength(28);
    expect(dependencies.size).toBe(63);
    expect(
      availableReportCases.map(report => report.id).sort((a, b) => a - b)
    ).toEqual(
      definitions
        .filter(report => report.availability === "available")
        .map(report => report.id)
    );
  });
  it.each(definitions)(
    "report $id keeps its declared source boundary and role matrix",
    definition => {
      const recorded = baseline.rows.find(
        report => report.id === definition.id
      );
      expect(definition).toEqual(recorded);
      const dependency = dependencies.get(definition.id);
      if (definition.availability === "available")
        expect(dependency).toBeUndefined();
      else {
        expect(dependency?.availability).toBe(definition.availability);
        expect(dependency?.missingSource.length).toBeGreaterThan(10);
        expect(dependency?.acceptance.length).toBeGreaterThan(10);
        expect(definition.limitations.length).toBeGreaterThan(0);
      }
      for (const role of [
        "user",
        "support",
        "ops",
        "finance",
        "airline_admin",
        "admin",
        "super_admin",
      ]) {
        const platform = role === "admin" || role === "super_admin";
        const allowed =
          platform ||
          role === "airline_admin" ||
          (role === "ops" && definition.category === "operations") ||
          (role === "finance" && definition.category === "finance");
        const actor = { id: 7, role, tenantId: platform ? null : 101 };
        const authorize = () =>
          authorizeStandardReport(actor, actor.tenantId, definition.id);
        if (allowed)
          expect(authorize()).toEqual({
            userId: 7,
            tenantId: platform ? undefined : 101,
          });
        else expect(authorize).toThrow();
        if (!platform) {
          expect(() =>
            authorizeStandardReport(actor, null, definition.id)
          ).toThrow();
          expect(() =>
            authorizeStandardReport(actor, 202, definition.id)
          ).toThrow();
        }
      }
    }
  );
  it.each(definitions.filter(report => report.availability === "blocked"))(
    "report $id fails before any query or exportable result can imply source availability",
    async definition => {
      const scope = { userId: 7 };
      await expect(
        runStandardReport({ reportId: definition.id, filters: {} }, scope)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      const reader =
        definition.category === "operations"
          ? getOperationsStandardReport
          : definition.category === "finance"
            ? getFinanceStandardReport
            : getCommercialStandardReport;
      await expect(reader(definition.id, {}, scope)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(state.getDb).not.toHaveBeenCalled();
    }
  );
});
