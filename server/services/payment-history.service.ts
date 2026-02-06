import { getDb } from "../db";
import { payments, bookings, flights, airports } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte, count, sum, SQL } from "drizzle-orm";

export interface PaymentHistoryFilters {
  userId?: number;
  status?: string;
  method?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Get payment history for a user with booking/flight details
 */
export async function getUserPaymentHistory(
  userId: number,
  filters: PaymentHistoryFilters = {}
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions: SQL[] = [eq(bookings.userId, userId)];

  if (filters.status) {
    conditions.push(
      eq(
        payments.status,
        filters.status as "pending" | "completed" | "failed" | "refunded"
      )
    );
  }
  if (filters.method) {
    conditions.push(
      eq(payments.method, filters.method as "card" | "wallet" | "bank_transfer")
    );
  }
  if (filters.dateFrom) {
    conditions.push(gte(payments.createdAt, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(payments.createdAt, filters.dateTo));
  }

  const result = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      currency: payments.currency,
      method: payments.method,
      status: payments.status,
      transactionId: payments.transactionId,
      createdAt: payments.createdAt,
      bookingId: payments.bookingId,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      cabinClass: bookings.cabinClass,
      flightNumber: flights.flightNumber,
      origin: airports.code,
      destination: sql<string>`dest.code`,
      departureTime: flights.departureTime,
    })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(and(...conditions))
    .orderBy(desc(payments.createdAt))
    .limit(filters.limit || 50)
    .offset(filters.offset || 0);

  return result;
}

/**
 * Get payment summary statistics for a user
 */
export async function getUserPaymentStats(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [stats] = await db
    .select({
      totalPayments: count(),
      totalAmount: sum(payments.amount),
      completedCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'completed' THEN 1 ELSE 0 END)`,
      completedAmount: sql<number>`SUM(CASE WHEN ${payments.status} = 'completed' THEN ${payments.amount} ELSE 0 END)`,
      refundedCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'refunded' THEN 1 ELSE 0 END)`,
      refundedAmount: sql<number>`SUM(CASE WHEN ${payments.status} = 'refunded' THEN ${payments.amount} ELSE 0 END)`,
      pendingCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'pending' THEN 1 ELSE 0 END)`,
      failedCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .where(eq(bookings.userId, userId));

  return {
    totalPayments: Number(stats.totalPayments) || 0,
    totalAmount: Number(stats.totalAmount) || 0,
    completedCount: Number(stats.completedCount) || 0,
    completedAmount: Number(stats.completedAmount) || 0,
    refundedCount: Number(stats.refundedCount) || 0,
    refundedAmount: Number(stats.refundedAmount) || 0,
    pendingCount: Number(stats.pendingCount) || 0,
    failedCount: Number(stats.failedCount) || 0,
  };
}

/**
 * Get all payment history for admin
 */
export async function getAdminPaymentHistory(
  filters: PaymentHistoryFilters = {}
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions: SQL[] = [];

  if (filters.status) {
    conditions.push(
      eq(
        payments.status,
        filters.status as "pending" | "completed" | "failed" | "refunded"
      )
    );
  }
  if (filters.method) {
    conditions.push(
      eq(payments.method, filters.method as "card" | "wallet" | "bank_transfer")
    );
  }
  if (filters.dateFrom) {
    conditions.push(gte(payments.createdAt, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(payments.createdAt, filters.dateTo));
  }

  const result = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      currency: payments.currency,
      method: payments.method,
      status: payments.status,
      transactionId: payments.transactionId,
      createdAt: payments.createdAt,
      bookingId: payments.bookingId,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      cabinClass: bookings.cabinClass,
      numberOfPassengers: bookings.numberOfPassengers,
      flightNumber: flights.flightNumber,
      origin: airports.code,
      destination: sql<string>`dest.code`,
      departureTime: flights.departureTime,
    })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(filters.limit || 100)
    .offset(filters.offset || 0);

  return result;
}

/**
 * Get admin payment statistics
 */
export async function getAdminPaymentStats() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [stats] = await db
    .select({
      totalPayments: count(),
      totalAmount: sum(payments.amount),
      completedCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'completed' THEN 1 ELSE 0 END)`,
      completedAmount: sql<number>`SUM(CASE WHEN ${payments.status} = 'completed' THEN ${payments.amount} ELSE 0 END)`,
      refundedCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'refunded' THEN 1 ELSE 0 END)`,
      refundedAmount: sql<number>`SUM(CASE WHEN ${payments.status} = 'refunded' THEN ${payments.amount} ELSE 0 END)`,
      pendingCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'pending' THEN 1 ELSE 0 END)`,
      failedCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(payments);

  // Get today's stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayStats] = await db
    .select({
      todayPayments: count(),
      todayAmount: sum(payments.amount),
    })
    .from(payments)
    .where(
      and(gte(payments.createdAt, today), eq(payments.status, "completed"))
    );

  return {
    totalPayments: Number(stats.totalPayments) || 0,
    totalAmount: Number(stats.totalAmount) || 0,
    completedCount: Number(stats.completedCount) || 0,
    completedAmount: Number(stats.completedAmount) || 0,
    refundedCount: Number(stats.refundedCount) || 0,
    refundedAmount: Number(stats.refundedAmount) || 0,
    pendingCount: Number(stats.pendingCount) || 0,
    failedCount: Number(stats.failedCount) || 0,
    todayPayments: Number(todayStats.todayPayments) || 0,
    todayAmount: Number(todayStats.todayAmount) || 0,
  };
}
