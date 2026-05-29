/**
 * Price Quote Service
 *
 * Customer-facing price composition: turns a flight + selected ancillaries +
 * loyalty status into a transparent price breakdown
 *
 *   total = base fare + ancillaries − loyalty-tier discount − miles redeemed
 *
 * This is the revenue/customer-side counterpart to seat-economics.service.ts
 * (which computes the airline's cost / net contribution). It is read-only and
 * has no side effects — miles are treated as a "what-if" quote input and are
 * NOT deducted from the member's balance here.
 *
 * Inspired by the Lufthansa-style Pricing Service pattern, implemented natively
 * on AIS's existing tables (flights.economyPrice/businessPrice,
 * ancillaryServices.price, loyalty tiers). All money is in SAR minor units (cents).
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { flights, ancillaryServices } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";
export type CabinClass = "economy" | "business";

/**
 * Tier-based purchase discount applied to (base fare + ancillaries).
 * Configurable; mirrors the loyalty earn-multiplier tiers already in
 * loyalty.service.ts. Bronze gets no purchase discount.
 */
export const TIER_DISCOUNT_RATE: Record<LoyaltyTier, number> = {
  bronze: 0,
  silver: 0.02,
  gold: 0.05,
  platinum: 0.08,
};

/** 1 redeemed mile = 1 SAR cent of discount (matches loyalty.service.ts). */
export const MILE_VALUE_CENTS = 1;

export interface QuoteAncillary {
  id: number;
  name: string;
  price: number; // cents
}

export interface PriceQuoteInput {
  baseFare: number; // cents
  ancillaries: QuoteAncillary[];
  loyaltyTier?: LoyaltyTier | null;
  milesToRedeem?: number;
  currency?: string;
}

export interface PriceQuote {
  currency: string;
  baseFare: number;
  ancillaries: QuoteAncillary[];
  ancillariesTotal: number;
  subtotal: number;
  loyaltyTier: LoyaltyTier | null;
  tierDiscountRate: number;
  tierDiscount: number;
  milesRedeemed: number;
  milesDiscount: number;
  total: number;
}

/**
 * Pure price composition (unit-testable without a database).
 */
export function computePriceQuote(input: PriceQuoteInput): PriceQuote {
  const currency = input.currency ?? "SAR";
  const baseFare = Math.max(0, Math.round(input.baseFare));

  const ancillariesTotal = input.ancillaries.reduce(
    (sum, a) => sum + Math.max(0, a.price),
    0
  );
  const subtotal = baseFare + ancillariesTotal;

  const tier = input.loyaltyTier ?? null;
  const tierDiscountRate = tier ? TIER_DISCOUNT_RATE[tier] : 0;
  const tierDiscount = Math.round(subtotal * tierDiscountRate);
  const afterTier = subtotal - tierDiscount;

  // Miles are a what-if input: clamp to what's left after the tier discount.
  const requestedMiles = Math.max(0, Math.floor(input.milesToRedeem ?? 0));
  const milesDiscount = Math.min(requestedMiles * MILE_VALUE_CENTS, afterTier);
  const milesRedeemed = Math.floor(milesDiscount / MILE_VALUE_CENTS);

  const total = afterTier - milesDiscount;

  return {
    currency,
    baseFare,
    ancillaries: input.ancillaries,
    ancillariesTotal,
    subtotal,
    loyaltyTier: tier,
    tierDiscountRate,
    tierDiscount,
    milesRedeemed,
    milesDiscount,
    total,
  };
}

export interface GetPriceQuoteInput {
  flightId: number;
  cabinClass: CabinClass;
  ancillaryServiceIds?: number[];
  loyaltyTier?: LoyaltyTier | null;
  milesToRedeem?: number;
}

/**
 * DB-backed quote: resolve the flight fare + ancillary prices, then compose.
 */
export async function getPriceQuote(
  input: GetPriceQuoteInput
): Promise<PriceQuote> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [flight] = await db
    .select({
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
    })
    .from(flights)
    .where(eq(flights.id, input.flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  const baseFare =
    input.cabinClass === "business"
      ? flight.businessPrice
      : flight.economyPrice;

  let ancillaries: QuoteAncillary[] = [];
  const ids = input.ancillaryServiceIds ?? [];
  if (ids.length > 0) {
    const rows = await db
      .select({
        id: ancillaryServices.id,
        name: ancillaryServices.name,
        price: ancillaryServices.price,
      })
      .from(ancillaryServices)
      .where(
        and(
          inArray(ancillaryServices.id, ids),
          eq(ancillaryServices.available, true)
        )
      );
    ancillaries = rows;

    // Surface any requested ancillary that doesn't exist / isn't available.
    const found = new Set(rows.map(r => r.id));
    const missing = ids.filter(id => !found.has(id));
    if (missing.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unknown or inactive ancillary service(s): ${missing.join(", ")}`,
      });
    }
  }

  return computePriceQuote({
    baseFare,
    ancillaries,
    loyaltyTier: input.loyaltyTier ?? null,
    milesToRedeem: input.milesToRedeem,
  });
}
