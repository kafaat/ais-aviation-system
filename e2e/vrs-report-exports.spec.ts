import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { fixtureFlight, reportBooking, rpc } from "./fixtures/hardening";
import {
  createReportingStaff,
  createReportingTenants,
  useReportingStaff,
} from "./fixtures/reporting-tenants";
import { testUsers } from "./fixtures/test-data";
import { disposableDatabaseUrl } from "./disposable-database";
import mysql, {
  type RowDataPacket,
  type ResultSetHeader,
} from "mysql2/promise";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ExcelJS from "exceljs";

async function openReport(page: Page, tab: string, start: string, end: string) {
  await useBrowserSession(page, "admin");
  await selectReport(page, tab, start, end);
}

async function selectReport(
  page: Page,
  tab: string,
  start: string,
  end: string
) {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await page.goto("/admin/reports");
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await page.getByLabel("Start Date").fill(start);
  await page.getByLabel("End Date").fill(end);
}

async function download(page: Page, format: "CSV" | "Excel" | "PDF") {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export " + format, exact: true })
    .click();
  const file = await pending;
  const path = await file.path();
  if (!path) throw new Error("Missing downloaded report");
  return path;
}

async function workbookAt(path: string) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  return book;
}

async function pdfTextAt(path: string) {
  return (await promisify(execFile)("pdftotext", [path, "-"])).stdout.replace(
    /\s+/g,
    " "
  );
}

function summaryValue(book: ExcelJS.Workbook, label: string) {
  const summary = book.getWorksheet("Summary")!;
  return summary
    .getRows(1, summary.rowCount)
    ?.find(row => row.getCell(1).value === label)
    ?.getCell(2).value;
}

test("booking downloads include the whole UTC creation day and only the selected status", async ({
  page,
}, info) => {
  await useBrowserSession(page, "reporting");
  const customer = await rpc(page).auth.me.query();
  if (!customer?.tenantId) throw new Error("Scoped report customer required");
  const db = await mysql.createConnection(disposableDatabaseUrl());
  const flightId = await fixtureFlight(customer.tenantId);
  const day =
    "2034-08-" + String(2 + (info.parallelIndex % 26)).padStart(2, "0");
  const ids: number[] = [];
  // Fixture references are unique per generated flight and identify the downloaded rows.
  const reference = (i: number) => "R" + String(flightId).padStart(4, "0") + i;
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    for (const [index, [status, offset, time, amount]] of (
      [
        ["confirmed", 0, "00:00:00", 10000],
        ["cancelled", 0, "23:59:59", 20000],
        ["confirmed", -1, "23:59:59", 40000],
        ["cancelled", 1, "00:00:00", 80000],
      ] as const
    ).entries()) {
      const [entry] = await db.execute<ResultSetHeader>(
        "INSERT INTO bookings (userId, tenantId, flightId, bookingReference, pnr, status, cabinClass, totalAmount, createdAt) SELECT id, tenantId, ?, ?, ?, ?, 'economy', ?, DATE_ADD(CAST(? AS DATETIME), INTERVAL ? DAY) FROM users WHERE email=?",
        [
          flightId,
          reference(index),
          reference(index),
          status,
          amount,
          day + " " + time,
          offset,
          testUsers.reporting.email,
        ]
      );
      expect(entry.affectedRows).toBe(1);
      ids.push(entry.insertId);
    }
    await openReport(page, "Bookings", day, day);
    for (const [status, expected, total] of [
      ["All", [1, 0], "300.00"],
      ["Confirmed", [0], "100.00"],
      ["Cancelled", [1], "200.00"],
    ] as const) {
      if (status !== "All") {
        await page.getByLabel("Status", { exact: true }).click();
        await page.getByRole("option", { name: status, exact: true }).click();
      }
      const csv = await readFile(await download(page, "CSV"), "utf8");
      const data = csv.trimEnd().split("\n").slice(1);
      expect(data.map(line => line.split(",")[0])).toEqual(
        expected.map(reference)
      );
      const book = await workbookAt(await download(page, "Excel"));
      const detail = book.getWorksheet("Bookings")!;
      expect(detail.actualRowCount).toBe(expected.length + 1);
      for (const [position, index] of expected.entries()) {
        const record =
          index === 0
            ? ["confirmed", "100.00", "00:00:00"]
            : ["cancelled", "200.00", "23:59:59"];
        const [state, amount, time] = record;
        const created = day + "T" + time + ".000Z";
        expect(data[position]).toContain(
          "," + state + ",pending," + amount + ","
        );
        expect(data[position].endsWith("," + created)).toBe(true);
        const row = detail.getRow(position + 2);
        expect([1, 8, 10, 13].map(column => row.getCell(column).value)).toEqual(
          [reference(index), state, amount, created]
        );
      }
      const summary = book.getWorksheet("Summary")!;
      const summaryCell = (label: string) =>
        summary
          .getRows(1, summary.rowCount)
          ?.find(row => row.getCell(1).value === label)
          ?.getCell(2).value;
      expect(summaryCell("Total Bookings:")).toBe(expected.length);
      expect(summaryCell("Total Booking Amount (SAR):")).toBe(total);
      const pdf = (
        await promisify(execFile)("pdftotext", [
          await download(page, "PDF"),
          "-",
        ])
      ).stdout.replace(/\s+/g, " ");
      expect(pdf).toContain("Total Bookings: " + expected.length + " ");
      expect(pdf).toContain("Total Booking Amount (SAR): " + total + " ");
      expect(pdf).toContain(
        "Confirmed Bookings: " + (status === "Cancelled" ? 0 : 1) + " "
      );
      expect(pdf).toContain(
        "Cancelled Bookings: " + (status === "Confirmed" ? 0 : 1) + " "
      );
    }
  } finally {
    for (const id of ids)
      await db.execute("DELETE FROM bookings WHERE id=?", [id]);
    await db.execute("DELETE FROM flights WHERE id=?", [flightId]);
    await db.end();
  }
});

