/**
 * Report Export Service
 *
 * Generates reports in various formats (CSV, PDF, Excel)
 * Supports analytics, bookings, financial, and refunds reports
 */

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
import { getRefundExportRows } from "./refunds-stats.service";
import {
  getFinancialExport,
  type FinancialGroup,
} from "./booking-financial-reporting.service";

function financialSAR(value: number) {
  const n = BigInt(value);
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
const financialHeaders = [
  "Schema Version",
  "Basis",
  "Currency",
  "Date (UTC)",
  "Posted Collections (SAR)",
  "Posted Refunds (SAR)",
  "Net Posted Amount (SAR)",
  "Collection Entries",
  "Refund Entries",
  "Active Bookings (distinct/day)",
  "Unmatched Collection Entries",
  "Collections Under Review (SAR)",
];
function financialCells(r: FinancialGroup) {
  return [
    2,
    "posted_booking_ledger",
    "SAR",
    r.date,
    financialSAR(r.collectedAmount),
    financialSAR(r.refundedAmount),
    financialSAR(r.netAmount),
    r.collectionEntries,
    r.refundEntries,
    r.activeBookings,
    r.unmatchedCollectionEntries,
    financialSAR(r.reviewCollectionAmount),
  ];
}

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
  status?: string;
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

/**
 * Export bookings to CSV format
 */
export async function exportBookingsToCSV(
  filters: ReportFilters
): Promise<string> {
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
    conditions.push(
      eq(
        bookings.status,
        filters.status as "pending" | "confirmed" | "cancelled" | "completed"
      )
    );
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
    .orderBy(desc(bookings.createdAt))
    .limit(10000);

  // Generate CSV
  const headers = [
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

  const rows = results.map(row => [
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
    String(row.passengers || 0),
    row.userEmail || "",
    row.createdAt ? new Date(row.createdAt).toISOString() : "",
  ]);

  return [
    headers.join(","),
    ...rows.map(row => row.map(escapeCSV).join(",")),
  ].join("\n");
}

/**
 * Export revenue report to CSV
 */
export async function exportRevenueToCSV(
  filters: ReportFilters
): Promise<string> {
  const report = await getFinancialExport(filters);
  return [
    financialHeaders.join(","),
    // These cells are constants, validated numbers and generated ISO dates.
    ...report.rows.map(r => financialCells(r).map(String).join(",")),
  ].join("\n");
}

/**
 * Export flight performance to CSV
 */
export async function exportFlightPerformanceToCSV(
  _filters: ReportFilters
): Promise<string> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const results = await db
    .select({
      flightNumber: flights.flightNumber,
      airlineName: airlines.name,
      originCity: sql<string>`origin_airport.city`,
      destCity: sql<string>`dest_airport.city`,
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
    .where(eq(flights.status, "scheduled"))
    .orderBy(desc(flights.departureTime))
    .limit(1000);

  const headers = [
    "Flight Number",
    "Airline",
    "Origin",
    "Destination",
    "Total Seats",
    "Booked Seats",
    "Occupancy Rate (%)",
    "Estimated Revenue (SAR)",
  ];

  const rows = results.map(row => {
    const totalSeats = (row.economySeats || 0) + (row.businessSeats || 0);
    const availableSeats =
      (row.economyAvailable || 0) + (row.businessAvailable || 0);
    const bookedSeats = totalSeats - availableSeats;
    const occupancyRate = totalSeats > 0 ? (bookedSeats / totalSeats) * 100 : 0;

    const economyBooked = (row.economySeats || 0) - (row.economyAvailable || 0);
    const businessBooked =
      (row.businessSeats || 0) - (row.businessAvailable || 0);
    const revenue =
      economyBooked * (Number(row.economyPrice) || 0) +
      businessBooked * (Number(row.businessPrice) || 0);

    return [
      row.flightNumber || "",
      row.airlineName || "",
      row.originCity || "",
      row.destCity || "",
      String(totalSeats),
      String(bookedSeats),
      occupancyRate.toFixed(1),
      (revenue / 100).toFixed(2),
    ];
  });

  return [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
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
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get summary data
  const startDate =
    filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = filters.endDate || new Date();

  const [summary] = await db
    .select({
      totalBookings: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`SUM(${bookings.totalAmount})`,
      confirmedBookings: sql<number>`SUM(CASE WHEN ${bookings.status} = 'confirmed' THEN 1 ELSE 0 END)`,
      cancelledBookings: sql<number>`SUM(CASE WHEN ${bookings.status} = 'cancelled' THEN 1 ELSE 0 END)`,
      totalPassengers: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(bookings)
    .where(
      and(gte(bookings.createdAt, startDate), lte(bookings.createdAt, endDate))
    );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title
    doc.fontSize(24).text("تقرير الحجوزات - AIS Aviation", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Booking Report - AIS Aviation`, { align: "center" });
    doc.moveDown(2);

    // Date range
    doc
      .fontSize(12)
      .text(
        `Period: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
        { align: "center" }
      );
    doc.moveDown(2);

    // Summary statistics
    doc.fontSize(16).text("Summary / ملخص", { underline: true });
    doc.moveDown();

    const stats = [
      {
        label: "Total Bookings / إجمالي الحجوزات",
        value: summary?.totalBookings || 0,
      },
      {
        label: "Total Revenue / إجمالي الإيرادات",
        value: `${((Number(summary?.totalRevenue) || 0) / 100).toFixed(2)} SAR`,
      },
      { label: "Confirmed / مؤكدة", value: summary?.confirmedBookings || 0 },
      { label: "Cancelled / ملغية", value: summary?.cancelledBookings || 0 },
      {
        label: "Total Passengers / إجمالي الركاب",
        value: summary?.totalPassengers || 0,
      },
    ];

    stats.forEach(stat => {
      doc.fontSize(12).text(`${stat.label}: ${stat.value}`);
      doc.moveDown(0.5);
    });

    doc.moveDown(2);

    // Footer
    doc
      .fontSize(10)
      .text(
        `Generated on ${new Date().toISOString()}`,
        50,
        doc.page.height - 50,
        { align: "center" }
      );

    doc.end();
  });
}

/**
 * Generate PDF revenue report
 */
export async function generateRevenuePDF(
  filters: ReportFilters
): Promise<Buffer> {
  const report = await getFinancialExport(filters);
  const total = report.totals;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(20).text("AIS Aviation - Posted Booking Collections");
    doc
      .moveDown()
      .fontSize(10)
      .text(
        "Basis: posted SAR booking ledger; UTC transaction dates; schema version 2."
      );
    doc.text(
      "Includes wallet booking settlements. Not bank reconciliation or recognized revenue."
    );
    doc.text(
      `Period: ${filters.startDate?.toISOString() ?? "All time"} to ${filters.endDate?.toISOString() ?? "Unbounded"}`
    );
    doc
      .moveDown()
      .fontSize(12)
      .text(`Posted Collections: ${financialSAR(total.collectedAmount)} SAR`);
    doc.text(`Posted Refunds: ${financialSAR(total.refundedAmount)} SAR`);
    doc.text(`Net Posted Amount: ${financialSAR(total.netAmount)} SAR`);
    doc.text(`Active Bookings (distinct/period): ${total.activeBookings}`);
    doc.text(
      `Unmatched Collection Entries: ${total.unmatchedCollectionEntries}`
    );
    doc.text(
      `Collections Under Review: ${financialSAR(total.reviewCollectionAmount)} SAR`
    );
    doc
      .moveDown()
      .fontSize(10)
      .text(
        "Daily amounts: collections / refunds / net (SAR). Daily booking counts are not additive."
      );
    for (const r of report.rows) {
      if (doc.y > 710) doc.addPage();
      doc.text(
        `${r.date}: ${financialSAR(r.collectedAmount)} / ${financialSAR(r.refundedAmount)} / ${financialSAR(r.netAmount)}; ${r.activeBookings} bookings`
      );
    }
    doc.end();
  });
}

/**
 * Escape CSV field value
 */
function escapeCSV(value: string): string {
  // Spreadsheet applications interpret formula-leading untrusted text on open.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value))
    value = "'" + value;
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

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
    conditions.push(
      eq(
        bookings.status,
        filters.status as "pending" | "confirmed" | "cancelled" | "completed"
      )
    );
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
    .orderBy(desc(bookings.createdAt))
    .limit(10000);

  // Calculate summary statistics
  const totalBookings = results.length;
  const totalRevenue = results.reduce(
    (sum, r) => sum + (Number(r.totalAmount) || 0),
    0
  );
  const confirmedBookings = results.filter(
    r => r.status === "confirmed"
  ).length;
  const totalPassengers = results.reduce(
    (sum, r) => sum + (r.passengers || 0),
    0
  );

  // Create summary sheet data
  const summaryData = [
    ["AIS Aviation System - Bookings Report"],
    [],
    [
      "Report Period:",
      filters.startDate?.toLocaleDateString() || "All Time",
      "-",
      filters.endDate?.toLocaleDateString() || "Present",
    ],
    ["Generated:", new Date().toISOString()],
    [],
    ["Summary Statistics"],
    ["Total Bookings:", totalBookings],
    ["Total Revenue (SAR):", (totalRevenue / 100).toFixed(2)],
    ["Confirmed Bookings:", confirmedBookings],
    ["Total Passengers:", totalPassengers],
  ];

  // Create detail sheet data
  const headers = [
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

  const detailData = [
    headers,
    ...results.map(row => [
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
    ]),
  ];

  return buildXlsxBuffer([
    { name: "Summary", rows: summaryData },
    { name: "Bookings", rows: detailData },
  ]);
}

/**
 * Export revenue report to Excel format
 */
export async function exportRevenueToExcel(
  filters: ReportFilters
): Promise<Buffer> {
  const report = await getFinancialExport(filters);
  const total = report.totals;
  return buildXlsxBuffer([
    {
      name: "Summary",
      rows: [
        ["AIS Aviation - Posted Booking Collections"],
        ["Schema Version", report.schemaVersion],
        ["Basis", report.basis],
        ["Currency", report.currency],
        ["Period Basis", report.periodBasis],
        ["Start", filters.startDate?.toISOString() ?? "All time"],
        ["End", filters.endDate?.toISOString() ?? "Unbounded"],
        ["Posted Collections (SAR)", financialSAR(total.collectedAmount)],
        ["Posted Refunds (SAR)", financialSAR(total.refundedAmount)],
        ["Net Posted Amount (SAR)", financialSAR(total.netAmount)],
        ["Active Bookings (distinct/period)", total.activeBookings],
        ["Unmatched Collection Entries", total.unmatchedCollectionEntries],
        [
          "Collections Under Review (SAR)",
          financialSAR(total.reviewCollectionAmount),
        ],
        [
          "Recognized Revenue",
          "Unavailable: recognition journal and allocation evidence required",
        ],
        [
          "Scope",
          "Posted SAR booking collections include wallet settlements; not bank reconciliation or earned revenue",
        ],
      ],
    },
    {
      name: "Daily Settlements",
      rows: [financialHeaders, ...report.rows.map(financialCells)],
    },
  ]);
}

/**
 * Export flight performance to Excel format
 */
export async function exportFlightPerformanceToExcel(
  _filters: ReportFilters
): Promise<Buffer> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const results = await db
    .select({
      flightNumber: flights.flightNumber,
      airlineName: airlines.name,
      originCity: sql<string>`origin_airport.city`,
      destCity: sql<string>`dest_airport.city`,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      departureTime: flights.departureTime,
      status: flights.status,
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
    .orderBy(desc(flights.departureTime))
    .limit(1000);

  // Calculate summary
  let totalSeats = 0;
  let totalBooked = 0;
  let totalRevenue = 0;

  const processedResults = results.map(row => {
    const flightTotalSeats = (row.economySeats || 0) + (row.businessSeats || 0);
    const availableSeats =
      (row.economyAvailable || 0) + (row.businessAvailable || 0);
    const bookedSeats = flightTotalSeats - availableSeats;
    const occupancyRate =
      flightTotalSeats > 0 ? (bookedSeats / flightTotalSeats) * 100 : 0;

    const economyBooked = (row.economySeats || 0) - (row.economyAvailable || 0);
    const businessBooked =
      (row.businessSeats || 0) - (row.businessAvailable || 0);
    const revenue =
      economyBooked * (Number(row.economyPrice) || 0) +
      businessBooked * (Number(row.businessPrice) || 0);

    totalSeats += flightTotalSeats;
    totalBooked += bookedSeats;
    totalRevenue += revenue;

    return {
      flightNumber: row.flightNumber || "",
      airline: row.airlineName || "",
      origin: row.originCity || "",
      destination: row.destCity || "",
      departureTime: row.departureTime,
      status: row.status || "",
      totalSeats: flightTotalSeats,
      bookedSeats,
      occupancyRate: occupancyRate.toFixed(1),
      estimatedRevenue: (revenue / 100).toFixed(2),
    };
  });

  // Create summary sheet
  const summaryData = [
    ["AIS Aviation System - Flight Performance Report"],
    [],
    ["Generated:", new Date().toISOString()],
    [],
    ["Summary Statistics"],
    ["Total Flights:", processedResults.length],
    ["Total Seats:", totalSeats],
    ["Total Booked:", totalBooked],
    [
      "Overall Occupancy Rate:",
      totalSeats > 0
        ? ((totalBooked / totalSeats) * 100).toFixed(1) + "%"
        : "0%",
    ],
    ["Total Estimated Revenue (SAR):", (totalRevenue / 100).toFixed(2)],
  ];

  // Create detail sheet
  const headers = [
    "Flight Number",
    "Airline",
    "Origin",
    "Destination",
    "Departure Time",
    "Status",
    "Total Seats",
    "Booked Seats",
    "Occupancy Rate (%)",
    "Estimated Revenue (SAR)",
  ];

  const detailData = [
    headers,
    ...processedResults.map(row => [
      row.flightNumber,
      row.airline,
      row.origin,
      row.destination,
      row.departureTime ? new Date(row.departureTime).toISOString() : "",
      row.status,
      row.totalSeats,
      row.bookedSeats,
      row.occupancyRate,
      row.estimatedRevenue,
    ]),
  ];

  return buildXlsxBuffer([
    { name: "Summary", rows: summaryData },
    { name: "Flights", rows: detailData },
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

/**
 * Generate flight performance PDF report
 */
export async function generateFlightPerformancePDF(
  _filters: ReportFilters
): Promise<Buffer> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const results = await db
    .select({
      flightNumber: flights.flightNumber,
      airlineName: airlines.name,
      originCity: sql<string>`origin_airport.city`,
      destCity: sql<string>`dest_airport.city`,
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
    .where(eq(flights.status, "scheduled"))
    .orderBy(desc(flights.departureTime))
    .limit(50);

  // Calculate totals
  let totalSeats = 0;
  let totalBooked = 0;
  let totalRevenue = 0;

  results.forEach(row => {
    const flightTotalSeats = (row.economySeats || 0) + (row.businessSeats || 0);
    const availableSeats =
      (row.economyAvailable || 0) + (row.businessAvailable || 0);
    const bookedSeats = flightTotalSeats - availableSeats;

    const economyBooked = (row.economySeats || 0) - (row.economyAvailable || 0);
    const businessBooked =
      (row.businessSeats || 0) - (row.businessAvailable || 0);
    const revenue =
      economyBooked * (Number(row.economyPrice) || 0) +
      businessBooked * (Number(row.businessPrice) || 0);

    totalSeats += flightTotalSeats;
    totalBooked += bookedSeats;
    totalRevenue += revenue;
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title
    doc
      .fontSize(24)
      .text("AIS Aviation - Flight Performance Report", { align: "center" });
    doc.moveDown(2);

    // Summary
    doc.fontSize(16).text("Summary", { underline: true });
    doc.moveDown();

    doc.fontSize(12).text(`Total Flights Analyzed: ${results.length}`);
    doc.text(`Total Seats: ${totalSeats}`);
    doc.text(`Total Booked: ${totalBooked}`);
    doc.text(
      `Overall Occupancy Rate: ${totalSeats > 0 ? ((totalBooked / totalSeats) * 100).toFixed(1) : 0}%`
    );
    doc.text(`Estimated Revenue: ${(totalRevenue / 100).toFixed(2)} SAR`);
    doc.moveDown(2);

    // Top flights
    doc.fontSize(16).text("Top Flights by Occupancy", { underline: true });
    doc.moveDown();

    results.slice(0, 20).forEach(row => {
      const flightTotalSeats =
        (row.economySeats || 0) + (row.businessSeats || 0);
      const availableSeats =
        (row.economyAvailable || 0) + (row.businessAvailable || 0);
      const bookedSeats = flightTotalSeats - availableSeats;
      const occupancyRate =
        flightTotalSeats > 0 ? (bookedSeats / flightTotalSeats) * 100 : 0;

      doc
        .fontSize(10)
        .text(
          `${row.flightNumber} (${row.originCity} - ${row.destCity}): ${occupancyRate.toFixed(1)}% (${bookedSeats}/${flightTotalSeats} seats)`
        );
    });

    // Footer
    doc
      .fontSize(10)
      .text(
        `Generated on ${new Date().toISOString()}`,
        50,
        doc.page.height - 50,
        { align: "center" }
      );

    doc.end();
  });
}
