import { describe, it, expect } from "vitest";
import {
  premiumPolicySchema,
  premiumVariant,
  premiumPrice,
  experimentDifference,
} from "../services/premium-experiment-policy";
const policy = premiumPolicySchema.parse({
  version: "test-v1",
  reference: "operator-budget",
  effectiveFrom: "2026-01-01T00:00:00Z",
  effectiveTo: "2026-12-01T00:00:00Z",
  analysisAfter: "2027-01-01T00:00:00Z",
  discountBps: 1000,
  protectedSeats: 2,
  minimumPerPassengerMinor: 300,
  expectedVariableCostMinor: 100,
  minimumContributionMinor: 200,
  displacedDemandValueMinor: 400,
  minimumSamplePerArm: 30,
});
describe("premium retail policy", () => {
  it("keeps repeat customers in the same allocation and populates both arms", () => {
    const values = Array.from({ length: 1000 }, (_, i) =>
      premiumVariant("policy-a", i + 1)
    );
    expect(values).toEqual(
      Array.from({ length: 1000 }, (_, i) => premiumVariant("policy-a", i + 1))
    );
    expect(values.filter(v => v === "control").length).toBeGreaterThan(400);
    expect(values.filter(v => v === "treatment").length).toBeGreaterThan(400);
  });
  it("protects contribution plus displacement and does not discount the control", () => {
    expect(premiumPrice(1500, 2, policy, "treatment").eligible).toBe(false);
    expect(premiumPrice(2000, 2, policy, "treatment")).toMatchObject({
      eligible: true,
      totalAmount: 1800,
      floor: 1400,
    });
    expect(premiumPrice(2000, 2, policy, "control").totalAmount).toBe(2000);
  });
  it("retains unknown effect below the sample gate and includes refund losses", () => {
    expect(experimentDifference([0], [100], 30)).toBeNull();
    expect(
      experimentDifference(Array(30).fill(100), Array(30).fill(-20), 30)
        ?.difference
    ).toBe(-120);
  });
  it("requires a predefined follow-up window and bounded discount", () => {
    expect(() =>
      premiumPolicySchema.parse({
        ...policy,
        analysisAfter: policy.effectiveTo,
      })
    ).toThrow();
    expect(() =>
      premiumPolicySchema.parse({ ...policy, discountBps: 9000 })
    ).toThrow();
  });
});
