export type PassengerRightsJurisdiction =
  "gaca-2023" | "eu261-2004" | "uk261" | "us-dot-14-cfr-260";

export type PassengerRightsEvent =
  | "delay"
  | "cancellation"
  | "denied_boarding"
  | "downgrade"
  | "baggage"
  | "refund";

export interface PassengerRightsRule {
  event: PassengerRightsEvent;
  currency: string;
  minimumDelayMinutes?: number;
  maximumDelayMinutes?: number;
  minimumDistanceKm?: number;
  maximumDistanceKm?: number;
  amount?:
    | { kind: "fixed"; minor: number }
    | { kind: "fare_percentage"; basisPoints: number };
  refundDeadlineBusinessDays?: number;
  conditions: string[];
}

export interface ApprovedPassengerRightsProfile {
  id: number;
  tenantId: number;
  jurisdiction: PassengerRightsJurisdiction;
  version: string;
  status: "approved";
  sourceUri: string;
  effectiveAt: Date;
  approvedBy: number;
  approvedAt: Date;
  rules: PassengerRightsRule[];
}

export interface PassengerRightsFacts {
  event: PassengerRightsEvent;
  occurredAt: Date;
  delayMinutes?: number;
  distanceKm?: number;
  fareMinor?: number;
  currency?: string;
  conditionsSatisfied: string[];
}

export const PASSENGER_RIGHTS_PRIMARY_SOURCES = {
  "gaca-2023":
    "https://gaca.gov.sa/-/media/Files/PDF/LawsAndRegulation/Consumer-Protection/Passenger-Rights-Protection-Regulations-EN.pdf",
  "eu261-2004":
    "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32004R0261",
  uk261: "https://www.legislation.gov.uk/eur/2004/261/body",
  "us-dot-14-cfr-260":
    "https://www.ecfr.gov/current/title-14/chapter-II/subchapter-A/part-260",
} as const;

