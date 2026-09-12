import { createHash } from "node:crypto";
/**
 * Data Warehouse Export Service
 *
 * Provides data export functionality for BI/ETL pipelines.
 * Supports CSV, JSON, and JSON Lines (Parquet-like streaming) formats.
 * Includes incremental export via last_export_timestamp tracking.
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  airports,
  airlines,
  users,
  warehouseExports,
  warehouseSchedules,
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql, gt, getTableColumns } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export type ExportFormat = "csv" | "json" | "jsonl";

export type ExportType =
  | "bookings"
  | "flights"
  | "revenue"
  | "customers"
  | "operational";

export type ExportStatus = "pending" | "processing" | "completed" | "failed";

export type ScheduleFrequency = "daily" | "weekly" | "monthly";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface ExportOptions {
  dateRange: DateRange;
  format: ExportFormat;
  incremental?: boolean;
  lastExportTimestamp?: Date;
}

/** Persistent representation of a data warehouse export record */
export interface DataWarehouseExport {
  id: number;
  checksum: string | null;
  exportType: ExportType;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  format: ExportFormat;
  status: ExportStatus;
  filePath: string | null;
  recordCount: number;
  fileSize: number;
  createdBy: number;
  createdAt: Date;
  completedAt: Date | null;
  errorMessage?: string | null;
}

/** Persistent representation of a scheduled export */
export interface DataWarehouseSchedule {
  id: number;
  createdBy: number;
  name: string;
  exportType: ExportType;
  frequency: ScheduleFrequency;
  format: ExportFormat;
  lastRunAt: Date | null;
  nextRunAt: Date;
  isActive: boolean;
  config: Record<string, unknown>;
  createdAt: Date;
}

export interface ETLManifest {
  version: string;
  generatedAt: string;
  exports: Array<{
    exportId: number;
    exportType: ExportType;
    format: ExportFormat;
    filePath: string;
    recordCount: number;
    fileSize: number;
    dateRangeStart: string;
    dateRangeEnd: string;
    checksum: string;
  }>;
  totalRecords: number;
  totalSize: number;
}

export interface ExportResult {
  data: string;
  recordCount: number;
  fileSize: number;
}

// ============================================================================
// Persistent export metadata and bounded content, shared by all replicas.
// ============================================================================
const { content: _contentColumn, ...exportColumns } =
  getTableColumns(warehouseExports);
async function warehouseDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

// ============================================================================
// Export: Bookings Data
// ============================================================================

/**
 * Export bookings with passenger and payment details for data warehouse ingestion.
 * Supports incremental exports by filtering on updatedAt > lastExportTimestamp.
 */
