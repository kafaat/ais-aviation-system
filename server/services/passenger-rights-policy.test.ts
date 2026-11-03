import { describe, expect, it } from "vitest";
import {
  evaluatePassengerRights,
  PASSENGER_RIGHTS_PRIMARY_SOURCES,
  type ApprovedPassengerRightsProfile,
} from "./passenger-rights-policy";

const profile: ApprovedPassengerRightsProfile = {
  id: 5,
  tenantId: 2,
  jurisdiction: "gaca-2023",
  version: "OPS-LEGAL-2026-01",
  status: "approved",
  sourceUri: PASSENGER_RIGHTS_PRIMARY_SOURCES["gaca-2023"],
  effectiveAt: new Date("2026-01-01T00:00:00Z"),
  approvedBy: 11,
  approvedAt: new Date("2025-12-20T00:00:00Z"),
  rules: [
    {
      event: "cancellation",
      currency: "SAR",
      amount: { kind: "fare_percentage", basisPoints: 15_000 },
      conditions: ["scope_confirmed", "carrier_exception_rejected"],
    },
    {
      event: "refund",
      currency: "SAR",
      refundDeadlineBusinessDays: 7,
      conditions: ["scope_confirmed"],
    },
  ],
};

describe("versioned passenger-rights policy", () => {
  it("fails closed when no approved profile is supplied", () => {
    expect(
      evaluatePassengerRights(null, {
        event: "cancellation",
        occurredAt: new Date("2026-05-01T00:00:00Z"),
        conditionsSatisfied: [],
      })
    ).toMatchObject({ status: "needs_review", amountMinor: null });
  });

  it("requires every recorded condition before calculating", () => {
    expect(
      evaluatePassengerRights(profile, {
        event: "cancellation",
        occurredAt: new Date("2026-05-01T00:00:00Z"),
        fareMinor: 100_00,
        currency: "SAR",
        conditionsSatisfied: ["scope_confirmed"],
      })
    ).toMatchObject({ status: "needs_review", amountMinor: null });
  });

  it("calculates only from an approved profile and audited fare basis", () => {
    expect(
      evaluatePassengerRights(profile, {
        event: "cancellation",
        occurredAt: new Date("2026-05-01T00:00:00Z"),
        fareMinor: 100_00,
        currency: "SAR",
        conditionsSatisfied: ["scope_confirmed", "carrier_exception_rejected"],
      })
    ).toMatchObject({
      status: "calculated",
      amountMinor: 150_00,
      currency: "SAR",
      policyVersion: "OPS-LEGAL-2026-01",
    });
  });

  it("records non-monetary deadlines without inventing an award", () => {
    expect(
      evaluatePassengerRights(profile, {
        event: "refund",
        occurredAt: new Date("2026-05-01T00:00:00Z"),
        conditionsSatisfied: ["scope_confirmed"],
      })
    ).toMatchObject({
      status: "eligible_non_monetary",
      amountMinor: null,
      refundDeadlineBusinessDays: 7,
    });
  });

  it("rejects a profile whose primary source was replaced", () => {
    expect(() =>
      evaluatePassengerRights(
        { ...profile, sourceUri: "https://example.invalid/summary" },
        {
          event: "refund",
          occurredAt: new Date("2026-05-01T00:00:00Z"),
          conditionsSatisfied: ["scope_confirmed"],
        }
      )
    ).toThrow("pinned primary source");
  });
});
