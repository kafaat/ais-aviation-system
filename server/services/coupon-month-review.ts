import { TRPCError } from "@trpc/server";
import { and, asc, eq, lt, or, isNull, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  aviationEvidence,
  bookings,
  bookingSegments,
  passengers,
  financialLedger,
  ticketCoupons,
  bookingFareComponents,
  loyaltyContractLiabilityEvents,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { nonCashFundingCondition } from "./financial-reporting.service";

const minor = z.number().int();
export const couponMonthResult = z.object({
  basis: z.literal("local_coupon_close_review"),
  bookingId: z.number().int(),
  month: z.string(),
  asOf: z.date(),
  closedMonth: z.boolean(),
  cashNetInMonthMinor: minor.nullable(),
  cashNetThroughCutoffMinor: minor.nullable(),
  loyaltyDeferredMinor: minor.nullable(),
  transportDeferredMinor: minor.nullable(),
  transportRecognizedThroughCutoffMinor: minor.nullable(),
  transportRecognizedInMonthMinor: minor.nullable(),
  currency: z.literal("SAR"),
  issues: z.array(z.string()),
  coupons: z.array(
    z.object({
      couponId: z.number(),
      flightId: z.number(),
      passengerId: z.number(),
      status: z.string(),
      baseFareMinor: minor.nullable(),
      upliftEvidenceId: z.number().nullable(),
    })
  ),
});
export const couponMonthInput = z.strictObject({
  bookingId: z.number().int().positive(),
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
});

/** Conservative close for one booking. Cash is reported independently, and
 * only mapped transport base fares can enter either transport bucket. Unknown
 * allocations and overwritten historical statuses deliberately yield null. */
export async function reviewCouponMonth(
  input: z.infer<typeof couponMonthInput>,
  tenantId: number,
  now = new Date()
) {
  const start = new Date(input.month + "-01T00:00:00.000Z");
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
  );
  if (start > now)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Future month" });
  const cutoff = end < now ? end : now,
    bookingId = input.bookingId;
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return await db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.id, bookingId),
          lt(bookings.createdAt, cutoff)
        )
      );
    if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
    const cash = await tx
      .select({
        type: financialLedger.type,
        minor: sql<string>`${financialLedger.amount}*100`,
        currency: financialLedger.currency,
        at: financialLedger.transactionDate,
        nonCash: sql<number>`${nonCashFundingCondition()}`,
      })
      .from(financialLedger)
      .where(
        and(
          eq(financialLedger.bookingId, bookingId),
          lt(financialLedger.transactionDate, cutoff),
          lt(financialLedger.createdAt, cutoff)
        )
      );
    const cps = await tx
      .select()
      .from(ticketCoupons)
      .where(
        and(
          eq(ticketCoupons.bookingId, bookingId),
          lt(ticketCoupons.createdAt, cutoff)
        )
      )
      .orderBy(asc(ticketCoupons.id));
    const pax = await tx
      .select({ id: passengers.id })
      .from(passengers)
      .where(
        and(
          eq(passengers.bookingId, bookingId),
          lt(passengers.createdAt, cutoff)
        )
      );
    const segments = await tx
      .select()
      .from(bookingSegments)
      .where(
        and(
          eq(bookingSegments.bookingId, bookingId),
          lt(bookingSegments.createdAt, cutoff)
        )
      );
    const components = await tx
      .select()
      .from(bookingFareComponents)
      .where(
        and(
          eq(bookingFareComponents.bookingId, bookingId),
          lt(bookingFareComponents.createdAt, cutoff),
          or(
            isNull(bookingFareComponents.reversedAt),
            gte(bookingFareComponents.reversedAt, cutoff)
          )
        )
      );
    const evidence = await tx
      .select()
      .from(aviationEvidence)
      .where(
        and(
          eq(aviationEvidence.kind, "coupon_uplift"),
          eq(aviationEvidence.tenantId, tenantId),
          lt(aviationEvidence.receivedAt, cutoff),
          lt(aviationEvidence.observedAt, cutoff),
          sql`JSON_EXTRACT(${aviationEvidence.payload}, '$.bookingId') = ${bookingId}`
        )
      );
    const liabilities = await tx
      .select()
      .from(loyaltyContractLiabilityEvents)
      .where(
        and(
          eq(loyaltyContractLiabilityEvents.bookingId, bookingId),
          eq(loyaltyContractLiabilityEvents.tenantId, tenantId),
          lt(loyaltyContractLiabilityEvents.occurredAt, cutoff),
          lt(loyaltyContractLiabilityEvents.createdAt, cutoff)
        )
      )
      .orderBy(
        asc(loyaltyContractLiabilityEvents.occurredAt),
        asc(loyaltyContractLiabilityEvents.id)
      );
    const issues = new Set<string>();
    let cashMonth = 0,
      cashToDate = 0,
      funded = 0,
      cashKnown = true;
    for (const r of cash) {
      const n = Number(r.minor);
      if (
        r.currency !== "SAR" ||
        !Number.isSafeInteger(n) ||
        n < 0 ||
        !["charge", "refund", "partial_refund"].includes(r.type)
      ) {
        cashKnown = false;
        issues.add("unclassified_ledger");
        continue;
      }
      const signed = r.type === "charge" ? n : -n;
      funded += signed;
      if (!Number(r.nonCash)) {
        cashToDate += signed;
        if (r.at >= start) cashMonth += signed;
      }
    }
    // For older reopened snapshots the current row cannot prove a past state.
    if (
      cps.some(c => c.updatedAt >= cutoff) ||
      segments.some(s => s.updatedAt >= cutoff)
    )
      issues.add("historical_state_unavailable");
    const key = (p: number, f: number) => p + "/" + f;
    const expected = new Set(
      pax.flatMap(p =>
        (segments.length
          ? segments.map(s => s.flightId)
          : [booking.flightId]
        ).map(f => key(p.id, f))
      )
    );
    if (
      !expected.size ||
      (segments.length && segments.some(s => s.status === "cancelled"))
    )
      issues.add("itinerary_requires_review");
    const seen = new Set<string>();
    let used = 0,
      open = 0,
      usedMonth = 0;
    const details = cps.map(c => {
      const k = key(c.passengerId, c.flightId);
      const base = components.filter(
        x =>
          x.tenantId === tenantId &&
          x.passengerId === c.passengerId &&
          x.flightId === c.flightId &&
          x.componentType === "base_fare"
      );
      const value =
        base.length === 1 && base[0].amount >= 0 ? base[0].amount : null;
      const proof = evidence.filter(
        e =>
          e.flightId === c.flightId &&
          e.payload.passengerId === c.passengerId &&
          e.payload.couponId === c.id
      );
      if (c.status !== "E" && c.status !== "V" && c.status !== "R") {
        if (seen.has(k) || !expected.has(k))
          issues.add("ambiguous_coupon_scope");
        seen.add(k);
        if (value === null) issues.add("missing_or_ambiguous_coupon_fare");
        if (c.status === "F" && proof.length === 1) {
          used += value ?? 0;
          if (proof[0].observedAt >= start) usedMonth += value ?? 0;
        } else if ((c.status === "O" || c.status === "C") && !proof.length)
          open += value ?? 0;
        else issues.add("unproven_coupon_status");
      }
      return {
        couponId: c.id,
        passengerId: c.passengerId,
        flightId: c.flightId,
        status: c.updatedAt >= cutoff ? "unknown_at_cutoff" : c.status,
        baseFareMinor: value,
        upliftEvidenceId: proof.length === 1 ? proof[0].id : null,
      };
    });
    if ([...expected].some(k => !seen.has(k))) issues.add("missing_coupon");
    if (
      !components.length ||
      components.some(
        r =>
          r.tenantId !== tenantId ||
          r.currency !== "SAR" ||
          r.amount < 0 ||
          ["discount", "unclassified", "carrier_surcharge"].includes(
            r.componentType
          ) ||
          (r.componentType === "base_fare" &&
            (r.passengerId === null ||
              !seen.has(key(r.passengerId, r.flightId))))
      )
    )
      issues.add("unmapped_fare_components");
    const commercialTotal = components.reduce((s, c) => s + c.amount, 0);
    if (!cashKnown || funded <= 0 || funded !== commercialTotal)
      issues.add("funding_not_reconciled");
    const allocation = liabilities[0];
    // Current writer posts one booking-level allocation. Multiple lots, reversals
    // or split travel/redemption allocations need their own conserved mapping.
    const singleAllocation =
      liabilities.length === 1 &&
      allocation.eventType === "allocate" &&
      allocation.currency === "SAR" &&
      allocation.allocatedAmountMinor >= 0 &&
      allocation.deferredAmountAfterMinor === allocation.allocatedAmountMinor &&
      allocation.recognizedAmountMinor === 0;
    const loyalty = !liabilities.length
      ? 0
      : singleAllocation
        ? allocation.deferredAmountAfterMinor
        : null;
    if (
      liabilities.length &&
      (!singleAllocation ||
        !allocation.evidence ||
        typeof allocation.evidence !== "object" ||
        !("transactionPriceMinor" in allocation.evidence) ||
        allocation.evidence.transactionPriceMinor !== used + open ||
        allocation.allocatedAmountMinor > used + open ||
        (used > 0 && open > 0) ||
        (usedMonth > 0 && usedMonth < used))
    )
      issues.add("coupon_loyalty_allocation_unmapped");
    const ready = issues.size === 0,
      loyaltyMinor = loyalty ?? 0;
    return {
      basis: "local_coupon_close_review" as const,
      bookingId,
      month: input.month,
      asOf: cutoff,
      closedMonth: cutoff === end,
      currency: "SAR" as const,
      cashNetInMonthMinor: cashKnown ? cashMonth : null,
      cashNetThroughCutoffMinor: cashKnown ? cashToDate : null,
      loyaltyDeferredMinor: loyalty,
      transportDeferredMinor: ready
        ? open - (open > 0 ? loyaltyMinor : 0)
        : null,
      transportRecognizedThroughCutoffMinor: ready
        ? used - (used > 0 ? loyaltyMinor : 0)
        : null,
      transportRecognizedInMonthMinor: ready
        ? usedMonth - (usedMonth > 0 ? loyaltyMinor : 0)
        : null,
      issues: [...issues],
      coupons: details,
    };
  });
}