export async function exportBookingsData(
  options: ExportOptions
): Promise<ExportResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const { dateRange, format, incremental, lastExportTimestamp } = options;

  const conditions = [
    gte(bookings.createdAt, dateRange.startDate),
    lte(bookings.createdAt, dateRange.endDate),
  ];

  if (incremental && lastExportTimestamp) {
    conditions.push(gt(bookings.updatedAt, lastExportTimestamp));
  }

  const results = await db
    .select({
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      userId: bookings.userId,
      flightId: bookings.flightId,
      status: bookings.status,
      cabinClass: bookings.cabinClass,
      numberOfPassengers: bookings.numberOfPassengers,
      totalAmount: bookings.totalAmount,
      paymentStatus: bookings.paymentStatus,
      checkedIn: bookings.checkedIn,
      createdAt: bookings.createdAt,
      updatedAt: bookings.updatedAt,
      flightNumber: flights.flightNumber,
      originCode: sql<string>`origin_airport.code`,
      originCity: sql<string>`origin_airport.city`,
      destinationCode: sql<string>`dest_airport.code`,
      destinationCity: sql<string>`dest_airport.city`,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      airlineCode: airlines.code,
      airlineName: airlines.name,
      passengerCount: sql<number>`(SELECT COUNT(*) FROM passengers p WHERE p.bookingId = ${bookings.id})`,
      paymentAmount: sql<number>`(SELECT SUM(pay.amount) FROM payments pay WHERE pay.bookingId = ${bookings.id})`,
      paymentMethod: sql<string>`(SELECT pay.method FROM payments pay WHERE pay.bookingId = ${bookings.id} LIMIT 1)`,
    })
    .from(bookings)
    .leftJoin(flights, eq(bookings.flightId, flights.id))
    .leftJoin(airlines, eq(flights.airlineId, airlines.id))
    .leftJoin(
      sql`${airports} AS origin_airport`,
      sql`origin_airport.id = ${flights.originId}`
    )
    .leftJoin(
      sql`${airports} AS dest_airport`,
      sql`dest_airport.id = ${flights.destinationId}`
    )
    .where(and(...conditions))
    .orderBy(desc(bookings.createdAt))
    // Hard limit to prevent excessive memory usage in export queries
    .limit(50000);

  if (results.length === 50000) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Export reached its row limit; narrow the date range",
    });
  }

  const data = formatExportData(
    results,
    format,
    [
      "bookingId",
      "bookingReference",
      "pnr",
      "userId",
      "flightId",
      "status",
      "cabinClass",
      "numberOfPassengers",
      "totalAmount",
      "paymentStatus",
      "checkedIn",
      "createdAt",
      "updatedAt",
      "flightNumber",
      "originCode",
      "originCity",
      "destinationCode",
      "destinationCity",
      "departureTime",
      "arrivalTime",
      "airlineCode",
      "airlineName",
      "passengerCount",
      "paymentAmount",
      "paymentMethod",
    ],
    row => [
      String(row.bookingId || ""),
      row.bookingReference || "",
      row.pnr || "",
      String(row.userId || ""),
      String(row.flightId || ""),
      row.status || "",
      row.cabinClass || "",
      String(row.numberOfPassengers || 0),
      String(row.totalAmount || 0),
      row.paymentStatus || "",
      String(row.checkedIn ? 1 : 0),
      row.createdAt ? new Date(row.createdAt).toISOString() : "",
      row.updatedAt ? new Date(row.updatedAt).toISOString() : "",
      row.flightNumber || "",
      row.originCode || "",
      row.originCity || "",
      row.destinationCode || "",
      row.destinationCity || "",
      row.departureTime ? new Date(row.departureTime).toISOString() : "",
      row.arrivalTime ? new Date(row.arrivalTime).toISOString() : "",
      row.airlineCode || "",
      row.airlineName || "",
      String(row.passengerCount || 0),
      String(row.paymentAmount || 0),
      row.paymentMethod || "",
    ]
  );

  return {
    data,
    recordCount: results.length,
    fileSize: Buffer.byteLength(data, "utf-8"),
  };
}

// ============================================================================
// Export: Flights Data
// ============================================================================

/**
 * Export flights with load factors and delay metrics for warehouse analysis.
 */
