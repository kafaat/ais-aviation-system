import { beforeEach, describe, expect, it } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  computeBaggageEntitlement,
  listOwnedBaggageEntitlements,
} from "../services/baggage-entitlement.service";

function baseSeed() {
  return {
    bookings: [
      {
        id: 7,
        cabinClass: "economy",
        userId: 1,
        tenantId: 3,
        status: "confirmed",
      },
    ],
    passengers: [
      { id: 11, bookingId: 7, tenantId: 3 },
      { id: 12, bookingId: 7, tenantId: 3 },
    ],
    booking_segments: [
      { id: 21, bookingId: 7, flightId: 31 },
      { id: 22, bookingId: 7, flightId: 32 },
    ],
    ancillary_services: [
      { id: 41, category: "baggage", name: "10kg baggage" },
      { id: 42, category: "meal", name: "Meal" },
    ],
    booking_modifications: [
      {
        id: 51,
        bookingId: 7,
        status: "completed",
        paymentStatus: "paid",
        totalCost: 5000,
        stripePaymentIntentId: "pi_bag",
        executionEventId: "event-bag",
      },
      {
        id: 52,
        bookingId: 7,
        status: "completed",
        paymentStatus: "paid",
        totalCost: 0,
        executionEventId: "event-free",
      },
    ],
    payment_receipts: [
      {
        paymentIntentId: "pi_bag",
        kind: "modification",
        bookingId: 7,
        targetId: 51,
        settlementStatus: "applied",
        refundedAmount: 0,
      },
    ],
    booking_ancillaries: [] as Record<string, unknown>[],
  };
}

function paidBaggage(overrides: Record<string, unknown> = {}) {
  return {
    id: 61,
    bookingId: 7,
    passengerId: 11,
    ancillaryServiceId: 41,
    status: "active",
    weightSnapshotGrams: 10000,
    fundedAt: new Date(),
    fundingReference: {
      kind: "collected_modification",
      modificationId: 51,
      paymentIntentId: "pi_bag",
      executionEventId: "event-bag",
    },
    metadata: JSON.stringify({ preferences: { modificationId: 51 } }),
    segmentId: 21,
    scopeState: "specific_segment",
    ...overrides,
  };
}