test("flight exports use the same flight IDs, departure day, status and seat totals", async ({
  page,
}, info) => {
  const db = await mysql.createConnection(disposableDatabaseUrl());
  const ids: number[] = [];
  const stamp =
    "2034-03-" + String(1 + (info.parallelIndex % 28)).padStart(2, "0");
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    for (const [status, time, dayOffset] of [
      ["delayed", "23:59:59", 0],
      ["scheduled", "09:00:00", 0],
      ["delayed", "00:00:00", 1],
    ] as const) {
      const id = await fixtureFlight();
      ids.push(id);
      await db.execute(
        "UPDATE flights SET status=?, departureTime=DATE_ADD(CAST(? AS DATETIME), INTERVAL ? DAY), arrivalTime=DATE_ADD(?, INTERVAL 2 DAY), economyAvailable=8 WHERE id=?",
        [status, stamp + " " + time, dayOffset, stamp, id]
      );
    }
    await openReport(page, "Flights", stamp, stamp);
    await page.getByLabel("Status", { exact: true }).click();
    await page.getByRole("option", { name: "Delayed", exact: true }).click();
    const csv = await readFile(await download(page, "CSV"), "utf8");
    const records = csv.trimEnd().split("\n");
    expect(records).toHaveLength(2);
    expect(records[1]).toMatch(new RegExp("^" + ids[0] + ","));
    expect(records[1]).toContain(
      stamp + "T23:59:59.000Z,delayed,12,2,16.7,200.00"
    );
    const workbook = await workbookAt(await download(page, "Excel"));
    const sheet = workbook.getWorksheet("Flights")!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(2).getCell(1).value).toBe(ids[0]);
    expect(sheet.getRow(2).getCell(9).value).toBe(2);
    const pdf = (
      await promisify(execFile)("pdftotext", [await download(page, "PDF"), "-"])
    ).stdout.replace(/\s+/g, " ");
    expect(pdf).toContain("Total flights: 1");
    expect(pdf).toContain("Total booked: 2");
    expect(pdf).toContain("Flight ID: " + ids[0] + " ");
    expect(pdf).toContain("Estimated Revenue (SAR): 200.00");
  } finally {
    for (const id of ids)
      await db.execute("DELETE FROM flights WHERE id=?", [id]);
    await db.end();
  }
});

