/** Compatibility endpoint owner for the financial dashboard.
 * Money is posted booking collections/refunds, in SAR minor units. There is no
 * recognition journal, so unsupported accounting amounts are explicitly null. */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import {
  FINANCIAL_BASIS,
  financialInteger,
  financialSnapshot,
  getFinancialGroups,
  readFinancialGroups,
  readBookingFaceValues,
  validateFinancialPeriod,
  type FinancialGroup,
  type FinancialPeriod,
} from "./booking-financial-reporting.service";

const average = (amount: number, count: number) =>
  count ? Math.round(amount / count) : 0;
const percentage = (amount: number, total: number) =>
  total ? Math.round((amount / total) * 1000) / 10 : 0;
const unavailable = {
  recognizedRevenue: null,
  deferredRevenue: null,
  ancillaryRevenue: null,
  recognitionStatus: "unavailable" as const,
};
const money = (r: FinancialGroup) => ({
  ...FINANCIAL_BASIS,
  totalRevenue: r.collectedAmount,
  refundedAmount: r.refundedAmount,
  netAmount: r.netAmount,
  bookingCount: r.collectedBookings,
  activeBookings: r.activeBookings,
  averageRevenue: average(r.collectedAmount, r.collectedBookings),
  passengerCount: r.passengerCount,
  unmatchedCollectionEntries: r.unmatchedCollectionEntries,
  reviewCollectionAmount: r.reviewCollectionAmount,
});
function period(startDate?: Date, endDate?: Date): FinancialPeriod {
  const p = { startDate, endDate };
  validateFinancialPeriod(p);
  return p;
}
function limitValue(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid report limit",
    });
  return limit;
}

