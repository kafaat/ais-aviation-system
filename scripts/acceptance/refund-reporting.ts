import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import * as schema from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

/** Read-model proof on the runner's guarded disposable MySQL fixtures. */
export async function verifyRefundReporting(
  db: SettlementTx,
  ownerId: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const {
    getRefundStats,
    getRefundHistory,
    getRefundTrends,
    getRefundExportRows,
  } = await import("../../server/services/refunds-stats.service");
  const { reportsRouter } = await import("../../server/routers/reports");
  const { exportRefundsToExcel } =
    await import("../../server/services/report-export.service");
  const [plan] = await db
    .select()
    .from(schema.bookingRefundPlans)
    .where(eq(schema.bookingRefundPlans.status, "completed"))
    .limit(1);
  assert(plan);
  const [booking] = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.id, plan.bookingId));
  const settled = await db
    .select()
    .from(schema.financialLedger)
    .where(
      and(
        eq(schema.financialLedger.bookingId, plan.bookingId),
        inArray(schema.financialLedger.type, ["refund", "partial_refund"])
      )
    );
  assert.equal(settled.length, 2);

  await check(
    "refund reporting includes partial payer settlements and counts fees once on MySQL",
    async () => {
      const stats = await getRefundStats();
      const ledger = await db.select().from(schema.financialLedger);
      const allBookings = await db.select().from(schema.bookings);
      const ids = new Set(allBookings.map(b => b.id));
      const eligible = ledger.filter(
        l =>
          l.bookingId !== null &&
          ids.has(l.bookingId) &&
          l.currency === "SAR" &&
          ["refund", "partial_refund"].includes(l.type)
      );
      assert.equal(stats.totalRefunds, eligible.length);
      assert.equal(
        stats.totalRefundedAmount,
        eligible.reduce((sum, l) => sum + Math.round(Number(l.amount) * 100), 0)
      );
      assert.equal(
        stats.refundedBookings,
        new Set(eligible.map(l => l.bookingId)).size
      );
      const items = await db.select().from(schema.bookingRefundItems);
      const pending = items.filter(i =>
        ["queued", "requesting", "pending"].includes(i.status)
      );
      assert.equal(stats.pendingRefunds, pending.length);
      assert.equal(
        stats.pendingRefundAmount,
        pending.reduce((sum, i) => sum + i.refundAmount, 0)
      );
      const plans = await db.select().from(schema.bookingRefundPlans);
      assert.equal(
        stats.retainedCancellationFees,
        plans.reduce((sum, p) => sum + p.cancellationFee, 0)
      );
      assert(stats.reviewRequiredRefunds >= 2);
      const history = (await getRefundHistory({ limit: 100 })).filter(
        r => r.bookingId === plan.bookingId
      );
      assert.equal(history.length, 2);
      assert.equal(
        history.reduce((sum, r) => sum + r.amount, 0),
        7501
      );
      assert.equal(booking.paymentStatus, "paid");
      assert(history.every(r => r.status === "settled"));
      assert.equal(new Set(history.map(r => r.id)).size, 2);
      // Mutable display/invoice fields cannot change financial totals.
      try {
        await db
          .update(schema.bookings)
          .set({
            totalAmount: 99999,
            updatedAt: new Date("2020-01-01"),
            paymentStatus: "refunded",
          })
          .where(eq(schema.bookings.id, booking.id));
        assert.deepEqual(await getRefundStats(), stats);
      } finally {
        await db
          .update(schema.bookings)
          .set({
            totalAmount: booking.totalAmount,
            updatedAt: booking.updatedAt,
            paymentStatus: booking.paymentStatus,
          })
          .where(eq(schema.bookings.id, booking.id));
      }
    }
  );
  await check(
    "refund exports share exact UTC boundaries and preserve all accounting rows",
    async () => {
      // Move only fixture timestamps across midnight, then restore them.
      try {
        await db
          .update(schema.financialLedger)
          .set({ transactionDate: new Date("2024-01-15T23:59:59Z") })
          .where(eq(schema.financialLedger.id, settled[0].id));
        await db
          .update(schema.financialLedger)
          .set({ transactionDate: new Date("2024-01-16T00:00:00Z") })
          .where(eq(schema.financialLedger.id, settled[1].id));
        const beforeLedger = await db.select().from(schema.financialLedger);
        const beforeItems = await db.select().from(schema.bookingRefundItems);
        const api = reportsRouter.createCaller({
          user: { id: ownerId, role: "admin" },
          authMethod: "jwt",
          tenantId: null,
          req: { headers: {} },
          res: {},
        } as any);
        const csv = await api.exportRefundsCSV({
          startDate: "2024-01-15",
          endDate: "2024-01-15",
        });
        assert.equal(csv.content.split("\n").length, 2);
        assert(csv.content.includes(String(settled[0].id)));
        assert(
          csv.content.includes(
            `${Number(settled[0].amount).toFixed(2)},settled,2024-01-15T23:59:59.000Z`
          )
        );
        const period = {
          startDate: new Date("2024-01-15T00:00:00Z"),
          endDate: new Date("2024-01-16T00:00:00Z"),
        };
        const rows = await getRefundExportRows(period);
        assert.equal(rows.length, 2);
        assert.equal(
          rows.reduce((sum, r) => sum + r.amount, 0),
          7501
        );
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(
          new Uint8Array(await exportRefundsToExcel(period)).buffer
        );
        assert(
          JSON.stringify(
            workbook.getWorksheet("Summary")!.getSheetValues()
          ).includes("75.01")
        );
        const trends = await getRefundTrends();
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - 29);
        cutoff.setUTCHours(0, 0, 0, 0);
        const existingBookings = new Set(
          (await db.select().from(schema.bookings)).map(b => b.id)
        );
        const todayRefunds = beforeLedger.filter(
          l =>
            l.currency === "SAR" &&
            l.bookingId &&
            ["refund", "partial_refund"].includes(l.type) &&
            existingBookings.has(l.bookingId) &&
            l.transactionDate >= cutoff &&
            l.transactionDate <= new Date()
        );
        assert.equal(
          trends.reduce((sum, r) => sum + r.amount, 0),
          todayRefunds.reduce(
            (sum, l) => sum + Math.round(Number(l.amount) * 100),
            0
          )
        );
        assert.deepEqual(
          await db.select().from(schema.financialLedger),
          beforeLedger
        );
        assert.deepEqual(
          await db.select().from(schema.bookingRefundItems),
          beforeItems
        );
      } finally {
        for (const row of settled)
          await db
            .update(schema.financialLedger)
            .set({ transactionDate: row.transactionDate })
            .where(eq(schema.financialLedger.id, row.id));
      }
    }
  );
  await check(
    "refund history pagination has stable settlement IDs and excludes other currencies",
    async () => {
      const originalCurrency = settled[0].currency;
      try {
        await db
          .update(schema.financialLedger)
          .set({ currency: "USD" })
          .where(eq(schema.financialLedger.id, settled[0].id));
        const history = await getRefundHistory({ limit: 100 });
        assert(!history.some(r => r.id === settled[0].id));
        const first = await getRefundHistory({ limit: 1 });
        const second = await getRefundHistory({ limit: 1, offset: 1 });
        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.notEqual(first[0].id, second[0].id);
        assert.equal(first[0].id, history[0].id);
        assert.equal(second[0].id, history[1].id);
      } finally {
        await db
          .update(schema.financialLedger)
          .set({ currency: originalCurrency })
          .where(eq(schema.financialLedger.id, settled[0].id));
      }
    }
  );
}
