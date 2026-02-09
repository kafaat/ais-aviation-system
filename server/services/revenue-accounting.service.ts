/**
 * Revenue Accounting Service
 * Handles revenue recognition, deferred revenue, yield analysis,
 * and financial reporting for the aviation booking system.
 *
 * All monetary amounts are in SAR cents (100 = 1 SAR).
 */

import { getDb } from "../db";
import {
  bookings,
  flights,
  airports,
  payments,
  bookingAncillaries,
  ancillaryServices,
} from "../../drizzle/schema";
import { sql, and, gte, lte, eq, desc, between } from "drizzle-orm";

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

export interface YieldAnalysis {
  flightId: number;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  totalRevenue: number;
  passengerCount: number;
  distanceKm: number;
  rpk: number; // Revenue Passenger Kilometers
  yield: number; // Revenue per RPK in SAR cents
  loadFactor: number; // percentage
}

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

function buildDateRange(startDate?: Date, endDate?: Date) {
  if (startDate && endDate) {
    return and(
      gte(bookings.createdAt, startDate),
      lte(bookings.createdAt, endDate)
    );
  }
  return undefined;
}

function buildPaymentDateRange(startDate?: Date, endDate?: Date) {
  if (startDate && endDate) {
    return and(
      gte(payments.createdAt, startDate),
      lte(payments.createdAt, endDate)
    );
  }
  return undefined;
}

// ============ Estimated distance between airports (simplified) ============

/**
 * Rough estimated distances in km for common Saudi/Middle East routes.
 * In production this would come from a distances table or API.
 * Falls back to a default of 1000 km for unknown routes.
 */
function estimateDistanceKm(originId: number, destinationId: number): number {
  // Simple hash-based estimate for consistent results
  // In real implementation, this would use airport lat/lng or a reference table
  const key = `${Math.min(originId, destinationId)}-${Math.max(originId, destinationId)}`;
  const distances: Record<string, number> = {
    "1-2": 950, // JED-RUH
    "1-3": 1480, // JED-DMM
    "2-3": 400, // RUH-DMM
    "1-4": 630, // JED-MED
    "2-4": 850, // RUH-MED
    "1-5": 1960, // JED-DXB
    "2-5": 1060, // RUH-DXB
    "1-6": 2680, // JED-CAI
    "2-6": 2400, // RUH-CAI
  };
  return distances[key] || 1000;
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
  if (!db) throw new Error("Database not available");

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
    throw new Error(`Booking ${bookingId} not found`);
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
  if (!db) throw new Error("Database not available");

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
  if (!db) throw new Error("Database not available");

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
  if (!db) throw new Error("Database not available");

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

  const originAirports = airports;

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
  if (!db) throw new Error("Database not available");

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
  if (!db) throw new Error("Database not available");

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
  if (!db) throw new Error("Database not available");

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
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      originId: flights.originId,
      destinationId: flights.destinationId,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
    })
    .from(flights)
    .where(eq(flights.id, flightId));

  if (!flight) return null;

  const [bookingStats] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
      passengerCount: sql<number>`COALESCE(SUM(${bookings.numberOfPassengers}), 0)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} != 'cancelled'`,
        eq(bookings.paymentStatus, "paid")
      )
    );

  // Get airport codes
  const airportList = await db
    .select({
      id: airports.id,
      code: airports.code,
    })
    .from(airports)
    .where(
      sql`${airports.id} IN (${sql`${flight.originId}`}, ${sql`${flight.destinationId}`})`
    );

  const airportMap = new Map<number, string>();
  for (const a of airportList) {
    airportMap.set(a.id, a.code);
  }

  const distanceKm = estimateDistanceKm(flight.originId, flight.destinationId);
  const passengerCount = bookingStats.passengerCount || 0;
  const rpk = passengerCount * distanceKm;
  const totalSeats = flight.economySeats + flight.businessSeats;

  return {
    flightId: flight.id,
    flightNumber: flight.flightNumber,
    originCode: airportMap.get(flight.originId) || "???",
    destinationCode: airportMap.get(flight.destinationId) || "???",
    totalRevenue: bookingStats.totalRevenue || 0,
    passengerCount,
    distanceKm,
    rpk,
    yield: rpk > 0 ? Math.round((bookingStats.totalRevenue || 0) / rpk) : 0,
    loadFactor:
      totalSeats > 0
        ? Math.round((passengerCount / totalSeats) * 1000) / 10
        : 0,
  };
}

/**
 * Calculate yield analysis for top routes within a date range.
 */
