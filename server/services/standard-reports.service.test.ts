import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({
  ops: vi.fn(),
  finance: vi.fn(),
  commercial: vi.fn(),
}));
vi.mock("./standard-reports-ops.service", () => ({
  operationsReportDefinitions: [
    {
      id: 5,
      title: "Daily Flight Load",
      category: "operations",
      availability: "available",
      description: "Flight observations",
      limitations: [],
      filters: ["startDate", "endDate", "flightId"],
    },
  ],
  getOperationsStandardReport: readers.ops,
}));
vi.mock("./standard-reports-finance.service", () => ({
  financeReportDefinitions: [
    {
      id: 55,
      title: "Payments",
      category: "finance",
      availability: "available",
      description: "Payment entries",
      limitations: [],
      filters: ["startDate", "endDate"],
    },
    {
      id: 10,
      title: "Expired Tickets",
      category: "finance",
      availability: "blocked",
      description: "Expiry",
      limitations: ["Ticket expiration evidence is not recorded"],
      filters: [],
    },
  ],
  getFinanceStandardReport: readers.finance,
}));
vi.mock("./standard-reports-commercial.service", () => ({
  commercialReportDefinitions: [
    {
      id: 30,
      title: "Frequent Flyer Membership",
      category: "commercial",
      availability: "available",
      description: "Membership",
      limitations: [],
      filters: ["startDate", "endDate"],
    },
  ],
  getCommercialStandardReport: readers.commercial,
}));

import {
  authorizeStandardReport,
  listStandardReports,
  renderStandardReport,
  runStandardReport,
} from "./standard-reports.service";
import { reportTable, standardReportPeriod } from "./standard-report-utils";
import { standardReportRequestSchema } from "../contracts/standard-reports";

const scope = { userId: 21, tenantId: 101 };
const actor = { id: 21, role: "ops", tenantId: 101 };
beforeEach(() => {
  vi.clearAllMocks();
  readers.ops.mockResolvedValue({
    columns: [
      { key: "flight", label: "Flight", type: "text" },
      { key: "booked", label: "Booked", type: "number" },
      { key: "unknown", label: "Unknown", type: "number" },
    ],
    rows: [
      {
        flight: "=SUM(1,2)",
        booked: 0,
        unknown: null,
        secret: "DO-NOT-EXPOSE",
      },
    ],
    notes: ["Local operational evidence"],
  });
});