export async function exportFlightsData(
  options: ExportOptions
): Promise<ExportResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const { dateRange, format, incremental, lastExportTimestamp } = options;

  const conditions = [
    gte(flights.departureTime, dateRange.startDate),
    lte(flights.departureTime, dateRange.endDate),
  ];

  if (incremental && lastExportTimestamp) {
    conditions.push(gt(flights.updatedAt, lastExportTimestamp));
  }

  const results = await db
    .select({
      flightId: flights.id,
      flightNumber: flights.flightNumber,
      airlineCode: airlines.code,
      airlineName: airlines.name,
      originCode: sql<string>`origin_airport.code`,
      originCity: sql<string>`origin_airport.city`,
      originCountry: sql<string>`origin_airport.country`,
      destinationCode: sql<string>`dest_airport.code`,
      destinationCity: sql<string>`dest_airport.city`,
      destinationCountry: sql<string>`dest_airport.country`,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      status: flights.status,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      totalBookings: sql<number>`(SELECT COUNT(*) FROM bookings b WHERE b.flightId = ${flights.id} AND b.status != 'cancelled')`,
      delayMinutes: sql<number>`(SELECT fsh.delayMinutes FROM flight_status_history fsh WHERE fsh.flightId = ${flights.id} AND fsh.newStatus = 'delayed' ORDER BY fsh.createdAt DESC LIMIT 1)`,
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
    .where(and(...conditions))
    .orderBy(desc(flights.departureTime))
    // Hard limit to prevent excessive memory usage in export queries
    .limit(50000);

  if (results.length === 50000) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Export reached its row limit; narrow the date range",
    });
  }

  const processedRows = results.map(row => {
    const totalSeats = (row.economySeats || 0) + (row.businessSeats || 0);
    const totalAvailable =
      (row.economyAvailable || 0) + (row.businessAvailable || 0);
    const bookedSeats = totalSeats - totalAvailable;
    const loadFactor = totalSeats > 0 ? (bookedSeats / totalSeats) * 100 : 0;
    const economyLoadFactor =
      (row.economySeats || 0) > 0
        ? (((row.economySeats || 0) - (row.economyAvailable || 0)) /
            (row.economySeats || 1)) *
          100
        : 0;
    const businessLoadFactor =
      (row.businessSeats || 0) > 0
        ? (((row.businessSeats || 0) - (row.businessAvailable || 0)) /
            (row.businessSeats || 1)) *
          100
        : 0;

    return {
      ...row,
      totalSeats,
      bookedSeats,
      loadFactor: Math.round(loadFactor * 10) / 10,
      economyLoadFactor: Math.round(economyLoadFactor * 10) / 10,
      businessLoadFactor: Math.round(businessLoadFactor * 10) / 10,
    };
  });

  const headers = [
    "flightId",
    "flightNumber",
    "airlineCode",
    "airlineName",
    "originCode",
    "originCity",
    "originCountry",
    "destinationCode",
    "destinationCity",
    "destinationCountry",
    "departureTime",
    "arrivalTime",
    "aircraftType",
    "status",
    "economySeats",
    "businessSeats",
    "economyAvailable",
    "businessAvailable",
    "economyPrice",
    "businessPrice",
    "totalSeats",
    "bookedSeats",
    "loadFactor",
    "economyLoadFactor",
    "businessLoadFactor",
    "totalBookings",
    "delayMinutes",
  ];

  const data = formatExportData(processedRows, format, headers, row => [
    String(row.flightId || ""),
    row.flightNumber || "",
    row.airlineCode || "",
    row.airlineName || "",
    row.originCode || "",
    row.originCity || "",
    row.originCountry || "",
    row.destinationCode || "",
    row.destinationCity || "",
    row.destinationCountry || "",
    row.departureTime ? new Date(row.departureTime).toISOString() : "",
    row.arrivalTime ? new Date(row.arrivalTime).toISOString() : "",
    row.aircraftType || "",
    row.status || "",
    String(row.economySeats || 0),
    String(row.businessSeats || 0),
    String(row.economyAvailable || 0),
    String(row.businessAvailable || 0),
    String(row.economyPrice || 0),
    String(row.businessPrice || 0),
    String(row.totalSeats || 0),
    String(row.bookedSeats || 0),
    String(row.loadFactor || 0),
    String(row.economyLoadFactor || 0),
    String(row.businessLoadFactor || 0),
    String(row.totalBookings || 0),
    String(row.delayMinutes ?? ""),
  ]);

  return {
    data,
    recordCount: processedRows.length,
    fileSize: Buffer.byteLength(data, "utf-8"),
  };
}

// ============================================================================
// Export: Revenue Data
// ============================================================================

/**
 * Export revenue breakdown by route, cabin class, and payment channel.
 */
