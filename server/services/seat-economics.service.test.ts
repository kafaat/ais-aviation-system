import { describe, it, expect } from "vitest";
import {
  allocateProportional,
  computeSeatEconomics,
  DEFAULT_PAYMENT_FEE_FIXED,
  DEFAULT_PAYMENT_FEE_RATE,
  type SeatEconomicsInput,
} from "./seat-economics.service";

describe("allocateProportional", () => {
  it("splits exactly and evenly when weights are equal", () => {
    expect(allocateProportional(100, [1, 1, 1, 1])).toEqual([25, 25, 25, 25]);
  });

  it("distributes the remainder via largest fractional part", () => {
    // 10 / 3 = 3.33 each -> [4,3,3] summing to 10
    const parts = allocateProportional(10, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(parts).toEqual([4, 3, 3]);
  });

  it("allocates proportional to weights and sums exactly", () => {
    const parts = allocateProportional(448, [7000, 5000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(448);
    expect(parts).toEqual([261, 187]);
  });

  it("falls back to even split when all weights are zero", () => {
    expect(allocateProportional(9, [0, 0])).toEqual([5, 4]);
  });

  it("handles a zero total", () => {
    expect(allocateProportional(0, [3, 1])).toEqual([0, 0]);
  });
});

describe("computeSeatEconomics", () => {
  const base = (
    over: Partial<SeatEconomicsInput> = {}
  ): SeatEconomicsInput => ({
    baseFareTotal: 10000,
    currency: "SAR",
    seats: [{ passengerId: 1, name: "A", seatNumber: "1A" }],
    ancillaries: [],
    discountsTotal: 0,
    agentCommission: 0,
    ...over,
  });

  it("computes a single seat with only base fare + estimated payment fee", () => {
    const r = computeSeatEconomics(base());
    const fee =
      Math.round(10000 * DEFAULT_PAYMENT_FEE_RATE) + DEFAULT_PAYMENT_FEE_FIXED; // 290+100
    expect(fee).toBe(390);
    expect(r.seats).toHaveLength(1);
    expect(r.summary.gross).toBe(10000);
    expect(r.summary.paymentFee).toBe(390);
    expect(r.summary.netContribution).toBe(10000 - 390);
  });

  it("keeps seat-level sums consistent with the booking summary", () => {
    const r = computeSeatEconomics(
      base({
        baseFareTotal: 10000,
        seats: [
          { passengerId: 1, name: "A", seatNumber: "1A" },
          { passengerId: 2, name: "B", seatNumber: "1B" },
        ],
        ancillaries: [{ passengerId: 1, totalPrice: 2000 }],
      })
    );

    // Base split evenly; ancillary attributed to seat 1.
    expect(r.seats[0].revenue.baseFare).toBe(5000);
    expect(r.seats[1].revenue.baseFare).toBe(5000);
    expect(r.seats[0].revenue.ancillaries).toBe(2000);
    expect(r.seats[1].revenue.ancillaries).toBe(0);
    expect(r.summary.gross).toBe(12000);

    // Invariants: per-seat sums equal the summary.
    const sum = (pick: (s: (typeof r.seats)[number]) => number) =>
      r.seats.reduce((a, s) => a + pick(s), 0);
    expect(sum(s => s.revenue.gross)).toBe(r.summary.gross);
    expect(sum(s => s.cost.totalCost)).toBe(r.summary.totalCost);
    expect(sum(s => s.netContribution)).toBe(r.summary.netContribution);
  });

  it("pools ancillaries with no passenger across all seats", () => {
    const r = computeSeatEconomics(
      base({
        seats: [
          { passengerId: 1, name: "A", seatNumber: null },
          { passengerId: 2, name: "B", seatNumber: null },
        ],
        ancillaries: [{ passengerId: null, totalPrice: 1000 }],
      })
    );
    expect(r.seats[0].revenue.ancillaries).toBe(500);
    expect(r.seats[1].revenue.ancillaries).toBe(500);
  });

  it("treats discounts as contra-revenue and charges fee on the net amount", () => {
    const r = computeSeatEconomics(base({ discountsTotal: 1000 }));
    // payment fee base = gross - discount = 9000
    const fee =
      Math.round(9000 * DEFAULT_PAYMENT_FEE_RATE) + DEFAULT_PAYMENT_FEE_FIXED; // 261+100
    expect(r.summary.paymentFee).toBe(fee);
    expect(r.summary.netRevenue).toBe(9000);
    expect(r.summary.netContribution).toBe(9000 - fee);
  });

  it("subtracts agent commission from contribution", () => {
    const r = computeSeatEconomics(base({ agentCommission: 500 }));
    expect(r.summary.agentCommission).toBe(500);
    expect(r.summary.netContribution).toBe(10000 - 390 - 500);
  });

  it("surfaces the costing assumptions", () => {
    const r = computeSeatEconomics(
      base({ paymentFeeRate: 0.02, paymentFeeFixed: 50 })
    );
    expect(r.assumptions.paymentFeeRate).toBe(0.02);
    expect(r.assumptions.paymentFeeFixed).toBe(50);
  });

  it("throws when there are no seats", () => {
    expect(() => computeSeatEconomics(base({ seats: [] }))).toThrow();
  });
});
