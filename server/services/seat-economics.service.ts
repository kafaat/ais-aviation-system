/**
 * Seat Economics Service
 *
 * Answers "what is the cost — and net contribution — of every seat?".
 * For a booking (and each occupied seat) it computes:
 *
 *   revenue  = base fare + ancillaries − discounts (vouchers/credits)
 *   cost     = payment-processing fee + travel-agent commission
 *   net      = net revenue − total cost   (the seat's contribution margin)
 *
 * All money is in minor units (SAR cents), matching the rest of the schema.
 *
 * Data model notes (verified against the codebase):
 *  - `bookings.totalAmount` is the BASE FARE only (= pricingResult.price);
 *    ancillaries are stored separately in `bookingAncillaries.totalPrice`
 *    and are NOT folded into totalAmount, so we add them on top.
 *  - Payment-processing fee is not stored anywhere, so it is ESTIMATED from
 *    configurable rates (clearly surfaced in the result under `assumptions`).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { tenantCondition } from "./tenant-scope.service";
import {
  bookings,
  passengers,
  bookingAncillaries,
  voucherUsage,
  creditUsage,
  agentBookings,
  payments,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

/** Estimated payment-processing cost (Stripe-style: percentage + fixed). */
export const DEFAULT_PAYMENT_FEE_RATE = 0.029; // 2.9%
export const DEFAULT_PAYMENT_FEE_FIXED = 100; // 1.00 SAR per transaction, in cents

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeatEconomicsInput {
  baseFareTotal: number; // cents
  currency: string;
  seats: Array<{
    passengerId: number | null;
    name: string;
    seatNumber: string | null;
  }>;
  ancillaries: Array<{ passengerId: number | null; totalPrice: number }>;
  discountsTotal: number; // cents (vouchers + credits)
  agentCommission: number; // cents
  paymentFeeRate?: number;
  paymentFeeFixed?: number; // cents, per booking
}

export interface SeatEconomics {
  passengerId: number | null;
  passengerName: string;
  seatNumber: string | null;
  revenue: {
    baseFare: number;
    ancillaries: number;
    gross: number;
    discounts: number;
    netRevenue: number;
  };
  cost: {
    paymentFee: number;
    agentCommission: number;
    totalCost: number;
  };
  netContribution: number;
  marginPct: number; // netContribution / gross * 100
}

export interface BookingSeatEconomics {
  bookingId?: number;
  currency: string;
  seats: SeatEconomics[];
  summary: {
    seatCount: number;
    baseFare: number;
    ancillaries: number;
    gross: number;
    discounts: number;
    netRevenue: number;
    paymentFee: number;
    agentCommission: number;
    totalCost: number;
    netContribution: number;
    marginPct: number;
  };
  assumptions: {
    paymentFeeRate: number;
    paymentFeeFixed: number;
    note: string;
  };
}

// ---------------------------------------------------------------------------
// Pure computation (unit-testable without a database)
// ---------------------------------------------------------------------------

/**
 * Split `total` across `weights` into integer parts that sum EXACTLY to total
 * (largest-remainder method). Falls back to an even split when all weights are
 * zero. Assumes `total >= 0`.
 */
export function allocateProportional(
  total: number,
  weights: number[]
): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const sumW = weights.reduce((a, b) => a + b, 0);

  if (sumW <= 0) {
    const base = Math.floor(total / n);
    const parts = new Array(n).fill(base);
    let rem = total - base * n;
    for (let i = 0; i < n && rem > 0; i++) {
      parts[i]++;
      rem--;
    }
    return parts;
  }

  const raw = weights.map(w => (total * w) / sumW);
  const parts = raw.map(Math.floor);
  let rem = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rem > 0; k++) {
    parts[order[k].i]++;
    rem--;
  }
  return parts;
}