export async function exportRevenueData(
  options: ExportOptions
): Promise<ExportResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const { dateRange, format } = options;

  // Revenue by route and class
  const results = await db
    .select({
      date: sql<string>`DATE(${bookings.createdAt})`,
      originCode: sql<string>`origin_airport.code`,
      originCity: sql<string>`origin_airport.city`,
      destinationCode: sql<string>`dest_airport.code`,
      destinationCity: sql<string>`dest_airport.city`,
      airlineCode: airlines.code,
      cabinClass: bookings.cabinClass,
      totalBookings: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`SUM(${bookings.totalAmount})`,
      confirmedRevenue: sql<number>`SUM(CASE WHEN ${bookings.status} = 'confirmed' THEN ${bookings.totalAmount} ELSE 0 END)`,
      cancelledRevenue: sql<number>`SUM(CASE WHEN ${bookings.status} = 'cancelled' THEN ${bookings.totalAmount} ELSE 0 END)`,
      refundedRevenue: sql<number>`SUM(CASE WHEN ${bookings.paymentStatus} = 'refunded' THEN ${bookings.totalAmount} ELSE 0 END)`,
      totalPassengers: sql<number>`SUM(${bookings.numberOfPassengers})`,
      avgTicketPrice: sql<number>`AVG(${bookings.totalAmount})`,
    })
    .from(bookings)
    .leftJoin(flights, eq(bookings.flightId, flights.id))
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
        gte(bookings.createdAt, dateRange.startDate),
        lte(bookings.createdAt, dateRange.endDate)
      )
    )
    .groupBy(
      sql`DATE(${bookings.createdAt})`,
      sql`origin_airport.code`,
      sql`origin_airport.city`,
      sql`dest_airport.code`,
      sql`dest_airport.city`,
      airlines.code,
      bookings.cabinClass
    )
    .orderBy(sql`DATE(${bookings.createdAt})`);

  const headers = [
    "date",
    "originCode",
    "originCity",
    "destinationCode",
    "destinationCity",
    "airlineCode",
    "cabinClass",
    "totalBookings",
    "totalRevenue",
    "confirmedRevenue",
    "cancelledRevenue",
    "refundedRevenue",
    "totalPassengers",
    "avgTicketPrice",
  ];

  const data = formatExportData(results, format, headers, row => [
    row.date || "",
    row.originCode || "",
    row.originCity || "",
    row.destinationCode || "",
    row.destinationCity || "",
    row.airlineCode || "",
    row.cabinClass || "",
    String(row.totalBookings || 0),
    String(row.totalRevenue || 0),
    String(row.confirmedRevenue || 0),
    String(row.cancelledRevenue || 0),
    String(row.refundedRevenue || 0),
    String(row.totalPassengers || 0),
    String(Math.round(Number(row.avgTicketPrice) || 0)),
  ]);

  return {
    data,
    recordCount: results.length,
    fileSize: Buffer.byteLength(data, "utf-8"),
  };
}

// ============================================================================
// Export: Customer Data (Anonymized)
// ============================================================================

/**
 * Export anonymized customer analytics data.
 * Personal information is hashed/omitted for privacy compliance.
 */
export async function exportCustomerData(
  options: ExportOptions
): Promise<ExportResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const { dateRange, format } = options;

  const results = await db
    .select({
      anonymizedUserId: sql<string>`MD5(CAST(${users.id} AS CHAR))`,
      userRole: users.role,
      registrationDate: sql<string>`DATE(${users.createdAt})`,
      lastActivity: sql<string>`DATE(${users.lastSignedIn})`,
      totalBookings: sql<number>`COUNT(DISTINCT ${bookings.id})`,
      totalSpend: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
      avgBookingValue: sql<number>`COALESCE(AVG(${bookings.totalAmount}), 0)`,
      totalPassengers: sql<number>`COALESCE(SUM(${bookings.numberOfPassengers}), 0)`,
      confirmedBookings: sql<number>`SUM(CASE WHEN ${bookings.status} = 'confirmed' THEN 1 ELSE 0 END)`,
      cancelledBookings: sql<number>`SUM(CASE WHEN ${bookings.status} = 'cancelled' THEN 1 ELSE 0 END)`,
      preferredCabin: sql<string>`(SELECT b2.cabinClass FROM bookings b2 WHERE b2.userId = ${users.id} GROUP BY b2.cabinClass ORDER BY COUNT(*) DESC LIMIT 1)`,
      daysSinceRegistration: sql<number>`DATEDIFF(NOW(), ${users.createdAt})`,
    })
    .from(users)
    .leftJoin(
      bookings,
      and(
        eq(bookings.userId, users.id),
        gte(bookings.createdAt, dateRange.startDate),
        lte(bookings.createdAt, dateRange.endDate)
      )
    )
    .groupBy(users.id, users.role, users.createdAt, users.lastSignedIn)
    .orderBy(desc(sql`COUNT(DISTINCT ${bookings.id})`))
    // Hard limit to prevent excessive memory usage in export queries
    .limit(50000);

  if (results.length === 50000) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Export reached its row limit; narrow the date range",
    });
  }

  const headers = [
    "anonymizedUserId",
    "userRole",
    "registrationDate",
    "lastActivity",
    "totalBookings",
    "totalSpend",
    "avgBookingValue",
    "totalPassengers",
    "confirmedBookings",
    "cancelledBookings",
    "preferredCabin",
    "daysSinceRegistration",
  ];

  const data = formatExportData(results, format, headers, row => [
    row.anonymizedUserId || "",
    row.userRole || "",
    row.registrationDate || "",
    row.lastActivity || "",
    String(row.totalBookings || 0),
    String(row.totalSpend || 0),
    String(Math.round(Number(row.avgBookingValue) || 0)),
    String(row.totalPassengers || 0),
    String(row.confirmedBookings || 0),
    String(row.cancelledBookings || 0),
    row.preferredCabin || "",
    String(row.daysSinceRegistration || 0),
  ]);

  return {
    data,
    recordCount: results.length,
    fileSize: Buffer.byteLength(data, "utf-8"),
  };
}

