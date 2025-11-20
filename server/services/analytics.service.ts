/**
 * Analytics Service
 * Provides business intelligence and KPIs for admin dashboard
 */

import { getDb } from "../db";
import { bookings, flights, passengers, airports } from "../../drizzle/schema";
import { sql, and, gte, lte, eq, desc } from "drizzle-orm";

export interface KPIMetrics {
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
    throw new Error("Database not available");
  }

  const dateFilter = startDate && endDate
    ? and(
        gte(bookings.createdAt, startDate),
        lte(bookings.createdAt, endDate)
      )
    : undefined;

  // Total bookings and revenue
  const [bookingStats] = await db
    .select({
      totalBookings: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`SUM(${bookings.totalAmount})`,
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

  const cancellationRate = cancellationStats.totalBookings > 0
    ? (cancellationStats.cancelledBookings / cancellationStats.totalBookings) * 100
    : 0;

  // Average occupancy rate (simplified - across all flights with bookings)
  const [occupancyStats] = await db
    .select({
      totalSeats: sql<number>`SUM(${flights.economySeats} + ${flights.businessSeats})`,
      bookedSeats: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(
      and(
        dateFilter,
        sql`${bookings.status} != 'cancelled'`
      )
    );

  const averageOccupancyRate = occupancyStats.totalSeats > 0
    ? (occupancyStats.bookedSeats / occupancyStats.totalSeats) * 100
    : 0;

  return {
    totalBookings: bookingStats.totalBookings || 0,
    totalRevenue: bookingStats.totalRevenue || 0,
    averageOccupancyRate: Math.round(averageOccupancyRate * 10) / 10,
    cancellationRate: Math.round(cancellationRate * 10) / 10,
    totalPassengers: bookingStats.totalPassengers || 0,
  };
}

/**
 * Get revenue data over time (daily)
 */
export async function getRevenueOverTime(
  days: number = 30
): Promise<RevenueDataPoint[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const revenueData = await db
    .select({
      date: sql<string>`DATE(${bookings.createdAt})`,
      revenue: sql<number>`SUM(${bookings.totalAmount})`,
      bookings: sql<number>`COUNT(*)`,
    })
    .from(bookings)
    .where(
      and(
        gte(bookings.createdAt, startDate),
        sql`${bookings.status} = 'confirmed'`
      )
    )
    .groupBy(sql`DATE(${bookings.createdAt})`)
    .orderBy(sql`DATE(${bookings.createdAt})`);

  return revenueData.map((row) => ({
    date: row.date,
    revenue: row.revenue || 0,
    bookings: row.bookings || 0,
  }));
}

/**
 * Get most popular destinations
 */
export async function getPopularDestinations(
  limit: number = 10
): Promise<PopularDestination[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
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
    .where(sql`${bookings.status} != 'cancelled'`)
    .groupBy(airports.id, airports.code, airports.name, airports.city)
    .orderBy(desc(sql`COUNT(${bookings.id})`))
    .limit(limit);

  return popularDests.map((row) => ({
    airportCode: row.airportCode,
    airportName: row.airportName,
    city: row.city,
    bookingCount: row.bookingCount || 0,
    revenue: row.revenue || 0,
  }));
}

/**
 * Get booking trends over time
 */
export async function getBookingTrends(
  days: number = 30
): Promise<BookingTrend[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const trends = await db
    .select({
      date: sql<string>`DATE(${bookings.createdAt})`,
      bookings: sql<number>`COUNT(*)`,
      passengers: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(bookings)
    .where(gte(bookings.createdAt, startDate))
    .groupBy(sql`DATE(${bookings.createdAt})`)
    .orderBy(sql`DATE(${bookings.createdAt})`);

  return trends.map((row) => ({
    date: row.date,
    bookings: row.bookings || 0,
    passengers: row.passengers || 0,
  }));
}

/**
 * Get flight occupancy details
 */
export async function getFlightOccupancyDetails() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const occupancyDetails = await db
    .select({
      flightId: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      totalSeats: sql<number>`${flights.economySeats} + ${flights.businessSeats}`,
      bookedSeats: sql<number>`COALESCE(SUM(${bookings.numberOfPassengers}), 0)`,
      occupancyRate: sql<number>`ROUND((COALESCE(SUM(${bookings.numberOfPassengers}), 0) / (${flights.economySeats} + ${flights.businessSeats})) * 100, 1)`,
    })
    .from(flights)
    .leftJoin(
      bookings,
      and(
        eq(bookings.flightId, flights.id),
        sql`${bookings.status} != 'cancelled'`
      )
    )
    .where(gte(flights.departureTime, new Date()))
    .groupBy(flights.id, flights.flightNumber, flights.departureTime, flights.economySeats, flights.businessSeats)
    .orderBy(desc(sql`ROUND((COALESCE(SUM(${bookings.numberOfPassengers}), 0) / (${flights.economySeats} + ${flights.businessSeats})) * 100, 1)`))
    .limit(20);

  return occupancyDetails;
}
