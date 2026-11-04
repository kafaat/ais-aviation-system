import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  getStandardReportDefinitions,
  listStandardReports,
} from "../services/standard-reports.service";
import { standardReportDefinitionSchema } from "../contracts/standard-reports";

it("registers every audited reference exactly once with explicit access and source limits", () => {
  const expected = ["ops", "finance", "distribution"]
    .flatMap(
      domain =>
        JSON.parse(
          readFileSync(
            new URL(
              `../../docs/audits/reporting-review-20261104/${domain}.json`,
              import.meta.url
            ),
            "utf8"
          )
        ).rows as { id: number; title: string }[]
    )
    .sort((a, b) => a.id - b.id);
  const catalog = getStandardReportDefinitions();
  expect(catalog.map(report => report.id)).toEqual(
    Array.from({ length: 99 }, (_, index) => index + 1)
  );
  expect(
    catalog.map(report => ({ id: report.id, title: report.title }))
  ).toEqual(expected.map(({ id, title }) => ({ id, title })));
  for (const report of catalog) {
    expect(standardReportDefinitionSchema.safeParse(report).success).toBe(true);
    expect(new Set(report.filters).size).toBe(report.filters.length);
    if (report.availability !== "available")
      expect(report.limitations.length).toBeGreaterThan(0);
  }
  const admin = { id: 1, role: "admin", tenantId: null };
  expect(listStandardReports(admin, null)).toHaveLength(99);
  expect(
    listStandardReports({ ...admin, role: "ops", tenantId: 101 }, 101).every(
      report => report.category === "operations"
    )
  ).toBe(true);
  expect(
    listStandardReports(
      { ...admin, role: "finance", tenantId: 101 },
      101
    ).every(report => report.category === "finance")
  ).toBe(true);
});