export async function getRevenueDashboard(startDate?: Date, endDate?: Date) {
  const p = period(startDate, endDate);
  return await financialSnapshot(async tx => {
    const [total] = await readFinancialGroups(tx, p, "total");
    const faceValues = await readBookingFaceValues(tx, p);
    let revenueGrowthPercent: number | null = null;
    if (p.startDate && p.endDate) {
      const length = p.endDate.getTime() - p.startDate.getTime() + 1;
      const [previous] = await readFinancialGroups(
        tx,
        {
          startDate: new Date(p.startDate.getTime() - length),
          endDate: new Date(p.startDate.getTime() - 1),
        },
        "total"
      );
      if (previous.collectedAmount > 0)
        revenueGrowthPercent = percentage(
          total.collectedAmount - previous.collectedAmount,
          previous.collectedAmount
        );
    }
    return {
      ...FINANCIAL_BASIS,
      ...unavailable,
      ...faceValues,
      totalRevenue: total.collectedAmount,
      refundTotal: total.refundedAmount,
      netRevenue: total.netAmount,
      revenueGrowthPercent,
      averageRevenuePerBooking: average(
        total.collectedAmount,
        total.collectedBookings
      ),
      totalBookings: total.collectedBookings,
      activeBookings: total.activeBookings,
      collectionEntries: total.collectionEntries,
      refundEntries: total.refundEntries,
      unmatchedCollectionEntries: total.unmatchedCollectionEntries,
      reviewCollectionAmount: total.reviewCollectionAmount,
    };
  });
}
export async function getRevenueByRoute(startDate?: Date, endDate?: Date) {
  return (await getFinancialGroups(period(startDate, endDate), "route"))
    .map(r => ({
      ...money(r),
      originCode: r.originCode,
      originCity: r.originCity,
      destinationCode: r.destinationCode,
      destinationCity: r.destinationCity,
      itineraryType: r.itineraryType,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}
export async function getRevenueByClass(startDate?: Date, endDate?: Date) {
  const rows = await getFinancialGroups(period(startDate, endDate), "class");
  const total = financialInteger(
    rows.reduce((sum, r) => sum + r.collectedAmount, 0)
  );
  return rows.map(r => ({
    ...money(r),
    classOfService: r.cabinClass,
    percentageOfTotal: percentage(r.collectedAmount, total),
  }));
}
export async function getRevenueByChannel(startDate?: Date, endDate?: Date) {
  const rows = await getFinancialGroups(period(startDate, endDate), "channel");
  const total = financialInteger(
    rows.reduce((sum, r) => sum + r.collectedAmount, 0)
  );
  return rows.map(r => ({
    ...money(r),
    channel: r.channel,
    percentageOfTotal: percentage(r.collectedAmount, total),
  }));
}

/** Active invoice lines are useful operational data; they do not prove either
 * collection or delivery, and cannot be added to gross booking collections. */
export async function getAncillaryRevenue(startDate?: Date, endDate?: Date) {
  const p = period(startDate, endDate);
  return await financialSnapshot(async tx => {
    const [data] = await tx.execute(sql`
      SELECT s.category, COALESCE(SUM(a.totalPrice),0) AS amount,
        COALESCE(SUM(a.quantity),0) AS quantity,
        COALESCE(SUM(a.totalPrice < 0 OR a.quantity <= 0),0) AS invalidRows
      FROM booking_ancillaries a INNER JOIN ancillary_services s ON s.id=a.ancillaryServiceId
      INNER JOIN bookings b ON b.id=a.bookingId
      WHERE a.status='active'
      ${p.startDate ? sql`AND UNIX_TIMESTAMP(a.createdAt) >= ${p.startDate.getTime() / 1000}` : sql``}
      ${p.endDate ? sql`AND UNIX_TIMESTAMP(a.createdAt) <= ${p.endDate.getTime() / 1000}` : sql``}
      GROUP BY s.category ORDER BY s.category
    `);
    const rows = (
      data as unknown as Array<{
        category: string;
        amount: unknown;
        quantity: unknown;
        invalidRows: unknown;
      }>
    ).map(r => {
      if (financialInteger(r.invalidRows))
        throw new Error("Invalid ancillary invoice lines");
      return {
        category: r.category,
        amount: financialInteger(r.amount),
        quantity: financialInteger(r.quantity),
      };
    });
    const total = financialInteger(rows.reduce((sum, r) => sum + r.amount, 0));
    return {
      basis: "active_ancillary_invoice_lines" as const,
      total,
      breakdown: rows.map(r => ({
        category: r.category,
        totalRevenue: r.amount,
        quantity: r.quantity,
        averagePrice: average(r.amount, r.quantity),
        percentageOfTotal: percentage(r.amount, total),
      })),
    };
  });
}
export function calculateDeferredRevenue() {
  return Promise.resolve({
    total: null,
    items: [],
    recognitionStatus: "unavailable" as const,
    reason:
      "Revenue allocation, fulfillment evidence and a recognition journal are required",
  });
}
export async function getYieldAnalysis(
  startDate?: Date,
  endDate?: Date,
  limit = 20
) {
  limitValue(limit);
  const rows = await getFinancialGroups(period(startDate, endDate), "flight");
  return rows
    .sort((a, b) => b.collectedAmount - a.collectedAmount)
    .slice(0, limit)
    .map(r => ({
      ...money(r),
      flightId: r.flightId,
      flightNumber: r.flightNumber,
      originCode: r.originCode,
      destinationCode: r.destinationCode,
      itineraryType: r.itineraryType,
      distanceKm: null,
      rpk: null,
      yield: null,
      loadFactor: null,
      yieldStatus: "unavailable" as const,
    }));
}
export async function getRefundImpact(startDate?: Date, endDate?: Date) {
  const p = period(startDate, endDate);
  return await financialSnapshot(async tx => {
    const [total] = await readFinancialGroups(tx, p, "total");
    const months = await readFinancialGroups(tx, p, "month");
    return {
      ...FINANCIAL_BASIS,
      totalRefunds: total.refundedAmount,
      refundCount: total.refundEntries,
      refundedBookings: total.refundedBookings,
      activeBookings: total.activeBookings,
      averageRefundAmount: average(total.refundedAmount, total.refundEntries),
      refundRate: percentage(total.refundedBookings, total.activeBookings),
      refundsByMonth: months
        .filter(r => r.refundEntries > 0)
        .map(r => ({
          month: r.date,
          amount: r.refundedAmount,
          count: r.refundEntries,
        })),
    };
  });
}
function monthlyPeriod(month: number, year: number) {
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(year) ||
    year < 1970 ||
    year > 9999
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid report month",
    });
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1)),
    endDate: new Date(Date.UTC(year, month, 1) - 1),
  };
}
/** A preview is not a persisted or finalized accounting report. Durable exported
 * snapshots and their checksums remain owned by the data-warehouse service. */
export async function generateRevenueReport(
  month: number,
  year: number,
  generatedBy: number
) {
  if (year < 2020 || year > 2100)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid report year",
    });
  const p = monthlyPeriod(month, year);
  const data = await getRevenueDashboard(p.startDate, p.endDate);
  return {
    ...data,
    id: `REV-PREVIEW-${year}-${String(month).padStart(2, "0")}`,
    reportType: "monthly" as const,
    periodStart: p.startDate.toISOString().slice(0, 10),
    periodEnd: p.endDate.toISOString().slice(0, 10),
    refundAmount: data.refundTotal,
    status: "preview" as const,
    generatedBy,
    generatedAt: new Date().toISOString(),
  };
}
export async function getReports(limit = 12) {
  limitValue(limit);
  const months = await getFinancialGroups({}, "month");
  return months
    .slice(-limit)
    .reverse()
    .map(r => {
      const [year, month] = r.date.split("-").map(Number);
      const p = monthlyPeriod(month, year);
      return {
        ...FINANCIAL_BASIS,
        ...unavailable,
        id: `REV-PREVIEW-${r.date}`,
        reportType: "monthly" as const,
        periodStart: p.startDate.toISOString().slice(0, 10),
        periodEnd: p.endDate.toISOString().slice(0, 10),
        totalRevenue: r.collectedAmount,
        refundAmount: r.refundedAmount,
        netRevenue: r.netAmount,
        status: "preview" as const,
        generatedAt: new Date().toISOString(),
      };
    });
}
