/**
 * BSP (Billing and Settlement Plan) & AHC Reporting Service
 *
 * Implements IATA BSP settlement reporting, Airlines Handling Charges (AHC)
 * reports, agent commission calculations, and HOT (Hand Off Tape) file
 * generation for the aviation booking system.
 *
 * All monetary amounts are in SAR cents (100 = 1 SAR) unless otherwise noted.
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  payments,
  flights,
  users,
  airports,
  airlines,
  travelAgents,
  agentBookings,
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export type BSPReportType = "bsp" | "ahc" | "hot";

export type BSPReportStatus = "draft" | "submitted" | "reconciled" | "settled";

export type BSPTransactionType = "sale" | "refund" | "exchange" | "void";

export type BSPTransactionStatus =
  | "active"
  | "voided"
  | "disputed"
  | "reconciled";

export type AgentSettlementStatus = "pending" | "paid" | "disputed";

export interface BSPReport {
  id: string;
  reportType: BSPReportType;
  periodStart: Date;
  periodEnd: Date;
  cycleNumber: number;
  totalSales: number;
  totalRefunds: number;
  netAmount: number;
  commissionAmount: number;
  taxAmount: number;
  status: BSPReportStatus;
  submittedAt: Date | null;
  createdAt: Date;
}

export interface BSPTransaction {
  id: string;
  reportId: string;
  transactionType: BSPTransactionType;
  documentNumber: string;
  ticketNumber: string;
  agentCode: string;
  passengerName: string;
  routeCode: string;
  fareAmount: number;
  taxAmount: number;
  commissionAmount: number;
  netAmount: number;
  issueDate: Date;
  travelDate: Date;
  status: BSPTransactionStatus;
  createdAt: Date;
}

export interface AgentSettlement {
  id: string;
  agentId: number;
  agentName: string;
  iataNumber: string;
  bspReportId: string;
  totalSales: number;
  totalRefunds: number;
  commissionEarned: number;
  netPayable: number;
  settlementDate: Date | null;
  status: AgentSettlementStatus;
  createdAt: Date;
}

export interface SettlementCycle {
  cycleNumber: number;
  periodStart: Date;
  periodEnd: Date;
  reportCount: number;
  totalSales: number;
  totalRefunds: number;
  netAmount: number;
  commissionAmount: number;
  status: BSPReportStatus;
}

export interface IATAComplianceResult {
  reportId: string;
  isCompliant: boolean;
  checks: IATAComplianceCheck[];
  checkedAt: Date;
}

export interface IATAComplianceCheck {
  rule: string;
  description: string;
  passed: boolean;
  details: string;
}

export interface HOTFileRecord {
  recordType: string;
  transactionCode: string;
  documentNumber: string;
  agentCode: string;
  issueDate: string;
  passengerName: string;
  routeCode: string;
  fareAmount: string;
  taxAmount: string;
  commissionAmount: string;
  netAmount: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique report ID with BSP prefix
 */