test("revenue downloads reconcile a paid ticket and a later partial refund by UTC day", async ({
  page,
}, info) => {
  const { booking, userId, flightId } = await reportBooking(page);
  const passenger = rpc(page);
  expect(await passenger.auth.me.query()).toMatchObject({
    id: userId,
    email: testUsers.reporting.email,
    role: "user",
  });
  const db = await mysql.createConnection(disposableDatabaseUrl());
  const date = new Date(Date.UTC(2034, 4, 1 + (info.parallelIndex % 12) * 2));
  const first = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 1);
  const second = date.toISOString().slice(0, 10);
  const originalTimes: { id: number; postedAt: string }[] = [];
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    // Only the starting wallet balance is seeded. All charges, the coupon and the partial refund are written by the application.
    await passenger.wallet.balance.query();
    await db.execute("UPDATE wallets SET balance=balance+? WHERE userId=?", [
      booking.totalAmount,
      userId,
    ]);
    await passenger.wallet.pay.mutate({
      bookingId: booking.bookingId,
      expectedAmount: booking.totalAmount,
    });
    const [traveller] = await passenger.bookings.getPassengers.query({
      bookingId: booking.bookingId,
    });
    const ticket = await passenger.eticket.generateETicket.mutate({
      bookingId: booking.bookingId,
      passengerId: traveller.id,
    });
    const credit = await reportBooking(page, true);
    expect(credit.userId).toBe(userId);
    await useBrowserSession(page, "admin");
    const operator = rpc(page);
    const administrator = await operator.auth.me.query();
    expect(administrator).toMatchObject({ role: "admin" });
    expect(administrator?.id).not.toBe(userId);
    const refund = await operator.refunds.refundInternalFunding.mutate({
      bookingId: booking.bookingId,
      amount: 1234,
      requestId: randomUUID(),
      approvalReference: "Synthetic report acceptance",
      reason: "Partial refund for report reconciliation",
      cancelItinerary: false,
    });
    expect(refund).toMatchObject({
      tender: "wallet",
      amount: 1234,
      remaining: booking.totalAmount - 1234,
      cancelled: false,
    });
    const [coupon] = await db.execute<RowDataPacket[]>(
      "SELECT c.status,b.paymentStatus,b.totalAmount FROM ticket_coupons c JOIN bookings b ON b.id=c.bookingId WHERE c.bookingId=? AND c.ticketNumber=? AND c.flightId=?",
      [booking.bookingId, ticket.ticketNumber, flightId]
    );
    expect(coupon).toMatchObject([
      { status: "O", paymentStatus: "paid", totalAmount: booking.totalAmount },
    ]);
    // Place just these genuine postings on isolated UTC days, then restore their original timestamps.
    const [postings] = await db.execute<RowDataPacket[]>(
      "SELECT id,type,DATE_FORMAT(transactionDate,'%Y-%m-%d %H:%i:%s') AS postedAt FROM financial_ledger WHERE bookingId IN (?,?)",
      [booking.bookingId, credit.booking.bookingId]
    );
    expect(postings).toHaveLength(3);
    for (const entry of postings) {
      originalTimes.push({ id: entry.id, postedAt: entry.postedAt });
      await db.execute(
        "UPDATE financial_ledger SET transactionDate=? WHERE id=?",
        [
          entry.id === refund.ledgerId
            ? second + " 23:59:59"
            : first + " 00:00:00",
          entry.id,
        ]
      );
    }
    await openReport(page, "Revenue", first, second);
    const csv = await readFile(await download(page, "CSV"), "utf8");
    const paid = (booking.totalAmount / 100).toFixed(2);
    const nonCash = (credit.booking.totalAmount / 100).toFixed(2);
    const expected = [
      [first, 0, "0.00", paid, "0.00", paid, nonCash, "0.00", 0, 0],
      [second, 0, "0.00", "0.00", "12.34", "-12.34", "0.00", "0.00", 0, 0],
    ];
    expect(csv.split("\n").slice(1)).toEqual(
      expected.map(row => row.join(","))
    );
    const sheet = (
      await workbookAt(await download(page, "Excel"))
    ).getWorksheet("Daily Revenue")!;
    expect(sheet.rowCount).toBe(3);
    for (const [index, row] of expected.entries()) {
      expect((sheet.getRow(index + 2).values as unknown[]).slice(1)).toEqual(
        row
      );
    }
    const pdf = (
      await promisify(execFile)("pdftotext", [await download(page, "PDF"), "-"])
    ).stdout.replace(/\s+/g, " ");
    expect(pdf).toContain(
      "Net cash collected (SAR): " +
        ((booking.totalAmount - 1234) / 100).toFixed(2)
    );
    expect(pdf).toContain("Date (UTC): " + second);
    expect(pdf).toContain("Net cash collected (SAR): -12.34");
  } finally {
    for (const entry of originalTimes)
      await db.execute(
        "UPDATE financial_ledger SET transactionDate=? WHERE id=?",
        [entry.postedAt, entry.id]
      );
    await db.end();
  }
});

