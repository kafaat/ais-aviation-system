import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  bookings,
  bookingRefundItems,
  bookingRefundPlans,
  financialLedger,
  flights,
  airports,
  users,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

/** Read owner for SAR booking-refund reporting. Posted ledger deltas and
 * outstanding provider requests are distinct amounts. No provider calls. */
export interface RefundStats {
  totalRefunds: number;
  totalRefundedAmount: number;
  completedRefunds: number;
  refundedBookings: number;
  pendingRefunds: number;
  pendingRefundAmount: number;
  reviewRequiredRefunds: number;
  reviewRequiredAmount: number;
  retainedCancellationFees: number;
  refundRate: number;
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
export interface RefundReportPeriod {
  startDate?: Date;
  endDate?: Date;
}

function integer(value: unknown): number {
  const n = Number(value);
  if (value == null || !Number.isSafeInteger(n) || n < 0)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Invalid refund reporting value",
    });
  return n;
}
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}
async function reporting<T>(
  read: (db: Awaited<ReturnType<typeof database>>) => Promise<T>
): Promise<T> {
  try {
    return await read(await database());
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const code =
      (error as { cause?: { code?: unknown } })?.cause?.code ??
      (error as { code?: unknown })?.code;
    console.error(
      "[refund-reporting] Query failed",
      typeof code === "string" && /^ER_[A-Z0-9_]+$/.test(code)
        ? code
        : "QUERY_FAILED"
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Refund reporting unavailable",
    });
  }
}
function bounds(period: RefundReportPeriod) {
  for (const value of [period.startDate, period.endDate])
    if (
      value !== undefined &&
      (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid refund report period",
      });
  if (period.startDate && period.endDate && period.startDate > period.endDate)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Refund report start must precede end",
    });
}
function settledWhere(period: RefundReportPeriod = {}) {
  bounds(period);
  return and(
    inArray(financialLedger.type, ["refund", "partial_refund"]),
    eq(financialLedger.currency, "SAR"),
    period.startDate
      ? sql`UNIX_TIMESTAMP(${financialLedger.transactionDate}) >= ${period.startDate.getTime() / 1000}`
      : undefined,
    period.endDate
      ? sql`UNIX_TIMESTAMP(${financialLedger.transactionDate}) <= ${period.endDate.getTime() / 1000}`
      : undefined
  );
}

export async function getRefundStats(): Promise<RefundStats> {
  return await reporting(db =>
    db.transaction(
      async tx => {
        const [settled] = await tx
          .select({
            count: sql<string>`COUNT(*)`,
            bookingCount: sql<string>`COUNT(DISTINCT ${financialLedger.bookingId})`,
            amount: sql<string>`COALESCE(SUM(${financialLedger.amount} * 100), 0)`,
          })
          .from(financialLedger)
          .innerJoin(bookings, eq(bookings.id, financialLedger.bookingId))
          .where(settledWhere());
        const [all] = await tx
          .select({ count: sql<string>`COUNT(*)` })
          .from(bookings);
        const [requests] = await tx
          .select({
            pending: sql<string>`COALESCE(SUM(${bookingRefundItems.status} IN ('queued','requesting','pending')), 0)`,
            pendingAmount: sql<string>`COALESCE(SUM(CASE WHEN ${bookingRefundItems.status} IN ('queued','requesting','pending') THEN ${bookingRefundItems.refundAmount} ELSE 0 END), 0)`,
            review: sql<string>`COALESCE(SUM(${bookingRefundItems.status} IN ('failed','review_required')), 0)`,
            reviewAmount: sql<string>`COALESCE(SUM(CASE WHEN ${bookingRefundItems.status} IN ('failed','review_required') THEN ${bookingRefundItems.refundAmount} ELSE 0 END), 0)`,
          })
          .from(bookingRefundItems);
        const [fees] = await tx
          .select({
            amount: sql<string>`COALESCE(SUM(${bookingRefundPlans.cancellationFee}), 0)`,
          })
          .from(bookingRefundPlans);
        const count = integer(settled.count);
        const bookingCount = integer(settled.bookingCount);
        const allCount = integer(all.count);
        return {
          totalRefunds: count,
          completedRefunds: count,
          totalRefundedAmount: integer(settled.amount),
          refundedBookings: bookingCount,
          pendingRefunds: integer(requests.pending),
          pendingRefundAmount: integer(requests.pendingAmount),
          reviewRequiredRefunds: integer(requests.review),
          reviewRequiredAmount: integer(requests.reviewAmount),
          retainedCancellationFees: integer(fees.amount),
          refundRate: allCount > 0 ? (bookingCount / allCount) * 100 : 0,
        };
      },
      // This Drizzle version joins transaction-start options without commas.
      // REPEATABLE READ establishes the shared snapshot at the first SELECT.
      {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      }
    )
  );
}

