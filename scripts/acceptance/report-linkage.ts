import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";
import { reportsRouter } from "../../server/routers/reports";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

/** Exercise registered report procedures against independent tenant data. */
export async function verifyReportLinkage(
  db: SettlementTx,
  ctx: TrpcContext,
  tenantId: number
) {
  assert(ctx.user);
  const [foreignTenant] = await db.insert(s.tenants).values({
    name: "Synthetic report isolation",
    slug: "report-isolation-fixture",
    status: "active",
  });
  const [foreignUser] = await db.insert(s.users).values({
    openId: "report-isolation-fixture",
    tenantId: foreignTenant.insertId,
    role: "finance",
  });
  const at = new Date("2018-02-01T12:00:00.000Z");
  const period = { startDate: "2018-02-01", endDate: "2018-02-01" };
  const fixtures = [
    { tenantId, userId: ctx.user.id, label: "A", amount: 12345, refund: 2345 },
    {
      tenantId: foreignTenant.insertId,
      userId: foreignUser.insertId,
      label: "B",
      amount: 98765,
      refund: 8765,
    },
  ];
  for (const fixture of fixtures) {
    const [flight] = await db.insert(s.flights).values({
      tenantId: fixture.tenantId,
      airlineId: tenantId,
      flightNumber: "RP" + fixture.label + "901",
      originId: tenantId,
      destinationId: tenantId + 1,
      departureTime: at,
      arrivalTime: new Date(at.getTime() + 3600_000),
      status: "completed",
      economySeats: 10,
      economyAvailable: 9,
      businessSeats: 0,
      businessAvailable: 0,
      economyPrice: fixture.amount,
      businessPrice: 0,
    });
    const [booking] = await db.insert(s.bookings).values({
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      flightId: flight.insertId,
      bookingReference: "RPT" + fixture.label + "01",
      pnr: "RP" + fixture.label + "001",
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
      cabinClass: "economy",
      numberOfPassengers: 1,
      totalAmount: fixture.amount,
      createdAt: at,
    });
    await db.insert(s.financialLedger).values(
      [
        { type: "charge" as const, amount: fixture.amount },
        { type: "partial_refund" as const, amount: fixture.refund },
      ].map(row => ({
        ...row,
        amount: (row.amount / 100).toFixed(2),
        bookingId: booking.insertId,
        userId: fixture.userId,
        transactionDate: at,
        createdAt: at,
      }))
    );
  }
  const beforeLedger = await db
    .select()
    .from(s.financialLedger)
    .orderBy(s.financialLedger.id);
  const beforeBookings = await db
    .select()
    .from(s.bookings)
    .orderBy(s.bookings.id);
  let checkedFormats = 0;
  for (const fixture of fixtures) {
    const user = {
      ...ctx.user,
      id: fixture.userId,
      tenantId: fixture.tenantId,
    };
    const finance = reportsRouter.createCaller({
      ...ctx,
      tenantId: fixture.tenantId,
      user: { ...user, role: "finance" },
    });
    const ops = reportsRouter.createCaller({
      ...ctx,
      tenantId: fixture.tenantId,
      user: { ...user, role: "ops" },
    });
    const other = fixture.label === "A" ? "B" : "A";
    const reports = [
      {
        csv: await finance.exportBookingsCSV(period),
        excel: await finance.exportBookingsExcel(period),
        pdf: await finance.generateBookingsPDF(period),
        present: "RPT" + fixture.label + "01",
        absent: "RPT" + other + "01",
      },
      {
        csv: await finance.exportRevenueCSV(period),
        excel: await finance.exportRevenueExcel(period),
        pdf: await finance.generateRevenuePDF(period),
        present: (fixture.amount / 100).toFixed(2),
        absent: fixture.label === "A" ? "987.65" : "123.45",
      },
      {
        csv: await finance.exportRefundsCSV(period),
        excel: await finance.exportRefundsExcel(period),
        pdf: await finance.generateRefundsPDF(period),
        present: "RPT" + fixture.label + "01",
        absent: "RPT" + other + "01",
      },
      {
        csv: await ops.exportFlightPerformanceCSV(period),
        excel: await ops.exportFlightPerformanceExcel(period),
        pdf: await ops.generateFlightPerformancePDF(period),
        present: "RP" + fixture.label + "901",
        absent: "RP" + other + "901",
      },
    ];
    assert.deepEqual(reports[1].csv.content.split("\n")[1].split(","), [
      period.startDate,
      "1",
      (fixture.amount / 100).toFixed(2),
      (fixture.amount / 100).toFixed(2),
      (fixture.refund / 100).toFixed(2),
      ((fixture.amount - fixture.refund) / 100).toFixed(2),
      "0.00",
      "0.00",
      "0",
      "0",
    ]);
    for (const report of reports) {
      assert(report.csv.content.includes(report.present));
      assert(!report.csv.content.includes(report.absent));
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        new Uint8Array(Buffer.from(report.excel.content, "base64")).buffer
      );
      const cells = JSON.stringify(
        workbook.worksheets.map(sheet => sheet.getSheetValues())
      );
      assert(cells.includes(report.present));
      assert(!cells.includes(report.absent));
      assert.equal(report.pdf.contentType, "application/pdf");
      assert.equal(
        Buffer.from(report.pdf.content, "base64").subarray(0, 5).toString(),
        "%PDF-"
      );
      checkedFormats += 3;
    }
    await assert.rejects(ops.exportRevenueCSV(period), { code: "FORBIDDEN" });
    await assert.rejects(finance.exportFlightPerformanceCSV(period), {
      code: "FORBIDDEN",
    });
  }
  const global = reportsRouter.createCaller({
    ...ctx,
    tenantId: null,
    user: { ...ctx.user, role: "admin", tenantId: null },
  });
  const allBookings = await global.exportBookingsCSV(period);
  assert(allBookings.content.includes("RPTA01"));
  assert(allBookings.content.includes("RPTB01"));
  const mismatched = reportsRouter.createCaller({
    ...ctx,
    tenantId: foreignTenant.insertId,
    user: { ...ctx.user, role: "finance", tenantId },
  });
  await assert.rejects(mismatched.exportBookingsCSV(period), {
    code: "FORBIDDEN",
  });
  await assert.rejects(
    reportsRouter.createCaller(ctx).exportBookingsCSV(period),
    { code: "FORBIDDEN" }
  );
  assert.deepEqual(
    await db.select().from(s.financialLedger).orderBy(s.financialLedger.id),
    beforeLedger
  );
  assert.deepEqual(
    await db.select().from(s.bookings).orderBy(s.bookings.id),
    beforeBookings
  );
  return {
    reportFamilies: 4,
    tenants: 2,
    successfulFormatRequests: checkedFormats,
    csvAndExcelRowsTenantScoped: true,
    reconciliationCountsVerified: true,
    pdfDocumentsGenerated: 8,
    roleAndTenantMismatchRejected: true,
    globalAdminIncludesBothTenants: true,
    ledgerAndBookingsUnchanged: true,
  };
}
