import { beforeEach, describe, expect, it } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import { computeBaggageEntitlement } from "../services/baggage-entitlement.service";

function baseSeed() {
  return {
    bookings: [{ id: 7, cabinClass: "economy" }],
    passengers: [
      { id: 11, bookingId: 7 },
      { id: 12, bookingId: 7 },
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