/** Shared history/export projection: a row is one posted settlement delta.
 * Date and amount never come from mutable booking status or invoice totals. */
async function settledRows(
  db: SettlementTx,
  period: RefundReportPeriod,
  limit: number,
  offset: number
) {
  const predicate = settledWhere(period);
  const rows = await db
    .select({
      id: financialLedger.id,
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      userId: bookings.userId,
      userEmail: users.email,
      amount: sql<string>`${financialLedger.amount} * 100`,
      refundedAtEpoch: sql<string>`UNIX_TIMESTAMP(${financialLedger.transactionDate})`,
      flightNumber: flights.flightNumber,
      origin: sql<string>`origin_airport.city`,
      destination: sql<string>`dest_airport.city`,
    })
    .from(financialLedger)
    .innerJoin(bookings, eq(bookings.id, financialLedger.bookingId))
    .leftJoin(users, eq(users.id, bookings.userId))
    .leftJoin(flights, eq(flights.id, bookings.flightId))
    .leftJoin(
      sql`${airports} AS origin_airport`,
      sql`origin_airport.id = ${flights.originId}`
    )
    .leftJoin(
      sql`${airports} AS dest_airport`,
      sql`dest_airport.id = ${flights.destinationId}`
    )
    .where(predicate)
    .orderBy(desc(financialLedger.transactionDate), desc(financialLedger.id))
    .limit(limit)
    .offset(offset);
  return rows.map(({ refundedAtEpoch, ...row }) => ({
    ...row,
    refundedAt: new Date(integer(refundedAtEpoch) * 1000),
    amount: integer(row.amount),
    status: "settled" as const,
    userEmail: row.userEmail ?? "",
    flightNumber: row.flightNumber ?? "",
    origin: row.origin ?? "",
    destination: row.destination ?? "",
  }));
}
export async function getRefundHistory(params: {
  limit?: number;
  offset?: number;
}): Promise<RefundHistoryItem[]> {
  const { limit = 50, offset = 0 } = params;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 1_000_000
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid refund history page",
    });
  return await reporting(db => settledRows(db, {}, limit, offset));
}
export async function getRefundExportRows(period: RefundReportPeriod) {
  bounds(period);
  const rows = await reporting(db => settledRows(db, period, 10001, 0));
  if (rows.length > 10000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Refund export exceeds 10000 settlements; narrow the date range",
    });
  return rows;
}
export async function getRefundTrends(): Promise<
  Array<{ date: string; count: number; amount: number }>
> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 29);
  startDate.setUTCHours(0, 0, 0, 0);
  return await reporting(async db => {
    const rows = await db
      .select({
        day: sql<string>`FLOOR(UNIX_TIMESTAMP(${financialLedger.transactionDate}) / 86400)`,
        count: sql<string>`COUNT(*)`,
        amount: sql<string>`COALESCE(SUM(${financialLedger.amount} * 100), 0)`,
      })
      .from(financialLedger)
      .innerJoin(bookings, eq(bookings.id, financialLedger.bookingId))
      .where(settledWhere({ startDate, endDate }))
      .groupBy(
        sql`FLOOR(UNIX_TIMESTAMP(${financialLedger.transactionDate}) / 86400)`
      )
      .orderBy(
        sql`FLOOR(UNIX_TIMESTAMP(${financialLedger.transactionDate}) / 86400) ASC`
      );
    return rows.map(row => ({
      date: new Date(integer(row.day) * 86400_000).toISOString().slice(0, 10),
      count: integer(row.count),
      amount: integer(row.amount),
    }));
  });
}