test("refund downloads report posted partial settlements at both UTC day boundaries after full cancellation", async ({
  page,
}, info) => {
  const { booking, userId } = await reportBooking(page);
  const passenger = rpc(page);
  const customer = await passenger.auth.me.query();
  if (!customer?.tenantId) throw new Error("Scoped refund customer required");
  const finance = await createReportingStaff(customer.tenantId, "finance");
  const db = await mysql.createConnection(disposableDatabaseUrl());
  const day =
    "2035-01-" + String(2 + (info.parallelIndex % 26)).padStart(2, "0");
  const originalTimes: { id: number; postedAt: string }[] = [];
  const settlements: {
    id: number;
    amount: number;
    offset: number;
    time: string;
  }[] = [];
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    await passenger.wallet.balance.query();
    await db.execute("UPDATE wallets SET balance=balance+? WHERE userId=?", [
      booking.totalAmount,
      userId,
    ]);
    await passenger.wallet.pay.mutate({
      bookingId: booking.bookingId,
      expectedAmount: booking.totalAmount,
    });
    await useReportingStaff(page, finance.staff);
    const operator = rpc(page);
    expect(booking.totalAmount).toBeGreaterThan(3680);
    // The last refund cancels the booking. Its current state and creation day
    // must not replace the immutable settlement date/amount in these exports.
    for (const [amount, offset, time, cancelItinerary] of [
      [101, -1, "23:59:59", false],
      [2345, 0, "00:00:00", false],
      [1234, 0, "23:59:59", false],
      [booking.totalAmount - 3680, 1, "00:00:00", true],
    ] as const) {
      const refund = await operator.refunds.refundInternalFunding.mutate({
        bookingId: booking.bookingId,
        amount,
        requestId: randomUUID(),
        approvalReference: "Synthetic refund export acceptance",
        reason: "Verify posted refund export boundaries",
        cancelItinerary,
      });
      expect(refund).toMatchObject({
        tender: "wallet",
        amount,
        cancelled: cancelItinerary,
      });
      settlements.push({ id: refund.ledgerId, amount, offset, time });
    }
    const [state] = await db.execute<RowDataPacket[]>(
      "SELECT status,paymentStatus FROM bookings WHERE id=?",
      [booking.bookingId]
    );
    expect(state).toMatchObject([
      { status: "cancelled", paymentStatus: "refunded" },
    ]);
    for (const entry of settlements) {
      const [[original]] = await db.execute<RowDataPacket[]>(
        "SELECT DATE_FORMAT(transactionDate,'%Y-%m-%d %H:%i:%s') AS postedAt FROM financial_ledger WHERE id=?",
        [entry.id]
      );
      originalTimes.push({ id: entry.id, postedAt: original.postedAt });
      await db.execute(
        "UPDATE financial_ledger SET transactionDate=DATE_ADD(CAST(? AS DATETIME), INTERVAL ? DAY) WHERE id=?",
        [day + " " + entry.time, entry.offset, entry.id]
      );
    }
    await selectReport(page, "Refunds", day, day);
    const expected = [settlements[2], settlements[1]];
    const csv = await readFile(await download(page, "CSV"), "utf8");
    const rows = csv
      .trimEnd()
      .split("\n")
      .slice(1)
      .map(row => row.split(","));
    expect(rows).toHaveLength(2);
    for (const [index, entry] of expected.entries()) {
      expect([0, 1, 2, 7, 8, 9].map(column => rows[index][column])).toEqual([
        String(entry.id),
        String(booking.bookingId),
        booking.bookingReference,
        (entry.amount / 100).toFixed(2),
        "settled",
        day + "T" + entry.time + ".000Z",
      ]);
    }
    const book = await workbookAt(await download(page, "Excel"));
    const detail = book.getWorksheet("Refunds")!;
    expect(detail.actualRowCount).toBe(3);
    for (const [index, row] of rows.entries())
      expect((detail.getRow(index + 2).values as unknown[]).slice(1)).toEqual(
        row
      );
    expect(summaryValue(book, "Settlement Entries")).toBe(2);
    expect(summaryValue(book, "Refunded Bookings")).toBe(1);
    expect(summaryValue(book, "Total Refunded Amount (SAR)")).toBe("35.79");
    const pdf = await pdfTextAt(await download(page, "PDF"));
    expect(pdf).toContain("Settlement Entries: 2 ");
    expect(pdf).toContain("Refunded Bookings: 1 ");
    expect(pdf).toContain("Total Refunded Amount: 35.79 SAR");
    expect(pdf).toContain(day + ": 2 entries - 35.79 SAR");
  } finally {
    try {
      for (const entry of originalTimes)
        await db.execute(
          "UPDATE financial_ledger SET transactionDate=? WHERE id=?",
          [entry.postedAt, entry.id]
        );
    } finally {
      try {
        await page.context().clearCookies();
      } finally {
        try {
          await finance.cleanup();
        } finally {
          await db.end();
        }
      }
    }
  }
});

