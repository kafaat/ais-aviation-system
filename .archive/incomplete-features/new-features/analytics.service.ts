import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  analyticsEvents,
  dailyMetrics,
  popularRoutes,
  type InsertAnalyticsEvent,
  type InsertDailyMetric,
} from "../../drizzle/schema-analytics";
import { bookings, payments, users, flights } from "../../drizzle/schema";

/**
 * Analytics Service
 * Handles analytics tracking and dashboard data
 */

/**
 * Track an analytics event
 */
export async function trackEvent(data: {
  eventType: string;
  eventCategory: string;
  userId?: number;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  pageUrl?: string;
  referrer?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const event: InsertAnalyticsEvent = {
    eventType: data.eventType,
    eventCategory: data.eventCategory,
    userId: data.userId,
    sessionId: data.sessionId,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    pageUrl: data.pageUrl,
    referrer: data.referrer,
  };

  await db.insert(analyticsEvents).values(event);
}

/**
 * Get dashboard overview metrics
 */
export async function getDashboardOverview(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get aggregated metrics from daily_metrics table
  const metrics = await db
    .select({
      totalBookings: sql<number>`SUM(${dailyMetrics.totalBookings})`,
      confirmedBookings: sql<number>`SUM(${dailyMetrics.confirmedBookings})`,
      cancelledBookings: sql<number>`SUM(${dailyMetrics.cancelledBookings})`,
      totalRevenue: sql<number>`SUM(${dailyMetrics.totalRevenue})`,
      confirmedRevenue: sql<number>`SUM(${dailyMetrics.confirmedRevenue})`,
      refundedAmount: sql<number>`SUM(${dailyMetrics.refundedAmount})`,
      newUsers: sql<number>`SUM(${dailyMetrics.newUsers})`,
      activeUsers: sql<number>`SUM(${dailyMetrics.activeUsers})`,
      totalFlights: sql<number>`SUM(${dailyMetrics.totalFlights})`,
      totalSeatsBooked: sql<number>`SUM(${dailyMetrics.totalSeatsBooked})`,
    })
    .from(dailyMetrics)
    .where(
      and(
        gte(dailyMetrics.date, startDate.toISOString().split('T')[0]),
        lte(dailyMetrics.date, endDate.toISOString().split('T')[0])
      )
    );

  return metrics[0] || {
    totalBookings: 0,
    confirmedBookings: 0,
    cancelledBookings: 0,
    totalRevenue: 0,
    confirmedRevenue: 0,
    refundedAmount: 0,
    newUsers: 0,
    activeUsers: 0,
    totalFlights: 0,
    totalSeatsBooked: 0,
  };
}

/**
 * Get daily metrics for a date range
 */
export async function getDailyMetrics(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const metrics = await db
    .select()
    .from(dailyMetrics)
    .where(
      and(
        gte(dailyMetrics.date, startDate.toISOString().split('T')[0]),
        lte(dailyMetrics.date, endDate.toISOString().split('T')[0])
      )
    )
    .orderBy(dailyMetrics.date);

  return metrics;
}

/**
 * Get popular routes
 */
export async function getPopularRoutes(limit: number = 10) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const routes = await db
    .select()
    .from(popularRoutes)
    .orderBy(desc(popularRoutes.bookingCount))
    .limit(limit);

  return routes;
}

/**
 * Get booking trends (daily bookings over time)
 */
export async function getBookingTrends(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const trends = await db
    .select({
      date: dailyMetrics.date,
      totalBookings: dailyMetrics.totalBookings,
      confirmedBookings: dailyMetrics.confirmedBookings,
      cancelledBookings: dailyMetrics.cancelledBookings,
    })
    .from(dailyMetrics)
    .where(
      and(
        gte(dailyMetrics.date, startDate.toISOString().split('T')[0]),
        lte(dailyMetrics.date, endDate.toISOString().split('T')[0])
      )
    )
    .orderBy(dailyMetrics.date);

  return trends;
}

/**
 * Get revenue trends (daily revenue over time)
 */
export async function getRevenueTrends(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const trends = await db
    .select({
      date: dailyMetrics.date,
      totalRevenue: dailyMetrics.totalRevenue,
      confirmedRevenue: dailyMetrics.confirmedRevenue,
      refundedAmount: dailyMetrics.refundedAmount,
    })
    .from(dailyMetrics)
    .where(
      and(
        gte(dailyMetrics.date, startDate.toISOString().split('T')[0]),
        lte(dailyMetrics.date, endDate.toISOString().split('T')[0])
      )
    )
    .orderBy(dailyMetrics.date);

  return trends;
}

