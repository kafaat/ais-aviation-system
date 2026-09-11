import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const state = vi.hoisted(() => ({
  db: null as any,
  results: [] as any[][],
  queries: [] as { sql: string; params: unknown[] }[],
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  financialInteger,
  getFinancialGroups,
  getFinancialExport,
} from "../services/booking-financial-reporting.service";
import {
  getRevenueDashboard,
  getRevenueByChannel,
  getYieldAnalysis,
  getReports,
  generateRevenueReport,
  calculateDeferredRevenue,
} from "../services/revenue-accounting.service";
import {
  exportRevenueToCSV,
  exportRevenueToExcel,
  generateRevenuePDF,
} from "../services/report-export.service";
import { exportRevenueData } from "../services/data-warehouse.service";
import { reportsRouter } from "../routers/reports";
import { revenueAccountingRouter } from "../routers/revenue-accounting";
import { responseContracts } from "../contracts/revenue-accounting";
const day = Date.parse("2024-02-15T00:00:00Z") / 86400000;
function row(overrides: Record<string, unknown> = {}) {
  return {
    timeKey: String(day),
    originCode: "AAA",
    originCity: "Origin",
    destinationCode: "BBB",
    destinationCity: "Destination",
    airlineCode: "ZZ",
    cabinClass: "economy",
    channel: "ambiguous",
    flightId: 1,
    flightNumber: "ZZ01",
    itineraryType: "single_flight",
    collectedAmount: "10001.00",
    refundedAmount: "7501.00",
    activeBookings: "1",
    collectedBookings: "1",
    refundedBookings: "1",
    collectionEntries: "2",
    refundEntries: "2",
    passengerCount: "1",
    unmatchedCollectionEntries: "0",
    reviewCollectionAmount: "0",
    invalidAmounts: "0",
    bookedAmount: "99999",
    bookedCount: "2",
    unpostedPaidBookings: "1",
    ...overrides,
  };
}
function ctx(role = "admin") {
  return {
    user: { id: 9, role },
    tenantId: null,
    authMethod: "cookie",
    req: { headers: {} },
    res: { setHeader: vi.fn() },
  } as any;
}
beforeEach(() => {
  vi.restoreAllMocks();
  state.results = [];
  state.queries = [];
  const dialect = new MySqlDialect();
  state.db = {
    execute: vi.fn(async (statement: any) => {
      state.queries.push(dialect.sqlToQuery(statement));
      return [state.results.shift() ?? [row()]];
    }),
  };
  state.db.transaction = vi.fn(async (fn: (tx: any) => unknown) =>
    fn(state.db)
  );
});
describe("posted financial reporting boundaries", () => {
  it("keeps paid booking face value independent of posted collections and returns no invented recognition", async () => {
    const data = await getRevenueDashboard();
    expect(data).toMatchObject({
      totalRevenue: 10001,
      refundTotal: 7501,
      netRevenue: 2500,
      bookedAmount: 99999,
      totalBookings: 1,
      unpostedPaidBookings: 1,
      recognizedRevenue: null,
      deferredRevenue: null,
      ancillaryRevenue: null,
      revenueGrowthPercent: null,
    });
    expect(state.db.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    const contract = responseContracts.getDashboard.parse({
      ...data,
      ownerEmail: "secret@example.invalid",
    });
    expect(contract).not.toHaveProperty("ownerEmail");
  });
  it("exports identical exact amounts in CSV, actual XLSX and actual PDF", async () => {
    const csv = await exportRevenueToCSV({});
    expect(csv).toContain("Posted Collections (SAR)");
    expect(csv).toContain("100.01,75.01,25.00");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportRevenueToExcel({}));
    const summary = JSON.stringify(
      wb.getWorksheet("Summary")!.getSheetValues()
    );
    expect(summary).toContain("100.01");
    expect(summary).toContain("75.01");
    expect(summary).toContain("25.00");
    expect(summary).toContain("Unavailable");
    expect(wb.getWorksheet("Daily Settlements")!.rowCount).toBe(2);
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const pdf = await generateRevenuePDF({});
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(text.mock.calls.map(r => r[0])).toContain(
      "Net Posted Amount: 25.00 SAR"
    );
  });
  it("does not add per-day booking counts to create a false distinct-period total", async () => {
    state.results = [[row()], [row(), row({ timeKey: day + 1 })]];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportRevenueToExcel({}));
    const sheet = wb.getWorksheet("Summary")!;
    const metric = sheet
      .getRows(1, sheet.rowCount)!
      .find(
        row => row.getCell(1).value === "Active Bookings (distinct/period)"
      )!;
    expect(metric.getCell(2).value).toBe(1);
    expect(wb.getWorksheet("Daily Settlements")!.rowCount).toBe(3);
  });
  it("preserves negative refund-only period net as a numeric warehouse value", async () => {
    const negative = row({
      collectedAmount: 0,
      collectedBookings: 0,
      collectionEntries: 0,
      refundedAmount: 7501,
    });
    for (const format of ["json", "jsonl", "csv"] as const) {
      state.results = [[negative], [negative]];
      const result = await exportRevenueData({
        dateRange: {
          startDate: new Date("2024-02-15"),
          endDate: new Date("2024-02-16"),
        },
        format,
      });
      expect(result.recordCount).toBe(1);
      expect(result.data).toContain("-7501");
      expect(result.data).not.toContain("'-7501");
      if (format !== "csv") {
        const r =
          format === "json"
            ? JSON.parse(result.data)[0]
            : JSON.parse(result.data);
        expect(r.netPostedAmountMinor).toBe(-7501);
        expect(r.recognizedRevenueMinor).toBeNull();
        expect(r.schemaVersion).toBe(2);
      }
    }
  });
  it("escapes untrusted warehouse text without changing typed money", async () => {
    state.results = [[row()], [row({ originCity: "=SUM(1,2)" })]];
    const csv = await exportRevenueData({
      dateRange: {
        startDate: new Date("2024-02-15"),
        endDate: new Date("2024-02-16"),
      },
      format: "csv",
    });
    expect(csv.data).toContain('"\'=SUM(1,2)"');
    expect(csv.data).toContain("10001,7501,2500");
  });
  it("refuses incremental financial aggregates rather than silently replaying a full export", async () => {
    await expect(
      exportRevenueData({
        dateRange: { startDate: new Date(0), endDate: new Date() },
        format: "json",
        incremental: true,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.db.execute).not.toHaveBeenCalled();
  });
  it.each([
    null,
    undefined,
    "",
    true,
    "1.25",
    -1,
    "9007199254740992",
    "9007199254740990.75",
    " ",
    "1e3",
    {},
    NaN,
    Infinity,
  ])("rejects invalid or unsafe numeric evidence %s", value => {
    expect(() => financialInteger(value)).toThrow(
      "Invalid financial reporting value"
    );
  });
  it("rejects corrupt individual amounts even when positive and negative rows would offset", async () => {
    state.results = [[row({ invalidAmounts: 2 })]];
    await expect(getFinancialGroups({}, "total")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("does not truncate reports exceeding the group cap", async () => {
    state.results = [Array.from({ length: 10001 }, () => row())];
    await expect(getFinancialGroups({}, "day")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
  it("prints every PDF day beyond the former thirty-day cut-off", async () => {
    state.results = [
      [row()],
      Array.from({ length: 35 }, (_, i) => row({ timeKey: day + i })),
    ];
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateRevenuePDF({});
    expect(
      text.mock.calls.some(([v]) => String(v).startsWith("2024-03-20:"))
    ).toBe(true);
  });
  it("uses the whole UTC end day for every revenue export RPC and honors one-sided filters", async () => {
    const caller = reportsRouter.createCaller(ctx());
    await caller.exportRevenueCSV({ endDate: "2024-02-29" });
    const params = state.queries[0].params;
    expect(params).toContain(Date.parse("2024-02-29T23:59:59.999Z") / 1000);
    expect(state.queries[0].sql).not.toContain(
      "UNIX_TIMESTAMP(l.transactionDate) >="
    );
    await expect(
      caller.exportRevenueCSV({
        startDate: "2024-03-01",
        endDate: "2024-02-29",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.generateRevenuePDF({ startDate: "not-a-date" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("validates service dates before opening the database snapshot", async () => {
    await expect(
      getFinancialExport({ startDate: new Date("invalid") })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.db.transaction).not.toHaveBeenCalled();
  });
  it("sanitizes nested database failures without leaking SQL or secrets", async () => {
    state.db.execute.mockRejectedValue({
      message: "SELECT secret_password",
      cause: { code: "ER_BAD_FIELD_ERROR", sql: "secret" },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getRevenueDashboard()).rejects.toMatchObject({
      message: "Financial reporting unavailable",
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(error).toHaveBeenCalledWith(
      "[financial-reporting] Query failed",
      "ER_BAD_FIELD_ERROR"
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
  });
  it("enforces administrator ownership before reading financial records", async () => {
    await expect(
      revenueAccountingRouter.createCaller(ctx("user")).getDashboard()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reportsRouter.createCaller(ctx("airline_admin")).exportRevenueExcel({})
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.db.execute).not.toHaveBeenCalled();
  });
  it("does not turn conflicting channel links into negative direct sales", async () => {
    const result = await getRevenueByChannel();
    expect(result[0].channel).toBe("ambiguous");
    expect(result[0].totalRevenue).toBe(10001);
    expect(result[0].percentageOfTotal).toBe(100);
  });
  it("does not fabricate yield or deferred revenue from status or airport numeric IDs", async () => {
    const result = await getYieldAnalysis();
    expect(result[0]).toMatchObject({
      totalRevenue: 10001,
      distanceKm: null,
      yield: null,
      rpk: null,
      loadFactor: null,
    });
    expect(await calculateDeferredRevenue()).toMatchObject({
      total: null,
      recognitionStatus: "unavailable",
    });
  });
  it("labels monthly output as a preview and uses leap-year UTC boundaries", async () => {
    const data = await generateRevenueReport(2, 2024, 9);
    expect(data).toMatchObject({
      status: "preview",
      periodStart: "2024-02-01",
      periodEnd: "2024-02-29",
      totalRevenue: 10001,
      refundAmount: 7501,
      recognizedRevenue: null,
    });
    expect(state.queries[0].params).toContain(
      Date.parse("2024-02-29T23:59:59.999Z") / 1000
    );
    state.results = [[row({ timeKey: 202402 })]];
    expect((await getReports())[0]).toMatchObject({
      status: "preview",
      netRevenue: 2500,
      refundAmount: 7501,
    });
    await expect(generateRevenueReport(1.5, 2024, 9)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