describe("baggage entitlement authority", () => {
  let seed: ReturnType<typeof baseSeed>;
  beforeEach(() => {
    seed = baseSeed();
  });

  async function entitlement(passengerId = 11, segmentId = 21) {
    const fixture = transactionMemory(seed);
    return computeBaggageEntitlement(fixture.db, {
      bookingId: 7,
      passengerId,
      segmentId,
    });
  }

  it("presents owner-scoped entitlements without financial references", async () => {
    seed.booking_ancillaries.push(paidBaggage());
    const rows = await listOwnedBaggageEntitlements(
      transactionMemory(seed).db,
      7,
      { id: 1, role: "user", tenantId: 3 }
    );
    expect(rows).toHaveLength(4);
    expect(
      rows.find(row => row.passengerId === 11 && row.segmentId === 21)
        ?.totalWeightGrams
    ).toBe(33000);
    expect(JSON.stringify(rows)).not.toContain("pi_bag");
    expect(JSON.stringify(rows)).not.toContain("fundingReference");
  });
  it("rejects another owner and an administrator from another tenant", async () => {
    const db = transactionMemory(seed).db;
    await expect(
      listOwnedBaggageEntitlements(db, 7, { id: 2, role: "user", tenantId: 3 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      listOwnedBaggageEntitlements(db, 7, { id: 2, role: "admin", tenantId: 4 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await listOwnedBaggageEntitlements(db, 7, {
        id: 2,
        role: "admin",
        tenantId: 3,
      })
    ).toHaveLength(4);
  });
  it("does not present a cancelled booking as an active allowance", async () => {
    seed.bookings[0].status = "cancelled";
    expect(
      await listOwnedBaggageEntitlements(transactionMemory(seed).db, 7, {
        id: 1,
        role: "user",
        tenantId: 3,
      })
    ).toEqual([]);
  });

  it("adds only a funded purchase snapshot and keeps the 32kg piece limit", async () => {
    seed.booking_ancillaries.push(paidBaggage());
    const result = await entitlement();
    expect(result).toMatchObject({
      totalWeightGrams: 33000,
      maxBagWeightGrams: 32000,
      requiresOperationalReview: false,
    });
    expect(result.sources.map(source => source.weightGrams)).toEqual([
      23000, 10000,
    ]);
  });

  it("excludes an unfunded item and reports it instead of granting weight", async () => {
    seed.booking_ancillaries.push(
      paidBaggage({ fundedAt: null, fundingReference: null })
    );
    const result = await entitlement();
    expect(result.totalWeightGrams).toBe(23000);
    expect(result.warnings.map(warning => warning.code)).toEqual([
      "missing_funding",
    ]);
    expect(result.requiresOperationalReview).toBe(true);
  });

  it("requires the funding timestamp even when the receipt reference is valid", async () => {
    seed.booking_ancillaries.push(paidBaggage({ fundedAt: null }));
    const result = await entitlement();
    expect(result.totalWeightGrams).toBe(23000);
    expect(result.warnings.map(warning => warning.code)).toContain(
      "missing_funding"
    );
    expect(result.requiresOperationalReview).toBe(true);
  });

  it("isolates passenger and segment scopes", async () => {
    seed.booking_ancillaries.push(
      paidBaggage(),
      paidBaggage({ id: 62, passengerId: 12 }),
      paidBaggage({ id: 63, segmentId: 22 })
    );
    expect((await entitlement()).totalWeightGrams).toBe(33000);
    expect((await entitlement(12)).totalWeightGrams).toBe(33000);
    expect((await entitlement(11, 22)).totalWeightGrams).toBe(33000);
  });

  it("requires approved explicit scope and structured weight", async () => {
    seed.booking_ancillaries.push(
      paidBaggage({ id: 62, segmentId: null, scopeState: "unresolved" }),
      paidBaggage({ id: 63, weightSnapshotGrams: null })
    );
    const result = await entitlement();
    expect(result.totalWeightGrams).toBe(23000);
    expect(result.warnings.map(warning => warning.code).sort()).toEqual([
      "missing_scope",
      "missing_weight_snapshot",
    ]);
  });

  it("proves the allowance before and after cancellation", async () => {
    const item = paidBaggage();
    seed.booking_ancillaries.push(item);
    expect((await entitlement()).totalWeightGrams).toBe(33000);
    item.status = "cancelled";
    expect((await entitlement()).totalWeightGrams).toBe(23000);
  });

  it("accepts an applied no-charge authority without inventing collection", async () => {
    seed.booking_ancillaries.push(
      paidBaggage({
        metadata: JSON.stringify({ preferences: { modificationId: 52 } }),
        fundingReference: {
          kind: "authorized_no_charge",
          modificationId: 52,
          executionEventId: "event-free",
        },
      })
    );
    expect(await entitlement()).toMatchObject({
      totalWeightGrams: 33000,
      requiresOperationalReview: false,
    });
  });

  it("accepts a provider-funded single-passenger booking reference", async () => {
    Object.assign(seed.bookings[0], {
      paymentStatus: "paid",
      stripePaymentIntentId: "pi_booking",
    });
    seed.payment_receipts.push({
      paymentIntentId: "pi_booking",
      kind: "booking",
      bookingId: 7,
      targetId: 7,
      settlementStatus: "applied",
      refundedAmount: 0,
    });
    seed.booking_ancillaries.push(
      paidBaggage({
        metadata: null,
        fundingReference: {
          kind: "collected_booking",
          bookingId: 7,
          paymentIntentId: "pi_booking",
        },
      })
    );
    expect(await entitlement()).toMatchObject({
      totalWeightGrams: 33000,
      requiresOperationalReview: false,
    });
  });

  it("sends partially refunded modification baggage for review", async () => {
    seed.booking_ancillaries.push(paidBaggage());
    seed.payment_receipts[0].refundedAmount = 1;
    expect(await entitlement()).toMatchObject({
      totalWeightGrams: 23000,
      requiresOperationalReview: true,
    });
  });

  it.each([
    ["wallet", "wallet-credit"],
    ["user_credit", "internal-credit"],
    ["corporate_credit", "corporate-credit"],
  ])(
    "verifies %s settlement against the original posting and revokes automatic allowance on refund",
    async (tender, prefix) => {
      Object.assign(seed.bookings[0], { paymentStatus: "paid" });
      const entries = [
        {
          id: 88,
          bookingId: 7,
          userId: 1,
          type: "charge",
          amount: "50.00",
          currency: "SAR",
          stripeEventId: prefix + ":7",
          metadata: JSON.stringify({ tender }),
        },
      ];
      Object.assign(seed, { financial_ledger: entries });
      seed.booking_ancillaries.push(
        paidBaggage({
          fundingReference: {
            kind: "internal_booking",
            bookingId: 7,
            ledgerId: 88,
            tender,
            amountMinor: 5000,
          },
        })
      );
      expect((await entitlement()).totalWeightGrams).toBe(33000);
      entries.push({ ...entries[0], id: 89, type: "partial_refund" });
      expect(await entitlement()).toMatchObject({
        totalWeightGrams: 23000,
        requiresOperationalReview: true,
      });
    }
  );

  it("requires every split receipt to remain fully collected", async () => {
    Object.assign(seed.bookings[0], {
      paymentStatus: "paid",
      stripePaymentIntentId: "pi_two",
    });
    const shares = ["pi_one", "pi_two"].map((intent, index) => ({
      id: index + 1,
      bookingId: 7,
      status: "paid",
      amount: 2500,
      stripePaymentIntentId: intent,
    }));
    const receipts = shares.map(share => ({
      paymentIntentId: share.stripePaymentIntentId,
      targetId: share.id,
      bookingId: 7,
      kind: "split_payment",
      userId: 1,
      currency: "SAR",
      amount: share.amount,
      refundedAmount: 0,
      settlementStatus: "applied",
    }));
    Object.assign(seed, { payment_splits: shares, payment_receipts: receipts });
    seed.booking_ancillaries.push(
      paidBaggage({
        fundingReference: {
          kind: "split_booking",
          bookingId: 7,
          paymentIntentId: "pi_two",
          amountMinor: 5000,
        },
      })
    );
    expect((await entitlement()).totalWeightGrams).toBe(33000);
    receipts[0].refundedAmount = 100;
    expect(await entitlement()).toMatchObject({
      totalWeightGrams: 23000,
      requiresOperationalReview: true,
    });
  });

  it("returns an operator warning for malformed historical JSON evidence", async () => {
    seed.booking_ancillaries.push(
      paidBaggage({ metadata: "null", fundingReference: "invalid" })
    );
    expect(await entitlement()).toMatchObject({
      totalWeightGrams: 23000,
      requiresOperationalReview: true,
    });
  });

  it("rejects mismatched financial evidence", async () => {
    seed.booking_ancillaries.push(
      paidBaggage({
        fundingReference: {
          kind: "collected_modification",
          modificationId: 51,
          paymentIntentId: "pi_wrong",
          executionEventId: "event-bag",
        },
      })
    );
    const result = await entitlement();
    expect(result.totalWeightGrams).toBe(23000);
    expect(result.warnings[0].code).toBe("invalid_funding_evidence");
  });
});
