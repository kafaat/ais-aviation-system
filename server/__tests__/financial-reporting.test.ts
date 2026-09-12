import { describe, expect, it, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { combineFinancialDays, getFinancialDays, getFinancialSummary, financialInteger } from "../services/financial-reporting.service";
import { exportRevenueData } from "../services/data-warehouse.service";

function database(invoiceRows: unknown[], settlementRows: unknown[]) {
  const replies = [invoiceRows, settlementRows];
  const db = { select: vi.fn(() => {
    const result = Promise.resolve(replies.shift());
    const query = { from: () => query, where: () => query, groupBy: () => query, limit: () => result };
    return query;
  }), transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)) };
  state.db = db;
  return db;
}
beforeEach(() => { state.db = null; });
const day = Date.parse("2026-09-11") / 86400000;
describe("financial read authority", () => {
  it("keeps invoices, two payers and a partial refund distinct; a refund-only day can be negative", () => {
    const rows = combineFinancialDays([{ day, amount: "10000", count: "1", unreconciled: "0" }], [
      { day: day + 1, collected: "4000.00", refunded: "0", unclassified: "0" },
      { day: day + 1, collected: "6000.00", refunded: "2501", unclassified: "0" },
      { day: day + 2, collected: "0", refunded: "999", unclassified: "0" },
    ]);
    expect(rows.map(r => [r.billedAmount, r.netCollectedAmount])).toEqual([[10000, 0], [0, 7499], [0, -999]]);
    expect(rows.every(r => r.earnedRevenue === null)).toBe(true);
  });
  it("uses one read-only snapshot and exports the same amounts and unknown recognition", async () => {
    const invoices = [{ day, amount: "10000", count: "1", unreconciled: "1" }];
    const settlements = [{ day, collected: "7000.00", refunded: "101.00", unclassified: "1" }];
    const db = database(invoices, settlements);
    expect(await getFinancialSummary()).toMatchObject({ billedAmount: 10000, collectedAmount: 7000, refundedAmount: 101, netCollectedAmount: 6899, unreconciledBookings: 1, unclassifiedEntries: 1, earnedRevenue: null });
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    database(invoices, settlements);
    const file = await exportRevenueData({ dateRange: { startDate: new Date("2026-09-11"), endDate: new Date("2026-09-12") }, format: "json" });
    expect(JSON.parse(file.data)[0]).toMatchObject({ currency: "SAR", amountUnit: "minor", netCollectedAmount: "6899", earnedRevenue: "" });
  });
  it.each([null, undefined, "", -1, "0.01", "NaN", true, "9007199254740992"])("rejects an invalid amount %s", value => {
    expect(() => financialInteger(value)).toThrow();
  });
  it("does not turn database failure into zero money or reveal driver secrets", async () => {
    state.db = { transaction: () => { throw new Error("mysql://private-password"); } };
    await expect(getFinancialDays()).rejects.toMatchObject({ message: "Financial reporting unavailable" });
  });
  it("rejects reversed bounds before querying", async () => {
    const db = database([], []);
    await expect(getFinancialDays({ startDate: new Date("2026-09-12"), endDate: new Date("2026-09-11") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.select).not.toHaveBeenCalled();
  });
});