export async function getYieldAnalysis(
  startDate?: Date,
  endDate?: Date,
  limit: number = 20
): Promise<YieldAnalysis[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [
    sql`${bookings.status} != 'cancelled'`,
    eq(bookings.paymentStatus, "paid"),
  ];

  if (startDate && endDate) {
    conditions.push(
      gte(flights.departureTime, startDate),
      lte(flights.departureTime, endDate)
    );
  }

  const flightStats = await db
    .select({
      flightId: flights.id,
      flightNumber: flights.flightNumber,
      originId: flights.originId,
      destinationId: flights.destinationId,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      totalRevenue: sql<number>`SUM(${bookings.totalAmount})`,
      passengerCount: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(and(...conditions))
    .groupBy(
      flights.id,
      flights.flightNumber,
      flights.originId,
      flights.destinationId,
      flights.economySeats,
      flights.businessSeats
    )
    .orderBy(desc(sql`SUM(${bookings.totalAmount})`))
    .limit(limit);

  // Gather all airport IDs
  const airportIds = new Set<number>();
  for (const row of flightStats) {
    airportIds.add(row.originId);
    airportIds.add(row.destinationId);
  }

  const airportMap = new Map<number, string>();
  if (airportIds.size > 0) {
    const airportList = await db
      .select({ id: airports.id, code: airports.code })
      .from(airports)
      .where(
        sql`${airports.id} IN (${sql.join(
          [...airportIds].map(id => sql`${id}`),
          sql`, `
        )})`
      );
    for (const a of airportList) {
      airportMap.set(a.id, a.code);
    }
  }

  return flightStats.map(row => {
    const distanceKm = estimateDistanceKm(row.originId, row.destinationId);
    const paxCount = row.passengerCount || 0;
    const rpk = paxCount * distanceKm;
    const totalSeats = row.economySeats + row.businessSeats;
    const revenue = row.totalRevenue || 0;

    return {
      flightId: row.flightId,
      flightNumber: row.flightNumber,
      originCode: airportMap.get(row.originId) || "???",
      destinationCode: airportMap.get(row.destinationId) || "???",
      totalRevenue: revenue,
      passengerCount: paxCount,
      distanceKm,
      rpk,
      yield: rpk > 0 ? Math.round(revenue / rpk) : 0,
      loadFactor:
        totalSeats > 0 ? Math.round((paxCount / totalSeats) * 1000) / 10 : 0,
    };
  });
}

/**
 * Generate a monthly revenue reconciliation report.
 */
export async function generateRevenueReport(
  month: number,
  year: number,
  generatedBy: number
): Promise<GeneratedReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

  // Total revenue from confirmed bookings in the period
  const [revenueStats] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
      bookingCount: sql<number>`COUNT(*)`,
    })
    .from(bookings)
    .where(
      and(
        sql`${bookings.status} != 'cancelled'`,
        eq(bookings.paymentStatus, "paid"),
        gte(bookings.createdAt, periodStart),
        lte(bookings.createdAt, periodEnd)
      )
    );

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

  // Refund amounts in the period
  const [refundStats] = await db
    .select({
      refundAmount: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.status, "refunded"),
        gte(payments.createdAt, periodStart),
        lte(payments.createdAt, periodEnd)
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
    totalRevenue: revenueStats.totalRevenue || 0,
    deferredRevenue: deferredStats.deferredRevenue || 0,
    recognizedRevenue: recognizedStats.recognizedRevenue || 0,
    refundAmount: refundStats.refundAmount || 0,
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const refundConditions = [eq(payments.status, "refunded")];
  const bookingConditions: ReturnType<typeof eq>[] = [];

  if (startDate && endDate) {
    refundConditions.push(
      gte(payments.createdAt, startDate),
      lte(payments.createdAt, endDate)
    );
    bookingConditions.push(
      gte(bookings.createdAt, startDate),
      lte(bookings.createdAt, endDate)
    );
  }

  // Refund totals
  const [refundTotals] = await db
    .select({
      totalRefunds: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
      refundCount: sql<number>`COUNT(*)`,
    })
    .from(payments)
    .where(and(...refundConditions));

  // Total bookings for refund rate calculation
  const [bookingTotals] = await db
    .select({
      totalBookings: sql<number>`COUNT(*)`,
    })
    .from(bookings)
    .where(
      bookingConditions.length > 0 ? and(...bookingConditions) : undefined
    );

  // Refunds grouped by month
  const refundsByMonth = await db
    .select({
      month: sql<string>`DATE_FORMAT(${payments.createdAt}, '%Y-%m')`,
      amount: sql<number>`SUM(${payments.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(payments)
    .where(and(...refundConditions))
    .groupBy(sql`DATE_FORMAT(${payments.createdAt}, '%Y-%m')`)
    .orderBy(sql`DATE_FORMAT(${payments.createdAt}, '%Y-%m')`);

  const totalRefunds = refundTotals.totalRefunds || 0;
  const refundCount = refundTotals.refundCount || 0;

  return {
    totalRefunds,
    refundCount,
    averageRefundAmount:
      refundCount > 0 ? Math.round(totalRefunds / refundCount) : 0,
    refundRate:
      bookingTotals.totalBookings > 0
        ? Math.round((refundCount / bookingTotals.totalBookings) * 1000) / 10
        : 0,
    refundsByMonth: refundsByMonth.map(row => ({
      month: row.month,
      amount: row.amount || 0,
      count: row.count || 0,
    })),
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
  if (!db) throw new Error("Database not available");

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

  // Refund totals
  const refundConditions = [eq(payments.status, "refunded")];
  if (startDate && endDate) {
    refundConditions.push(
      gte(payments.createdAt, startDate),
      lte(payments.createdAt, endDate)
    );
  }

  const [refundStats] = await db
    .select({
      refundTotal: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
    })
    .from(payments)
    .where(and(...refundConditions));

  // Revenue growth: compare to previous period of same length
  let revenueGrowthPercent = 0;
  if (startDate && endDate) {
    const periodLengthMs = endDate.getTime() - startDate.getTime();
    const prevStart = new Date(startDate.getTime() - periodLengthMs);
    const prevEnd = new Date(startDate.getTime() - 1);

    const [prevStats] = await db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
      })
      .from(bookings)
      .where(
        and(
          sql`${bookings.status} != 'cancelled'`,
          eq(bookings.paymentStatus, "paid"),
          gte(bookings.createdAt, prevStart),
          lte(bookings.createdAt, prevEnd)
        )
      );

    if (prevStats.totalRevenue > 0) {
      revenueGrowthPercent =
        Math.round(
          (((totalStats.totalRevenue || 0) - prevStats.totalRevenue) /
            prevStats.totalRevenue) *
            1000
        ) / 10;
    }
  }

  const totalRevenue = totalStats.totalRevenue || 0;
  const refundTotal = refundStats.refundTotal || 0;
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
  if (!db) throw new Error("Database not available");

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
