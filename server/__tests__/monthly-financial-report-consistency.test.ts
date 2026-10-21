import { beforeEach, describe, expect, it, vi } from "vitest";

// The fixture deliberately separates booking-created dates from ledger-posted dates.
const source = vi.hoisted(() => ({ getFinancialDays: vi.fn() }));
vi.mock("../services/financial-reporting.service", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../services/financial-reporting.service")
  >()),
  getFinancialDays: source.getFinancialDays,
}));

// Old getReports reads booking creation totals, even when the cash ledger differs.
// Its one historical booking in October is 100 SAR; the October cash receipts are 200 SAR.
vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          groupBy: () => ({
            orderBy: () => ({
              limit: async () => [
                { yearMonth: "2026-10", totalRevenue: 10000, bookingCount: 1 },
              ],
            }),
          }),
        }),
      }),
    }),
  }),
}));

import {
  generateRevenueReport,
  getReports,
} from "../services/revenue-accounting.service";

function day(
  date: string,
  amount: Partial<{
    bookings: number;
    billedAmount: number;
    collectedAmount: number;
    nonCashFundedAmount: number;
    nonCashRefundedAmount: number;
    refundedAmount: number;
    unreconciledBookings: number;
    unclassifiedEntries: number;
  }> = {}
) {
  return {
    date,
    bookings: 0,
    billedAmount: 0,
    collectedAmount: 0,
    nonCashFundedAmount: 0,
    nonCashRefundedAmount: 0,
    refundedAmount: 0,
    netCollectedAmount: (amount.collectedAmount ?? 0) - (amount.refundedAmount ?? 0),
    earnedRevenue: null,
    unreconciledBookings: 0,
    unclassifiedEntries: 0,
    currency: "SAR",
    amountUnit: "minor",
    ...amount,
  };
}

beforeEach(() => {
  source.getFinancialDays.mockReset();
  source.getFinancialDays.mockResolvedValue([
    day("2026-09-30", { bookings: 1, billedAmount: 10000 }),
    day("2026-10-01", { collectedAmount: 10000 }),
    day("2026-10-10", {
      bookings: 1,
      billedAmount: 10000,
      collectedAmount: 10000,
      refundedAmount: 4000,
      nonCashFundedAmount: 1500,
      nonCashRefundedAmount: 500,
      unreconciledBookings: 1,
    }),
    day("2026-11-02", { refundedAmount: 2500 }),
  ]);
});

describe("monthly reporting reconciliation (cash ≠ booking-created totals)", () => {
  it("lists ledger-only/refund-only months and uses the same cash semantics as generation", async () => {
    const rows = await getReports();
    expect(rows.map(row => row.id)).toEqual([
      "REV-2026-11",
      "REV-2026-10",
      "REV-2026-09",
    ]);
    const oct = rows.find(row => row.id === "REV-2026-10");
    expect(oct).toMatchObject({
      totalRevenue: 20000,
      collectedAmount: 20000,
      refundAmount: 4000,
      netCollectedAmount: 16000,
      nonCashFundedAmount: 1500,
      nonCashRefundedAmount: 500,
      billedAmount: 10000,
      unreconciledBookings: 1,
    });
    expect(rows[0]).toMatchObject({
      totalRevenue: 0,
      refundAmount: 2500,
      netCollectedAmount: -2500,
    });
    expect(oct?.recognizedRevenue).toBeNull();
    expect(oct?.deferredRevenue).toBeNull();
    expect(oct?.ancillaryRevenue).toBeNull();
    expect(source.getFinancialDays).toHaveBeenCalledTimes(1);
  });

  it("generates the same October fields with exact UTC month bounds and no invented recognition", async () => {
    const oct = await generateRevenueReport(10, 2026, 12);
    expect(oct).toMatchObject({
      id: "REV-2026-10",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      totalRevenue: 20000,
      collectedAmount: 20000,
      refundAmount: 4000,
      netCollectedAmount: 16000,
      deferredRevenue: null,
      recognizedRevenue: null,
      ancillaryRevenue: null,
    });
    expect(source.getFinancialDays).toHaveBeenCalledOnce();
    const period = source.getFinancialDays.mock.calls[0]?.[0];
    expect(period.startDate.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(period.endDate.toISOString()).toBe("2026-10-31T23:59:59.999Z");
  });

  it("represents a month with no activity as zero cash, but unknown recognition", async () => {
    const dec = await generateRevenueReport(12, 2026, 12);
    expect(dec).toMatchObject({
      totalRevenue: 0,
      billedAmount: 0,
      collectedAmount: 0,
      refundAmount: 0,
      netCollectedAmount: 0,
      recognizedRevenue: null,
      deferredRevenue: null,
      ancillaryRevenue: null,
    });
  });
});