function safeNonNegative(value: number | undefined) {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

export function validatePassengerRightsProfile(
  profile: ApprovedPassengerRightsProfile,
  at: Date
) {
  if (!Number.isSafeInteger(profile.id) || profile.id <= 0)
    throw new Error("Passenger-rights profile ID is invalid");
  if (!Number.isSafeInteger(profile.tenantId) || profile.tenantId <= 0)
    throw new Error("Passenger-rights tenant is invalid");
  if (profile.status !== "approved" || !profile.version.trim())
    throw new Error("Passenger-rights policy version is not approved");
  if (
    profile.sourceUri !== PASSENGER_RIGHTS_PRIMARY_SOURCES[profile.jurisdiction]
  )
    throw new Error(
      "Passenger-rights profile source is not the pinned primary source"
    );
  if (
    Number.isNaN(profile.effectiveAt.getTime()) ||
    profile.effectiveAt > at ||
    !Number.isSafeInteger(profile.approvedBy) ||
    profile.approvedBy <= 0 ||
    Number.isNaN(profile.approvedAt.getTime()) ||
    profile.approvedAt > at ||
    !Number.isFinite(at.getTime())
  )
    throw new Error("Passenger-rights approval evidence is incomplete");
  for (const rule of profile.rules) {
    if (!/^[A-Z]{3}$/.test(rule.currency))
      throw new Error("Passenger-rights rule currency is invalid");
    if (
      !safeNonNegative(rule.minimumDelayMinutes) ||
      !safeNonNegative(rule.maximumDelayMinutes) ||
      !safeNonNegative(rule.minimumDistanceKm) ||
      !safeNonNegative(rule.maximumDistanceKm) ||
      !safeNonNegative(rule.refundDeadlineBusinessDays)
    )
      throw new Error("Passenger-rights rule thresholds are invalid");
    if (
      rule.minimumDelayMinutes !== undefined &&
      rule.maximumDelayMinutes !== undefined &&
      rule.minimumDelayMinutes > rule.maximumDelayMinutes
    )
      throw new Error("Passenger-rights delay band is inverted");
    if (
      rule.minimumDistanceKm !== undefined &&
      rule.maximumDistanceKm !== undefined &&
      rule.minimumDistanceKm > rule.maximumDistanceKm
    )
      throw new Error("Passenger-rights distance band is inverted");
    if (rule.amount?.kind === "fixed" && !safeNonNegative(rule.amount.minor))
      throw new Error("Fixed award is invalid");
    if (
      rule.amount?.kind === "fare_percentage" &&
      (!Number.isSafeInteger(rule.amount.basisPoints) ||
        rule.amount.basisPoints < 0 ||
        rule.amount.basisPoints > 100_000)
    )
      throw new Error("Fare percentage is invalid");
  }
}

function within(value: number | undefined, min?: number, max?: number) {
  if (min === undefined && max === undefined) return true;
  if (value === undefined) return false;
  return (
    (min === undefined || value >= min) && (max === undefined || value <= max)
  );
}

/**
 * Evaluates only a pinned, approved profile. Missing facts or conditions keep
 * the claim in review instead of inventing an entitlement.
 */
export function evaluatePassengerRights(
  profile: ApprovedPassengerRightsProfile | null,
  facts: PassengerRightsFacts
) {
  if (!profile)
    return {
      status: "needs_review" as const,
      reason: "No approved jurisdiction profile",
      amountMinor: null,
      currency: null,
      policyVersion: null,
    };
  validatePassengerRightsProfile(profile, facts.occurredAt);
  const candidates = profile.rules.filter(
    rule =>
      rule.event === facts.event &&
      within(
        facts.delayMinutes,
        rule.minimumDelayMinutes,
        rule.maximumDelayMinutes
      ) &&
      within(facts.distanceKm, rule.minimumDistanceKm, rule.maximumDistanceKm)
  );
  const matches = candidates.filter(item =>
    item.conditions.every(condition =>
      facts.conditionsSatisfied.includes(condition)
    )
  );
  const [rule] = matches;
  if (matches.length !== 1)
    return {
      status: "needs_review" as const,
      reason: matches.length
        ? "Multiple approved rules match the facts"
        : "No approved rule matches the recorded facts and conditions",
      amountMinor: null,
      currency: null,
      policyVersion: profile.version,
    };
  if (!rule.amount)
    return {
      status: "eligible_non_monetary" as const,
      reason: "The approved rule records a duty or refund deadline",
      amountMinor: null,
      currency: rule.currency,
      policyVersion: profile.version,
      refundDeadlineBusinessDays: rule.refundDeadlineBusinessDays ?? null,
    };
  if (rule.amount.kind === "fare_percentage") {
    if (
      !safeNonNegative(facts.fareMinor) ||
      facts.fareMinor === undefined ||
      facts.currency !== rule.currency
    )
      return {
        status: "needs_review" as const,
        reason: "Audited fare basis in the rule currency is required",
        amountMinor: null,
        currency: rule.currency,
        policyVersion: profile.version,
      };
    const award =
      (BigInt(facts.fareMinor) * BigInt(rule.amount.basisPoints) + 5000n) /
      10000n;
    if (award > BigInt(Number.MAX_SAFE_INTEGER))
      return {
        status: "needs_review" as const,
        reason: "Calculated award exceeds the supported monetary range",
        amountMinor: null,
        currency: rule.currency,
        policyVersion: profile.version,
      };
    return {
      status: "calculated" as const,
      reason: "Approved fare-percentage rule matched",
      amountMinor: Number(award),
      currency: rule.currency,
      policyVersion: profile.version,
    };
  }
  return {
    status: "calculated" as const,
    reason: "Approved fixed-amount rule matched",
    amountMinor: rule.amount.minor,
    currency: rule.currency,
    policyVersion: profile.version,
  };
}