describe("standard report authorization and projections", () => {
  it("keeps ops, finance, and administrative access separate and validates tenant identity", () => {
    expect(listStandardReports(actor, 101).map(row => row.id)).toEqual([5]);
    expect(() => authorizeStandardReport(actor, 101, 55)).toThrow(
      "outside your role"
    );
    expect(() =>
      authorizeStandardReport({ ...actor, role: "finance" }, 101, 5)
    ).toThrow("outside your role");
    expect(() => authorizeStandardReport(actor, 202, 5)).toThrow("tenant");
    expect(() =>
      authorizeStandardReport({ ...actor, tenantId: null }, null, 5)
    ).toThrow("tenant");
    expect(() =>
      authorizeStandardReport({ ...actor, role: "user" }, 101, 5)
    ).toThrow("role");
    expect(
      authorizeStandardReport({ ...actor, role: "admin" }, null, 55)
    ).toEqual({ userId: 21, tenantId: undefined });
    expect(
      authorizeStandardReport({ ...actor, role: "airline_admin" }, 101, 30)
    ).toEqual(scope);
  });
  it("uses the real reader scope and drops every unregistered output field", async () => {
    const result = await runStandardReport(
      {
        reportId: 5,
        filters: { flightId: 42 },
        columns: ["unknown", "flight"],
      },
      scope
    );
    expect(readers.ops).toHaveBeenCalledWith(5, { flightId: 42 }, scope);
    expect(result.rows).toEqual([{ unknown: null, flight: "=SUM(1,2)" }]);
    expect(result.columns.map(column => column.key)).toEqual([
      "unknown",
      "flight",
    ]);
    expect(JSON.stringify(result)).not.toContain("DO-NOT-EXPOSE");
  });
  it("rejects unsupported filters, unknown columns, duplicate columns and blocked sources", async () => {
    await expect(
      runStandardReport({ reportId: 5, filters: { officeId: 4 } }, scope)
    ).rejects.toThrow("does not support");
    expect(readers.ops).not.toHaveBeenCalled();
    await expect(
      runStandardReport({ reportId: 10, filters: {} }, scope)
    ).rejects.toThrow("expiration evidence");
    await expect(
      runStandardReport(
        { reportId: 5, filters: {}, columns: ["secret"] },
        scope
      )
    ).rejects.toThrow("Select unique columns");
    await expect(
      runStandardReport(
        { reportId: 5, filters: {}, columns: ["flight", "flight"] },
        scope
      )
    ).rejects.toThrow("Select unique columns");
    expect(
      standardReportRequestSchema.safeParse({
        reportId: 5,
        filters: { sql: "select * from users" },
      }).success
    ).toBe(false);
  });
  it("fails before publishing a truncated result and uses inclusive UTC end days", () => {
    expect(() =>
      reportTable(
        [{ key: "id", label: "ID", type: "number" }],
        Array.from({ length: 10001 }, (_, id) => ({ id }))
      )
    ).toThrow("no rows were silently omitted");
    const period = standardReportPeriod({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    expect(period.start?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(period.end?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
  it("does not expose database statements or personal data in an unexpected reader failure", async () => {
    readers.ops.mockRejectedValue(
      new Error("SQL driver failed with passenger-secret-value")
    );
    await expect(
      runStandardReport({ reportId: 5, filters: {} }, scope)
    ).rejects.toThrow("No partial output was published");
    await expect(
      runStandardReport({ reportId: 5, filters: {} }, scope)
    ).rejects.not.toThrow("passenger-secret");
  });
});

describe("standard report documents", () => {
  it("neutralizes spreadsheet formula injection while preserving zero and unknown distinctly", async () => {
    const result = await runStandardReport({ reportId: 5, filters: {} }, scope);
    const csv = renderStandardReport(result, "csv");
    expect(csv.content).toContain('"\'=SUM(1,2)",0,');
    expect(csv.content).not.toContain("DO-NOT-EXPOSE");
    expect(csv.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(csv.recordCount).toBe(1);
  });
  it("imports signed numeric amounts and zero as numbers while preserving negative-leading strings as protected text", async () => {
    readers.finance.mockResolvedValue({
      columns: [
        // Serialization must follow the actual cell primitive, not the label
        // or a column's display type.
        { key: "amount", label: "Signed amount", type: "text" },
        { key: "reference", label: "Reference", type: "number" },
      ],
      rows: [
        { amount: -2345, reference: "-2345" },
        { amount: 0, reference: "-2+3" },
        { amount: 123, reference: "=SUM(1,2)" },
      ],
      notes: [],
    });
    const result = await runStandardReport(
      { reportId: 55, filters: {} },
      scope
    );
    const csv = renderStandardReport(result, "csv");
    // ExcelJS is an existing direct dependency. Its CSV reader independently
    // exercises the exported bytes and its normal numeric import behavior.
    const sheet = await new ExcelJS.Workbook().csv.read(
      Readable.from([csv.content])
    );
    expect([
      sheet.getCell("A2").value,
      sheet.getCell("A3").value,
      sheet.getCell("A4").value,
    ]).toEqual([-2345, 0, 123]);
    expect([
      sheet.getCell("B2").value,
      sheet.getCell("B3").value,
      sheet.getCell("B4").value,
    ]).toEqual(["'-2345", "'-2+3", "'=SUM(1,2)"]);
    expect(csv.content).toContain("\r\n-2345,'-2345\r\n0,'-2+3\r\n123,");
  });
  it.each([
    ["null", null],
    ["empty text", ""],
  ] as const)(
    "preserves a single-column %s record at EOF",
    async (_name, value) => {
      readers.ops.mockResolvedValue({
        columns: [{ key: "value", label: "Value", type: "text" }],
        rows: [{ value }],
        notes: [],
      });
      const result = await runStandardReport(
        { reportId: 5, filters: {} },
        scope
      );
      const csv = renderStandardReport(result, "csv");
      expect(csv.content).toBe('\uFEFFValue\r\n""');
      const sheet = await new ExcelJS.Workbook().csv.read(
        Readable.from([csv.content])
      );
      expect(sheet.rowCount).toBe(2);
      expect(sheet.getCell("A2").value).toBeNull();
      expect(csv.recordCount).toBe(sheet.rowCount - 1);
      expect(csv.checksum).toBe(
        createHash("sha256").update(csv.content, "utf8").digest("hex")
      );
    }
  );
  it("retains consecutive and trailing empty records alongside numeric zero", async () => {
    readers.ops.mockResolvedValue({
      columns: [{ key: "value", label: "Value", type: "number" }],
      rows: [
        { value: null },
        { value: "" },
        { value: 0 },
        { value: null },
        { value: "" },
      ],
      notes: [],
    });
    const result = await runStandardReport(
      { reportId: 5, filters: {}, columns: ["value"] },
      scope
    );
    const csv = renderStandardReport(result, "csv");
    expect(csv.content).toBe('\uFEFFValue\r\n""\r\n""\r\n0\r\n""\r\n""');
    const sheet = await new ExcelJS.Workbook().csv.read(
      Readable.from([csv.content])
    );
    expect(sheet.rowCount).toBe(6);
    expect(
      Array.from({ length: 5 }, (_, index) => sheet.getCell(index + 2, 1).value)
    ).toEqual([null, null, 0, null, null]);
    expect(csv.recordCount).toBe(sheet.rowCount - 1);
    expect(csv.checksum).toBe(
      createHash("sha256").update(csv.content, "utf8").digest("hex")
    );
  });
  it("keeps formula-leading headers and text neutralized while quoting embedded delimiters", async () => {
    readers.ops.mockResolvedValue({
      columns: [{ key: "value", label: "=SUM(1,2)", type: "text" }],
      rows: [
        { value: "+1+2" },
        { value: "@SUM(A1:A2)" },
        { value: "\t=SUM(1,2)" },
        { value: 'ordinary,"quoted"\ntext' },
      ],
      notes: [],
    });
    const result = await runStandardReport({ reportId: 5, filters: {} }, scope);
    const csv = renderStandardReport(result, "csv");
    const sheet = await new ExcelJS.Workbook().csv.read(
      Readable.from([csv.content])
    );
    expect(
      Array.from({ length: 5 }, (_, index) => sheet.getCell(index + 1, 1).value)
    ).toEqual([
      "'=SUM(1,2)",
      "'+1+2",
      "'@SUM(A1:A2)",
      "'\t=SUM(1,2)",
      'ordinary,"quoted"\ntext',
    ]);
    expect(csv.recordCount).toBe(sheet.rowCount - 1);
  });
  it("escapes HTML and XML including labels, notes and data and produces parseable XML", async () => {
    readers.ops.mockResolvedValue({
      columns: [
        { key: "name", label: '<img src=x onerror="alert(1)">', type: "text" },
        { key: "value", label: "Value", type: "number" },
      ],
      rows: [{ name: "<script>alert('x')</script>&", value: null }],
      notes: ["<svg onload='x'>"],
    });
    const result = await runStandardReport({ reportId: 5, filters: {} }, scope);
    const html = renderStandardReport(result, "html").content;
    const dom = new JSDOM(html);
    expect(dom.window.document.querySelector("script,img,svg")).toBeNull();
    expect(dom.window.document.querySelector("td")?.textContent).toBe(
      "<script>alert('x')</script>&"
    );
    expect(html).toContain("Not recorded");
    const xml = renderStandardReport(result, "xml").content;
    const xmlDom = new JSDOM(xml, { contentType: "text/xml" });
    expect(
      xmlDom.window.document.querySelector('cell[key="name"]')?.textContent
    ).toBe("<script>alert('x')</script>&");
    expect(
      xmlDom.window.document
        .querySelector('cell[key="value"]')
        ?.getAttribute("nil")
    ).toBe("true");
  });
  it("includes the selected schema in an empty report and rejects oversized output", async () => {
    const result = await runStandardReport({ reportId: 5, filters: {} }, scope);
    expect(
      renderStandardReport({ ...result, rows: [], total: 0 }, "csv").content
    ).toBe("\uFEFFFlight,Booked,Unknown");
    expect(() =>
      renderStandardReport(
        {
          ...result,
          rows: [
            { flight: "x".repeat(8 * 1024 * 1024), booked: 0, unknown: null },
          ],
        },
        "xml"
      )
    ).toThrow("8 MiB");
  });
});
