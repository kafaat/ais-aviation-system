/**
 * Analytics Service
 * Provides business intelligence and KPIs for admin dashboard
 */

import {
  getFinancialDays,
  getFinancialSummary,
  type FinancialAmounts,
  type FinancialPeriod,
  validateFinancialPeriod,
} from "./financial-reporting.service";
import { flightBookingCondition } from "./flight-state.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  airports,
  bookingAncillaries,
  ancillaryServices,
} from "../../drizzle/schema";
import { sql, and, gte, lte, eq, desc, isNull, isNotNull } from "drizzle-orm";

export type AnalyticsPeriod = Pick<FinancialPeriod, "startDate" | "endDate">;

function bookingPeriodFilter(period: AnalyticsPeriod) {
  validateFinancialPeriod(period);
  return and(
    period.startDate ? gte(bookings.createdAt, period.startDate) : undefined,
    period.endDate ? lte(bookings.createdAt, period.endDate) : undefined
  );
}

function soldFlightBookingCondition() {
  return and(
    flightBookingCondition(flights.id, "manifest"),
    sql`${bookings.status} IN ('confirmed','completed')`,
    isNull(bookings.deletedAt)
  );
}

// Ancillary KPIs describe active funded items for the selected booking cohort.
// They are booked values, not cash-ledger collections or earned revenue.
function fundedAncillaryCondition(period: AnalyticsPeriod) {
  return and(
    bookingPeriodFilter(period),
    eq(bookingAncillaries.status, "active"),
    isNotNull(bookingAncillaries.fundedAt)
  );
}

export interface KPIMetrics extends FinancialAmounts {
  totalBookings: number;
  totalRevenue: number;
  averageOccupancyRate: number;
  cancellationRate: number;
  totalPassengers: number;
}

export interface RevenueDataPoint {
  date: string;
  revenue: number;
  bookings: number;
}

export interface PopularDestination {
  airportCode: string;
  airportName: string;
  city: string;
  bookingCount: number;
  revenue: number;
}

export interface BookingTrend {
  date: string;
  bookings: number;
  passengers: number;
}

/**
 * Get overall KPI metrics
 */
