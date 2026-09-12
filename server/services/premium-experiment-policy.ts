import { createHash } from "node:crypto";
import { z } from "zod";
const minor = z.number().int().nonnegative().max(100000000);
export const premiumPolicySchema = z
  .object({
    version: z.string().min(1).max(50),
    reference: z.string().min(1).max(200),
    effectiveFrom: z.iso.datetime(),
    effectiveTo: z.iso.datetime(),
    analysisAfter: z.iso.datetime(),
    discountBps: z.number().int().min(0).max(2000),
    protectedSeats: z.number().int().nonnegative().max(500),
    minimumPerPassengerMinor: minor,
    expectedVariableCostMinor: minor,
    minimumContributionMinor: minor,
    displacedDemandValueMinor: minor,
    minimumSamplePerArm: z.number().int().min(30).max(100000),
  })
  .strict()
  .refine(
    p =>
      Date.parse(p.effectiveFrom) < Date.parse(p.effectiveTo) &&
      Date.parse(p.effectiveTo) < Date.parse(p.analysisAfter)
  );
export function premiumVariant(policyId: string, userId: number) {
  return createHash("sha256")
    .update(`premium:v1:${policyId}:${userId}`)
    .digest()
    .readUInt32BE(0) %
    2 ===
    0
    ? ("control" as const)
    : ("treatment" as const);
}
export function premiumPrice(
  base: number,
  pax: number,
  policy: z.infer<typeof premiumPolicySchema>,
  variant: "control" | "treatment"
) {
  const floor =
    Math.max(
      policy.minimumPerPassengerMinor,
      policy.expectedVariableCostMinor +
        policy.minimumContributionMinor +
        policy.displacedDemandValueMinor
    ) * pax;
  const treatment = Math.round((base * (10000 - policy.discountBps)) / 10000);
  if (
    !Number.isSafeInteger(base) ||
    base < 0 ||
    !Number.isSafeInteger(pax) ||
    pax < 1
  )
    throw new Error("Invalid premium fare");
  return {
    eligible: treatment >= floor,
    totalAmount: variant === "treatment" ? treatment : base,
    floor,
  };
}
export function experimentDifference(
  control: number[],
  treatment: number[],
  minimum: number
) {
  const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;
  if (control.length < minimum || treatment.length < minimum) return null;
  const a = mean(control),
    b = mean(treatment),
    variance = (xs: number[], m: number) =>
      xs.reduce((s, n) => s + (n - m) ** 2, 0) / (xs.length - 1);
  const difference = b - a,
    standardError = Math.sqrt(
      variance(control, a) / control.length +
        variance(treatment, b) / treatment.length
    );
  return {
    difference,
    lower95: difference - 1.96 * standardError,
    upper95: difference + 1.96 * standardError,
    method: "normal_approximation_per_randomized_user" as const,
  };
}
