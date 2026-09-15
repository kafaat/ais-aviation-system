import { getRefundExportRows } from "./refunds-stats.service";
import {
  getFinancialDays,
  getFinancialSummary,
} from "./financial-reporting.service";
/**
 * Revenue Accounting Service
 * Handles revenue recognition, deferred revenue, yield analysis,
 * and financial reporting for the aviation booking system.
 *
 * All monetary amounts are in SAR cents (100 = 1 SAR).
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  airports,
  payments,
  bookingAncillaries,
  ancillaryServices,
} from "../../drizzle/schema";
import { sql, and, gte, lte, eq, desc, inArray, isNull } from "drizzle-orm";
import { flightBookingCondition } from "./flight-state.service";
import { readFlightCosts } from "./flight-economics-evidence.service";
import { requireCurrentAviationSource } from "./aviation-evidence.service";
import type { z } from "zod";
import type { responseContracts } from "../contracts/revenue-accounting";

// ============ Inline Schema Types ============

export interface RevenueEntry {
  id: number;
  bookingId: number;
  flightId: number;
  type: "ticket_sale" | "ancillary" | "refund" | "exchange" | "penalty";
  amount: number; // SAR cents
  currency: string;
  recognitionDate: Date | null;
  status: "deferred" | "recognized" | "voided";
  channel: "direct" | "agent" | "corporate";
  classOfService: "economy" | "business";
  routeId: string; // "originId-destinationId"
  createdAt: Date;
}

export interface RevenueReport {
  id: number;
  reportType: "monthly" | "quarterly" | "annual";
  periodStart: Date;
  periodEnd: Date;
  totalRevenue: number;
  deferredRevenue: number;
  recognizedRevenue: number;
  refundAmount: number;
  ancillaryRevenue: number;
  status: "draft" | "finalized";
  generatedBy: number;
  createdAt: Date;
}

// ============ Response Interfaces ============

export interface RevenueOverview {
  totalRevenue: number;
  deferredRevenue: number;
  recognizedRevenue: number;
  ancillaryRevenue: number;
  refundTotal: number;
  netRevenue: number;
  revenueGrowthPercent: number;
  averageRevenuePerBooking: number;
  totalBookings: number;
}

export interface RouteRevenue {
  originCode: string;
  originCity: string;
  destinationCode: string;
  destinationCity: string;
  totalRevenue: number;
  bookingCount: number;
  averageRevenue: number;
  passengerCount: number;
}

export interface ClassRevenue {
  classOfService: string;
  totalRevenue: number;
  bookingCount: number;
  averageRevenue: number;
  passengerCount: number;
  percentageOfTotal: number;
}

export interface ChannelRevenue {
  channel: string;
  totalRevenue: number;
  bookingCount: number;
  averageRevenue: number;
  percentageOfTotal: number;
}

export interface AncillaryRevenueBreakdown {
  category: string;
  totalRevenue: number;
  quantity: number;
  averagePrice: number;
  percentageOfTotal: number;
}

export type YieldAnalysis = z.infer<
  typeof responseContracts.getYieldAnalysis
>[number];

export interface GeneratedReport {
  id: string;
  reportType: "monthly" | "quarterly" | "annual";
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  deferredRevenue: number;
  recognizedRevenue: number;
  refundAmount: number;
  ancillaryRevenue: number;
  status: "draft" | "finalized";
  generatedAt: string;
}

export interface DeferredRevenueItem {
  bookingId: number;
  bookingReference: string;
  flightNumber: string;
  departureDate: string;
  cabinClass: string;
  amount: number;
  passengerCount: number;
}

export interface RefundImpact {
  totalRefunds: number;
  refundCount: number;
  averageRefundAmount: number;
  refundRate: number; // percentage of total bookings
  refundsByMonth: Array<{
    month: string;
    amount: number;
    count: number;
  }>;
}

// ============ Helper: Date Range Builder ============

function _buildDateRange(startDate?: Date, endDate?: Date) {
  if (startDate && endDate) {
    return and(
      gte(bookings.createdAt, startDate),
      lte(bookings.createdAt, endDate)
    );
  }
  return undefined;
}

function _buildPaymentDateRange(startDate?: Date, endDate?: Date) {
  if (startDate && endDate) {
    return and(
      gte(payments.createdAt, startDate),
      lte(payments.createdAt, endDate)
    );
  }
  return undefined;
}

// ============ Service Functions ============

/**
 * Record a revenue entry for a booking.
 * Builds a virtual revenue entry from the booking data.
 */
