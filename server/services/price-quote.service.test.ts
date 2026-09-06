import { describe, it, expect } from "vitest";
import {
  computePriceQuote,
  TIER_DISCOUNT_RATE,
  type PriceQuoteInput,
} from "./price-quote.service";

const base = (over: Partial<PriceQuoteInput> = {}): PriceQuoteInput => ({
  baseFare: 50000, // 500.00 SAR
  ancillaries: [],
  ...over,
});

describe("computePriceQuote", () => {
  it("returns base fare as total when nothing else applies", () => {
    const q = computePriceQuote(base());
    expect(q.subtotal).toBe(50000);
    expect(q.tierDiscount).toBe(0);
    expect(q.total).toBe(50000);
    expect(q.currency).toBe("SAR");
  });

  it("adds ancillaries to the subtotal", () => {
    const q = computePriceQuote(
      base({
        ancillaries: [
          { id: 1, name: "Bag 20kg", price: 5000 },
          { id: 2, name: "Extra legroom", price: 3000 },
        ],
      })
    );
    expect(q.ancillariesTotal).toBe(8000);
    expect(q.subtotal).toBe(58000);
    expect(q.total).toBe(58000);
  });

  it("applies a tier discount to the subtotal", () => {
    const q = computePriceQuote(
      base({
        ancillaries: [{ id: 1, name: "Bag", price: 10000 }],
        loyaltyTier: "gold",
      })
    );
    // subtotal 60000, gold 5% = 3000 discount
    expect(q.tierDiscountRate).toBe(TIER_DISCOUNT_RATE.gold);
    expect(q.tierDiscount).toBe(3000);
    expect(q.total).toBe(57000);
  });

  it("gives bronze no purchase discount", () => {
    const q = computePriceQuote(base({ loyaltyTier: "bronze" }));
    expect(q.tierDiscount).toBe(0);
    expect(q.total).toBe(50000);
  });

  it("redeems miles after the tier discount (1 mile = 1 cent)", () => {
    const q = computePriceQuote(
      base({ loyaltyTier: "platinum", milesToRedeem: 2000 })
    );
    // subtotal 50000, platinum 8% = 4000 -> afterTier 46000, miles 2000 -> 44000
    expect(q.tierDiscount).toBe(4000);
    expect(q.milesDiscount).toBe(2000);
    expect(q.milesRedeemed).toBe(2000);
    expect(q.total).toBe(44000);
  });

  it("clamps miles so the total never goes below zero", () => {
    const q = computePriceQuote(
      base({ baseFare: 1000, milesToRedeem: 999999 })
    );
    expect(q.milesDiscount).toBe(1000);
    expect(q.total).toBe(0);
  });

  it("ignores negative ancillary prices and negative miles", () => {
    const q = computePriceQuote(
      base({
        ancillaries: [{ id: 1, name: "Bad", price: -500 }],
        milesToRedeem: -10,
      })
    );
    expect(q.ancillariesTotal).toBe(0);
    // The returned breakdown must agree with the total: the bad line item is
    // clamped to 0, not echoed back as -500.
    expect(q.ancillaries).toEqual([{ id: 1, name: "Bad", price: 0 }]);
    expect(q.milesDiscount).toBe(0);
    expect(q.total).toBe(50000);
  });

  it("returned ancillary line items always sum to ancillariesTotal", () => {
    const q = computePriceQuote(
      base({
        ancillaries: [
          { id: 1, name: "Bag", price: 1999.6 }, // fractional → rounded
          { id: 2, name: "Meal", price: -100 }, // negative → clamped
          { id: 3, name: "Seat", price: 3000 },
        ],
      })
    );
    const lineSum = q.ancillaries.reduce((s, a) => s + a.price, 0);
    expect(lineSum).toBe(q.ancillariesTotal);
    expect(q.ancillariesTotal).toBe(2000 + 0 + 3000);
    expect(q.ancillaries.map(a => a.price)).toEqual([2000, 0, 3000]);
  });
});