// ============================================================================
// Export: Operational Data
// ============================================================================

/**
 * Export operational metrics: on-time performance, load factors, utilization.
 */
export async function exportOperationalData(
  options: ExportOptions
): Promise<ExportResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const { dateRange, format } = options;

  const results = await db
    .select({
      date: sql<string>`DATE(${flights.departureTime})`,
      airlineCode: airlines.code,
      totalFlights: sql<number>`COUNT(DISTINCT ${flights.id})`,
      scheduledFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'scheduled' THEN 1 ELSE 0 END)`,
      completedFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'completed' THEN 1 ELSE 0 END)`,
      delayedFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'delayed' THEN 1 ELSE 0 END)`,
      cancelledFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'cancelled' THEN 1 ELSE 0 END)`,
      totalCapacity: sql<number>`SUM(${flights.economySeats} + ${flights.businessSeats})`,
      totalAvailable: sql<number>`SUM(${flights.economyAvailable} + ${flights.businessAvailable})`,
      avgLoadFactor: sql<number>`AVG(
        CASE WHEN (${flights.economySeats} + ${flights.businessSeats}) > 0
        THEN ((${flights.economySeats} + ${flights.businessSeats}) - (${flights.economyAvailable} + ${flights.businessAvailable}))
             / (${flights.economySeats} + ${flights.businessSeats}) * 100
        ELSE 0 END
      )`,
      totalRevenue: sql<number>`(
        SELECT COALESCE(SUM(b.totalAmount), 0)
        FROM bookings b
        WHERE b.flightId IN (
          SELECT f2.id FROM flights f2
          WHERE f2.airlineId = ${airlines.id}
          AND DATE(f2.departureTime) = DATE(${flights.departureTime})
        )
        AND b.status != 'cancelled'
      )`,
    })
    .from(flights)
    .leftJoin(airlines, eq(flights.airlineId, airlines.id))
    .where(
      and(
        gte(flights.departureTime, dateRange.startDate),
        lte(flights.departureTime, dateRange.endDate)
      )
    )
    .groupBy(sql`DATE(${flights.departureTime})`, airlines.code, airlines.id)
    .orderBy(sql`DATE(${flights.departureTime})`);

  const processedRows = results.map(row => {
    const totalFlights = Number(row.totalFlights) || 0;
    const completedFlights = Number(row.completedFlights) || 0;
    const delayedFlights = Number(row.delayedFlights) || 0;
    const onTimeRate =
      totalFlights > 0
        ? ((totalFlights -
            delayedFlights -
            (Number(row.cancelledFlights) || 0)) /
            totalFlights) *
          100
        : 0;
    const completionRate =
      totalFlights > 0 ? (completedFlights / totalFlights) * 100 : 0;

    return {
      ...row,
      onTimeRate: Math.round(onTimeRate * 10) / 10,
      completionRate: Math.round(completionRate * 10) / 10,
    };
  });

  const headers = [
    "date",
    "airlineCode",
    "totalFlights",
    "scheduledFlights",
    "completedFlights",
    "delayedFlights",
    "cancelledFlights",
    "totalCapacity",
    "totalAvailable",
    "avgLoadFactor",
    "onTimeRate",
    "completionRate",
    "totalRevenue",
  ];

  const data = formatExportData(processedRows, format, headers, row => [
    row.date || "",
    row.airlineCode || "",
    String(row.totalFlights || 0),
    String(row.scheduledFlights || 0),
    String(row.completedFlights || 0),
    String(row.delayedFlights || 0),
    String(row.cancelledFlights || 0),
    String(row.totalCapacity || 0),
    String(row.totalAvailable || 0),
    String(Math.round((Number(row.avgLoadFactor) || 0) * 10) / 10),
    String(row.onTimeRate || 0),
    String(row.completionRate || 0),
    String(row.totalRevenue || 0),
  ]);

  return {
    data,
    recordCount: processedRows.length,
    fileSize: Buffer.byteLength(data, "utf-8"),
  };
}

