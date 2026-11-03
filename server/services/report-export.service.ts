/**
 * Report Export Service
 *
 * Generates reports in various formats (CSV, PDF, Excel)
 * Supports analytics, bookings, financial, and refunds reports
 */

import { escapeCSV } from "../../shared/csv";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  users,
  airports,
  airlines,
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import {
  getFinancialDays,
  summarizeFinancialDays,
  type FinancialAmounts,
  type FinancialDay,
} from "./financial-reporting.service";
import { getRefundExportRows } from "./refunds-stats.service";

/**
 * Build an .xlsx buffer from named sheets given as arrays-of-arrays.
 * (exceljs replaced SheetJS `xlsx`, whose last npm release 0.18.5 carries
 * unfixed prototype-pollution and ReDoS advisories.)
 */
async function buildXlsxBuffer(
  sheets: Array<{ name: string; rows: unknown[][] }>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    workbook.addWorksheet(sheet.name).addRows(sheet.rows);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ============================================================================
// Types
// ============================================================================

export interface ReportFilters {
  startDate?: Date;
  endDate?: Date;
  status?: typeof bookings.$inferSelect.status;
  type?: string;
}

export interface BookingReportRow {
  bookingReference: string;
  pnr: string;
  passengerName: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  cabinClass: string;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
}

export interface RevenueReportRow {
  date: string;
  totalBookings: number;
  totalRevenue: number;
  confirmedRevenue: number;
  refundedAmount: number;
  currency: string;
}

export interface FlightPerformanceRow {
  flightNumber: string;
  airline: string;
  origin: string;
  destination: string;
  totalSeats: number;
  bookedSeats: number;
  occupancyRate: number;
  revenue: number;
}

// ============================================================================
// CSV Export Functions
// ============================================================================

const maxBookingRows = 10000;

async function getBookingRows(filters: ReportFilters) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const conditions = [];
  if (filters.startDate) {
    conditions.push(gte(bookings.createdAt, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(bookings.createdAt, filters.endDate));
  }
  if (filters.status) {
    conditions.push(eq(bookings.status, filters.status));
  }

  const results = await db
    .select({
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      flightNumber: flights.flightNumber,
      origin: sql<string>`origin_airport.city`,
      destination: sql<string>`dest_airport.city`,
      departureTime: flights.departureTime,
      cabinClass: bookings.cabinClass,
      status: bookings.status,
      paymentStatus: bookings.paymentStatus,
      totalAmount: bookings.totalAmount,
      passengers: bookings.numberOfPassengers,
      userEmail: users.email,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .leftJoin(flights, eq(bookings.flightId, flights.id))
    .leftJoin(users, eq(bookings.userId, users.id))
    .leftJoin(
      sql`${airports} AS origin_airport`,
      sql`origin_airport.id = ${flights.originId}`
    )
    .leftJoin(
      sql`${airports} AS dest_airport`,
      sql`dest_airport.id = ${flights.destinationId}`
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(bookings.createdAt), desc(bookings.id))
    .limit(maxBookingRows + 1);
  if (results.length > maxBookingRows) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Report exceeds 10,000 bookings. Narrow the selected filters.",
    });
  }
  return results;
}

type BookingRow = Awaited<ReturnType<typeof getBookingRows>>[number];
const bookingHeaders = [
  "Booking Reference",
  "PNR",
  "Flight Number",
  "Origin",
  "Destination",
  "Departure Date",
  "Cabin Class",
  "Status",
  "Payment Status",
  "Total Amount (SAR)",
  "Passengers",
  "User Email",
  "Created At",
];

function bookingCells(row: BookingRow) {
  return [
    row.bookingReference || "",
    row.pnr || "",
    row.flightNumber || "",
    row.origin || "",
    row.destination || "",
    row.departureTime ? new Date(row.departureTime).toISOString() : "",
    row.cabinClass || "",
    row.status || "",
    row.paymentStatus || "",
    ((Number(row.totalAmount) || 0) / 100).toFixed(2),
    row.passengers || 0,
    row.userEmail || "",
    row.createdAt ? new Date(row.createdAt).toISOString() : "",
  ];
}

