import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, sql, type AnyColumn } from "drizzle-orm";
import { bookings, financialLedger } from "../../drizzle/schema";
import { getDb } from "../db";

export interface FinancialPeriod { startDate?: Date; endDate?: Date }
export interface FinancialAmounts {
  billedAmount: number;
  collectedAmount: number;
  refundedAmount: number;
  netCollectedAmount: number;
  earnedRevenue: null;
  unreconciledBookings: number;
  unclassifiedEntries: number;
  currency: "SAR";
  amountUnit: "minor";
}
export interface FinancialDay extends FinancialAmounts { date: string; bookings: number }
export interface InvoiceDay { day: unknown; amount: unknown; count: unknown; unreconciled: unknown }
export interface SettlementDay { day: unknown; collected: unknown; refunded: unknown; unclassified: unknown }

export function financialInteger(value: unknown): number {
  if (value === null || value === undefined || value === "" || typeof value === "boolean")
    throw new Error("Missing financial amount");
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid financial amount");
  return amount;
}
export function validateFinancialPeriod(period: FinancialPeriod) {
  for (const date of [period.startDate, period.endDate]) {
    if (date !== undefined && (!(date instanceof Date) || !Number.isFinite(date.getTime())))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid financial report period" });
  }
  if (period.startDate && period.endDate && period.startDate > period.endDate)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Reversed financial report period" });
}
function bounds(column: AnyColumn, period: FinancialPeriod) {
  return and(
    period.startDate ? sql`UNIX_TIMESTAMP(${column}) >= ${period.startDate.getTime() / 1000}` : undefined,
    period.endDate ? sql`UNIX_TIMESTAMP(${column}) <= ${period.endDate.getTime() / 1000}` : undefined,
  );
}
function emptyAmounts(): FinancialAmounts {
  return { billedAmount: 0, collectedAmount: 0, refundedAmount: 0, netCollectedAmount: 0,
    earnedRevenue: null, unreconciledBookings: 0, unclassifiedEntries: 0, currency: "SAR", amountUnit: "minor" };
}

/** A booking creation and a settlement on different days remain on different days.
 * Wallet top-ups have no bookingId and are excluded: spending the wallet posts the booking charge. */
export function combineFinancialDays(invoices: InvoiceDay[], settlements: SettlementDay[]): FinancialDay[] {
  const days = new Map<number, FinancialDay>();
  const dayRow = (value: unknown) => {
    const day = financialInteger(value);
    if (!days.has(day)) days.set(day, { ...emptyAmounts(), date: new Date(day * 86400000).toISOString().slice(0, 10), bookings: 0 });
    const row = days.get(day);
    if (!row) throw new Error("Missing financial day");
    return row;
  };
  for (const invoice of invoices) {
    const row = dayRow(invoice.day);
    row.billedAmount = financialInteger(row.billedAmount + financialInteger(invoice.amount));
    row.bookings += financialInteger(invoice.count);
    row.unreconciledBookings += financialInteger(invoice.unreconciled);
  }
  for (const settlement of settlements) {
    const row = dayRow(settlement.day);
    row.collectedAmount = financialInteger(row.collectedAmount + financialInteger(settlement.collected));
    row.refundedAmount = financialInteger(row.refundedAmount + financialInteger(settlement.refunded));
    row.unclassifiedEntries += financialInteger(settlement.unclassified);
    row.netCollectedAmount = row.collectedAmount - row.refundedAmount;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Read projection only. No inferred earned revenue, no second financial ledger.
 * Invoices use creation time; cash movements use posting time, both UTC. */
export async function getFinancialDays(period: FinancialPeriod = {}): Promise<FinancialDay[]> {
  validateFinancialPeriod(period);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Financial reporting unavailable" });
  try {
    return await db.transaction(async tx => {
      const invoices = await tx.select({
        day: sql<string>`FLOOR(UNIX_TIMESTAMP(${bookings.createdAt}) / 86400)`,
        amount: sql<string>`COALESCE(SUM(${bookings.totalAmount}), 0)`,
        count: sql<string>`COUNT(*)`,
        unreconciled: sql<string>`SUM(CASE WHEN ${bookings.paymentStatus} IN ('paid','refunded') AND NOT EXISTS (
          SELECT 1 FROM financial_ledger l WHERE l.bookingId = ${bookings.id} AND l.type = 'charge' AND l.currency = 'SAR'
        ) THEN 1 ELSE 0 END)`,
      }).from(bookings).where(bounds(bookings.createdAt, period))
        .groupBy(sql`FLOOR(UNIX_TIMESTAMP(${bookings.createdAt}) / 86400)`).limit(50001);
      const settlements = await tx.select({
        day: sql<string>`FLOOR(UNIX_TIMESTAMP(${financialLedger.transactionDate}) / 86400)`,
        collected: sql<string>`SUM(CASE WHEN ${financialLedger.type} = 'charge' THEN ${financialLedger.amount} * 100 ELSE 0 END)`,
        refunded: sql<string>`SUM(CASE WHEN ${financialLedger.type} IN ('refund','partial_refund') THEN ${financialLedger.amount} * 100 ELSE 0 END)`,
        unclassified: sql<string>`SUM(CASE WHEN ${financialLedger.type} = 'adjustment' THEN 1 ELSE 0 END)`,
      }).from(financialLedger).where(and(isNotNull(financialLedger.bookingId), eq(financialLedger.currency, "SAR"), bounds(financialLedger.transactionDate, period)))
        .groupBy(sql`FLOOR(UNIX_TIMESTAMP(${financialLedger.transactionDate}) / 86400)`).limit(50001);
      if (invoices.length > 50000 || settlements.length > 50000)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Narrow the financial report period" });
      return combineFinancialDays(invoices, settlements);
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Financial reporting unavailable" });
  }
}

export async function getFinancialSummary(period: FinancialPeriod = {}): Promise<FinancialAmounts> {
  const summary = emptyAmounts();
  for (const row of await getFinancialDays(period)) {
    for (const key of ["billedAmount", "collectedAmount", "refundedAmount", "unreconciledBookings", "unclassifiedEntries"] as const)
      summary[key] = financialInteger(summary[key] + row[key]);
  }
  summary.netCollectedAmount = summary.collectedAmount - summary.refundedAmount;
  return summary;
}
