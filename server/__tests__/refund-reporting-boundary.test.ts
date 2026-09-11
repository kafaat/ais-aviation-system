import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  getRefundStats,
  getRefundHistory,
  getRefundTrends,
  getRefundExportRows,
} from "../services/refunds-stats.service";
import {
  exportRefundsToCSV,
  exportRefundsToExcel,
  generateRefundsPDF,
} from "../services/report-export.service";
import { responseContracts } from "../contracts/refunds";
import { reportsRouter } from "../routers/reports";
import { refundsRouter } from "../routers/refunds";

function queryRows(rows: unknown[]) {
  const query: any = {};
  for (const method of [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "groupBy",
    "orderBy",
    "limit",
    "offset",
  ])
    query[method] = vi.fn(() => query);
  query.then = (
    ok: (r: unknown[]) => unknown,
    fail?: (e: unknown) => unknown
  ) => Promise.resolve(rows).then(ok, fail);
  const db: any = { select: vi.fn(() => query) };
  db.transaction = vi.fn((run: (db: any) => Promise<unknown>) => run(db));
  return { db, query };
}
function caller(role: string | null = "admin") {
  return {
    user: role ? { id: 9, role } : null,
    authMethod: "jwt",
    tenantId: null,
    req: { headers: {} },
    res: {},
  } as any;
}
const rows = [3001, 4500].map((amount, i) => ({
  id: 100 + i,
  bookingId: 7,
  userId: 9,
  bookingReference: "FORMULA",
  pnr: "ABCDEF",
  amount: String(amount),
  refundedAtEpoch: new Date(`2026-09-11T${10 + i}:00:00Z`).getTime() / 1000,
  userEmail: "=SUM(1,2)",
  flightNumber: "ZX01",
  origin: "A",
  destination: "B",
}));
beforeEach(() => {
  vi.restoreAllMocks();
  state.db = queryRows(rows).db;
});