function bookingSummary(rows: BookingRow[]) {
  const amount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  return [
    ["Total Bookings", rows.length, "إجمالي الحجوزات"],
    [
      "Total Booking Amount (SAR)",
      (amount / 100).toFixed(2),
      "إجمالي قيمة الحجوزات",
    ],
    [
      "Confirmed Bookings",
      rows.filter(row => row.status === "confirmed").length,
      "الحجوزات المؤكدة",
    ],
    [
      "Cancelled Bookings",
      rows.filter(row => row.status === "cancelled").length,
      "الحجوزات الملغاة",
    ],
    [
      "Total Passengers",
      rows.reduce((sum, row) => sum + row.passengers, 0),
      "إجمالي الركاب",
    ],
  ] as const;
}

export async function exportBookingsToCSV(
  filters: ReportFilters
): Promise<string> {
  const rows = await getBookingRows(filters);
  return [bookingHeaders, ...rows.map(bookingCells)]
    .map(row => row.map(cell => escapeCSV(String(cell))).join(","))
    .join("\n");
}

const financialColumns = [
  ["Billed (SAR)", "billedAmount"],
  ["Cash collected (SAR)", "collectedAmount"],
  ["Cash refunded (SAR)", "refundedAmount"],
  ["Net cash collected (SAR)", "netCollectedAmount"],
  ["Non-cash funded (SAR)", "nonCashFundedAmount"],
  ["Non-cash refunded (SAR)", "nonCashRefundedAmount"],
] as const;
const revenueHeaders = [
  "Date (UTC)",
  "Bookings created",
  ...financialColumns.map(([label]) => label),
  "Unreconciled bookings",
  "Unclassified entries",
];

function revenueCells(row: FinancialDay) {
  return [
    row.date,
    row.bookings,
    ...financialColumns.map(([, key]) => (row[key] / 100).toFixed(2)),
    row.unreconciledBookings,
    row.unclassifiedEntries,
  ];
}
async function revenueReport(filters: ReportFilters) {
  const endDate = filters.endDate ?? new Date();
  const startDate =
    filters.startDate ?? new Date(endDate.getTime() - 30 * 86400000);
  const rows = await getFinancialDays({ startDate, endDate });
  return { startDate, endDate, rows };
}

export async function exportRevenueToCSV(
  filters: ReportFilters
): Promise<string> {
  const { rows } = await revenueReport(filters);
  // The projection contains only ISO dates and trusted numeric amounts. Keep negative cash numeric.
  return [revenueHeaders, ...rows.map(revenueCells)]
    .map(row => row.join(","))
    .join("\n");
}

