import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { bookings, flights, airports, airlines } from "../../drizzle/schema";
import { eq, gte, count, sum, desc, sql } from "drizzle-orm";

/**
 * Analytics Router
 * Handles all analytics and reporting operations
 */
export const analyticsRouter = router({
  /**
   * Get overview statistics
   */
  overview: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Total bookings
    const totalBookingsResult = await database
      .select({ count: count() })
      .from(bookings);
    const totalBookings = totalBookingsResult[0]?.count || 0;

    // Total revenue (only paid bookings)
    const revenueResult = await database
      .select({ total: sum(bookings.totalAmount) })
      .from(bookings)
      .where(eq(bookings.paymentStatus, "paid"));
    const totalRevenue = Number(revenueResult[0]?.total || 0);

    // Today's bookings
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayBookingsResult = await database
      .select({ count: count() })
      .from(bookings)
      .where(gte(bookings.createdAt, today));
    const todayBookings = todayBookingsResult[0]?.count || 0;

    // Average booking value
    const avgBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

    return {
      totalBookings,
      totalRevenue,
      todayBookings,
      avgBookingValue,
    };
  }),

  /**
   * Get daily bookings for the last 30 days
   */
  dailyBookings: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);
    const formattedDate = last30Days.toISOString().split("T")[0];

    const result = await database.execute(
      sql`
        SELECT 
          DATE(createdAt) as date,
          COUNT(*) as count,
          SUM(totalAmount) as revenue
        FROM bookings
        WHERE createdAt >= ${formattedDate}
        GROUP BY DATE(createdAt)
        ORDER BY DATE(createdAt)
      `
    );

    const rows = (result as any)[0] as any[];
    return rows.map((r: any) => ({
      date: r.date,
      bookings: Number(r.count),
      revenue: Number(r.revenue || 0) / 100,
    }));
  }),

  /**
   * Get top destinations
   */
  topDestinations: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const result = await database
      .select({
        destination: airports.city,
        code: airports.code,
        count: count(),
      })
      .from(bookings)
      .innerJoin(flights, eq(bookings.flightId, flights.id))
      .innerJoin(airports, eq(flights.destinationId, airports.id))
      .groupBy(airports.id, airports.city, airports.code)
      .orderBy(desc(count()))
      .limit(10);

    return result;
  }),

  /**
   * Get airline performance
   */
  airlinePerformance: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const result = await database
      .select({
        airline: airlines.name,
        bookings: count(),
        revenue: sum(bookings.totalAmount),
      })
      .from(bookings)
      .innerJoin(flights, eq(bookings.flightId, flights.id))
      .innerJoin(airlines, eq(flights.airlineId, airlines.id))
      .where(eq(bookings.paymentStatus, "paid"))
      .groupBy(airlines.id, airlines.name)
      .orderBy(desc(count()));

    return result.map((r) => ({
      airline: r.airline,
      bookings: r.bookings,
      revenue: Number(r.revenue || 0) / 100,
    }));
  }),
});