export async function recordRevenueEntry(
  bookingId: number,
  type: RevenueEntry["type"],
  amount: number
): Promise<RevenueEntry> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [booking] = await db
    .select({
      id: bookings.id,
      flightId: bookings.flightId,
      cabinClass: bookings.cabinClass,
      status: bookings.status,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId));

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Booking ${bookingId} not found`,
    });
  }

  const [flight] = await db
    .select({
      originId: flights.originId,
      destinationId: flights.destinationId,
      departureTime: flights.departureTime,
      status: flights.status,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId));

  // Determine channel
  const { corporateBookings } = await import("../../drizzle/schema");
  const { agentBookings } = await import("../../drizzle/schema");

  const [corpBooking] = await db
    .select({ id: corporateBookings.id })
    .from(corporateBookings)
    .where(eq(corporateBookings.bookingId, bookingId))
    .limit(1);

  const [agentBooking] = await db
    .select({ id: agentBookings.id })
    .from(agentBookings)
    .where(eq(agentBookings.bookingId, bookingId))
    .limit(1);

  const channel: RevenueEntry["channel"] = corpBooking
    ? "corporate"
    : agentBooking
      ? "agent"
      : "direct";

  // Determine status: if flight is completed, revenue is recognized
  const isCompleted = flight?.status === "completed";
  const status: RevenueEntry["status"] =
    type === "refund" ? "voided" : isCompleted ? "recognized" : "deferred";

  return {
    id: bookingId, // Virtual ID
    bookingId,
    flightId: booking.flightId,
    type,
    amount,
    currency: "SAR",
    recognitionDate: isCompleted ? flight.departureTime : null,
    status,
    channel,
    classOfService: booking.cabinClass as "economy" | "business",
    routeId: flight ? `${flight.originId}-${flight.destinationId}` : "unknown",
    createdAt: booking.createdAt,
  };
}

/**
 * Calculate deferred revenue: revenue for tickets sold but flights not yet flown.
 */
export async function calculateDeferredRevenue(): Promise<{
  total: number;
  items: DeferredRevenueItem[];
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const now = new Date();

  const deferredItems = await db
    .select({
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      cabinClass: bookings.cabinClass,
      totalAmount: bookings.totalAmount,
      numberOfPassengers: bookings.numberOfPassengers,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        eq(bookings.paymentStatus, "paid"),
        gte(flights.departureTime, now),
        sql`${flights.status} IN ('scheduled', 'delayed')`
      )
    )
    .orderBy(flights.departureTime);

  const items: DeferredRevenueItem[] = deferredItems.map(row => ({
    bookingId: row.bookingId,
    bookingReference: row.bookingReference,
    flightNumber: row.flightNumber,
    departureDate: row.departureTime.toISOString().split("T")[0],
    cabinClass: row.cabinClass,
    amount: row.totalAmount,
    passengerCount: row.numberOfPassengers,
  }));

  const total = items.reduce((sum, item) => sum + item.amount, 0);

  return { total, items };
}

/**
 * Calculate recognized revenue for completed flights within a date range.
 */
export async function calculateRecognizedRevenue(
  startDate?: Date,
  endDate?: Date
): Promise<{ total: number; byDay: Array<{ date: string; amount: number }> }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const conditions = [
    eq(bookings.status, "confirmed"),
    eq(bookings.paymentStatus, "paid"),
    eq(flights.status, "completed"),
  ];

  if (startDate && endDate) {
    conditions.push(
      gte(flights.departureTime, startDate),
      lte(flights.departureTime, endDate)
    );
  }

  const [totals] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(and(...conditions));

  const byDay = await db
    .select({
      date: sql<string>`DATE(${flights.departureTime})`,
      amount: sql<number>`SUM(${bookings.totalAmount})`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(and(...conditions))
    .groupBy(sql`DATE(${flights.departureTime})`)
    .orderBy(sql`DATE(${flights.departureTime})`);

  return {
    total: totals.total || 0,
    byDay: byDay.map(row => ({
      date: row.date,
      amount: row.amount || 0,
    })),
  };
}

/**
 * Get revenue breakdown by route.
 */
export async function getRevenueByRoute(
  startDate?: Date,
  endDate?: Date
): Promise<RouteRevenue[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Need to alias airports for origin and destination
  const conditions = [
    sql`${bookings.status} != 'cancelled'`,
    eq(bookings.paymentStatus, "paid"),
  ];

  if (startDate && endDate) {
    conditions.push(
      gte(bookings.createdAt, startDate),
      lte(bookings.createdAt, endDate)
    );
  }

  const _originAirports = airports;

  const routeData = await db
    .select({
      originId: flights.originId,
      destinationId: flights.destinationId,
      totalRevenue: sql<number>`SUM(${bookings.totalAmount})`,
      bookingCount: sql<number>`COUNT(${bookings.id})`,
      passengerCount: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(and(...conditions))
    .groupBy(flights.originId, flights.destinationId)
    .orderBy(desc(sql`SUM(${bookings.totalAmount})`))
    .limit(20);

  // Fetch airport details separately to avoid complex double-join alias issues
  const airportIds = new Set<number>();
  for (const row of routeData) {
    airportIds.add(row.originId);
    airportIds.add(row.destinationId);
  }

  const airportMap = new Map<number, { code: string; city: string }>();

  if (airportIds.size > 0) {
    const airportList = await db
      .select({
        id: airports.id,
        code: airports.code,
        city: airports.city,
      })
      .from(airports)
      .where(
        sql`${airports.id} IN (${sql.join(
          [...airportIds].map(id => sql`${id}`),
          sql`, `
        )})`
      );

    for (const airport of airportList) {
      airportMap.set(airport.id, {
        code: airport.code,
        city: airport.city,
      });
    }
  }

  return routeData.map(row => {
    const origin = airportMap.get(row.originId) || {
      code: "???",
      city: "Unknown",
    };
    const destination = airportMap.get(row.destinationId) || {
      code: "???",
      city: "Unknown",
    };
    return {
      originCode: origin.code,
      originCity: origin.city,
      destinationCode: destination.code,
      destinationCity: destination.city,
      totalRevenue: row.totalRevenue || 0,
      bookingCount: row.bookingCount || 0,
      averageRevenue:
        row.bookingCount > 0
          ? Math.round((row.totalRevenue || 0) / row.bookingCount)
          : 0,
      passengerCount: row.passengerCount || 0,
    };
  });
}

/**
 * Get revenue breakdown by cabin class (Economy vs Business).
 */
export async function getRevenueByClass(
  startDate?: Date,
  endDate?: Date
): Promise<ClassRevenue[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const conditions = [
    sql`${bookings.status} != 'cancelled'`,
    eq(bookings.paymentStatus, "paid"),
  ];

  if (startDate && endDate) {
    conditions.push(
      gte(bookings.createdAt, startDate),
      lte(bookings.createdAt, endDate)
    );
  }

  const classData = await db
    .select({
      cabinClass: bookings.cabinClass,
      totalRevenue: sql<number>`SUM(${bookings.totalAmount})`,
      bookingCount: sql<number>`COUNT(${bookings.id})`,
      passengerCount: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(bookings)
    .where(and(...conditions))
    .groupBy(bookings.cabinClass);

  const grandTotal = classData.reduce(
    (sum, row) => sum + (row.totalRevenue || 0),
    0
  );

  return classData.map(row => ({
    classOfService: row.cabinClass,
    totalRevenue: row.totalRevenue || 0,
    bookingCount: row.bookingCount || 0,
    averageRevenue:
      row.bookingCount > 0
        ? Math.round((row.totalRevenue || 0) / row.bookingCount)
        : 0,
    passengerCount: row.passengerCount || 0,
    percentageOfTotal:
      grandTotal > 0
        ? Math.round(((row.totalRevenue || 0) / grandTotal) * 1000) / 10
        : 0,
  }));
}

/**
 * Get revenue breakdown by channel: Direct, Agent, Corporate.
 */
export async function getRevenueByChannel(
  startDate?: Date,
  endDate?: Date
): Promise<ChannelRevenue[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const { corporateBookings } = await import("../../drizzle/schema");
  const { agentBookings } = await import("../../drizzle/schema");

  const conditions = [
    sql`${bookings.status} != 'cancelled'`,
    eq(bookings.paymentStatus, "paid"),
  ];

  if (startDate && endDate) {
    conditions.push(
      gte(bookings.createdAt, startDate),
      lte(bookings.createdAt, endDate)
    );
  }

  // Total revenue for all paid bookings
  const [totalStats] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
      totalBookings: sql<number>`COUNT(*)`,
    })
    .from(bookings)
    .where(and(...conditions));

  // Corporate channel revenue
  const [corporateStats] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
      bookingCount: sql<number>`COUNT(${bookings.id})`,
    })
    .from(bookings)
    .innerJoin(corporateBookings, eq(corporateBookings.bookingId, bookings.id))
    .where(and(...conditions));

  // Agent channel revenue
  const [agentStats] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
      bookingCount: sql<number>`COUNT(${bookings.id})`,
    })
    .from(bookings)
    .innerJoin(agentBookings, eq(agentBookings.bookingId, bookings.id))
    .where(and(...conditions));

  // Direct channel = Total - Corporate - Agent
  const directRevenue =
    (totalStats.totalRevenue || 0) -
    (corporateStats.totalRevenue || 0) -
    (agentStats.totalRevenue || 0);
  const directBookings =
    (totalStats.totalBookings || 0) -
    (corporateStats.bookingCount || 0) -
    (agentStats.bookingCount || 0);

  const grandTotal = totalStats.totalRevenue || 1; // Avoid division by zero

  const channels: ChannelRevenue[] = [
    {
      channel: "direct",
      totalRevenue: directRevenue,
      bookingCount: directBookings,
      averageRevenue:
        directBookings > 0 ? Math.round(directRevenue / directBookings) : 0,
      percentageOfTotal: Math.round((directRevenue / grandTotal) * 1000) / 10,
    },
    {
      channel: "agent",
      totalRevenue: agentStats.totalRevenue || 0,
      bookingCount: agentStats.bookingCount || 0,
      averageRevenue:
        agentStats.bookingCount > 0
          ? Math.round((agentStats.totalRevenue || 0) / agentStats.bookingCount)
          : 0,
      percentageOfTotal:
        Math.round(((agentStats.totalRevenue || 0) / grandTotal) * 1000) / 10,
    },
    {
      channel: "corporate",
      totalRevenue: corporateStats.totalRevenue || 0,
      bookingCount: corporateStats.bookingCount || 0,
      averageRevenue:
        corporateStats.bookingCount > 0
          ? Math.round(
              (corporateStats.totalRevenue || 0) / corporateStats.bookingCount
            )
          : 0,
      percentageOfTotal:
        Math.round(((corporateStats.totalRevenue || 0) / grandTotal) * 1000) /
        10,
    },
  ];

  return channels;
}

/**
 * Get ancillary services revenue breakdown.
 */
export async function getAncillaryRevenue(
  startDate?: Date,
  endDate?: Date
): Promise<{
  total: number;
  breakdown: AncillaryRevenueBreakdown[];
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const dateFilter =
    startDate && endDate
      ? and(
          gte(bookingAncillaries.createdAt, startDate),
          lte(bookingAncillaries.createdAt, endDate)
        )
      : undefined;

  const categoryData = await db
    .select({
      category: ancillaryServices.category,
      totalRevenue: sql<number>`COALESCE(SUM(${bookingAncillaries.totalPrice}), 0)`,
      quantity: sql<number>`COALESCE(SUM(${bookingAncillaries.quantity}), 0)`,
    })
    .from(bookingAncillaries)
    .innerJoin(
      ancillaryServices,
      eq(bookingAncillaries.ancillaryServiceId, ancillaryServices.id)
    )
    .where(
      dateFilter
        ? and(dateFilter, eq(bookingAncillaries.status, "active"))
        : eq(bookingAncillaries.status, "active")
    )
    .groupBy(ancillaryServices.category)
    .orderBy(desc(sql`SUM(${bookingAncillaries.totalPrice})`));

  const total = categoryData.reduce(
    (sum, row) => sum + (row.totalRevenue || 0),
    0
  );

  const breakdown: AncillaryRevenueBreakdown[] = categoryData.map(row => ({
    category: row.category,
    totalRevenue: row.totalRevenue || 0,
    quantity: row.quantity || 0,
    averagePrice:
      row.quantity > 0 ? Math.round((row.totalRevenue || 0) / row.quantity) : 0,
    percentageOfTotal:
      total > 0 ? Math.round(((row.totalRevenue || 0) / total) * 1000) / 10 : 0,
  }));

  return { total, breakdown };
}

/**
 * Calculate yield (Revenue per RPK) for a given flight.
 * RPK = Revenue Passenger Kilometer = passengers carried * distance in km
 * Yield = Total Revenue / RPK
 */
export async function calculateYield(
  flightId: number
): Promise<YieldAnalysis | null> {
  return (
    (await readYieldAnalysis(undefined, undefined, 1, flightId))[0] ?? null
  );
}

/** Flight-scoped evidence supplies recognized revenue and distance. Booking totals
 * cannot be allocated to individual legs without an approved revenue policy.
 * Counts are funded current membership, explicitly not certified carried RPK. */
export function getYieldAnalysis(
  startDate?: Date,
  endDate?: Date,
  limit = 20
): Promise<YieldAnalysis[]> {
  return readYieldAnalysis(startDate, endDate, limit);
}

async function readYieldAnalysis(
  startDate?: Date,
  endDate?: Date,
  limit = 20,
  flightId?: number
): Promise<YieldAnalysis[]> {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Narrow the yield report",
    });
  const { validateFinancialPeriod } =
    await import("./financial-reporting.service");
  validateFinancialPeriod({ startDate, endDate });
  const rows = await db
    .select({
      flightId: flights.id,
      flightNumber: flights.flightNumber,
      tenantId: flights.tenantId,
      airlineId: flights.airlineId,
      originId: flights.originId,
      destinationId: flights.destinationId,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      passengerCount: sql<number>`COALESCE(SUM(${bookings.numberOfPassengers}), 0)`,
    })
    .from(flights)
    .leftJoin(
      bookings,
      and(
        flightBookingCondition(flights.id),
        eq(bookings.paymentStatus, "paid"),
        sql`${bookings.status} IN ('confirmed', 'completed')`,
        isNull(bookings.deletedAt),
        sql`${bookings.tenantId} <=> ${flights.tenantId}`
      )
    )
    .where(
      and(
        flightId === undefined ? undefined : eq(flights.id, flightId),
        startDate ? gte(flights.departureTime, startDate) : undefined,
        endDate ? lte(flights.departureTime, endDate) : undefined
      )
    )
    .groupBy(
      flights.id,
      flights.flightNumber,
      flights.tenantId,
      flights.airlineId,
      flights.originId,
      flights.destinationId,
      flights.economySeats,
      flights.businessSeats,
      flights.departureTime
    )
    .orderBy(desc(flights.departureTime), flights.id)
    .limit(limit);
  const costs = await readFlightCosts(rows.map(r => r.flightId));
  const ids = [...new Set(rows.flatMap(r => [r.originId, r.destinationId]))];
  const places = ids.length
    ? await db
        .select({ id: airports.id, code: airports.code })
        .from(airports)
        .where(inArray(airports.id, ids))
    : [];
  const codes = new Map(places.map(p => [p.id, p.code]));
  return rows.map(row => {
    const cost = costs.get(row.flightId);
    let coverage: YieldAnalysis["coverage"] = cost
      ? "available"
      : "missing_evidence";
    if (cost) {
      try {
        requireCurrentAviationSource(
          cost.sourceId,
          "flight_cost",
          row.tenantId,
          row.airlineId
        );
      } catch {
        coverage = "unavailable_source";
      }
    }
    const accepted = coverage === "available" ? cost : undefined;
    const distanceKm = accepted?.payload.routeDistanceKm ?? null;
    const totalRevenue = accepted?.payload.recognizedRevenueMinor ?? null;
    if (accepted && totalRevenue === null)
      coverage = "missing_recognized_revenue";
    const passengerCount = Number(row.passengerCount);
    const rpk = distanceKm === null ? null : passengerCount * distanceKm;
    const seats = row.economySeats + row.businessSeats;
    return {
      flightId: row.flightId,
      flightNumber: row.flightNumber,
      originCode: codes.get(row.originId) ?? "—",
      destinationCode: codes.get(row.destinationId) ?? "—",
      totalRevenue,
      passengerCount,
      distanceKm,
      rpk,
      yield: rpk && totalRevenue !== null ? totalRevenue / rpk : null,
      loadFactor:
        seats > 0 ? Math.round((passengerCount / seats) * 1000) / 10 : 0,
      evidenceId: accepted?.evidenceId ?? null,
      sourceId: accepted?.sourceId ?? null,
      coverage,
      passengerBasis: "funded_active_membership" as const,
    };
  });
}

/**
 * Generate a monthly revenue reconciliation report.
 */
export async function generateRevenueReport(
  month: number,
  year: number,
  _generatedBy: number
): Promise<GeneratedReport> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const cash = await getFinancialSummary({
    startDate: periodStart,
    endDate: periodEnd,
  });
  // Deferred revenue: tickets sold in period for future flights
  const now = new Date();
  const [deferredStats] = await db
    .select({
      deferredRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        eq(bookings.paymentStatus, "paid"),
        gte(bookings.createdAt, periodStart),
        lte(bookings.createdAt, periodEnd),
        gte(flights.departureTime, now)
      )
    );

  // Recognized revenue: tickets sold in period for completed flights
  const [recognizedStats] = await db
    .select({
      recognizedRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        eq(bookings.paymentStatus, "paid"),
        gte(bookings.createdAt, periodStart),
        lte(bookings.createdAt, periodEnd),
        eq(flights.status, "completed")
      )
    );

  // Ancillary revenue in the period
  const [ancillaryStats] = await db
    .select({
      ancillaryRevenue: sql<number>`COALESCE(SUM(${bookingAncillaries.totalPrice}), 0)`,
    })
    .from(bookingAncillaries)
    .where(
      and(
        eq(bookingAncillaries.status, "active"),
        gte(bookingAncillaries.createdAt, periodStart),
        lte(bookingAncillaries.createdAt, periodEnd)
      )
    );

  const monthStr = String(month).padStart(2, "0");
  const reportId = `REV-${year}-${monthStr}`;

  return {
    id: reportId,
    reportType: "monthly",
    periodStart: periodStart.toISOString().split("T")[0],
    periodEnd: periodEnd.toISOString().split("T")[0],
    totalRevenue: cash.collectedAmount,
    deferredRevenue: deferredStats.deferredRevenue || 0,
    recognizedRevenue: recognizedStats.recognizedRevenue || 0,
    refundAmount: cash.refundedAmount,
    ancillaryRevenue: ancillaryStats.ancillaryRevenue || 0,
    status: "draft",
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get refund impact on revenue within a date range.
 */
export async function getRefundImpact(
  startDate?: Date,
  endDate?: Date
): Promise<RefundImpact> {
  const rows = await getRefundExportRows({ startDate, endDate });
  const days = await getFinancialDays({ startDate, endDate });
  const months = new Map<
    string,
    { month: string; amount: number; count: number }
  >();
  for (const row of rows) {
    const month = row.refundedAt.toISOString().slice(0, 7);
    const group = months.get(month) ?? { month, amount: 0, count: 0 };
    group.amount += row.amount;
    group.count++;
    months.set(month, group);
  }
  const totalRefunds = rows.reduce((sum, row) => sum + row.amount, 0);
  const bookingCount = days.reduce((sum, day) => sum + day.bookings, 0);
  return {
    totalRefunds,
    refundCount: rows.length,
    averageRefundAmount: rows.length
      ? Math.round(totalRefunds / rows.length)
      : 0,
    refundRate: bookingCount
      ? (new Set(rows.map(row => row.bookingId)).size / bookingCount) * 100
      : 0,
    refundsByMonth: [...months.values()].sort((a, b) =>
      a.month.localeCompare(b.month)
    ),
  };
}

/**
 * Get revenue dashboard overview with KPIs.
 */
export async function getRevenueDashboard(
  startDate?: Date,
  endDate?: Date
): Promise<RevenueOverview> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const conditions = [
    sql`${bookings.status} != 'cancelled'`,
    eq(bookings.paymentStatus, "paid"),
  ];

  if (startDate && endDate) {
    conditions.push(
      gte(bookings.createdAt, startDate),
      lte(bookings.createdAt, endDate)
    );
  }

  // Total revenue
  const [totalStats] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
      totalBookings: sql<number>`COUNT(*)`,
    })
    .from(bookings)
    .where(and(...conditions));

  // Deferred (future flights)
  const now = new Date();
  const deferredConditions = [
    eq(bookings.status, "confirmed"),
    eq(bookings.paymentStatus, "paid"),
    gte(flights.departureTime, now),
  ];
  if (startDate && endDate) {
    deferredConditions.push(
      gte(bookings.createdAt, startDate),
      lte(bookings.createdAt, endDate)
    );
  }

  const [deferredStats] = await db
    .select({
      deferredRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(and(...deferredConditions));

  // Recognized (completed flights)
  const recognizedConditions = [
    eq(bookings.status, "confirmed"),
    eq(bookings.paymentStatus, "paid"),
    eq(flights.status, "completed"),
  ];
  if (startDate && endDate) {
    recognizedConditions.push(
      gte(bookings.createdAt, startDate),
      lte(bookings.createdAt, endDate)
    );
  }

  const [recognizedStats] = await db
    .select({
      recognizedRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(and(...recognizedConditions));

  // Ancillary revenue
  const ancillaryConditions = [eq(bookingAncillaries.status, "active")];
  if (startDate && endDate) {
    ancillaryConditions.push(
      gte(bookingAncillaries.createdAt, startDate),
      lte(bookingAncillaries.createdAt, endDate)
    );
  }

  const [ancillaryStats] = await db
    .select({
      ancillaryRevenue: sql<number>`COALESCE(SUM(${bookingAncillaries.totalPrice}), 0)`,
    })
    .from(bookingAncillaries)
    .where(and(...ancillaryConditions));

  // Cash is read from the shared settlement ledger on its posting date.
  const cash = await getFinancialSummary({ startDate, endDate });
  let revenueGrowthPercent = 0;
  if (startDate && endDate) {
    const previous = await getFinancialSummary({
      startDate: new Date(
        startDate.getTime() - (endDate.getTime() - startDate.getTime() + 1)
      ),
      endDate: new Date(startDate.getTime() - 1),
    });
    if (previous.collectedAmount > 0)
      revenueGrowthPercent =
        Math.round(
          ((cash.collectedAmount - previous.collectedAmount) /
            previous.collectedAmount) *
            1000
        ) / 10;
  }
  const totalRevenue = cash.collectedAmount;
  const refundTotal = cash.refundedAmount;
  const totalBookings = totalStats.totalBookings || 0;

  return {
    totalRevenue,
    deferredRevenue: deferredStats.deferredRevenue || 0,
    recognizedRevenue: recognizedStats.recognizedRevenue || 0,
    ancillaryRevenue: ancillaryStats.ancillaryRevenue || 0,
    refundTotal,
    netRevenue: totalRevenue - refundTotal,
    revenueGrowthPercent,
    averageRevenuePerBooking:
      totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0,
    totalBookings,
  };
}

/**
 * List generated reports (virtual - based on available monthly data).
 */
export async function getReports(
  limit: number = 12
): Promise<GeneratedReport[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get months that have booking data
  const monthlyData = await db
    .select({
      yearMonth: sql<string>`DATE_FORMAT(${bookings.createdAt}, '%Y-%m')`,
      totalRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
      bookingCount: sql<number>`COUNT(*)`,
    })
    .from(bookings)
    .where(
      and(
        sql`${bookings.status} != 'cancelled'`,
        eq(bookings.paymentStatus, "paid")
      )
    )
    .groupBy(sql`DATE_FORMAT(${bookings.createdAt}, '%Y-%m')`)
    .orderBy(desc(sql`DATE_FORMAT(${bookings.createdAt}, '%Y-%m')`))
    .limit(limit);

  return monthlyData.map(row => {
    const [year, month] = row.yearMonth.split("-");
    const periodStart = new Date(parseInt(year), parseInt(month) - 1, 1);
    const periodEnd = new Date(parseInt(year), parseInt(month), 0);

    return {
      id: `REV-${row.yearMonth}`,
      reportType: "monthly" as const,
      periodStart: periodStart.toISOString().split("T")[0],
      periodEnd: periodEnd.toISOString().split("T")[0],
      totalRevenue: row.totalRevenue || 0,
      deferredRevenue: 0, // Requires detailed calculation per report
      recognizedRevenue: 0,
      refundAmount: 0,
      ancillaryRevenue: 0,
      status: "draft" as const,
      generatedAt: new Date().toISOString(),
    };
  });
}
