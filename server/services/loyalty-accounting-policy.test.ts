import { describe, expect, it } from "vitest";
import {
  allocateLoyaltyContractLiability,
  recognizeLoyaltyRedemption,
  resolveMilesExpiry,
  type ApprovedLoyaltyPolicy,
} from "./loyalty-accounting-policy";
import { loyaltyAllocationIdempotencyKey } from "./loyalty-liability-ledger.service";

const policy: ApprovedLoyaltyPolicy = {
  id: 7,
  tenantId: 2,
  version: "FIN-2026-01",
  status: "approved",
  expiryMode: "activity",
  expiryMonths: 24,
  mileStandaloneValueMinor: 2,
  expectedBreakageBasisPoints: 2_000,
  currency: "SAR",
  effectiveAt: new Date("2026-01-01T00:00:00Z"),
  approvedBy: 19,
  approvedAt: new Date("2025-12-20T00:00:00Z"),
};

describe("loyalty accounting policy", () => {
  it("keeps miles non-expiring without an approved policy", () => {
    expect(
      resolveMilesExpiry(null, new Date("2026-01-31T00:00:00Z"))
    ).toBeNull();
  });

  it("uses calendar months for an approved activity policy", () => {
    expect(
      resolveMilesExpiry(
        policy,
        new Date("2026-01-15T00:00:00Z"),
        new Date("2026-01-31T00:00:00Z")
      )?.toISOString()
    ).toBe("2028-01-31T00:00:00.000Z");
  });

  it("allocates consideration using relative standalone selling prices", () => {
    expect(
      allocateLoyaltyContractLiability({
        transactionPriceMinor: 100_000,
        travelStandalonePriceMinor: 100_000,
        awardedMiles: 10_000,
        policy,
      })
    ).toEqual({
      transactionPriceMinor: 100_000,
      loyaltyStandaloneValueMinor: 20_000,
      allocatedAmountMinor: 16_667,
      expectedBreakageMinor: 3_333,
      deferredAmountMinor: 16_667,
    });
  });

  it("recognizes expected breakage proportionally to rights exercised", () => {
    expect(
      recognizeLoyaltyRedemption({
        allocatedAmountMinor: 16_667,
        expectedBreakageBasisPoints: 2_000,
        awardedMiles: 10_000,
        redeemedMilesToDate: 4_000,
        alreadyRecognizedMinor: 0,
      })
    ).toEqual({
      recognizedDeltaMinor: 8_334,
      cumulativeRecognizedMinor: 8_334,
      deferredAmountAfterMinor: 8_333,
    });
  });

  it("rejects an unapproved or future policy shape", () => {
    expect(() =>
      resolveMilesExpiry(
        { ...policy, effectiveAt: new Date("2030-01-01T00:00:00Z") },
        new Date("2026-01-01T00:00:00Z")
      )
    ).toThrow("not effective");
  });

  it("rejects a policy that was effective but not yet approved on the credit date", () => {
    expect(() =>
      resolveMilesExpiry(
        { ...policy, approvedAt: new Date("2026-07-01T00:00:00Z") },
        new Date("2026-06-01T00:00:00Z")
      )
    ).toThrow("approval evidence");
  });

  it("derives stable allocation receipts from the business state", () => {
    const input = {
      tenantId: 2,
      bookingId: 44,
      userId: 9,
      awardedMiles: 1_000,
      transactionPriceMinor: 50_000,
      travelStandalonePriceMinor: 50_000,
      occurredAt: new Date("2026-02-01T00:00:00Z"),
      policy,
      settlementReferences: ["receipt:88"],
    };
    expect(loyaltyAllocationIdempotencyKey(input)).toBe(
      "loyalty-allocation-v1:2:44:7:50000:1000"
    );
    expect(
      loyaltyAllocationIdempotencyKey({
        ...input,
        transactionPriceMinor: 49_000,
      })
    ).not.toBe(loyaltyAllocationIdempotencyKey(input));
  });
});