describe("refund reporting money and failure boundaries", () => {
  it("exports posted minor amounts consistently across CSV, XLSX and real PDF rendering", async () => {
    const csv = await exportRefundsToCSV({});
    expect(csv).toContain("30.01");
    expect(csv).toContain("45.00");
    expect(csv).toContain("Settlement ID");
    expect(csv).toContain("'=SUM(1,2)");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportRefundsToExcel({}));
    const values = workbook.getWorksheet("Summary")!.getSheetValues();
    expect(JSON.stringify(values)).toContain("75.01");
    expect(workbook.getWorksheet("Refunds")!.getCell("E2").value).toBe(
      "=SUM(1,2)"
    ); // A literal string, not an Excel formula object.
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const pdf = await generateRefundsPDF({});
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(text.mock.calls.map(c => c[0])).toContain(
      "Total Refunded Amount: 75.01 SAR"
    );
    expect(text.mock.calls.map(c => c[0])).toContain(
      "2026-09-11: 2 entries - 75.01 SAR"
    );
  });
  it("keeps distinct booking and settlement counts and outstanding amounts in one read-only snapshot", async () => {
    const results = [
      [{ count: "2", bookingCount: "1", amount: "7501.00" }],
      [{ count: "4" }],
      [
        {
          pending: "3",
          pendingAmount: "9900",
          review: "1",
          reviewAmount: "3001",
        },
      ],
      [{ amount: "2500" }],
    ];
    const db: any = { select: vi.fn(() => queryRows(results.shift()!).query) };
    db.transaction = vi.fn((run: (db: any) => Promise<unknown>) => run(db));
    state.db = db;
    const stats = await getRefundStats();
    expect(stats).toEqual({
      totalRefunds: 2,
      completedRefunds: 2,
      refundedBookings: 1,
      totalRefundedAmount: 7501,
      refundRate: 25,
      pendingRefunds: 3,
      pendingRefundAmount: 9900,
      reviewRequiredRefunds: 1,
      reviewRequiredAmount: 3001,
      retainedCancellationFees: 2500,
    });
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
      withConsistentSnapshot: true,
    });
    expect(responseContracts.getStats.parse(stats)).toEqual(stats);
  });
  it("normalizes UTC day and exact aggregate amounts in trends", async () => {
    state.db = queryRows([
      {
        day: String(new Date("2026-09-11").getTime() / 86400000),
        count: "2",
        amount: "7501.00",
      },
    ]).db;
    expect(await getRefundTrends()).toEqual([
      { date: "2026-09-11", count: 2, amount: 7501 },
    ]);
  });
  it("has a zero rate for a genuinely empty database", async () => {
    const allZero = {
      count: "0",
      bookingCount: "0",
      amount: "0",
      pending: "0",
      pendingAmount: "0",
      review: "0",
      reviewAmount: "0",
    };
    state.db = queryRows([allZero]).db;
    expect((await getRefundStats()).refundRate).toBe(0);
  });
  it.each([
    getRefundStats,
    () => getRefundHistory({}),
    getRefundTrends,
    () => exportRefundsToCSV({}),
  ])(
    "propagates read failure without returning empty success or driver details",
    async read => {
      state.db = {
        select: () => {
          throw new Error("mysql://password PRIVATE passport");
        },
        transaction: (run: (db: any) => unknown) => run(state.db),
      };
      await expect(read()).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Refund reporting unavailable",
      });
    }
  );
  it("rejects unavailable storage", async () => {
    state.db = null;
    await expect(getRefundHistory({})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
  it.each(["-1", "0.5", "9007199254740992", "NaN", null])(
    "rejects invalid financial values: %s",
    async amount => {
      state.db = queryRows([{ ...rows[0], amount }]).db;
      await expect(getRefundHistory({})).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  );
  it("fails an oversized export without returning a silently truncated file", async () => {
    state.db = queryRows(
      Array.from({ length: 10001 }, (_, id) => ({ ...rows[0], id }))
    ).db;
    await expect(exportRefundsToCSV({})).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { offset: -1 },
    { offset: 1000001 },
  ])("rejects invalid history pagination before querying: %j", async page => {
    await expect(getRefundHistory(page)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(state.db.select).not.toHaveBeenCalled();
  });
  it("rejects invalid or reversed periods before querying", async () => {
    await expect(
      getRefundExportRows({ startDate: new Date("invalid") })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      getRefundExportRows({
        startDate: new Date("2026-09-12"),
        endDate: new Date("2026-09-11"),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.db.select).not.toHaveBeenCalled();
  });
  it("keeps report APIs admin-only and strips export-only email from dashboard history", async () => {
    await expect(
      refundsRouter.createCaller(caller("user")).getStats()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reportsRouter.createCaller(caller(null)).exportRefundsCSV({})
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const history = await refundsRouter
      .createCaller(caller())
      .getHistory({ limit: 20 });
    expect(history).toHaveLength(2);
    expect(JSON.stringify(history)).not.toContain("SUM");
    expect(history[0]).toMatchObject({
      id: 100,
      amount: 3001,
      status: "settled",
    });
  });
  it("normalizes date-only export bounds to full UTC days and rejects invalid dates", async () => {
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    const fixture = queryRows(rows);
    state.db = fixture.db;
    const api = reportsRouter.createCaller(caller());
    await api.exportRefundsCSV({
      startDate: "2026-09-11",
      endDate: "2026-09-11",
    });
    const params = new MySqlDialect().sqlToQuery(
      fixture.query.where.mock.calls[0][0]
    ).params;
    expect(params).toContain(
      new Date("2026-09-11T00:00:00.000Z").getTime() / 1000
    );
    expect(params).toContain(
      new Date("2026-09-11T23:59:59.999Z").getTime() / 1000
    );
    await expect(
      api.exportRefundsCSV({ startDate: "2026-02-30" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      api.exportRefundsCSV({ startDate: "2026-09-12", endDate: "2026-09-11" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