// ============================================================================
// ETL Manifest
// ============================================================================

/**
 * Generate an ETL manifest JSON describing a set of exports.
 * Used by downstream ETL pipelines to discover and validate exported data.
 */
export function generateETLManifest(
  exportRecords: DataWarehouseExport[]
): ETLManifest {
  const completedExports = exportRecords.filter(
    e => e.status === "completed" && e.filePath && e.checksum
  );

  const totalRecords = completedExports.reduce(
    (sum, e) => sum + e.recordCount,
    0
  );
  const totalSize = completedExports.reduce((sum, e) => sum + e.fileSize, 0);

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    exports: completedExports.map(e => ({
      exportId: e.id,
      exportType: e.exportType,
      format: e.format,
      filePath: e.filePath ?? "",
      recordCount: e.recordCount,
      fileSize: e.fileSize,
      dateRangeStart: e.dateRangeStart.toISOString(),
      dateRangeEnd: e.dateRangeEnd.toISOString(),
      checksum: e.checksum ?? "",
    })),
    totalRecords,
    totalSize,
  };
}

// ============================================================================
// Export Job Management
// ============================================================================

/**
 * Create a new export job and execute it.
 */
export async function createExportJob(
  exportType: ExportType,
  dateRange: DateRange,
  format: ExportFormat,
  createdBy: number,
  incremental: boolean = false,
  lastExportTimestamp?: Date,
  requestKey?: string
): Promise<DataWarehouseExport> {
  const db = await warehouseDb();
  if (
    !Number.isFinite(dateRange.startDate.getTime()) ||
    !Number.isFinite(dateRange.endDate.getTime()) ||
    dateRange.startDate > dateRange.endDate
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid export date range",
    });
  const [created] = await db
    .insert(warehouseExports)
    .values({
      exportType,
      format,
      createdBy,
      requestKey,
      dateRangeStart: dateRange.startDate,
      dateRangeEnd: dateRange.endDate,
      status: "processing",
    })
    .onDuplicateKeyUpdate({ set: { id: sql`${warehouseExports.id}` } });
  const [exportRecord] = await db
    .select(exportColumns)
    .from(warehouseExports)
    .where(
      requestKey
        ? eq(warehouseExports.requestKey, requestKey)
        : eq(warehouseExports.id, created.insertId)
    )
    .limit(1);
  if (exportRecord.status === "completed") return exportRecord;
  dateRange = {
    startDate: exportRecord.dateRangeStart,
    endDate: exportRecord.dateRangeEnd,
  };
  await db
    .update(warehouseExports)
    .set({ status: "processing", errorMessage: null })
    .where(eq(warehouseExports.id, exportRecord.id));
  // Process the export
  try {
    exportRecord.status = "processing";

    const options: ExportOptions = {
      dateRange,
      format,
      incremental,
      lastExportTimestamp,
    };

    let result: ExportResult;

    switch (exportType) {
      case "bookings":
        result = await exportBookingsData(options);
        break;
      case "flights":
        result = await exportFlightsData(options);
        break;
      case "revenue":
        result = await exportRevenueData(options);
        break;
      case "customers":
        result = await exportCustomerData(options);
        break;
      case "operational":
        result = await exportOperationalData(options);
        break;
      default:
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown export type: ${exportType}`,
        });
    }

    const bytes = Buffer.byteLength(result.data, "utf8");
    if (bytes > MAX_EXPORT_BYTES)
      throw new Error("Export exceeds 8 MiB; select a smaller date range");
    const checksum = createHash("sha256")
      .update(result.data, "utf8")
      .digest("hex");
    await db
      .update(warehouseExports)
      .set({
        content: result.data,
        checksum,
        filePath: `/api/data-warehouse/download/${exportRecord.id}`,
        recordCount: result.recordCount,
        fileSize: bytes,
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(warehouseExports.id, exportRecord.id));
  } catch (error) {
    await db
      .update(warehouseExports)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Export failed",
      })
      .where(eq(warehouseExports.id, exportRecord.id));
  }
  const job = await getExportJobById(exportRecord.id);
  if (!job)
    throw new Error(`Export job ${exportRecord.id} vanished after creation`);
  return job;
}

/**
 * Get a list of export jobs with pagination.
 */
export async function getExportJobs(
  page = 1,
  limit = 20,
  exportType?: ExportType,
  status?: ExportStatus
) {
  const db = await warehouseDb();
  page = Math.max(1, Math.floor(page));
  limit = Math.min(100, Math.max(1, Math.floor(limit)));
  const filter = and(
    exportType ? eq(warehouseExports.exportType, exportType) : undefined,
    status ? eq(warehouseExports.status, status) : undefined
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)` })
    .from(warehouseExports)
    .where(filter);
  const exports = await db
    .select(exportColumns)
    .from(warehouseExports)
    .where(filter)
    .orderBy(desc(warehouseExports.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);
  return { exports, total: Number(count?.total ?? 0), page, limit };
}
export async function getExportJobById(
  id: number
): Promise<DataWarehouseExport | undefined> {
  const db = await warehouseDb();
  const [record] = await db
    .select(exportColumns)
    .from(warehouseExports)
    .where(eq(warehouseExports.id, id))
    .limit(1);
  return record;
}
export async function getExportDownloadUrl(id: number): Promise<string | null> {
  const record = await getExportJobById(id);
  return record?.status === "completed" && record.checksum
    ? record.filePath
    : null;
}
export async function readExportContent(id: number) {
  const db = await warehouseDb();
  const [record] = await db
    .select()
    .from(warehouseExports)
    .where(
      and(eq(warehouseExports.id, id), eq(warehouseExports.status, "completed"))
    )
    .limit(1);
  if (!record || record.content == null || !record.checksum)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Export content unavailable",
    });
  if (
    createHash("sha256").update(record.content).digest("hex") !==
    record.checksum
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Export integrity check failed",
    });
  return {
    content: record.content,
    format: record.format,
    checksum: record.checksum,
  };
}

