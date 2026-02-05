/**
 * Report Export Service
 *
 * Generates reports in various formats (CSV, PDF, Excel)
 * Supports analytics, bookings, and financial reports
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  payments,
  flights,
  users,
  airports,
  airlines,
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import PDFDocument from "pdfkit";

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
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const startDate =
    filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = filters.endDate || new Date();

  const results = await db
    .select({
      date: sql<string>`DATE(${bookings.createdAt})`,
      totalBookings: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`SUM(${bookings.totalAmount})`,
      confirmedRevenue: sql<number>`SUM(CASE WHEN ${bookings.status} = 'confirmed' THEN ${bookings.totalAmount} ELSE 0 END)`,
      refundedAmount: sql<number>`SUM(CASE WHEN ${bookings.paymentStatus} = 'refunded' THEN ${bookings.totalAmount} ELSE 0 END)`,
    })
    .from(bookings)
    .where(
      and(gte(bookings.createdAt, startDate), lte(bookings.createdAt, endDate))
    )
    .groupBy(sql`DATE(${bookings.createdAt})`)
    .orderBy(sql`DATE(${bookings.createdAt})`);

  const headers = [
    "Date",
    "Total Bookings",
    "Total Revenue (SAR)",
    "Confirmed Revenue (SAR)",
    "Refunded Amount (SAR)",
  ];

  const rows = results.map(row => [
    row.date,
    String(row.totalBookings || 0),
    ((Number(row.totalRevenue) || 0) / 100).toFixed(2),
    ((Number(row.confirmedRevenue) || 0) / 100).toFixed(2),
    ((Number(row.refundedAmount) || 0) / 100).toFixed(2),
  ]);

  return [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
}

/**
 * Export flight performance to CSV
 */
export async function exportFlightPerformanceToCSV(
  filters: ReportFilters
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
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const startDate =
    filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = filters.endDate || new Date();

  const dailyRevenue = await db
    .select({
      date: sql<string>`DATE(${bookings.createdAt})`,
      revenue: sql<number>`SUM(${bookings.totalAmount})`,
      bookings: sql<number>`COUNT(*)`,
    })
    .from(bookings)
    .where(
      and(
        gte(bookings.createdAt, startDate),
        lte(bookings.createdAt, endDate),
        eq(bookings.status, "confirmed")
      )
    )
    .groupBy(sql`DATE(${bookings.createdAt})`)
    .orderBy(sql`DATE(${bookings.createdAt})`);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title
    doc
      .fontSize(24)
      .text("تقرير الإيرادات - AIS Aviation", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Revenue Report - AIS Aviation`, { align: "center" });
    doc.moveDown(2);

    // Date range
    doc
      .fontSize(12)
      .text(
        `Period: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
        { align: "center" }
      );
    doc.moveDown(2);

    // Total revenue
    const totalRevenue = dailyRevenue.reduce(
      (sum, row) => sum + (Number(row.revenue) || 0),
      0
    );
    const totalBookings = dailyRevenue.reduce(
      (sum, row) => sum + (row.bookings || 0),
      0
    );

    doc.fontSize(16).text("Summary / ملخص", { underline: true });
    doc.moveDown();
    doc
      .fontSize(14)
      .text(
        `Total Revenue / إجمالي الإيرادات: ${(totalRevenue / 100).toFixed(2)} SAR`
      );
    doc.text(`Total Confirmed Bookings / الحجوزات المؤكدة: ${totalBookings}`);
    doc.moveDown(2);

    // Daily breakdown
    doc
      .fontSize(16)
      .text("Daily Breakdown / التفصيل اليومي", { underline: true });
    doc.moveDown();

    dailyRevenue.slice(0, 30).forEach(row => {
      doc
        .fontSize(10)
        .text(
          `${row.date}: ${(Number(row.revenue) / 100).toFixed(2)} SAR (${row.bookings} bookings)`
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Escape CSV field value
 */
function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
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