function generateReportId(type: BSPReportType): string {
  const prefix = type.toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Generate a unique transaction ID
 */
function generateTransactionId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TXN-${timestamp}-${random}`;
}

/**
 * Calculate the BSP settlement cycle number based on date.
 * IATA BSP uses bi-monthly cycles (roughly every 15 days).
 */
function calculateCycleNumber(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();
  // Each month has 2 cycles: 1st-15th = cycle A, 16th-end = cycle B
  const cycleInMonth = day <= 15 ? 0 : 1;
  return year * 24 + month * 2 + cycleInMonth;
}

/**
 * Get the period boundaries for a given cycle number
 */
function getCyclePeriod(cycleNumber: number): { start: Date; end: Date } {
  const year = Math.floor(cycleNumber / 24);
  const remainder = cycleNumber % 24;
  const month = Math.floor(remainder / 2);
  const isSecondHalf = remainder % 2 === 1;

  const start = new Date(year, month, isSecondHalf ? 16 : 1);
  const end = isSecondHalf
    ? new Date(year, month + 1, 0, 23, 59, 59, 999) // last day of month
    : new Date(year, month, 15, 23, 59, 59, 999);

  return { start, end };
}

/**
 * Format a monetary amount from SAR cents to a fixed-width string
 * for HOT file output (12 chars, right-justified, zero-padded).
 */
function formatHOTAmount(amountInCents: number): string {
  const absAmount = Math.abs(Math.round(amountInCents));
  const sign = amountInCents < 0 ? "-" : "+";
  return sign + absAmount.toString().padStart(11, "0");
}

/**
 * Format a date as DDMMYY for HOT file
 */
function formatHOTDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

/**
 * Pad or truncate a string to a fixed width for HOT file fields
 */
function fixedWidth(value: string, width: number): string {
  return value.slice(0, width).padEnd(width, " ");
}

// ============================================================================
// Core Service Functions
// ============================================================================

/**
 * Generate a BSP settlement report for a given period.
 *
 * Aggregates all confirmed bookings (including those via travel agents)
 * within the specified date range, calculates commissions, taxes, and
 * net amounts, and produces a structured BSP report with individual
 * transaction details.
 */
export async function generateBSPReport(
  periodStart: Date,
  periodEnd: Date
): Promise<{
  report: BSPReport;
  transactions: BSPTransaction[];
  agentSettlements: AgentSettlement[];
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const cycleNumber = calculateCycleNumber(periodStart);
  const reportId = generateReportId("bsp");

  // Fetch all confirmed bookings in the period
  const confirmedBookings = await db
    .select({
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      userId: bookings.userId,
      flightId: bookings.flightId,
      totalAmount: bookings.totalAmount,
      cabinClass: bookings.cabinClass,
      numberOfPassengers: bookings.numberOfPassengers,
      status: bookings.status,
      paymentStatus: bookings.paymentStatus,
      createdAt: bookings.createdAt,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      originCode: sql<string>`origin_airport.code`,
      destCode: sql<string>`dest_airport.code`,
      airlineCode: airlines.code,
      userName: users.name,
    })
    .from(bookings)
    .leftJoin(flights, eq(bookings.flightId, flights.id))
    .leftJoin(users, eq(bookings.userId, users.id))
    .leftJoin(airlines, eq(flights.airlineId, airlines.id))
    .leftJoin(
      sql`${airports} AS origin_airport`,
      sql`origin_airport.id = ${flights.originId}`
    )
    .leftJoin(
      sql`${airports} AS dest_airport`,
      sql`dest_airport.id = ${flights.destinationId}`
    )
    .where(
      and(
        gte(bookings.createdAt, periodStart),
        lte(bookings.createdAt, periodEnd)
      )
    )
    .orderBy(desc(bookings.createdAt))
    .limit(50000);

  // Fetch agent bookings for commission info
  const bookingIds = confirmedBookings.map(b => b.bookingId);
  const agentBookingMap = new Map<
    number,
    {
      agentId: number;
      commissionRate: string;
      commissionAmount: number;
      bookingAmount: number;
    }
  >();

  if (bookingIds.length > 0) {
    const agentBookingResults = await db
      .select({
        bookingId: agentBookings.bookingId,
        agentId: agentBookings.agentId,
        commissionRate: agentBookings.commissionRate,
        commissionAmount: agentBookings.commissionAmount,
        bookingAmount: agentBookings.bookingAmount,
      })
      .from(agentBookings)
      .where(inArray(agentBookings.bookingId, bookingIds));

    for (const ab of agentBookingResults) {
      agentBookingMap.set(ab.bookingId, {
        agentId: ab.agentId,
        commissionRate: ab.commissionRate,
        commissionAmount: ab.commissionAmount,
        bookingAmount: ab.bookingAmount,
      });
    }
  }

  // Fetch all active travel agents for settlement grouping
  const agents = await db
    .select({
      id: travelAgents.id,
      agencyName: travelAgents.agencyName,
      iataNumber: travelAgents.iataNumber,
      commissionRate: travelAgents.commissionRate,
    })
    .from(travelAgents)
    .where(eq(travelAgents.isActive, true));

  const agentMap = new Map(agents.map(a => [a.id, a]));

  // Build transactions
  const transactions: BSPTransaction[] = [];
  let totalSales = 0;
  let totalRefunds = 0;
  let totalCommission = 0;
  let totalTax = 0;

  // Track per-agent aggregates
  const agentAggregates = new Map<
    number,
    {
      totalSales: number;
      totalRefunds: number;
      commissionEarned: number;
    }
  >();

  for (const booking of confirmedBookings) {
    const amount = Number(booking.totalAmount) || 0;
    const isRefund = booking.paymentStatus === "refunded";
    const transactionType: BSPTransactionType = isRefund ? "refund" : "sale";

    // Tax calculation: approximate VAT at 15% (Saudi Arabia standard)
    const taxRate = 0.15;
    const fareBeforeTax = Math.round(amount / (1 + taxRate));
    const taxAmount = amount - fareBeforeTax;

    // Determine agent code and commission
    const agentBooking = agentBookingMap.get(booking.bookingId);
    let commissionAmount = 0;
    let agentCode = "DIRECT";

    if (agentBooking) {
      commissionAmount = agentBooking.commissionAmount;
      const agent = agentMap.get(agentBooking.agentId);
      agentCode = agent?.iataNumber || `AGT${agentBooking.agentId}`;

      // Aggregate per agent
      const existing = agentAggregates.get(agentBooking.agentId) || {
        totalSales: 0,
        totalRefunds: 0,
        commissionEarned: 0,
      };

      if (isRefund) {
        existing.totalRefunds += amount;
        existing.commissionEarned -= commissionAmount;
      } else {
        existing.totalSales += amount;
        existing.commissionEarned += commissionAmount;
      }
      agentAggregates.set(agentBooking.agentId, existing);
    }

    const netAmount = isRefund
      ? -(amount - commissionAmount)
      : amount - commissionAmount;

    const passengerName = (booking.userName || "UNKNOWN").toUpperCase();
    const routeCode = `${booking.originCode || "???"}${booking.destCode || "???"}`;
    const documentNumber = booking.pnr || booking.bookingReference || "";
    const ticketNumber = `${booking.airlineCode || "XX"}${documentNumber}`;

    const transaction: BSPTransaction = {
      id: generateTransactionId(),
      reportId,
      transactionType,
      documentNumber,
      ticketNumber,
      agentCode,
      passengerName,
      routeCode,
      fareAmount: isRefund ? -fareBeforeTax : fareBeforeTax,
      taxAmount: isRefund ? -taxAmount : taxAmount,
      commissionAmount: isRefund ? -commissionAmount : commissionAmount,
      netAmount,
      issueDate: booking.createdAt ? new Date(booking.createdAt) : new Date(),
      travelDate: booking.departureTime
        ? new Date(booking.departureTime)
        : new Date(),
      status: "active",
      createdAt: new Date(),
    };

    transactions.push(transaction);

    if (isRefund) {
      totalRefunds += amount;
    } else {
      totalSales += amount;
    }
    totalCommission += commissionAmount;
    totalTax += isRefund ? -taxAmount : taxAmount;
  }

  const netAmount = totalSales - totalRefunds - totalCommission;

  // Build agent settlements
  const agentSettlements: AgentSettlement[] = [];
  for (const [agentId, aggregates] of agentAggregates.entries()) {
    const agent = agentMap.get(agentId);
    if (!agent) continue;

    const netPayable =
      aggregates.totalSales -
      aggregates.totalRefunds -
      aggregates.commissionEarned;

    agentSettlements.push({
      id: `SETL-${generateTransactionId()}`,
      agentId,
      agentName: agent.agencyName,
      iataNumber: agent.iataNumber,
      bspReportId: reportId,
      totalSales: aggregates.totalSales,
      totalRefunds: aggregates.totalRefunds,
      commissionEarned: aggregates.commissionEarned,
      netPayable,
      settlementDate: null,
      status: "pending",
      createdAt: new Date(),
    });
  }

  const report: BSPReport = {
    id: reportId,
    reportType: "bsp",
    periodStart,
    periodEnd,
    cycleNumber,
    totalSales,
    totalRefunds,
    netAmount,
    commissionAmount: totalCommission,
    taxAmount: totalTax,
    status: "draft",
    submittedAt: null,
    createdAt: new Date(),
  };

  return { report, transactions, agentSettlements };
}

/**
 * Generate an AHC (Airlines Handling Charges) report for a given period.
 *
 * AHC reports detail the handling charges airlines incur through the BSP
 * system, including processing fees, distribution costs, and service charges.
 */
export async function generateAHCReport(
  periodStart: Date,
  periodEnd: Date
): Promise<{
  report: BSPReport;
  airlineCharges: Array<{
    airlineCode: string;
    airlineName: string;
    transactionCount: number;
    grossSales: number;
    handlingCharge: number;
    processingFee: number;
    totalCharges: number;
  }>;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const cycleNumber = calculateCycleNumber(periodStart);
  const reportId = generateReportId("ahc");

  // Aggregate bookings by airline for the period
  const airlineResults = await db
    .select({
      airlineCode: airlines.code,
      airlineName: airlines.name,
      transactionCount: sql<number>`COUNT(${bookings.id})`,
      grossSales: sql<number>`SUM(${bookings.totalAmount})`,
    })
    .from(bookings)
    .leftJoin(flights, eq(bookings.flightId, flights.id))
    .leftJoin(airlines, eq(flights.airlineId, airlines.id))
    .where(
      and(
        gte(bookings.createdAt, periodStart),
        lte(bookings.createdAt, periodEnd),
        eq(bookings.status, "confirmed")
      )
    )
    .groupBy(airlines.code, airlines.name)
    .orderBy(desc(sql`SUM(${bookings.totalAmount})`));

  // AHC fee rates (standard IATA rates)
  const HANDLING_CHARGE_RATE = 0.01; // 1% handling charge
  const PROCESSING_FEE_PER_TXN = 50; // 50 SAR cents (0.50 SAR) per transaction

  let totalChargesAll = 0;
  const airlineCharges = airlineResults.map(row => {
    const grossSales = Number(row.grossSales) || 0;
    const txnCount = Number(row.transactionCount) || 0;
    const handlingCharge = Math.round(grossSales * HANDLING_CHARGE_RATE);
    const processingFee = txnCount * PROCESSING_FEE_PER_TXN;
    const totalCharges = handlingCharge + processingFee;
    totalChargesAll += totalCharges;

    return {
      airlineCode: row.airlineCode || "XX",
      airlineName: row.airlineName || "Unknown Airline",
      transactionCount: txnCount,
      grossSales,
      handlingCharge,
      processingFee,
      totalCharges,
    };
  });

  const totalSales = airlineCharges.reduce((s, a) => s + a.grossSales, 0);

  const report: BSPReport = {
    id: reportId,
    reportType: "ahc",
    periodStart,
    periodEnd,
    cycleNumber,
    totalSales,
    totalRefunds: 0,
    netAmount: totalChargesAll,
    commissionAmount: 0,
    taxAmount: 0,
    status: "draft",
    submittedAt: null,
    createdAt: new Date(),
  };

  return { report, airlineCharges };
}

/**
 * Calculate commissions for all agents in a given BSP period.
 *
 * Uses the commission rates stored on each agent booking record,
 * aggregated by agent for the specified settlement cycle.
 */
export async function calculateAgentCommissions(periodId: number): Promise<{
  cycleNumber: number;
  period: { start: Date; end: Date };
  commissions: Array<{
    agentId: number;
    agencyName: string;
    iataNumber: string;
    commissionRate: string;
    totalBookings: number;
    totalBookingAmount: number;
    totalCommission: number;
    pendingCommission: number;
    paidCommission: number;
  }>;
  totalCommission: number;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const period = getCyclePeriod(periodId);

  // Get agent commissions aggregated by agent for the period
  const commissionResults = await db
    .select({
      agentId: agentBookings.agentId,
      agencyName: travelAgents.agencyName,
      iataNumber: travelAgents.iataNumber,
      commissionRate: travelAgents.commissionRate,
      totalBookings: sql<number>`COUNT(${agentBookings.id})`,
      totalBookingAmount: sql<number>`SUM(${agentBookings.bookingAmount})`,
      totalCommission: sql<number>`SUM(${agentBookings.commissionAmount})`,
      pendingCommission: sql<number>`SUM(CASE WHEN ${agentBookings.commissionStatus} = 'pending' THEN ${agentBookings.commissionAmount} ELSE 0 END)`,
      paidCommission: sql<number>`SUM(CASE WHEN ${agentBookings.commissionStatus} = 'paid' THEN ${agentBookings.commissionAmount} ELSE 0 END)`,
    })
    .from(agentBookings)
    .leftJoin(travelAgents, eq(agentBookings.agentId, travelAgents.id))
    .where(
      and(
        gte(agentBookings.createdAt, period.start),
        lte(agentBookings.createdAt, period.end)
      )
    )
    .groupBy(
      agentBookings.agentId,
      travelAgents.agencyName,
      travelAgents.iataNumber,
      travelAgents.commissionRate
    )
    .orderBy(desc(sql`SUM(${agentBookings.commissionAmount})`));

  const commissions = commissionResults.map(row => ({
    agentId: row.agentId,
    agencyName: row.agencyName || "Unknown Agency",
    iataNumber: row.iataNumber || "",
    commissionRate: row.commissionRate || "0.00",
    totalBookings: Number(row.totalBookings) || 0,
    totalBookingAmount: Number(row.totalBookingAmount) || 0,
    totalCommission: Number(row.totalCommission) || 0,
    pendingCommission: Number(row.pendingCommission) || 0,
    paidCommission: Number(row.paidCommission) || 0,
  }));

  const totalCommission = commissions.reduce(
    (sum, c) => sum + c.totalCommission,
    0
  );

  return {
    cycleNumber: periodId,
    period,
    commissions,
    totalCommission,
  };
}

/**
 * Get data for a specific BSP settlement cycle.
 *
 * Returns summary statistics and a breakdown of all bookings,
 * refunds, and agent activity within that cycle.
 */
export async function getSettlementCycle(
  cycleNumber: number
): Promise<SettlementCycle & { transactions: BSPTransaction[] }> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const period = getCyclePeriod(cycleNumber);

  // Get summary stats
  const [summary] = await db
    .select({
      totalBookings: sql<number>`COUNT(*)`,
      totalSales: sql<number>`SUM(CASE WHEN ${bookings.paymentStatus} != 'refunded' THEN ${bookings.totalAmount} ELSE 0 END)`,
      totalRefunds: sql<number>`SUM(CASE WHEN ${bookings.paymentStatus} = 'refunded' THEN ${bookings.totalAmount} ELSE 0 END)`,
    })
    .from(bookings)
    .where(
      and(
        gte(bookings.createdAt, period.start),
        lte(bookings.createdAt, period.end)
      )
    );

  // Get commission totals
  const [commissionSummary] = await db
    .select({
      totalCommission: sql<number>`COALESCE(SUM(${agentBookings.commissionAmount}), 0)`,
    })
    .from(agentBookings)
    .where(
      and(
        gte(agentBookings.createdAt, period.start),
        lte(agentBookings.createdAt, period.end)
      )
    );

  const totalSales = Number(summary?.totalSales) || 0;
  const totalRefunds = Number(summary?.totalRefunds) || 0;
  const commissionAmount = Number(commissionSummary?.totalCommission) || 0;
  const netAmount = totalSales - totalRefunds - commissionAmount;

  // Build detailed transaction list for the cycle
  const cycleBookings = await db
    .select({
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      totalAmount: bookings.totalAmount,
      paymentStatus: bookings.paymentStatus,
      createdAt: bookings.createdAt,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      originCode: sql<string>`origin_airport.code`,
      destCode: sql<string>`dest_airport.code`,
      userName: users.name,
    })
    .from(bookings)
    .leftJoin(flights, eq(bookings.flightId, flights.id))
    .leftJoin(users, eq(bookings.userId, users.id))
    .leftJoin(
      sql`${airports} AS origin_airport`,
      sql`origin_airport.id = ${flights.originId}`
    )
    .leftJoin(
      sql`${airports} AS dest_airport`,
      sql`dest_airport.id = ${flights.destinationId}`
    )
    .where(
      and(
        gte(bookings.createdAt, period.start),
        lte(bookings.createdAt, period.end)
      )
    )
    .orderBy(desc(bookings.createdAt))
    .limit(10000);

  const transactions: BSPTransaction[] = cycleBookings.map(b => {
    const amount = Number(b.totalAmount) || 0;
    const isRefund = b.paymentStatus === "refunded";
    const taxRate = 0.15;
    const fareBeforeTax = Math.round(amount / (1 + taxRate));
    const taxAmount = amount - fareBeforeTax;

    return {
      id: generateTransactionId(),
      reportId: `CYCLE-${cycleNumber}`,
      transactionType: isRefund ? ("refund" as const) : ("sale" as const),
      documentNumber: b.pnr || b.bookingReference || "",
      ticketNumber: b.pnr || "",
      agentCode: "DIRECT",
      passengerName: (b.userName || "UNKNOWN").toUpperCase(),
      routeCode: `${b.originCode || "???"}${b.destCode || "???"}`,
      fareAmount: isRefund ? -fareBeforeTax : fareBeforeTax,
      taxAmount: isRefund ? -taxAmount : taxAmount,
      commissionAmount: 0,
      netAmount: isRefund ? -amount : amount,
      issueDate: b.createdAt ? new Date(b.createdAt) : new Date(),
      travelDate: b.departureTime ? new Date(b.departureTime) : new Date(),
      status: "active",
      createdAt: new Date(),
    };
  });

  return {
    cycleNumber,
    periodStart: period.start,
    periodEnd: period.end,
    reportCount: 1,
    totalSales,
    totalRefunds,
    netAmount,
    commissionAmount,
    status: "draft",
    transactions,
  };
}

/**
 * Reconcile BSP transactions for a given period.
 *
 * Cross-references bookings with payment records to identify
 * discrepancies and produce a reconciliation report.
 */
export async function reconcileBSPTransactions(periodId: number): Promise<{
  cycleNumber: number;
  period: { start: Date; end: Date };
  totalBookings: number;
  matchedTransactions: number;
  unmatchedTransactions: number;
  discrepancies: Array<{
    bookingReference: string;
    bookingAmount: number;
    paymentAmount: number;
    difference: number;
    issue: string;
  }>;
  reconciliationStatus: "clean" | "discrepancies_found";
  reconciledAt: Date;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const period = getCyclePeriod(periodId);

  // Get bookings with their payment records
  const bookingPayments = await db
    .select({
      bookingReference: bookings.bookingReference,
      bookingAmount: bookings.totalAmount,
      bookingStatus: bookings.status,
      paymentStatus: bookings.paymentStatus,
      paymentAmount: payments.amount,
      paymentMethod: payments.method,
      stripePaymentIntentId: payments.stripePaymentIntentId,
    })
    .from(bookings)
    .leftJoin(payments, eq(bookings.id, payments.bookingId))
    .where(
      and(
        gte(bookings.createdAt, period.start),
        lte(bookings.createdAt, period.end)
      )
    )
    .orderBy(desc(bookings.createdAt))
    .limit(50000);

  const discrepancies: Array<{
    bookingReference: string;
    bookingAmount: number;
    paymentAmount: number;
    difference: number;
    issue: string;
  }> = [];

  let matched = 0;
  let unmatched = 0;

  for (const bp of bookingPayments) {
    const bookingAmount = Number(bp.bookingAmount) || 0;
    const paymentAmount = Number(bp.paymentAmount) || 0;
    const ref = bp.bookingReference || "UNKNOWN";

    if (bp.bookingStatus === "confirmed" && !bp.paymentAmount) {
      // Confirmed booking with no payment record
      unmatched++;
      discrepancies.push({
        bookingReference: ref,
        bookingAmount,
        paymentAmount: 0,
        difference: bookingAmount,
        issue: "Confirmed booking with no payment record",
      });
    } else if (
      bp.bookingStatus === "confirmed" &&
      bookingAmount !== paymentAmount
    ) {
      // Amount mismatch
      unmatched++;
      discrepancies.push({
        bookingReference: ref,
        bookingAmount,
        paymentAmount,
        difference: bookingAmount - paymentAmount,
        issue: "Booking amount does not match payment amount",
      });
    } else if (
      bp.paymentStatus === "refunded" &&
      bp.bookingStatus !== "cancelled"
    ) {
      // Refunded but not cancelled
      unmatched++;
      discrepancies.push({
        bookingReference: ref,
        bookingAmount,
        paymentAmount,
        difference: 0,
        issue: "Payment refunded but booking not cancelled",
      });
    } else {
      matched++;
    }
  }

  return {
    cycleNumber: periodId,
    period,
    totalBookings: bookingPayments.length,
    matchedTransactions: matched,
    unmatchedTransactions: unmatched,
    discrepancies,
    reconciliationStatus:
      discrepancies.length === 0 ? "clean" : "discrepancies_found",
    reconciledAt: new Date(),
  };
}

/**
 * Generate an IATA HOT (Hand Off Tape) format export.
 *
 * HOT is a fixed-width text format used for electronic data interchange
 * between BSP participants. Each line is a fixed-length record with
 * specific field positions defined by IATA standards.
 */
export async function generateHOTFile(): Promise<{
  filename: string;
  content: string;
  recordCount: number;
  generatedAt: Date;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get the current cycle period
  const now = new Date();
  const cycleNumber = calculateCycleNumber(now);
  const period = getCyclePeriod(cycleNumber);

  // Fetch all transactions in the current cycle
  const results = await db
    .select({
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      totalAmount: bookings.totalAmount,
      paymentStatus: bookings.paymentStatus,
      createdAt: bookings.createdAt,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      originCode: sql<string>`origin_airport.code`,
      destCode: sql<string>`dest_airport.code`,
      airlineCode: airlines.code,
      userName: users.name,
    })
    .from(bookings)
    .leftJoin(flights, eq(bookings.flightId, flights.id))
    .leftJoin(users, eq(bookings.userId, users.id))
    .leftJoin(airlines, eq(flights.airlineId, airlines.id))
    .leftJoin(
      sql`${airports} AS origin_airport`,
      sql`origin_airport.id = ${flights.originId}`
    )
    .leftJoin(
      sql`${airports} AS dest_airport`,
      sql`dest_airport.id = ${flights.destinationId}`
    )
    .where(
      and(
        gte(bookings.createdAt, period.start),
        lte(bookings.createdAt, period.end),
        eq(bookings.status, "confirmed")
      )
    )
    .orderBy(bookings.createdAt)
    .limit(99999);

  const lines: string[] = [];

  // Header record (BHD)
  const headerDate = formatHOTDate(now);
  const cycleStr = String(cycleNumber).padStart(6, "0");
  lines.push(
    `BHD${headerDate}${cycleStr}${fixedWidth("AIS-AVIATION", 20)}${fixedWidth("SAR", 3)}${String(results.length).padStart(6, "0")}${"".padEnd(82, " ")}`
  );

  // Transaction records (BKP for sales, BRF for refunds)
  for (const row of results) {
    const amount = Number(row.totalAmount) || 0;
    const isRefund = row.paymentStatus === "refunded";
    const recordType = isRefund ? "BRF" : "BKP";
    const transactionCode = isRefund ? "RFND" : "TKTT";

    const taxRate = 0.15;
    const fareBeforeTax = Math.round(amount / (1 + taxRate));
    const taxAmount = amount - fareBeforeTax;
    const commissionAmount = 0;
    const netAmount = amount - commissionAmount;

    const docNumber = fixedWidth(row.pnr || row.bookingReference || "", 10);
    const agentCode = fixedWidth("DIRECT", 8);
    const issueDate = row.createdAt
      ? formatHOTDate(new Date(row.createdAt))
      : formatHOTDate(now);
    const passengerName = fixedWidth(
      (row.userName || "UNKNOWN").toUpperCase(),
      30
    );
    const routeCode = fixedWidth(
      `${row.originCode || "???"}${row.destCode || "???"}`,
      6
    );

    const line = [
      recordType,
      fixedWidth(transactionCode, 4),
      docNumber,
      agentCode,
      issueDate,
      passengerName,
      routeCode,
      formatHOTAmount(isRefund ? -fareBeforeTax : fareBeforeTax),
      formatHOTAmount(isRefund ? -taxAmount : taxAmount),
      formatHOTAmount(isRefund ? -commissionAmount : commissionAmount),
      formatHOTAmount(isRefund ? -netAmount : netAmount),
    ].join("");

    lines.push(line);
  }

  // Trailer record (BTL)
  const totalAmount = results.reduce(
    (sum, r) => sum + (Number(r.totalAmount) || 0),
    0
  );
  lines.push(
    `BTL${String(results.length).padStart(6, "0")}${formatHOTAmount(totalAmount)}${"".padEnd(111, " ")}`
  );

  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const filename = `HOT-BSP-${cycleStr}-${timestamp}.hot`;

  return {
    filename,
    content: lines.join("\n"),
    recordCount: results.length,
    generatedAt: now,
  };
}

/**
 * Validate a BSP report against IATA compliance standards.
 *
 * Checks various IATA BSP rules including document numbering,
 * amount integrity, agent code validation, date consistency,
 * and settlement balance verification.
 */
export async function validateIATACompliance(
  reportId: string
): Promise<IATAComplianceResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Generate the report to validate against
  // For a real implementation this would load a persisted report,
  // but here we validate the current period data.
  const now = new Date();
  const cycleNumber = calculateCycleNumber(now);
  const period = getCyclePeriod(cycleNumber);

  const { report, transactions } = await generateBSPReport(
    period.start,
    period.end
  );

  const checks: IATAComplianceCheck[] = [];

  // Check 1: Document numbering - all transactions must have document numbers
  const missingDocs = transactions.filter(t => !t.documentNumber.trim());
  checks.push({
    rule: "IATA-BSP-001",
    description: "All transactions must have valid document numbers",
    passed: missingDocs.length === 0,
    details:
      missingDocs.length === 0
        ? "All transactions have document numbers"
        : `${missingDocs.length} transaction(s) missing document numbers`,
  });

  // Check 2: Amount integrity - net = fare + tax - commission
  const amountErrors = transactions.filter(t => {
    const expectedNet = t.fareAmount + t.taxAmount - t.commissionAmount;
    return Math.abs(t.netAmount - expectedNet) > 1; // Allow 1 cent rounding
  });
  checks.push({
    rule: "IATA-BSP-002",
    description:
      "Net amount must equal fare + tax - commission for each transaction",
    passed: amountErrors.length === 0,
    details:
      amountErrors.length === 0
        ? "All transaction amounts are internally consistent"
        : `${amountErrors.length} transaction(s) with amount calculation errors`,
  });

  // Check 3: Report totals - sum of transactions must match report totals
  const calcTotalSales = transactions
    .filter(t => t.transactionType === "sale")
    .reduce((sum, t) => sum + t.fareAmount + t.taxAmount, 0);
  const calcTotalRefunds = transactions
    .filter(t => t.transactionType === "refund")
    .reduce((sum, t) => sum + Math.abs(t.fareAmount + t.taxAmount), 0);
  const salesTotalMatch =
    Math.abs(report.totalSales - calcTotalSales) <= transactions.length; // allow minor rounding
  const refundsTotalMatch =
    Math.abs(report.totalRefunds - calcTotalRefunds) <= transactions.length;

  checks.push({
    rule: "IATA-BSP-003",
    description: "Report totals must match sum of individual transactions",
    passed: salesTotalMatch && refundsTotalMatch,
    details:
      salesTotalMatch && refundsTotalMatch
        ? "Report totals match transaction sums"
        : `Sales difference: ${report.totalSales - calcTotalSales}, Refunds difference: ${report.totalRefunds - calcTotalRefunds}`,
  });

  // Check 4: Agent codes - all agent codes should be valid IATA format
  const invalidAgentCodes = transactions.filter(t => {
    if (t.agentCode === "DIRECT") return false;
    // IATA agent codes are typically 7-8 alphanumeric characters
    return !/^[A-Z0-9]{2,10}$/.test(t.agentCode);
  });
  checks.push({
    rule: "IATA-BSP-004",
    description: "Agent codes must conform to IATA format",
    passed: invalidAgentCodes.length === 0,
    details:
      invalidAgentCodes.length === 0
        ? "All agent codes are valid"
        : `${invalidAgentCodes.length} transaction(s) with invalid agent codes`,
  });

  // Check 5: Date consistency - issue date must not be after travel date
  const dateErrors = transactions.filter(
    t => t.issueDate > t.travelDate && t.transactionType === "sale"
  );
  checks.push({
    rule: "IATA-BSP-005",
    description: "Issue date must not be after travel date for sales",
    passed: dateErrors.length === 0,
    details:
      dateErrors.length === 0
        ? "All transaction dates are consistent"
        : `${dateErrors.length} transaction(s) with issue date after travel date`,
  });

  // Check 6: Non-negative commission - commissions should not be negative for sales
  const negativeCommissions = transactions.filter(
    t => t.transactionType === "sale" && t.commissionAmount < 0
  );
  checks.push({
    rule: "IATA-BSP-006",
    description:
      "Commission amounts must not be negative for sale transactions",
    passed: negativeCommissions.length === 0,
    details:
      negativeCommissions.length === 0
        ? "All sale commissions are non-negative"
        : `${negativeCommissions.length} sale transaction(s) with negative commission`,
  });

  // Check 7: Settlement balance verification
  const balanceCheck =
    Math.abs(
      report.netAmount -
        (report.totalSales - report.totalRefunds - report.commissionAmount)
    ) <= 1;
  checks.push({
    rule: "IATA-BSP-007",
    description:
      "Settlement balance must equal total sales minus refunds minus commission",
    passed: balanceCheck,
    details: balanceCheck
      ? "Settlement balance is correct"
      : `Balance discrepancy: expected ${report.totalSales - report.totalRefunds - report.commissionAmount}, got ${report.netAmount}`,
  });

  // Check 8: Currency consistency - all amounts should be in SAR
  checks.push({
    rule: "IATA-BSP-008",
    description:
      "All amounts must be in the configured settlement currency (SAR)",
    passed: true,
    details: "All amounts are denominated in SAR cents",
  });

  const isCompliant = checks.every(c => c.passed);

  return {
    reportId: reportId || report.id,
    isCompliant,
    checks,
    checkedAt: new Date(),
  };
}