export async function createSchedule(input: {
  name: string;
  exportType: ExportType;
  frequency: ScheduleFrequency;
  format: ExportFormat;
  createdBy: number;
  config?: Record<string, unknown>;
}): Promise<DataWarehouseSchedule> {
  const db = await warehouseDb();
  const [created] = await db.insert(warehouseSchedules).values({
    ...input,
    config: input.config ?? {},
    nextRunAt: calculateNextRunAt(input.frequency),
  });
  const [schedule] = await db
    .select()
    .from(warehouseSchedules)
    .where(eq(warehouseSchedules.id, created.insertId))
    .limit(1);
  return schedule;
}
export async function getSchedules(
  activeOnly = false
): Promise<DataWarehouseSchedule[]> {
  const db = await warehouseDb();
  return db
    .select()
    .from(warehouseSchedules)
    .where(activeOnly ? eq(warehouseSchedules.isActive, true) : undefined)
    .orderBy(desc(warehouseSchedules.createdAt));
}
export async function updateSchedule(
  id: number,
  updates: Partial<
    Pick<
      DataWarehouseSchedule,
      "name" | "frequency" | "format" | "isActive" | "config"
    >
  >
) {
  const db = await warehouseDb();
  await db
    .update(warehouseSchedules)
    .set({
      ...updates,
      ...(updates.frequency
        ? { nextRunAt: calculateNextRunAt(updates.frequency) }
        : {}),
    })
    .where(eq(warehouseSchedules.id, id));
  const [schedule] = await db
    .select()
    .from(warehouseSchedules)
    .where(eq(warehouseSchedules.id, id))
    .limit(1);
  return schedule ?? null;
}
export async function deleteSchedule(id: number) {
  const db = await warehouseDb();
  const [result] = await db
    .delete(warehouseSchedules)
    .where(eq(warehouseSchedules.id, id));
  return result.affectedRows === 1;
}
export async function getETLPipelineStatus() {
  const db = await warehouseDb();
  const counts = await db
    .select({ status: warehouseExports.status, count: sql<number>`count(*)` })
    .from(warehouseExports)
    .groupBy(warehouseExports.status);
  const count = (status: ExportStatus) =>
    Number(counts.find(r => r.status === status)?.count ?? 0);
  const totalExports = counts.reduce((sum, row) => sum + Number(row.count), 0);
  const recent = await getExportJobs(1, 5, undefined, "failed");
  const [latest] = await db
    .select({ completedAt: warehouseExports.completedAt })
    .from(warehouseExports)
    .where(eq(warehouseExports.status, "completed"))
    .orderBy(desc(warehouseExports.completedAt))
    .limit(1);
  return {
    status: !totalExports
      ? ("unknown" as const)
      : count("failed") === totalExports
        ? ("down" as const)
        : count("failed") > 0
          ? ("degraded" as const)
          : ("healthy" as const),
    totalExports,
    completedExports: count("completed"),
    failedExports: count("failed"),
    processingExports: count("processing"),
    activeSchedules: (await getSchedules(true)).length,
    lastExportAt: latest?.completedAt?.toISOString() ?? null,
    recentFailures: recent.exports.map(e => ({
      id: e.id,
      exportType: e.exportType,
      errorMessage: e.errorMessage,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/** Called by the durable scheduled-task coordinator; errors leave the due date retryable. */
export async function processScheduledExports() {
  const db = await warehouseDb();
  const { isAdmin } = await import("./rbac.service");
  const now = new Date();
  for (const schedule of await getSchedules(true)) {
    if (schedule.nextRunAt > now) continue;
    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.id, schedule.createdBy))
      .limit(1);
    if (!owner || !isAdmin(owner.role))
      throw new Error(
        `Export schedule ${schedule.id} requires an active administrator owner`
      );
    const startDate =
      schedule.lastRunAt ??
      new Date(
        now.getTime() -
          (schedule.frequency === "daily"
            ? 1
            : schedule.frequency === "weekly"
              ? 7
              : 31) *
            86400000
      );
    const result = await createExportJob(
      schedule.exportType,
      { startDate, endDate: now },
      schedule.format,
      schedule.createdBy,
      false,
      undefined,
      `schedule:${schedule.id}:${schedule.nextRunAt.toISOString()}`
    );
    if (result.status !== "completed")
      throw new Error(
        `Scheduled export ${schedule.id} failed: ${result.errorMessage}`
      );
    await db
      .update(warehouseSchedules)
      .set({
        lastRunAt: result.dateRangeEnd,
        nextRunAt: calculateNextRunAt(schedule.frequency),
      })
      .where(
        and(
          eq(warehouseSchedules.id, schedule.id),
          eq(warehouseSchedules.nextRunAt, schedule.nextRunAt)
        )
      );
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format data into the requested export format.
 */
function formatExportData<T>(
  rows: T[],
  format: ExportFormat,
  headers: string[],
  rowMapper: (row: T) => string[]
): string {
  switch (format) {
    case "csv":
      return formatCSV(rows, headers, rowMapper);
    case "json":
      return formatJSON(rows, headers, rowMapper);
    case "jsonl":
      return formatJSONLines(rows, headers, rowMapper);
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unsupported export format: ${format}`,
      });
  }
}

/**
 * Format rows as CSV.
 */
function formatCSV<T>(
  rows: T[],
  headers: string[],
  rowMapper: (row: T) => string[]
): string {
  const csvRows = rows.map(row => rowMapper(row).map(escapeCSV).join(","));
  return [headers.join(","), ...csvRows].join("\n");
}

/**
 * Format rows as JSON array.
 */
function formatJSON<T>(
  rows: T[],
  headers: string[],
  rowMapper: (row: T) => string[]
): string {
  const objects = rows.map(row => {
    const values = rowMapper(row);
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      obj[header] = values[idx] ?? "";
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

/**
 * Format rows as JSON Lines (one JSON object per line) for streaming/Parquet-like usage.
 */
function formatJSONLines<T>(
  rows: T[],
  headers: string[],
  rowMapper: (row: T) => string[]
): string {
  return rows
    .map(row => {
      const values = rowMapper(row);
      const obj: Record<string, string> = {};
      headers.forEach((header, idx) => {
        obj[header] = values[idx] ?? "";
      });
      return JSON.stringify(obj);
    })
    .join("\n");
}

/**
 * Escape CSV field value.
 */
function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Calculate next run timestamp based on frequency.
 */
function calculateNextRunAt(frequency: ScheduleFrequency): Date {
  const now = new Date();
  switch (frequency) {
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "monthly":
      return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

/**
 * Generate a simple checksum string for an export record.
 */