export function computeSeatEconomics(
  input: SeatEconomicsInput
): BookingSeatEconomics {
  const rate = input.paymentFeeRate ?? DEFAULT_PAYMENT_FEE_RATE;
  const fixed = input.paymentFeeFixed ?? DEFAULT_PAYMENT_FEE_FIXED;
  const seats = input.seats;
  const n = seats.length;

  if (n === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot compute seat economics for zero seats",
    });
  }

  // Base fare: split evenly across seats.
  const basePerSeat = allocateProportional(
    input.baseFareTotal,
    seats.map(() => 1)
  );

  // Ancillaries: those tied to a specific passenger go to that seat; the rest
  // (no passengerId, or an id not on this booking) are pooled and split evenly.
  const seatIds = new Set(
    seats.map(s => s.passengerId).filter((v): v is number => v != null)
  );
  const assigned = seats.map(s =>
    input.ancillaries
      .filter(a => a.passengerId != null && a.passengerId === s.passengerId)
      .reduce((sum, a) => sum + a.totalPrice, 0)
  );
  const unassignedPool = input.ancillaries
    .filter(a => a.passengerId == null || !seatIds.has(a.passengerId))
    .reduce((sum, a) => sum + a.totalPrice, 0);
  const unassignedPerSeat = allocateProportional(
    unassignedPool,
    seats.map(() => 1)
  );
  const ancPerSeat = seats.map((_, i) => assigned[i] + unassignedPerSeat[i]);

  const grossPerSeat = seats.map((_, i) => basePerSeat[i] + ancPerSeat[i]);
  const grossTotal = grossPerSeat.reduce((a, b) => a + b, 0);

  // Payment fee is charged on what the customer actually pays (gross − discounts).
  const paymentFeeBase = Math.max(0, grossTotal - input.discountsTotal);
  const paymentFeeTotal = Math.round(paymentFeeBase * rate) + fixed;

  // Allocate booking-level amounts to seats proportional to seat gross revenue.
  const discountPerSeat = allocateProportional(
    input.discountsTotal,
    grossPerSeat
  );
  const feePerSeat = allocateProportional(paymentFeeTotal, grossPerSeat);
  const commPerSeat = allocateProportional(input.agentCommission, grossPerSeat);

  const seatResults: SeatEconomics[] = seats.map((s, i) => {
    const gross = grossPerSeat[i];
    const discounts = discountPerSeat[i];
    const netRevenue = gross - discounts;
    const paymentFee = feePerSeat[i];
    const agentCommission = commPerSeat[i];
    const totalCost = paymentFee + agentCommission;
    const netContribution = netRevenue - totalCost;
    return {
      passengerId: s.passengerId,
      passengerName: s.name,
      seatNumber: s.seatNumber,
      revenue: {
        baseFare: basePerSeat[i],
        ancillaries: ancPerSeat[i],
        gross,
        discounts,
        netRevenue,
      },
      cost: { paymentFee, agentCommission, totalCost },
      netContribution,
      marginPct: gross > 0 ? round2((netContribution / gross) * 100) : 0,
    };
  });

  const sum = (pick: (s: SeatEconomics) => number) =>
    seatResults.reduce((a, s) => a + pick(s), 0);

  const gross = sum(s => s.revenue.gross);
  const netContribution = sum(s => s.netContribution);

  return {
    currency: input.currency,
    seats: seatResults,
    summary: {
      seatCount: n,
      baseFare: sum(s => s.revenue.baseFare),
      ancillaries: sum(s => s.revenue.ancillaries),
      gross,
      discounts: sum(s => s.revenue.discounts),
      netRevenue: sum(s => s.revenue.netRevenue),
      paymentFee: sum(s => s.cost.paymentFee),
      agentCommission: sum(s => s.cost.agentCommission),
      totalCost: sum(s => s.cost.totalCost),
      netContribution,
      marginPct: gross > 0 ? round2((netContribution / gross) * 100) : 0,
    },
    assumptions: {
      paymentFeeRate: rate,
      paymentFeeFixed: fixed,
      note: "Payment-processing fee is estimated (rate + fixed); base fare is split evenly across seats; per-passenger ancillaries are attributed to their seat.",
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// DB-backed wrappers
// ---------------------------------------------------------------------------

async function getDbOrThrow() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }
  return db;
}

