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
    throw new Error("Database not available");
  }

  const { bookingAncillaries, ancillaryServices } = await import("../../drizzle/schema");

  const dateFilter = startDate && endDate
    ? and(
        gte(bookingAncillaries.createdAt, startDate),
        lte(bookingAncillaries.createdAt, endDate)
      )
    : undefined;

  // Total ancillary revenue and quantity
  const [ancillaryStats] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${bookingAncillaries.totalPrice}), 0)`,
      totalQuantity: sql<number>`COALESCE(SUM(${bookingAncillaries.quantity}), 0)`,
      totalAncillaries: sql<number>`COUNT(*)`,
    })
    .from(bookingAncillaries)
    .where(dateFilter);

  // Total bookings in the same period
  const bookingDateFilter = startDate && endDate
    ? and(
        gte(bookings.createdAt, startDate),
        lte(bookings.createdAt, endDate)
      )
    : undefined;

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
    .where(dateFilter);

  const attachmentRate = bookingStats.totalBookings > 0
    ? (attachmentStats.bookingsWithAncillaries / bookingStats.totalBookings) * 100
    : 0;

  const avgRevenuePerBooking = bookingStats.totalBookings > 0
    ? ancillaryStats.totalRevenue / bookingStats.totalBookings
    : 0;

  return {
    totalAncillaryRevenue: ancillaryStats.totalRevenue || 0,
    ancillaryAttachmentRate: Math.round(attachmentRate * 10) / 10,
    averageAncillaryRevenuePerBooking: Math.round(avgRevenuePerBooking),
    totalAncillariesSold: ancillaryStats.totalQuantity || 0,
  };
}

/**
 * Get ancillary revenue breakdown by category
 */
export async function getAncillaryRevenueByCategory(): Promise<AncillaryRevenueByCategory[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { bookingAncillaries, ancillaryServices } = await import("../../drizzle/schema");

  const categoryRevenue = await db
    .select({
      category: ancillaryServices.category,
      revenue: sql<number>`SUM(${bookingAncillaries.totalPrice})`,
      quantity: sql<number>`SUM(${bookingAncillaries.quantity})`,
    })
    .from(bookingAncillaries)
    .innerJoin(ancillaryServices, eq(bookingAncillaries.ancillaryServiceId, ancillaryServices.id))
    .groupBy(ancillaryServices.category)
    .orderBy(desc(sql`SUM(${bookingAncillaries.totalPrice})`));

  const totalRevenue = categoryRevenue.reduce((sum, row) => sum + (row.revenue || 0), 0);

  return categoryRevenue.map((row) => ({
    category: row.category,
    revenue: row.revenue || 0,
    quantity: row.quantity || 0,
    percentage: totalRevenue > 0 ? Math.round(((row.revenue || 0) / totalRevenue) * 100 * 10) / 10 : 0,
  }));
}

/**
 * Get most popular ancillary services
 */
export async function getPopularAncillaries(limit: number = 10): Promise<PopularAncillary[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { bookingAncillaries, ancillaryServices } = await import("../../drizzle/schema");

  const popularServices = await db
    .select({
      serviceName: ancillaryServices.name,
      category: ancillaryServices.category,
      totalSold: sql<number>`SUM(${bookingAncillaries.quantity})`,
      revenue: sql<number>`SUM(${bookingAncillaries.totalPrice})`,
    })
    .from(bookingAncillaries)
    .innerJoin(ancillaryServices, eq(bookingAncillaries.ancillaryServiceId, ancillaryServices.id))
    .groupBy(ancillaryServices.id, ancillaryServices.name, ancillaryServices.category)
    .orderBy(desc(sql`SUM(${bookingAncillaries.quantity})`))
    .limit(limit);

  return popularServices.map((row) => ({
    serviceName: row.serviceName,
    category: row.category,
    totalSold: row.totalSold || 0,
    revenue: row.revenue || 0,
  }));
}