type FlightReportFilters = {
  startDate?: Date;
  endDate?: Date;
  status?: typeof flights.$inferSelect.status;
};
const flightHeaders = [
  "Flight ID",
  "Flight Number",
  "Airline",
  "Origin",
  "Destination",
  "Departure Time (UTC)",
  "Status",
  "Total Seats",
  "Booked Seats",
  "Occupancy Rate (%)",
  "Estimated Revenue (SAR)",
];
async function getFlightPerformance(filters: FlightReportFilters) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  // Each format reads the same ordered set; reject an oversized report instead of returning partial totals.
  const records = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      airlineName: airlines.name,
      originCity: sql<string>`origin_airport.city`,
      destCity: sql<string>`dest_airport.city`,
      departureTime: flights.departureTime,
      status: flights.status,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
    })
    .from(flights)
    .leftJoin(airlines, eq(flights.airlineId, airlines.id))
    .leftJoin(
      sql`${airports} AS origin_airport`,
      sql`origin_airport.id = ${flights.originId}`
    )
    .leftJoin(
      sql`${airports} AS dest_airport`,
      sql`dest_airport.id = ${flights.destinationId}`
    )
    .where(
      and(
        filters.startDate
          ? gte(flights.departureTime, filters.startDate)
          : undefined,
        filters.endDate
          ? lte(flights.departureTime, filters.endDate)
          : undefined,
        filters.status ? eq(flights.status, filters.status) : undefined
      )
    )
    .orderBy(desc(flights.departureTime), desc(flights.id))
    .limit(1001);
  if (records.length > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "More than 1,000 flights match. Narrow the report period or flight status.",
    });
  return records.map(row => {
    const seats = row.economySeats + row.businessSeats;
    const booked = seats - row.economyAvailable - row.businessAvailable;
    const estimated =
      (row.economySeats - row.economyAvailable) * row.economyPrice +
      (row.businessSeats - row.businessAvailable) * row.businessPrice;
    return { ...row, seats, booked, estimated };
  });
}
type FlightExportRow = Awaited<ReturnType<typeof getFlightPerformance>>[number];
function flightCells(row: FlightExportRow) {
  return [
    row.id,
    row.flightNumber,
    row.airlineName ?? "",
    row.originCity ?? "",
    row.destCity ?? "",
    row.departureTime.toISOString(),
    row.status,
    row.seats,
    row.booked,
    (row.seats > 0 ? (100 * row.booked) / row.seats : 0).toFixed(1),
    (row.estimated / 100).toFixed(2),
  ];
}
function flightSummary(rows: FlightExportRow[]) {
  const seats = rows.reduce((sum, row) => sum + row.seats, 0);
  const booked = rows.reduce((sum, row) => sum + row.booked, 0);
  return [
    ["Total flights", rows.length],
    ["Total seats", seats],
    ["Total booked", booked],
    [
      "Overall occupancy (%)",
      (seats > 0 ? (100 * booked) / seats : 0).toFixed(1),
    ],
    [
      "Estimated revenue (SAR)",
      (rows.reduce((sum, row) => sum + row.estimated, 0) / 100).toFixed(2),
    ],
  ];
}
export async function exportFlightPerformanceToCSV(
  filters: FlightReportFilters
): Promise<string> {
  const rows = await getFlightPerformance(filters);
  return [flightHeaders, ...rows.map(flightCells)]
    .map(row => row.map(cell => escapeCSV(String(cell))).join(","))
    .join("\n");
}

// ============================================================================
// PDF Export Functions
// ============================================================================

/**
 * Generate PDF report for bookings summary
 */
export async function generateBookingsPDF(
  filters: ReportFilters
): Promise<Buffer> {
  const rows = await getBookingRows(filters);
  return reportPDF("Booking Report - AIS Aviation / تقرير الحجوزات", doc => {
    doc.text(
      `Created (UTC): ${filters.startDate?.toISOString() ?? "All time"} to ${filters.endDate?.toISOString() ?? "No end date"}`
    );
    doc.text(`Status: ${filters.status ?? "All"}`);
    doc.moveDown();
    doc.fontSize(14).text("Summary / ملخص");
    doc.fontSize(11);
    for (const [label, value, arabicLabel] of bookingSummary(rows)) {
      doc.text(`${label}: ${value} / ${arabicLabel}`);
    }
    doc.moveDown();
    doc.fontSize(9).text(`Generated on ${new Date().toISOString()}`);
  });
}

