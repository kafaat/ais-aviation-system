import { describe, expect, it } from "vitest";
import {
  calculateMacPercent,
  calculateOperationalWeightBalance,
  createSignedLoadSheetDraft,
  verifySignedLoadSheetDraft,
} from "../services/operational-weight-balance.service";

const accepted = {
  status: "accepted" as const,
  evidenceId: 41,
  approvedAt: "2026-10-01T00:00:00.000Z",
  effectiveFrom: "2026-10-01T00:00:00.000Z",
  effectiveTo: null,
};

const envelope = (["zfw", "tow", "law"] as const).flatMap(phase => [
  { phase, weightKg: 30_000, forwardMacPercent: 20, aftMacPercent: 35 },
  { phase, weightKg: 70_000, forwardMacPercent: 21, aftMacPercent: 34 },
]);

const input = {
  calculationAt: "2026-11-03T00:00:00.000Z",
  registration: {
    ...accepted,
    registration: "HZ-TEST",
    dataVersion: "DOW-7",
    dryOperatingWeightKg: 40_000,
    dryOperatingIndex: 10,
  },
  profile: {
    ...accepted,
    evidenceId: 42,
    version: "AHM-OP-3",
    referenceStationMm: 10_000,
    lemacMm: 10_000,
    macLengthMm: 4_000,
    indexConstant: 0,
    indexCoefficient: 100_000,
    maxLmcWeightKg: 500,
    maxLmcIndex: 1,
    envelope,
  },
  trafficLoadKg: 8_000,
  trafficIndex: 2,
  takeoffFuelKg: 10_000,
  takeoffFuelIndex: 3,
  tripFuelKg: 5_000,
  tripFuelIndex: 1,
  limits: {
    maxZeroFuelWeightKg: 60_000,
    maxTakeoffWeightKg: 70_000,
    maxLandingWeightKg: 65_000,
  },
};

describe("operator-controlled weight and balance", () => {
  it("reproduces an index-to-percent-MAC reference vector", () => {
    expect(calculateMacPercent(48_000, 12, input.profile)).toBe(25);
    const result = calculateOperationalWeightBalance(input);
    expect(result).toMatchObject({
      weights: {
        zeroFuelWeightKg: 48_000,
        takeoffWeightKg: 58_000,
        landingWeightKg: 53_000,
      },
      indices: {
        zeroFuelIndex: 12,
        takeoffIndex: 15,
        landingIndex: 14,
      },
      underloadKg: 12_000,
      releasable: true,
      violations: [],
    });
    expect(result.phases.map(phase => phase.withinEnvelope)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("fails closed for unaccepted or expired controlled fleet data", () => {
    expect(() =>
      calculateOperationalWeightBalance({
        ...input,
        registration: { ...input.registration, status: "draft" },
      })
    ).toThrow();
    expect(() =>
      calculateOperationalWeightBalance({
        ...input,
        profile: {
          ...input.profile,
          effectiveTo: "2026-11-01T00:00:00.000Z",
        },
      })
    ).toThrow("Controlled data is outside its effective interval");
  });

  it("checks weight, envelope and last-minute-change limits independently", () => {
    const result = calculateOperationalWeightBalance({
      ...input,
      limits: { ...input.limits, maxTakeoffWeightKg: 57_000 },
      previous: {
        zeroFuelWeightKg: 47_000,
        takeoffWeightKg: 57_000,
        landingWeightKg: 52_000,
        zeroFuelIndex: 10,
        takeoffIndex: 13,
        landingIndex: 12,
      },
    });
    expect(result.releasable).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        "TOW weight limit exceeded",
        "Last-minute change exceeds the approved limit",
      ])
    );
    expect(result.lmc?.withinLimit).toBe(false);
  });

  it("creates a versioned signed draft whose signature detects tampering", () => {
    const signingKey = "test-only-load-sheet-key-32-characters";
    const draft = createSignedLoadSheetDraft({
      flightId: 811,
      edition: 2,
      issuedAt: "2026-11-03T00:10:00.000Z",
      issuedBy: 7,
      calculation: calculateOperationalWeightBalance(input),
      signingKey,
    });
    expect(draft.payload).toMatchObject({
      documentType: "LOAD_SHEET_DRAFT",
      edition: 2,
      dispatchAcceptanceRequired: true,
    });
    expect(verifySignedLoadSheetDraft(draft, signingKey)).toBe(true);
    const tampered = structuredClone(draft);
    tampered.payload.calculation.weights.takeoffWeightKg += 1;
    expect(verifySignedLoadSheetDraft(tampered, signingKey)).toBe(false);
  });
});