test("finance browser downloads isolate both tenants in CSV, Excel and PDF summaries", async ({
  page,
}, info) => {
  const day =
    "2035-04-" + String(1 + (info.parallelIndex % 28)).padStart(2, "0");
  const fixture = await createReportingTenants(day);
  try {
    for (const [index, tenant] of fixture.tenants.entries()) {
      const foreign = fixture.tenants[1 - index];
      await useReportingStaff(page, tenant.finance);
      for (const tab of ["Bookings", "Revenue", "Refunds"] as const) {
        await selectReport(page, tab, day, day);
        await expect(
          page.getByRole("tab", { name: "Flights", exact: true })
        ).toHaveCount(0);
        const csv = await readFile(await download(page, "CSV"), "utf8");
        const rows = csv.trimEnd().split("\n").slice(1);
        const book = await workbookAt(await download(page, "Excel"));
        const cells = JSON.stringify(
          book.worksheets.map(sheet => sheet.getSheetValues())
        );
        const pdf = await pdfTextAt(await download(page, "PDF"));
        const amount = (tenant.amount / 100).toFixed(2);
        const refund = (tenant.refund / 100).toFixed(2);
        expect(rows).toHaveLength(1);
        if (tab === "Bookings") {
          expect(rows[0].split(",")[0]).toBe(tenant.reference);
          expect(book.getWorksheet("Bookings")!.actualRowCount).toBe(2);
          expect(summaryValue(book, "Total Bookings:")).toBe(1);
          expect(summaryValue(book, "Total Booking Amount (SAR):")).toBe(
            amount
          );
          expect(pdf).toContain("Total Bookings: 1 ");
          expect(pdf).toContain("Total Booking Amount (SAR): " + amount + " ");
          expect(pdf).not.toContain((foreign.amount / 100).toFixed(2));
        } else if (tab === "Revenue") {
          const values = [
            day,
            1,
            amount,
            amount,
            refund,
            ((tenant.amount - tenant.refund) / 100).toFixed(2),
            "0.00",
            "0.00",
            0,
            0,
          ];
          expect(rows[0]).toBe(values.join(","));
          expect(
            (
              book.getWorksheet("Daily Revenue")!.getRow(2).values as unknown[]
            ).slice(1)
          ).toEqual(values);
          expect(book.getWorksheet("Daily Revenue")!.actualRowCount).toBe(2);
          expect(pdf).toContain("Cash collected (SAR): " + amount);
          expect(pdf).toContain("Cash refunded (SAR): " + refund);
          expect(pdf).toContain(
            "Net cash collected (SAR): " +
              ((tenant.amount - tenant.refund) / 100).toFixed(2)
          );
          expect(pdf).not.toContain((foreign.amount / 100).toFixed(2));
          expect(pdf).not.toContain((foreign.refund / 100).toFixed(2));
        } else {
          const data = rows[0].split(",");
          expect([data[1], data[2], data[7], data[8]]).toEqual([
            String(tenant.bookingId),
            tenant.reference,
            refund,
            "settled",
          ]);
          expect(book.getWorksheet("Refunds")!.actualRowCount).toBe(2);
          expect(summaryValue(book, "Settlement Entries")).toBe(1);
          expect(summaryValue(book, "Total Refunded Amount (SAR)")).toBe(
            refund
          );
          expect(pdf).toContain("Settlement Entries: 1 ");
          expect(pdf).toContain("Total Refunded Amount: " + refund + " SAR");
          expect(pdf).not.toContain((foreign.refund / 100).toFixed(2));
        }
        if (tab !== "Revenue") {
          expect(csv).toContain(tenant.reference);
          expect(cells).toContain(tenant.reference);
        }
        // A PDF summary has no booking rows; assert its tenant-specific amounts
        // and counts above, as well as excluding foreign identifiers everywhere.
        for (const content of [csv, cells, pdf]) {
          expect(content).not.toContain(foreign.reference);
          expect(content).not.toContain(foreign.flightNumber);
        }
      }
      await expect(
        rpc(page).reports.exportFlightPerformanceCSV.mutate({
          startDate: day,
          endDate: day,
        })
      ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    }
  } finally {
    await page.context().clearCookies();
    await fixture.cleanup();
  }
});

test("operations browser downloads isolate both tenants including PDF flight identities", async ({
  page,
}, info) => {
  const day =
    "2035-07-" + String(1 + (info.parallelIndex % 28)).padStart(2, "0");
  const fixture = await createReportingTenants(day);
  try {
    for (const [index, tenant] of fixture.tenants.entries()) {
      const foreign = fixture.tenants[1 - index];
      await useReportingStaff(page, tenant.ops);
      await selectReport(page, "Flights", day, day);
      await expect(page.getByRole("tab")).toHaveCount(1);
      const csv = await readFile(await download(page, "CSV"), "utf8");
      const rows = csv.trimEnd().split("\n").slice(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].split(",").slice(0, 2)).toEqual([
        String(tenant.flightId),
        tenant.flightNumber,
      ]);
      const book = await workbookAt(await download(page, "Excel"));
      const sheet = book.getWorksheet("Flights")!;
      expect(sheet.actualRowCount).toBe(2);
      expect(
        [1, 2, 9].map(column => sheet.getRow(2).getCell(column).value)
      ).toEqual([tenant.flightId, tenant.flightNumber, tenant.bookedSeats]);
      expect(summaryValue(book, "Total flights")).toBe(1);
      expect(summaryValue(book, "Total booked")).toBe(tenant.bookedSeats);
      const pdf = await pdfTextAt(await download(page, "PDF"));
      expect(pdf).toContain("Total flights: 1 ");
      expect(pdf).toContain("Total booked: " + tenant.bookedSeats + " ");
      expect(pdf).toContain("Flight ID: " + tenant.flightId + " ");
      expect(pdf).toContain("Flight Number: " + tenant.flightNumber + " ");
      expect(pdf).toContain(
        "Estimated Revenue (SAR): " +
          ((tenant.amount * tenant.bookedSeats) / 100).toFixed(2)
      );
      expect(pdf).not.toContain("Flight ID: " + foreign.flightId + " ");
      for (const content of [
        csv,
        JSON.stringify(book.worksheets.map(value => value.getSheetValues())),
        pdf,
      ])
        expect(content).not.toContain(foreign.flightNumber);
      await expect(
        rpc(page).reports.exportRevenueCSV.mutate({
          startDate: day,
          endDate: day,
        })
      ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    }
  } finally {
    await page.context().clearCookies();
    await fixture.cleanup();
  }
});