export async function getKPIMetrics(
  startDate?: Date,
  endDate?: Date
): Promise<KPIMetrics> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const dateFilter = bookingPeriodFilter({ startDate, endDate });

  const financial = await getFinancialSummary({ startDate, endDate });

  // Booking counts are independent of settlement posting dates.
  const [bookingStats] = await db
    .select({
      totalBookings: sql<number>`COUNT(*)`,
      totalPassengers: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(bookings)
    .where(dateFilter);

  // Cancellation rate
  const [cancellationStats] = await db
    .select({
      totalBookings: sql<number>`COUNT(*)`,
      cancelledBookings: sql<number>`SUM(CASE WHEN ${bookings.status} = 'cancelled' THEN 1 ELSE 0 END)`,
    })
    .from(bookings)
    .where(dateFilter);

  const cancellationRate =
    cancellationStats.totalBookings > 0
      ? (cancellationStats.cancelledBookings /
          cancellationStats.totalBookings) *
        100
      : 0;

  // Capacity is counted once per flight with confirmed/completed bookings in
  // the selected cohort; authoritative segments also include onward flights.
  const occupancyRows = await db
    .select({
      totalSeats: sql<number>`${flights.economySeats} + ${flights.businessSeats}`,
      bookedSeats: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(flights)
    .innerJoin(bookings, soldFlightBookingCondition())
    .where(dateFilter)
    .groupBy(flights.id, flights.economySeats, flights.businessSeats);

  const occupancyStats = occupancyRows.reduce(
    (total, row) => ({
      totalSeats: total.totalSeats + Number(row.totalSeats || 0),
      bookedSeats: total.bookedSeats + Number(row.bookedSeats || 0),
    }),
    { totalSeats: 0, bookedSeats: 0 }
  );

  const averageOccupancyRate =
    occupancyStats.totalSeats > 0
      ? (occupancyStats.bookedSeats / occupancyStats.totalSeats) * 100
      : 0;

  return {
    totalBookings: Number(bookingStats.totalBookings || 0),
    ...financial,
    totalRevenue: financial.netCollectedAmount, // Deprecated alias: net collections, not earned revenue.
    averageOccupancyRate: Math.round(averageOccupancyRate * 10) / 10,
    cancellationRate: Math.round(cancellationRate * 10) / 10,
    totalPassengers: Number(bookingStats.totalPassengers || 0),
  };
}

/**
 * Get revenue data over time (daily)
 */
export async function getRevenueOverTime(
  days: number = 30,
  period?: AnalyticsPeriod
): Promise<RevenueDataPoint[]> {
  return (
    await getFinancialDays(
      period ?? {
        startDate: new Date(Date.now() - days * 86400000),
      }
    )
  ).map(row => ({
    date: row.date,
    revenue: row.netCollectedAmount,
    bookings: row.bookings,
  }));
}

/**
 * Get most popular destinations
 */
export async function getPopularDestinations(
  limit: number = 10,
  period: AnalyticsPeriod = {}
): Promise<PopularDestination[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const popularDests = await db
    .select({
      airportCode: airports.code,
      airportName: airports.name,
      city: airports.city,
      bookingCount: sql<number>`COUNT(${bookings.id})`,
      revenue: sql<number>`SUM(${bookings.totalAmount})`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(airports, eq(flights.destinationId, airports.id))
    .where(
      and(bookingPeriodFilter(period), sql`${bookings.status} != 'cancelled'`)
    )
    .groupBy(airports.id, airports.code, airports.name, airports.city)
    .orderBy(desc(sql`COUNT(${bookings.id})`))
    .limit(limit);

  return popularDests.map(row => ({
    airportCode: row.airportCode,
    airportName: row.airportName,
    city: row.city,
    bookingCount: Number(row.bookingCount || 0),
    revenue: Number(row.revenue || 0),
  }));
}

/**
 * Get booking trends over time
 */
export async function getBookingTrends(
  days: number = 30,
  period?: AnalyticsPeriod
): Promise<BookingTrend[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const dateFilter = bookingPeriodFilter(
    period ?? {
      startDate: new Date(Date.now() - days * 86400000),
    }
  );

  const trends = await db
    .select({
      date: sql<string>`DATE(${bookings.createdAt})`,
      bookings: sql<number>`COUNT(*)`,
      passengers: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(bookings)
    .where(dateFilter)
    .groupBy(sql`DATE(${bookings.createdAt})`)
    .orderBy(sql`DATE(${bookings.createdAt})`);

  return trends.map(row => ({
    date: row.date,
    bookings: Number(row.bookings || 0),
    passengers: Number(row.passengers || 0),
  }));
}

/**
 * Get flight occupancy details
 */
export async function getFlightOccupancyDetails() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const occupancyDetails = await db
    .select({
      flightId: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      totalSeats: sql<number>`${flights.economySeats} + ${flights.businessSeats}`,
      bookedSeats: sql<number>`COALESCE(SUM(${bookings.numberOfPassengers}), 0)`,
      occupancyRate: sql<number>`COALESCE(ROUND((COALESCE(SUM(${bookings.numberOfPassengers}), 0) / NULLIF(${flights.economySeats} + ${flights.businessSeats}, 0)) * 100, 1), 0)`,
    })
    .from(flights)
    .leftJoin(bookings, soldFlightBookingCondition())
    .where(gte(flights.departureTime, new Date()))
    .groupBy(
      flights.id,
      flights.flightNumber,
      flights.departureTime,
      flights.economySeats,
      flights.businessSeats
    )
    .orderBy(
      desc(
        sql`COALESCE(ROUND((COALESCE(SUM(${bookings.numberOfPassengers}), 0) / NULLIF(${flights.economySeats} + ${flights.businessSeats}, 0)) * 100, 1), 0)`
      )
    )
    .limit(20);

  return occupancyDetails;
}

/**
 * Ancillary Services Analytics
 */

export interface AncillaryMetrics {
  totalAncillaryRevenue: number;
  ancillaryAttachmentRate: number; // % of bookings with ancillaries
  averageAncillaryRevenuePerBooking: number;
  totalAncillariesSold: number;
}

export interface AncillaryRevenueByCategory {
  category: string;
  revenue: number;
  quantity: number;
  percentage: number;
}

export interface PopularAncillary {
  serviceName: string;
  category: string;
  totalSold: number;
  revenue: number;
}

/**
 * Get ancillary services KPI metrics
 */
export async function getAncillaryMetrics(
  startDate?: Date,
  endDate?: Date
): Promise<AncillaryMetrics> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const period = { startDate, endDate };

  // Total ancillary revenue and quantity
  const [ancillaryStats] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${bookingAncillaries.totalPrice}), 0)`,
      totalQuantity: sql<number>`COALESCE(SUM(${bookingAncillaries.quantity}), 0)`,
    })
    .from(bookingAncillaries)
    .innerJoin(bookings, eq(bookingAncillaries.bookingId, bookings.id))
    .where(fundedAncillaryCondition(period));

  // Total bookings in the same period
  const bookingDateFilter = bookingPeriodFilter(period);

  const [bookingStats] = await db
    .select({
      totalBookings: sql<number>`COUNT(*)`,
    })
    .from(bookings)
    .where(bookingDateFilter);

  // Bookings with ancillaries
  const [attachmentStats] = await db
    .select({
      bookingsWithAncillaries: sql<number>`COUNT(DISTINCT ${bookingAncillaries.bookingId})`,
    })
    .from(bookingAncillaries)
    .innerJoin(bookings, eq(bookingAncillaries.bookingId, bookings.id))
    .where(fundedAncillaryCondition(period));

  const attachmentRate =
    bookingStats.totalBookings > 0
      ? (attachmentStats.bookingsWithAncillaries / bookingStats.totalBookings) *
        100
      : 0;

  const avgRevenuePerBooking =
    bookingStats.totalBookings > 0
      ? ancillaryStats.totalRevenue / bookingStats.totalBookings
      : 0;

  return {
    totalAncillaryRevenue: Number(ancillaryStats.totalRevenue || 0),
    ancillaryAttachmentRate: Math.round(attachmentRate * 10) / 10,
    averageAncillaryRevenuePerBooking: Math.round(avgRevenuePerBooking),
    totalAncillariesSold: Number(ancillaryStats.totalQuantity || 0),
  };
}

/**
 * Get ancillary revenue breakdown by category
 */
export async function getAncillaryRevenueByCategory(
  period: AnalyticsPeriod = {}
): Promise<AncillaryRevenueByCategory[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const categoryRevenue = await db
    .select({
      category: ancillaryServices.category,
      revenue: sql<number>`SUM(${bookingAncillaries.totalPrice})`,
      quantity: sql<number>`SUM(${bookingAncillaries.quantity})`,
    })
    .from(bookingAncillaries)
    .innerJoin(bookings, eq(bookingAncillaries.bookingId, bookings.id))
    .innerJoin(
      ancillaryServices,
      eq(bookingAncillaries.ancillaryServiceId, ancillaryServices.id)
    )
    .where(fundedAncillaryCondition(period))
    .groupBy(ancillaryServices.category)
    .orderBy(desc(sql`SUM(${bookingAncillaries.totalPrice})`));

  const totalRevenue = categoryRevenue.reduce(
    (sum, row) => sum + Number(row.revenue || 0),
    0
  );

  return categoryRevenue.map(row => ({
    category: row.category,
    revenue: Number(row.revenue || 0),
    quantity: Number(row.quantity || 0),
    percentage:
      totalRevenue > 0
        ? Math.round(((row.revenue || 0) / totalRevenue) * 100 * 10) / 10
        : 0,
  }));
}

/**
 * Get most popular ancillary services
 */
export async function getPopularAncillaries(
  limit: number = 10,
  period: AnalyticsPeriod = {}
): Promise<PopularAncillary[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const popularServices = await db
    .select({
      serviceName: ancillaryServices.name,
      category: ancillaryServices.category,
      totalSold: sql<number>`SUM(${bookingAncillaries.quantity})`,
      revenue: sql<number>`SUM(${bookingAncillaries.totalPrice})`,
    })
    .from(bookingAncillaries)
    .innerJoin(bookings, eq(bookingAncillaries.bookingId, bookings.id))
    .innerJoin(
      ancillaryServices,
      eq(bookingAncillaries.ancillaryServiceId, ancillaryServices.id)
    )
    .where(fundedAncillaryCondition(period))
    .groupBy(
      ancillaryServices.id,
      ancillaryServices.name,
      ancillaryServices.category
    )
    .orderBy(desc(sql`SUM(${bookingAncillaries.quantity})`))
    .limit(limit);

  return popularServices.map(row => ({
    serviceName: row.serviceName,
    category: row.category,
    totalSold: Number(row.totalSold || 0),
    revenue: Number(row.revenue || 0),
  }));
}
