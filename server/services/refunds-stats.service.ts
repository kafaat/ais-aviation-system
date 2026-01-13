import { getDb } from "../db";
import { bookings, payments } from "../../drizzle/schema";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * Refunds Statistics Service
 * Provides analytics and statistics for refunds
 */

export interface RefundStats {
  totalRefunds: number;
  totalRefundedAmount: number;
  pendingRefunds: number;
  completedRefunds: number;
  refundRate: number; // percentage of bookings that were refunded
}

export interface RefundHistoryItem {
  id: number;
  bookingId: number;
  bookingReference: string;
  pnr: string;
  userId: number;
  amount: number;
  status: string;
  refundedAt: Date;
  flightNumber?: string;
  origin?: string;
  destination?: string;
}

/**
 * Get overall refund statistics
 */
export async function getRefundStats(): Promise<RefundStats> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get total refunded bookings
    const refundedBookings = await database
      .select({
        count: sql<number>`COUNT(*)`,
        totalAmount: sql<number>`SUM(${bookings.totalAmount})`,
      })
      .from(bookings)
      .where(eq(bookings.paymentStatus, "refunded"));

    // Get total bookings for refund rate calculation
    const totalBookings = await database
      .select({ count: sql<number>`COUNT(*)` })
      .from(bookings);

    const totalRefunds = Number(refundedBookings[0]?.count || 0);
    const totalRefundedAmount = Number(refundedBookings[0]?.totalAmount || 0);
    const totalCount = Number(totalBookings[0]?.count || 1); // Avoid division by zero

    return {
      totalRefunds,
      totalRefundedAmount,
      pendingRefunds: 0, // We don't have pending refunds in current implementation
      completedRefunds: totalRefunds,
      refundRate: (totalRefunds / totalCount) * 100,
    };
  } catch (error) {
    console.error("Error getting refund stats:", error);
    return {
      totalRefunds: 0,
      totalRefundedAmount: 0,
      pendingRefunds: 0,
      completedRefunds: 0,
      refundRate: 0,
    };
  }
}

/**
 * Get refund history with pagination
 */
export async function getRefundHistory(params: {
  limit?: number;
  offset?: number;
}): Promise<RefundHistoryItem[]> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const { limit = 50, offset = 0 } = params;

    const refunds = await database
      .select({
        id: bookings.id,
        bookingId: bookings.id,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        userId: bookings.userId,
        amount: bookings.totalAmount,
        status: bookings.paymentStatus,
        refundedAt: bookings.updatedAt,
      })
      .from(bookings)
      .where(eq(bookings.paymentStatus, "refunded"))
      .orderBy(sql`${bookings.updatedAt} DESC`)
      .limit(limit)
      .offset(offset);

    return refunds.map(refund => ({
      id: refund.id,
      bookingId: refund.bookingId,
      bookingReference: refund.bookingReference,
      pnr: refund.pnr,
      userId: refund.userId,
      amount: refund.amount,
      status: refund.status,
      refundedAt: refund.refundedAt,
    }));
  } catch (error) {
    console.error("Error getting refund history:", error);
    return [];
  }
}

/**
 * Get refund trends (daily refunds for the last 30 days)
 */
export async function getRefundTrends(): Promise<
  Array<{ date: string; count: number; amount: number }>
> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trends = await database
      .select({
        date: sql<string>`DATE(${bookings.updatedAt})`,
        count: sql<number>`COUNT(*)`,
        amount: sql<number>`SUM(${bookings.totalAmount})`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.paymentStatus, "refunded"),
          gte(bookings.updatedAt, thirtyDaysAgo)
        )
      )
      .groupBy(sql`DATE(${bookings.updatedAt})`)
      .orderBy(sql`DATE(${bookings.updatedAt}) ASC`);

    return trends.map(trend => ({
      date: trend.date,
      count: Number(trend.count),
      amount: Number(trend.amount),
    }));
  } catch (error) {
    console.error("Error getting refund trends:", error);
    return [];
  }
}
