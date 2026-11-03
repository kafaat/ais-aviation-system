export type LoyaltyExpiryMode = "none" | "fixed" | "activity";

export interface ApprovedLoyaltyPolicy {
  id: number;
  tenantId: number;
  version: string;
  status: "approved";
  expiryMode: LoyaltyExpiryMode;
  expiryMonths: number | null;
  mileStandaloneValueMinor: number;
  expectedBreakageBasisPoints: number;
  currency: string;
  effectiveAt: Date;
  approvedBy: number;
  approvedAt: Date;
}

export interface LoyaltyAllocation {
  transactionPriceMinor: number;
  loyaltyStandaloneValueMinor: number;
  allocatedAmountMinor: number;
  expectedBreakageMinor: number;
  deferredAmountMinor: number;
}

function requireWholeMinor(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer`);
}

export function validateApprovedLoyaltyPolicy(
  policy: ApprovedLoyaltyPolicy,
  at = new Date()
) {
  if (!Number.isSafeInteger(policy.id) || policy.id <= 0)
    throw new Error("Loyalty policy ID is invalid");
  if (!Number.isSafeInteger(policy.tenantId) || policy.tenantId <= 0)
    throw new Error("Loyalty policy tenant is invalid");
  if (!policy.version.trim())
    throw new Error("Loyalty policy version is empty");
  if (!/^[A-Z]{3}$/.test(policy.currency))
    throw new Error("Loyalty policy currency must be an ISO 4217 code");
  requireWholeMinor(policy.mileStandaloneValueMinor, "Mile standalone value");
  if (
    !Number.isSafeInteger(policy.expectedBreakageBasisPoints) ||
    policy.expectedBreakageBasisPoints < 0 ||
    policy.expectedBreakageBasisPoints >= 10_000
  )
    throw new Error("Expected breakage must be between 0 and 9,999 bps");
  if (policy.expiryMode === "none" && policy.expiryMonths !== null)
    throw new Error("A no-expiry policy cannot define expiry months");
  if (
    policy.expiryMode !== "none" &&
    (!Number.isSafeInteger(policy.expiryMonths) ||
      (policy.expiryMonths ?? 0) <= 0 ||
      (policy.expiryMonths ?? 0) > 600)
  )
    throw new Error("Expiry months must be between 1 and 600");
  if (
    Number.isNaN(policy.effectiveAt.getTime()) ||
    policy.effectiveAt.getTime() > at.getTime()
  )
    throw new Error("Loyalty policy is not effective");
  if (
    !Number.isSafeInteger(policy.approvedBy) ||
    policy.approvedBy <= 0 ||
    Number.isNaN(policy.approvedAt.getTime())
  )
    throw new Error("Loyalty policy approval evidence is incomplete");
}

function addUtcMonths(date: Date, months: number) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Returns NULL unless an approved operator policy explicitly expires miles. */
export function resolveMilesExpiry(
  policy: ApprovedLoyaltyPolicy | null,
  creditAt: Date,
  activityAt = creditAt
) {
  if (!policy || policy.expiryMode === "none") return null;
  validateApprovedLoyaltyPolicy(policy, creditAt);
  if (policy.expiryMonths === null)
    throw new Error("Approved expiry policy has no duration");
  return addUtcMonths(
    policy.expiryMode === "activity" ? activityAt : creditAt,
    policy.expiryMonths
  );
}

/**
 * Relative standalone-selling-price allocation for the award-credit
 * performance obligation. Inputs are minor currency units and whole miles.
 */
export function allocateLoyaltyContractLiability(input: {
  transactionPriceMinor: number;
  travelStandalonePriceMinor: number;
  awardedMiles: number;
  policy: ApprovedLoyaltyPolicy;
}): LoyaltyAllocation {
  validateApprovedLoyaltyPolicy(input.policy);
  requireWholeMinor(input.transactionPriceMinor, "Transaction price");
  requireWholeMinor(input.travelStandalonePriceMinor, "Travel SSP");
  requireWholeMinor(input.awardedMiles, "Awarded miles");
  const loyaltyStandaloneValueMinor =
    input.awardedMiles * input.policy.mileStandaloneValueMinor;
  if (!Number.isSafeInteger(loyaltyStandaloneValueMinor))
    throw new Error("Loyalty standalone value exceeds safe integer bounds");
  const totalStandalone =
    input.travelStandalonePriceMinor + loyaltyStandaloneValueMinor;
  const allocatedAmountMinor = totalStandalone
    ? Math.round(
        (input.transactionPriceMinor * loyaltyStandaloneValueMinor) /
          totalStandalone
      )
    : 0;
  const expectedBreakageMinor = Math.floor(
    (allocatedAmountMinor * input.policy.expectedBreakageBasisPoints) / 10_000
  );
  return {
    transactionPriceMinor: input.transactionPriceMinor,
    loyaltyStandaloneValueMinor,
    allocatedAmountMinor,
    expectedBreakageMinor,
    deferredAmountMinor: allocatedAmountMinor,
  };
}

/** IFRS 15 B46-style proportional recognition of approved expected breakage. */
export function recognizeLoyaltyRedemption(input: {
  allocatedAmountMinor: number;
  expectedBreakageBasisPoints: number;
  awardedMiles: number;
  redeemedMilesToDate: number;
  alreadyRecognizedMinor: number;
}) {
  requireWholeMinor(input.allocatedAmountMinor, "Allocated amount");
  requireWholeMinor(input.awardedMiles, "Awarded miles");
  requireWholeMinor(input.redeemedMilesToDate, "Redeemed miles");
  requireWholeMinor(input.alreadyRecognizedMinor, "Recognized amount");
  if (
    !Number.isSafeInteger(input.expectedBreakageBasisPoints) ||
    input.expectedBreakageBasisPoints < 0 ||
    input.expectedBreakageBasisPoints >= 10_000
  )
    throw new Error("Expected breakage is invalid");
  if (input.redeemedMilesToDate > input.awardedMiles)
    throw new Error("Redeemed miles exceed awarded miles");
  const expectedExerciseMiles = Math.max(
    1,
    Math.round(
      (input.awardedMiles * (10_000 - input.expectedBreakageBasisPoints)) /
        10_000
    )
  );
  const cumulativeRecognizedMinor = Math.min(
    input.allocatedAmountMinor,
    Math.round(
      (input.allocatedAmountMinor * input.redeemedMilesToDate) /
        expectedExerciseMiles
    )
  );
  if (input.alreadyRecognizedMinor > cumulativeRecognizedMinor)
    throw new Error(
      "Previously recognized amount exceeds the current estimate"
    );
  return {
    recognizedDeltaMinor:
      cumulativeRecognizedMinor - input.alreadyRecognizedMinor,
    cumulativeRecognizedMinor,
    deferredAmountAfterMinor:
      input.allocatedAmountMinor - cumulativeRecognizedMinor,
  };
}