function reportPDF(
  title: string,
  write: (doc: PDFKit.PDFDocument) => void
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(18).text(title);
    doc.moveDown();
    doc.fontSize(10);
    write(doc);
    doc.end();
  });
}
function revenueSummary(rows: FinancialDay[]) {
  const totals: FinancialAmounts = summarizeFinancialDays(rows);
  return [
    ["Bookings created", rows.reduce((sum, row) => sum + row.bookings, 0)],
    ...financialColumns.map(([label, key]) => [
      label,
      (totals[key] / 100).toFixed(2),
    ]),
    ["Unreconciled bookings", totals.unreconciledBookings],
    ["Unclassified entries", totals.unclassifiedEntries],
  ];
}
export async function generateRevenuePDF(
  filters: ReportFilters
): Promise<Buffer> {
  const { rows, startDate, endDate } = await revenueReport(filters);
  return reportPDF("AIS - Booking billing and settlements", doc => {
    doc.text(
      `Period (UTC): ${startDate.toISOString()} to ${endDate.toISOString()}`
    );
    for (const [label, value] of revenueSummary(rows))
      doc.text(`${label}: ${value}`);
    doc.moveDown();
    doc.text("Daily detail (UTC)");
    for (const row of rows) {
      doc.moveDown(0.5);
      const cells = revenueCells(row);
      doc.text(
        revenueHeaders.map((label, i) => `${label}: ${cells[i]}`).join("  |  ")
      );
    }
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get report filename with timestamp
 */
export function getReportFilename(reportType: string, format: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${reportType}-${timestamp}.${format}`;
}

// ============================================================================
// Excel Export Functions
// ============================================================================

/**
 * Export bookings report to Excel format
 */
export async function exportBookingsToExcel(
  filters: ReportFilters
): Promise<Buffer> {
  const rows = await getBookingRows(filters);
  return buildXlsxBuffer([
    {
      name: "Summary",
      rows: [
        ["AIS Aviation System - Bookings Report"],
        ["Start (UTC)", filters.startDate?.toISOString() ?? "All time"],
        ["End (UTC)", filters.endDate?.toISOString() ?? "No end date"],
        ["Status", filters.status ?? "All"],
        ["Generated:", new Date().toISOString()],
        [],
        ["Summary Statistics"],
        ...bookingSummary(rows).map(([label, value]) => [`${label}:`, value]),
      ],
    },
    { name: "Bookings", rows: [bookingHeaders, ...rows.map(bookingCells)] },
  ]);
}

export async function exportRevenueToExcel(
  filters: ReportFilters
): Promise<Buffer> {
  const { rows, startDate, endDate } = await revenueReport(filters);
  return buildXlsxBuffer([
    {
      name: "Summary",
      rows: [
        ["AIS - Booking billing and settlements"],
        ["Start (UTC)", startDate.toISOString()],
        ["End (UTC)", endDate.toISOString()],
        ...revenueSummary(rows),
      ],
    },
    {
      name: "Daily Revenue",
      rows: [revenueHeaders, ...rows.map(revenueCells)],
    },
  ]);
}
export async function exportFlightPerformanceToExcel(
  filters: FlightReportFilters
): Promise<Buffer> {
  const rows = await getFlightPerformance(filters);
  return buildXlsxBuffer([
    { name: "Summary", rows: flightSummary(rows) },
    { name: "Flights", rows: [flightHeaders, ...rows.map(flightCells)] },
  ]);
}

// ============================================================================
// Refunds Report Functions
// ============================================================================

export interface RefundsReportRow {
  bookingReference: string;
  pnr: string;
  userEmail: string;
  refundAmount: number;
  originalAmount: number;
  reason: string;
  status: string;
  refundedAt: string;
}

/** Every refund export uses the same bounded, posted-ledger projection. */
const refundHeaders = [
  "Settlement ID",
  "Booking ID",
  "Booking Reference",
  "PNR",
  "User Email",
  "Flight Number",
  "Route",
  "Refund Amount (SAR)",
  "Status",
  "Settlement Date (UTC)",
];
type RefundExportRow = Awaited<ReturnType<typeof getRefundExportRows>>[number];
function refundCells(row: RefundExportRow) {
  return [
    String(row.id),
    String(row.bookingId),
    row.bookingReference,
    row.pnr,
    row.userEmail,
    row.flightNumber,
    `${row.origin} - ${row.destination}`,
    (row.amount / 100).toFixed(2),
    row.status,
    row.refundedAt.toISOString(),
  ];
}
function refundSummary(rows: RefundExportRow[]) {
  const amount = rows.reduce((sum, row) => sum + row.amount, 0);
  return {
    count: rows.length,
    amount,
    bookings: new Set(rows.map(row => row.bookingId)).size,
  };
}
export async function exportRefundsToCSV(
  filters: ReportFilters
): Promise<string> {
  const rows = await getRefundExportRows(filters);
  return [
    refundHeaders.join(","),
    ...rows.map(row => refundCells(row).map(escapeCSV).join(",")),
  ].join("\n");
}
export async function exportRefundsToExcel(
  filters: ReportFilters
): Promise<Buffer> {
  const rows = await getRefundExportRows(filters);
  const summary = refundSummary(rows);
  return buildXlsxBuffer([
    {
      name: "Summary",
      rows: [
        ["AIS Aviation System - Refunds Report"],
        ["Scope", "Posted SAR booking refund settlements (full and partial)"],
        ["Start (UTC)", filters.startDate?.toISOString() ?? "All time"],
        ["End (UTC)", filters.endDate?.toISOString() ?? "Present"],
        ["Generated", new Date().toISOString()],
        [],
        ["Settlement Entries", summary.count],
        ["Refunded Bookings", summary.bookings],
        ["Total Refunded Amount (SAR)", (summary.amount / 100).toFixed(2)],
      ],
    },
    { name: "Refunds", rows: [refundHeaders, ...rows.map(refundCells)] },
  ]);
}
export async function generateRefundsPDF(
  filters: ReportFilters
): Promise<Buffer> {
  const rows = await getRefundExportRows(filters);
  const summary = refundSummary(rows);
  const days = new Map<string, { count: number; amount: number }>();
  for (const row of rows) {
    const key = row.refundedAt.toISOString().slice(0, 10);
    const day = days.get(key) ?? { count: 0, amount: 0 };
    day.count++;
    day.amount += row.amount;
    days.set(key, day);
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(24).text("AIS Aviation - Refunds Report", { align: "center" });
    doc.moveDown();
    doc
      .fontSize(11)
      .text("Posted SAR booking refund settlements (full and partial)");
    doc.text(
      `Period (UTC): ${filters.startDate?.toISOString() ?? "All time"} - ${filters.endDate?.toISOString() ?? "Present"}`
    );
    doc.moveDown();
    doc.fontSize(16).text("Summary", { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`Settlement Entries: ${summary.count}`);
    doc.text(`Refunded Bookings: ${summary.bookings}`);
    doc.text(`Total Refunded Amount: ${(summary.amount / 100).toFixed(2)} SAR`);
    if (days.size) {
      doc.moveDown();
      doc.fontSize(16).text("Daily Settlements (UTC)", { underline: true });
      doc.moveDown();
      for (const [date, day] of [...days].sort(([a], [b]) =>
        a.localeCompare(b)
      ))
        doc
          .fontSize(10)
          .text(
            `${date}: ${day.count} entries - ${(day.amount / 100).toFixed(2)} SAR`
          );
    }
    doc.moveDown();
    doc.fontSize(9).text(`Generated on ${new Date().toISOString()}`);
    doc.end();
  });
}

export async function generateFlightPerformancePDF(
  filters: FlightReportFilters
): Promise<Buffer> {
  const rows = await getFlightPerformance(filters);
  return reportPDF("AIS - Flight performance", doc => {
    for (const [label, value] of flightSummary(rows))
      doc.text(`${label}: ${value}`);
    doc.moveDown();
    doc.text("Flights by departure (UTC)");
    for (const row of rows) {
      doc.moveDown(0.5);
      const cells = flightCells(row);
      doc.text(
        flightHeaders.map((label, i) => `${label}: ${cells[i]}`).join("  |  ")
      );
    }
  });
}