/**
 * Get user growth trends
 */
export async function getUserGrowthTrends(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const trends = await db
    .select({
      date: dailyMetrics.date,
      newUsers: dailyMetrics.newUsers,
      activeUsers: dailyMetrics.activeUsers,
    })
    .from(dailyMetrics)
    .where(
      and(
        gte(dailyMetrics.date, startDate.toISOString().split('T')[0]),
        lte(dailyMetrics.date, endDate.toISOString().split('T')[0])
      )
    )
    .orderBy(dailyMetrics.date);

  return trends;
}

/**
 * Calculate and store daily metrics (run this daily via cron)
 */
export async function calculateDailyMetrics(date: Date): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const dateStr = date.toISOString().split('T')[0];
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];

  // Count bookings
  const bookingStats = await db
    .select({
      total: sql<number>`COUNT(*)`,
      confirmed: sql<number>`SUM(CASE WHEN ${bookings.status} = 'confirmed' THEN 1 ELSE 0 END)`,
      cancelled: sql<number>`SUM(CASE WHEN ${bookings.status} = 'cancelled' THEN 1 ELSE 0 END)`,
    })
    .from(bookings)
    .where(
      and(
        gte(bookings.createdAt, new Date(dateStr)),
        lte(bookings.createdAt, new Date(nextDayStr))
      )
    );

  // Calculate revenue
  const revenueStats = await db
    .select({
      totalRevenue: sql<number>`SUM(${payments.amount})`,
      confirmedRevenue: sql<number>`SUM(CASE WHEN ${payments.status} = 'succeeded' THEN ${payments.amount} ELSE 0 END)`,
      refunded: sql<number>`SUM(CASE WHEN ${payments.status} = 'refunded' THEN ${payments.amount} ELSE 0 END)`,
    })
    .from(payments)
    .where(
      and(
        gte(payments.createdAt, new Date(dateStr)),
        lte(payments.createdAt, new Date(nextDayStr))
      )
    );

  // Count new users
  const userStats = await db
    .select({
      newUsers: sql<number>`COUNT(*)`,
    })
    .from(users)
    .where(
      and(
        gte(users.createdAt, new Date(dateStr)),
        lte(users.createdAt, new Date(nextDayStr))
      )
    );

  // Insert or update daily metrics
  const metrics: InsertDailyMetric = {
    date: dateStr,
    totalBookings: bookingStats[0]?.total || 0,
    confirmedBookings: bookingStats[0]?.confirmed || 0,
    cancelledBookings: bookingStats[0]?.cancelled || 0,
    totalRevenue: revenueStats[0]?.totalRevenue || 0,
    confirmedRevenue: revenueStats[0]?.confirmedRevenue || 0,
    refundedAmount: revenueStats[0]?.refunded || 0,
    newUsers: userStats[0]?.newUsers || 0,
    activeUsers: 0, // This would require session tracking
    totalFlights: 0, // This would require flight tracking
    totalSeatsBooked: 0, // This would require seat tracking
    averageBookingValue: 0, // Calculate if needed
    averagePassengersPerBooking: "0.00", // Calculate if needed
    searchToBookingRate: "0.00", // Calculate if needed
  };

  // Check if metrics already exist for this date
  const existing = await db
    .select()
    .from(dailyMetrics)
    .where(eq(dailyMetrics.date, dateStr))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(dailyMetrics)
      .set(metrics)
      .where(eq(dailyMetrics.id, existing[0].id));
  } else {
    await db.insert(dailyMetrics).values(metrics);
  }
}

/**
 * Get real-time stats (not cached)
 */
export async function getRealTimeStats() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Today's bookings
  const todayBookings = await db
    .select({
      total: sql<number>`COUNT(*)`,
      confirmed: sql<number>`SUM(CASE WHEN ${bookings.status} = 'confirmed' THEN 1 ELSE 0 END)`,
    })
    .from(bookings)
    .where(gte(bookings.createdAt, today));

  // Today's revenue
  const todayRevenue = await db
    .select({
      total: sql<number>`SUM(${payments.amount})`,
    })
    .from(payments)
    .where(
      and(
        gte(payments.createdAt, today),
        eq(payments.status, "succeeded")
      )
    );

  return {
    todayBookings: todayBookings[0]?.total || 0,
    todayConfirmedBookings: todayBookings[0]?.confirmed || 0,
    todayRevenue: todayRevenue[0]?.total || 0,
  };
}
