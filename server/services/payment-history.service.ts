import { getDb } from "../db";
import {
  payments,
  bookings,
  flights,
  airports,
  financialLedger,
} from "../../drizzle/schema";
import {
  eq,
  desc,
  and,
  sql,
  gte,
  lte,
  count,
  sum,
  SQL,
  inArray,
} from "drizzle-orm";

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
function purchaserCondition(userId: number, tenantId?: number | null) {
  return and(
    eq(bookings.userId, userId),
    tenantId == null ? undefined : eq(bookings.tenantId, tenantId)
  );
}

export async function getUserPaymentHistory(
  userId: number,
  filters: PaymentHistoryFilters = {},
  tenantId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions: Array<SQL | undefined> = [
    purchaserCondition(userId, tenantId),
  ];

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
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(filters.limit || 50)
    .offset(filters.offset || 0);

  return result;
}

/**
 * Get payment summary statistics for a user
 */
// History is owned by the booking purchaser, including split contributions.
// Refunded value is posted cash movement, not a mutable payment status; a
// partially refunded payment deliberately remains completed.
async function settledRefundAmount(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId?: number,
  tenantId?: number | null
) {
  const [row] = await db
    .select({
      amount: sql<string>`COALESCE(SUM(${financialLedger.amount} * 100), 0)`,
    })
    .from(financialLedger)
    .innerJoin(bookings, eq(bookings.id, financialLedger.bookingId))
    .where(
      and(
        inArray(financialLedger.type, ["refund", "partial_refund"]),
        eq(financialLedger.currency, "SAR"),
        userId === undefined ? undefined : purchaserCondition(userId, tenantId)
      )
    );
  const amount = Number(row.amount);
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error("Invalid settled refund total");
  return amount;
}

export async function getUserPaymentStats(
  userId: number,
  tenantId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [stats] = await db
    .select({
      totalPayments: count(),
      totalAmount: sum(payments.amount),
      completedCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'completed' THEN 1 ELSE 0 END)`,
      completedAmount: sql<number>`SUM(CASE WHEN ${payments.status} = 'completed' THEN ${payments.amount} ELSE 0 END)`,
      refundedCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'refunded' THEN 1 ELSE 0 END)`,
      pendingCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'pending' THEN 1 ELSE 0 END)`,
      failedCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .where(purchaserCondition(userId, tenantId));

  return {
    totalPayments: Number(stats.totalPayments) || 0,
    totalAmount: Number(stats.totalAmount) || 0,
    completedCount: Number(stats.completedCount) || 0,
    completedAmount: Number(stats.completedAmount) || 0,
    refundedCount: Number(stats.refundedCount) || 0,
    refundedAmount: await settledRefundAmount(db, userId, tenantId),
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
    .orderBy(desc(payments.createdAt), desc(payments.id))
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
    refundedAmount: await settledRefundAmount(db),
    pendingCount: Number(stats.pendingCount) || 0,
    failedCount: Number(stats.failedCount) || 0,
    todayPayments: Number(todayStats.todayPayments) || 0,
    todayAmount: Number(todayStats.todayAmount) || 0,
  };
}
