import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import * as schema from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

/** Called only by the guarded, disposable MySQL/Redis acceptance runner.
 * Fixture edits below are restored before the forensic audit and backup gate. */
export async function verifyFinancialReporting(
  db: SettlementTx,
  ownerId: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const {
    getRevenueDashboard,
    getRevenueByChannel,
    getRevenueByRoute,
    getYieldAnalysis,
    getAncillaryRevenue,
    getRefundImpact,
    generateRevenueReport,
    getReports,
  } = await import("../../server/services/revenue-accounting.service");
  const { getFinancialExport, financialSnapshot, readFinancialGroups } =
    await import("../../server/services/booking-financial-reporting.service");
  const { exportRevenueToCSV, exportRevenueToExcel } =
    await import("../../server/services/report-export.service");
  const { exportRevenueData, createExportJob, readExportContent } =
    await import("../../server/services/data-warehouse.service");
  const { reportsRouter } = await import("../../server/routers/reports");
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
  const entries = await db
    .select()
    .from(schema.financialLedger)
    .where(
      and(
        eq(schema.financialLedger.bookingId, booking.id),
        inArray(schema.financialLedger.type, [
          "charge",
          "refund",
          "partial_refund",
        ])
      )
    );
  const charges = entries.filter(r => r.type === "charge");
  const refunds = entries.filter(r => r.type !== "charge");
  assert.equal(charges.length, 2);
  assert.equal(refunds.length, 2);
  const startDate = new Date("2024-02-15T00:00:00Z");
  const endDate = new Date("2024-02-16T23:59:59.999Z");
  const period = { startDate, endDate };
  const originalReceipts = await db
    .select()
    .from(schema.paymentReceipts)
    .where(eq(schema.paymentReceipts.bookingId, booking.id));
  try {
    for (const e of entries)
      await db
        .update(schema.financialLedger)
        .set({
          transactionDate: new Date(
            e.type === "charge"
              ? "2024-02-15T23:59:59Z"
              : "2024-02-16T00:00:00Z"
          ),
        })
        .where(eq(schema.financialLedger.id, e.id));
    await db
      .update(schema.bookings)
      .set({ createdAt: startDate })
      .where(eq(schema.bookings.id, booking.id));
    await check(
      "financial dashboard and exports conserve split collections, partial refunds and negative refund-only periods",
      async () => {
        const [sums] = await db.execute(sql`
          SELECT SUM(CASE WHEN l.type='charge' THEN l.amount*100 ELSE 0 END) AS collected,
            SUM(CASE WHEN l.type IN ('refund','partial_refund') THEN l.amount*100 ELSE 0 END) AS refunded
          FROM financial_ledger l INNER JOIN bookings b ON b.id=l.bookingId
          WHERE l.currency='SAR'
        `);
        const expected = (
          sums as unknown as { collected: string; refunded: string }[]
        )[0];
        const allTime = await getRevenueDashboard();
        assert.equal(allTime.totalRevenue, Number(expected.collected));
        assert.equal(allTime.refundTotal, Number(expected.refunded));
        const data = await getRevenueDashboard(startDate, endDate);
        assert.equal(data.totalRevenue, 10001);
        assert.equal(data.refundTotal, 7501);
        assert.equal(data.netRevenue, 2500);
        assert.equal(data.totalBookings, 1);
        assert.equal(data.activeBookings, 1);
        assert.equal(data.unmatchedCollectionEntries, 0);
        assert.equal(data.recognizedRevenue, null);
        assert.equal(data.deferredRevenue, null);
        const preview = await generateRevenueReport(2, 2024, ownerId);
        assert.equal(preview.status, "preview");
        assert.equal(preview.netRevenue, 2500);
        assert(
          (await getReports(50)).some(
            r => r.periodStart === "2024-02-01" && r.refundAmount === 7501
          )
        );
        const impact = await getRefundImpact(startDate, endDate);
        assert.equal(impact.refundCount, 2);
        assert.equal(impact.refundedBookings, 1);
        assert.equal(impact.refundRate, 100);
        const daily = await getFinancialExport(period);
        assert.equal(daily.rows.length, 2);
        assert.equal(daily.rows[1].netAmount, -7501);
        assert.equal(daily.totals.activeBookings, 1);
        const csv = await exportRevenueToCSV(period);
        assert(csv.includes("100.01,0.00,100.01"));
        assert(csv.includes("0.00,75.01,-75.01"));
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(
          new Uint8Array(await exportRevenueToExcel(period)).buffer
        );
        assert(
          JSON.stringify(
            workbook.getWorksheet("Summary")!.getSheetValues()
          ).includes('"25.00"')
        );
        const caller = reportsRouter.createCaller({
          user: { id: ownerId, role: "admin" },
          authMethod: "cookie",
          tenantId: null,
          req: { headers: {} },
          res: {},
        } as any);
        const firstDay = await caller.exportRevenueCSV({
          startDate: "2024-02-15",
          endDate: "2024-02-15",
        });
        assert(firstDay.content.includes("100.01,0.00,100.01"));
        assert(!firstDay.content.includes("75.01"));
        const second = await getRevenueDashboard(
          new Date("2024-02-16"),
          endDate
        );
        assert.equal(second.totalRevenue, 0);
        assert.equal(second.netRevenue, -7501);
        // Face value/status changes affect their own display only.
        try {
          await db
            .update(schema.bookings)
            .set({ totalAmount: 99999, paymentStatus: "refunded" })
            .where(eq(schema.bookings.id, booking.id));
          const changed = await getRevenueDashboard(startDate, endDate);
          assert.equal(changed.totalRevenue, 10001);
          assert.equal(changed.refundTotal, 7501);
          assert.equal(changed.bookedAmount, 99999);
        } finally {
          await db
            .update(schema.bookings)
            .set({
              totalAmount: booking.totalAmount,
              paymentStatus: booking.paymentStatus,
            })
            .where(eq(schema.bookings.id, booking.id));
        }
        assert.equal(
          (await getAncillaryRevenue(startDate, endDate)).basis,
          "active_ancillary_invoice_lines"
        );
      }
    );
    await check(
      "financial attribution counts conflicting channel links once and does not assign a whole itinerary to its first flight",
      async () => {
        const inserted: number[] = [];
        try {
          const [c] = await db.insert(schema.corporateBookings).values({
            bookingId: booking.id,
            corporateAccountId: ownerId,
            bookedByUserId: ownerId,
          });
          inserted.push(Number(c.insertId));
          const [a] = await db.insert(schema.agentBookings).values({
            bookingId: booking.id,
            agentId: ownerId,
            commissionRate: "0.00",
            commissionAmount: 0,
            bookingAmount: booking.totalAmount,
          });
          inserted.push(Number(a.insertId));
          const channels = await getRevenueByChannel(startDate, endDate);
          assert.equal(channels.length, 1);
          assert.equal(channels[0].channel, "ambiguous");
          assert.equal(channels[0].totalRevenue, 10001);
          assert.equal(channels[0].netAmount, 2500);
          const routes = await getRevenueByRoute(startDate, endDate);
          assert.equal(routes.length, 1);
          assert.equal(routes[0].itineraryType, "multi_city");
          assert.equal(routes[0].originCode, "MULTI");
          assert.equal(routes[0].totalRevenue, 10001);
          const yields = await getYieldAnalysis(startDate, endDate);
          assert.equal(yields[0].flightId, null);
          assert.equal(yields[0].rpk, null);
          assert.equal(yields[0].yield, null);
          const wh = JSON.parse(
            (await exportRevenueData({ dateRange: period, format: "json" }))
              .data
          );
          assert.equal(wh.length, 2);
          assert(
            wh.every(
              (r: any) =>
                r.channel === "ambiguous" &&
                r.itineraryType === "multi_city" &&
                r.airlineCode === "MULTI"
            )
          );
          assert.equal(
            wh.reduce((sum: number, r: any) => sum + r.netPostedAmountMinor, 0),
            2500
          );
        } finally {
          if (inserted[1])
            await db
              .delete(schema.agentBookings)
              .where(eq(schema.agentBookings.id, inserted[1]));
          if (inserted[0])
            await db
              .delete(schema.corporateBookings)
              .where(eq(schema.corporateBookings.id, inserted[0]));
        }
      }
    );
    await check(
      "financial reporting exposes missing legacy evidence and review collections and excludes other currencies",
      async () => {
        const ref = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
        const [created] = await db.insert(schema.bookings).values({
          userId: ownerId,
          flightId: booking.flightId,
          bookingReference: ref,
          pnr: ref,
          totalAmount: 20000,
          cabinClass: "economy",
          numberOfPassengers: 1,
          status: "confirmed",
          paymentStatus: "paid",
          createdAt: startDate,
        });
        const legacyId = Number(created.insertId);
        let legacyLedgerId: number | undefined;
        let duplicateId: number | undefined;
        try {
          const data = await getRevenueDashboard(startDate, endDate);
          assert.equal(data.totalRevenue, 10001);
          assert.equal(data.unpostedPaidBookings, 1);
          const [l] = await db.insert(schema.financialLedger).values({
            bookingId: legacyId,
            userId: ownerId,
            type: "charge",
            currency: "SAR",
            amount: "200.00",
            description: "Historical fixture without collection evidence",
            transactionDate: startDate,
          });
          legacyLedgerId = Number(l.insertId);
          const unresolved = await getRevenueDashboard(startDate, endDate);
          assert.equal(unresolved.totalRevenue, 30001);
          assert.equal(unresolved.unmatchedCollectionEntries, 1);
          assert.equal(unresolved.unpostedPaidBookings, 0);
          await db
            .update(schema.financialLedger)
            .set({ currency: "USD" })
            .where(eq(schema.financialLedger.id, legacyLedgerId));
          assert.equal(
            (await getRevenueDashboard(startDate, endDate)).totalRevenue,
            10001
          );
          await db
            .update(schema.paymentReceipts)
            .set({ settlementStatus: "review_required" })
            .where(
              eq(
                schema.paymentReceipts.paymentIntentId,
                originalReceipts[0].paymentIntentId
              )
            );
          assert.equal(
            (await getRevenueDashboard(startDate, endDate))
              .reviewCollectionAmount,
            originalReceipts[0].amount
          );
          const { id: _id, ...originalCharge } = charges[0];
          const [duplicate] = await db.insert(schema.financialLedger).values({
            ...originalCharge,
            stripeEventId: null,
            transactionDate: startDate,
          });
          duplicateId = Number(duplicate.insertId);
          const duplicated = await getRevenueDashboard(startDate, endDate);
          assert.equal(duplicated.unmatchedCollectionEntries, 2);
          assert.equal(
            duplicated.totalRevenue,
            10001 + Math.round(Number(charges[0].amount) * 100)
          );
        } finally {
          if (duplicateId)
            await db
              .delete(schema.financialLedger)
              .where(eq(schema.financialLedger.id, duplicateId));
          for (const r of originalReceipts)
            await db
              .update(schema.paymentReceipts)
              .set({ settlementStatus: r.settlementStatus })
              .where(
                eq(schema.paymentReceipts.paymentIntentId, r.paymentIntentId)
              );
          if (legacyLedgerId)
            await db
              .delete(schema.financialLedger)
              .where(eq(schema.financialLedger.id, legacyLedgerId));
          await db
            .delete(schema.bookings)
            .where(eq(schema.bookings.id, legacyId));
        }
        const [walletEntry] = await db
          .select()
          .from(schema.financialLedger)
          .where(
            and(
              eq(
                schema.financialLedger.description,
                "Wallet booking settlement"
              ),
              eq(schema.financialLedger.type, "charge")
            )
          )
          .limit(1);
        assert(walletEntry, "Acceptance must include a real wallet settlement");
        const walletPeriod = {
          startDate: new Date("2024-02-17"),
          endDate: new Date("2024-02-17T23:59:59.999Z"),
        };
        try {
          await db
            .update(schema.financialLedger)
            .set({ transactionDate: walletPeriod.startDate })
            .where(eq(schema.financialLedger.id, walletEntry.id));
          const walletReport = await getFinancialExport(walletPeriod);
          assert.equal(
            walletReport.totals.collectedAmount,
            Math.round(Number(walletEntry.amount) * 100)
          );
          assert.equal(walletReport.totals.unmatchedCollectionEntries, 0);
        } finally {
          await db
            .update(schema.financialLedger)
            .set({ transactionDate: walletEntry.transactionDate })
            .where(eq(schema.financialLedger.id, walletEntry.id));
        }
      }
    );
    await check(
      "financial snapshots remain consistent across concurrent commits and warehouse downloads retain numeric evidence",
      async () => {
        try {
          await financialSnapshot(async tx => {
            const [before] = await readFinancialGroups(tx, period, "total");
            await db
              .update(schema.financialLedger)
              .set({ amount: (Number(charges[0].amount) + 0.02).toFixed(2) })
              .where(eq(schema.financialLedger.id, charges[0].id));
            const [after] = await readFinancialGroups(tx, period, "total");
            assert.deepEqual(after, before);
            await assert.rejects(
              tx.execute(
                sql`UPDATE bookings SET totalAmount=0 WHERE id=${booking.id}`
              )
            );
          });
          assert.equal(
            (await getRevenueDashboard(startDate, endDate)).totalRevenue,
            10003
          );
        } finally {
          await db
            .update(schema.financialLedger)
            .set({ amount: charges[0].amount })
            .where(eq(schema.financialLedger.id, charges[0].id));
        }
        const beforeLedger = await db.select().from(schema.financialLedger);
        const exported = await createExportJob(
          "revenue",
          period,
          "json",
          ownerId,
          false,
          undefined,
          `acceptance-financial:${randomUUID()}`
        );
        assert.equal(exported.status, "completed");
        assert.equal(exported.recordCount, 2);
        const downloaded = await readExportContent(exported.id);
        const data = JSON.parse(downloaded.content);
        assert(
          data.every(
            (r: any) =>
              r.schemaVersion === 2 &&
              r.currency === "SAR" &&
              r.snapshotSemantics === "replace_period_snapshot" &&
              r.periodStart === startDate.toISOString() &&
              r.periodEnd === endDate.toISOString() &&
              typeof r.netPostedAmountMinor === "number" &&
              r.recognizedRevenueMinor === null
          )
        );
        assert.equal(
          data.reduce(
            (sum: number, r: any) => sum + r.postedCollectedAmountMinor,
            0
          ),
          10001
        );
        assert.equal(
          data.reduce(
            (sum: number, r: any) => sum + r.postedRefundedAmountMinor,
            0
          ),
          7501
        );
        assert.deepEqual(
          await db.select().from(schema.financialLedger),
          beforeLedger
        );
      }
    );
  } finally {
    for (const e of entries)
      await db
        .update(schema.financialLedger)
        .set({
          transactionDate: e.transactionDate,
          amount: e.amount,
          currency: e.currency,
        })
        .where(eq(schema.financialLedger.id, e.id));
    await db
      .update(schema.bookings)
      .set({
        createdAt: booking.createdAt,
        totalAmount: booking.totalAmount,
        paymentStatus: booking.paymentStatus,
      })
      .where(eq(schema.bookings.id, booking.id));
  }
}
