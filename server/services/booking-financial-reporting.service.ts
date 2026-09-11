import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, financialLedger } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

/** Reporting authority for posted booking money. This is neither bank
 * reconciliation nor a revenue-recognition journal. Amounts are SAR minor units. */
export const FINANCIAL_BASIS = {
  schemaVersion: 2,
  basis: "posted_booking_ledger",
  currency: "SAR",
  recognitionStatus: "unavailable",
  periodBasis: "ledger_transaction_date_utc",
} as const;
export interface FinancialPeriod {
  startDate?: Date;
  endDate?: Date;
}
export type FinancialDimension =
  | "total"
  | "day"
  | "month"
  | "route"
  | "class"
  | "channel"
  | "flight"
  | "warehouse";
export interface FinancialGroup {
  date: string;
  originCode: string;
  originCity: string;
  destinationCode: string;
  destinationCity: string;
  airlineCode: string;
  cabinClass: string;
  channel: string;
  flightId: number | null;
  flightNumber: string;
  itineraryType: string;
  collectedAmount: number;
  refundedAmount: number;
  netAmount: number;
  activeBookings: number;
  collectedBookings: number;
  refundedBookings: number;
  collectionEntries: number;
  refundEntries: number;
  passengerCount: number;
  unmatchedCollectionEntries: number;
  reviewCollectionAmount: number;
}
export function financialInteger(value: unknown, signed = false): number {
  const n = Number(value);
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && !/^-?\d+(?:\.0+)?$/.test(value)) ||
    !Number.isSafeInteger(n) ||
    (!signed && n < 0)
  )
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Invalid financial reporting value",
    });
  return n;
}
export function validateFinancialPeriod(period: FinancialPeriod): void {
  for (const value of [period.startDate, period.endDate])
    if (
      value !== undefined &&
      (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid financial report period",
      });
  if (period.startDate && period.endDate && period.startDate > period.endDate)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Financial report start must precede end",
    });
}
function timeFilter(column: SQL, period: FinancialPeriod): SQL {
  validateFinancialPeriod(period);
  return sql`1=1
    ${period.startDate ? sql`AND UNIX_TIMESTAMP(${column}) >= ${period.startDate.getTime() / 1000}` : sql``}
    ${period.endDate ? sql`AND UNIX_TIMESTAMP(${column}) <= ${period.endDate.getTime() / 1000}` : sql``}`;
}
export async function financialSnapshot<T>(
  read: (tx: SettlementTx) => Promise<T>
): Promise<T> {
  try {
    const db = await getDb();
    if (!db)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Financial reporting unavailable",
      });
    return await db.transaction(read, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const code =
      (error as { cause?: { code?: unknown }; code?: unknown })?.cause?.code ??
      (error as { code?: unknown })?.code;
    console.error(
      "[financial-reporting] Query failed",
      typeof code === "string" && /^ER_[A-Z0-9_]+$/.test(code)
        ? code
        : "QUERY_FAILED"
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Financial reporting unavailable",
    });
  }
}
function rows(result: unknown): Record<string, unknown>[] {
  const data = (result as [unknown])[0];
  if (!Array.isArray(data)) throw new Error("Invalid financial query result");
  return data;
}

/** Aggregate before joining any metadata. EXISTS classifies links without
 * multiplying ledger rows. Multi-city money is an itinerary bucket, not a
 * made-up allocation of the entire booking to its first flight/carrier. */