/** Compute per-seat economics for a single booking. */
export async function getBookingSeatEconomics(
  bookingId: number,
  opts: { paymentFeeRate?: number; paymentFeeFixed?: number } = {}
): Promise<BookingSeatEconomics> {
  const db = await getDbOrThrow();

  const [booking] = await db
    .select({
      id: bookings.id,
      totalAmount: bookings.totalAmount,
      numberOfPassengers: bookings.numberOfPassengers,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  // Seats: prefer real passenger rows; fall back to numberOfPassengers.
  const paxRows = await db
    .select({
      id: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      seatNumber: passengers.seatNumber,
    })
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));

  const seats =
    paxRows.length > 0
      ? paxRows.map(p => ({
          passengerId: p.id,
          name: `${p.firstName} ${p.lastName}`.trim(),
          seatNumber: p.seatNumber ?? null,
        }))
      : Array.from({ length: Math.max(1, booking.numberOfPassengers) }, () => ({
          passengerId: null,
          name: "Passenger",
          seatNumber: null,
        }));

  const ancRows = await db
    .select({
      passengerId: bookingAncillaries.passengerId,
      totalPrice: bookingAncillaries.totalPrice,
    })
    .from(bookingAncillaries)
    .where(eq(bookingAncillaries.bookingId, bookingId));

  const voucherRows = await db
    .select({ discountApplied: voucherUsage.discountApplied })
    .from(voucherUsage)
    .where(eq(voucherUsage.bookingId, bookingId));

  const creditRows = await db
    .select({ amountUsed: creditUsage.amountUsed })
    .from(creditUsage)
    .where(eq(creditUsage.bookingId, bookingId));

  const discountsTotal =
    voucherRows.reduce((a, v) => a + v.discountApplied, 0) +
    creditRows.reduce((a, c) => a + c.amountUsed, 0);

  const [agent] = await db
    .select({ commissionAmount: agentBookings.commissionAmount })
    .from(agentBookings)
    .where(eq(agentBookings.bookingId, bookingId))
    .limit(1);

  const [payment] = await db
    .select({ currency: payments.currency })
    .from(payments)
    .where(eq(payments.bookingId, bookingId))
    .limit(1);

  const result = computeSeatEconomics({
    baseFareTotal: booking.totalAmount,
    currency: payment?.currency ?? "SAR",
    seats,
    ancillaries: ancRows.map(a => ({
      passengerId: a.passengerId ?? null,
      totalPrice: a.totalPrice,
    })),
    discountsTotal,
    agentCommission: agent?.commissionAmount ?? 0,
    paymentFeeRate: opts.paymentFeeRate,
    paymentFeeFixed: opts.paymentFeeFixed,
  });

  return { ...result, bookingId };
}

export interface FlightEconomics {
  flightId: number;
  currency: string;
  bookingCount: number;
  seatCount: number;
  gross: number;
  discounts: number;
  netRevenue: number;
  totalCost: number;
  netContribution: number;
  avgNetContributionPerSeat: number;
  marginPct: number;
}

/**
 * Aggregate seat economics across all revenue-bearing bookings on a flight.
 * Realized revenue = bookings whose payment has been captured (paymentStatus
 * "paid"); refunded/failed/pending bookings are excluded.
 */
export async function getFlightEconomics(
  flightId: number,
  opts: { tenantId?: number | null } = {}
): Promise<FlightEconomics> {
  const db = await getDbOrThrow();

  const bookingRows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.flightId, flightId),
        eq(bookings.paymentStatus, "paid"),
        // Tenant isolation (no-op when the caller has no tenant context).
        tenantCondition(bookings.tenantId, opts.tenantId)
      )
    );

  let seatCount = 0;
  let gross = 0;
  let discounts = 0;
  let netRevenue = 0;
  let totalCost = 0;
  let netContribution = 0;
  let currency = "SAR";

  for (const b of bookingRows) {
    const econ = await getBookingSeatEconomics(b.id);
    currency = econ.currency;
    seatCount += econ.summary.seatCount;
    gross += econ.summary.gross;
    discounts += econ.summary.discounts;
    netRevenue += econ.summary.netRevenue;
    totalCost += econ.summary.totalCost;
    netContribution += econ.summary.netContribution;
  }

  return {
    flightId,
    currency,
    bookingCount: bookingRows.length,
    seatCount,
    gross,
    discounts,
    netRevenue,
    totalCost,
    netContribution,
    avgNetContributionPerSeat:
      seatCount > 0 ? Math.round(netContribution / seatCount) : 0,
    marginPct: gross > 0 ? round2((netContribution / gross) * 100) : 0,
  };
}