export async function readFinancialGroups(
  tx: SettlementTx,
  period: FinancialPeriod,
  dimension: FinancialDimension
): Promise<FinancialGroup[]> {
  const daily = dimension === "day" || dimension === "warehouse";
  const monthly = dimension === "month";
  const timeKey = daily
    ? sql`FLOOR(UNIX_TIMESTAMP(l.transactionDate) / 86400)`
    : monthly
      ? sql`EXTRACT(YEAR_MONTH FROM TIMESTAMPADD(SECOND, UNIX_TIMESTAMP(l.transactionDate), '1970-01-01 00:00:00'))`
      : sql`0`;
  const keys: Record<FinancialDimension, SQL[]> = {
    total: [],
    day: [sql`timeKey`],
    month: [sql`timeKey`],
    route: [sql`itineraryType`, sql`originCode`, sql`destinationCode`],
    class: [sql`cabinClass`],
    channel: [sql`channel`],
    flight: [sql`itineraryType`, sql`flightId`],
    warehouse: [
      sql`timeKey`,
      sql`itineraryType`,
      sql`originCode`,
      sql`destinationCode`,
      sql`airlineCode`,
      sql`cabinClass`,
      sql`channel`,
    ],
  };
  const group = keys[dimension];
  if (!group)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid financial dimension",
    });
  const route = ["route", "flight", "warehouse"].includes(dimension);
  const column = (name: string, included: boolean) =>
    included ? sql`MAX(${sql.identifier(name)})` : sql`''`;
  const result = await tx.execute(sql`
    WITH provider_collections AS (
      SELECT stripePaymentIntentId, COUNT(*) AS entries FROM financial_ledger
      WHERE type='charge' AND stripePaymentIntentId IS NOT NULL GROUP BY stripePaymentIntentId
    ), wallet_collections AS (
      SELECT bookingId, COUNT(*) AS entries FROM financial_ledger
      WHERE type='charge' AND stripePaymentIntentId IS NULL AND description='Wallet booking settlement'
      GROUP BY bookingId
    ), money AS (
      SELECT l.bookingId, ${timeKey} AS timeKey,
        SUM(CASE WHEN l.type = 'charge' THEN l.amount * 100 ELSE 0 END) AS collectedAmount,
        SUM(CASE WHEN l.type IN ('refund','partial_refund') THEN l.amount * 100 ELSE 0 END) AS refundedAmount,
        SUM(l.type = 'charge') AS collectionEntries,
        SUM(l.type IN ('refund','partial_refund')) AS refundEntries,
        SUM(l.amount <= 0) AS invalidAmounts,
        SUM(CASE WHEN l.type = 'charge' AND NOT (
          (l.stripePaymentIntentId IS NOT NULL AND EXISTS (
            SELECT 1 FROM payment_receipts r WHERE r.paymentIntentId = l.stripePaymentIntentId
              AND r.bookingId = l.bookingId AND r.userId = l.userId AND r.currency = 'SAR' AND r.amount = l.amount * 100
              AND r.kind IN ('booking','split_payment','modification')
              AND pc.entries=1
          )) OR (l.stripePaymentIntentId IS NULL AND l.description = 'Wallet booking settlement' AND EXISTS (
            SELECT 1 FROM wallet_transactions w WHERE w.bookingId = l.bookingId
              AND w.userId = l.userId AND w.type = 'payment' AND w.status = 'completed' AND w.amount = -l.amount * 100
              AND wc.entries=1
          ))) THEN 1 ELSE 0 END) AS unmatchedCollectionEntries,
        SUM(CASE WHEN l.type = 'charge' AND EXISTS (
          SELECT 1 FROM payment_receipts r WHERE r.paymentIntentId = l.stripePaymentIntentId
            AND r.bookingId = l.bookingId AND r.settlementStatus = 'review_required'
        ) THEN l.amount * 100 ELSE 0 END) AS reviewCollectionAmount
      FROM ${financialLedger} l INNER JOIN ${bookings} existing ON existing.id = l.bookingId
      LEFT JOIN provider_collections pc ON pc.stripePaymentIntentId=l.stripePaymentIntentId
      LEFT JOIN wallet_collections wc ON wc.bookingId=l.bookingId
      WHERE l.currency = 'SAR' AND l.type IN ('charge','refund','partial_refund')
        AND ${timeFilter(sql`l.transactionDate`, period)}
      GROUP BY l.bookingId, timeKey
    ), attributed AS (
      SELECT m.*, b.cabinClass, b.numberOfPassengers,
        CASE WHEN (SELECT COUNT(*) FROM booking_segments s WHERE s.bookingId = b.id) > 1 THEN 'multi_city' ELSE 'single_flight' END AS itineraryType,
        CASE WHEN EXISTS (SELECT 1 FROM corporate_bookings c WHERE c.bookingId=b.id)
          AND EXISTS (SELECT 1 FROM agent_bookings a WHERE a.bookingId=b.id) THEN 'ambiguous'
          WHEN EXISTS (SELECT 1 FROM corporate_bookings c WHERE c.bookingId=b.id) THEN 'corporate'
          WHEN EXISTS (SELECT 1 FROM agent_bookings a WHERE a.bookingId=b.id) THEN 'agent' ELSE 'direct' END AS channel,
        f.id AS rawFlightId, COALESCE(f.flightNumber, 'UNKNOWN') AS rawFlightNumber,
        COALESCE(o.code, 'UNKNOWN') AS rawOriginCode, COALESCE(o.city, '') AS rawOriginCity,
        COALESCE(d.code, 'UNKNOWN') AS rawDestinationCode, COALESCE(d.city, '') AS rawDestinationCity,
        COALESCE(a.code, 'UNKNOWN') AS rawAirlineCode
      FROM money m INNER JOIN ${bookings} b ON b.id=m.bookingId
      LEFT JOIN flights f ON f.id=b.flightId LEFT JOIN airports o ON o.id=f.originId
      LEFT JOIN airports d ON d.id=f.destinationId LEFT JOIN airlines a ON a.id=f.airlineId
    ), classified AS (
      SELECT attributed.*,
        CASE WHEN itineraryType='multi_city' THEN NULL ELSE rawFlightId END AS flightId,
        CASE WHEN itineraryType='multi_city' THEN 'MULTI' ELSE rawFlightNumber END AS flightNumber,
        CASE WHEN itineraryType='multi_city' THEN 'MULTI' ELSE rawOriginCode END AS originCode,
        CASE WHEN itineraryType='multi_city' THEN '' ELSE rawOriginCity END AS originCity,
        CASE WHEN itineraryType='multi_city' THEN 'MULTI' ELSE rawDestinationCode END AS destinationCode,
        CASE WHEN itineraryType='multi_city' THEN '' ELSE rawDestinationCity END AS destinationCity,
        CASE WHEN itineraryType='multi_city' THEN 'MULTI' ELSE rawAirlineCode END AS airlineCode
      FROM attributed
    )
    SELECT COALESCE(MAX(timeKey), 0) AS timeKey,
      ${column("originCode", route)} AS originCode, ${column("originCity", route)} AS originCity,
      ${column("destinationCode", route)} AS destinationCode, ${column("destinationCity", route)} AS destinationCity,
      ${column("airlineCode", dimension === "warehouse")} AS airlineCode,
      ${column("cabinClass", dimension === "class" || dimension === "warehouse")} AS cabinClass,
      ${column("channel", dimension === "channel" || dimension === "warehouse")} AS channel,
      ${dimension === "flight" ? sql`MAX(flightId)` : sql`NULL`} AS flightId,
      ${column("flightNumber", dimension === "flight")} AS flightNumber,
      ${column("itineraryType", route)} AS itineraryType,
      COALESCE(SUM(collectedAmount),0) AS collectedAmount, COALESCE(SUM(refundedAmount),0) AS refundedAmount,
      COUNT(*) AS activeBookings, COALESCE(SUM(collectionEntries > 0),0) AS collectedBookings,
      COALESCE(SUM(refundEntries > 0),0) AS refundedBookings,
      COALESCE(SUM(collectionEntries),0) AS collectionEntries, COALESCE(SUM(refundEntries),0) AS refundEntries,
      COALESCE(SUM(numberOfPassengers),0) AS passengerCount,
      COALESCE(SUM(unmatchedCollectionEntries),0) AS unmatchedCollectionEntries,
      COALESCE(SUM(reviewCollectionAmount),0) AS reviewCollectionAmount,
      COALESCE(SUM(invalidAmounts),0) AS invalidAmounts
    FROM classified ${group.length ? sql`GROUP BY ${sql.join(group, sql`, `)}` : sql``}
    ORDER BY timeKey, originCode, destinationCode, cabinClass, channel, flightId
    LIMIT 10001
  `);
  const data = rows(result);
  if (data.length > 10000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Financial report exceeds 10000 groups; narrow the period",
    });
  return data.map(row => {
    if (financialInteger(row.invalidAmounts) !== 0)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Invalid ledger amounts require reconciliation",
      });
    const time = financialInteger(row.timeKey);
    const collectedAmount = financialInteger(row.collectedAmount);
    const refundedAmount = financialInteger(row.refundedAmount);
    const month = String(time);
    return {
      date: daily
        ? new Date(time * 86400000).toISOString().slice(0, 10)
        : monthly
          ? `${month.slice(0, 4)}-${month.slice(4, 6)}`
          : "",
      originCode: String(row.originCode ?? ""),
      originCity: String(row.originCity ?? ""),
      destinationCode: String(row.destinationCode ?? ""),
      destinationCity: String(row.destinationCity ?? ""),
      airlineCode: String(row.airlineCode ?? ""),
      cabinClass: String(row.cabinClass ?? ""),
      channel: String(row.channel ?? ""),
      flightId: row.flightId == null ? null : financialInteger(row.flightId),
      flightNumber: String(row.flightNumber ?? ""),
      itineraryType: String(row.itineraryType ?? ""),
      collectedAmount,
      refundedAmount,
      netAmount: financialInteger(collectedAmount - refundedAmount, true),
      activeBookings: financialInteger(row.activeBookings),
      collectedBookings: financialInteger(row.collectedBookings),
      refundedBookings: financialInteger(row.refundedBookings),
      collectionEntries: financialInteger(row.collectionEntries),
      refundEntries: financialInteger(row.refundEntries),
      passengerCount: financialInteger(row.passengerCount),
      unmatchedCollectionEntries: financialInteger(
        row.unmatchedCollectionEntries
      ),
      reviewCollectionAmount: financialInteger(row.reviewCollectionAmount),
    };
  });
}
export async function readBookingFaceValues(
  tx: SettlementTx,
  period: FinancialPeriod
) {
  const [row] = rows(
    await tx.execute(sql`
    SELECT COALESCE(SUM(b.totalAmount),0) AS bookedAmount, COUNT(*) AS bookedCount,
      COALESCE(SUM(b.totalAmount < 0),0) AS invalidAmounts,
      COALESCE(SUM(b.paymentStatus IN ('paid','refunded') AND NOT EXISTS (
        SELECT 1 FROM financial_ledger l WHERE l.bookingId=b.id AND l.type='charge' AND l.currency='SAR'
      )),0) AS unpostedPaidBookings
    FROM ${bookings} b WHERE ${timeFilter(sql`b.createdAt`, period)}
  `)
  );
  if (!row || financialInteger(row.invalidAmounts))
    throw new Error("Invalid booking face values");
  return {
    bookedAmount: financialInteger(row.bookedAmount),
    bookedCount: financialInteger(row.bookedCount),
    unpostedPaidBookings: financialInteger(row.unpostedPaidBookings),
  };
}
export async function getFinancialGroups(
  period: FinancialPeriod,
  dimension: FinancialDimension
) {
  validateFinancialPeriod(period);
  return await financialSnapshot(tx =>
    readFinancialGroups(tx, period, dimension)
  );
}
export async function getFinancialExport(
  period: FinancialPeriod,
  dimension: "day" | "warehouse" = "day"
) {
  validateFinancialPeriod(period);
  return await financialSnapshot(async tx => ({
    ...FINANCIAL_BASIS,
    totals: (await readFinancialGroups(tx, period, "total"))[0],
    rows: await readFinancialGroups(tx, period, dimension),
  }));
}
