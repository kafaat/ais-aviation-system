import { and, desc, eq, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { loyaltyProgramRules } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

/**
 * Loyalty programme rule sets with effective dates.
 *
 * The built-in default reproduces today's behaviour exactly (1 mile per SAR of
 * net paid total, tier multipliers frozen per booking, each lot expiring 24
 * months after issuance, no tier qualification window). Introducing the rules
 * table therefore changes nothing until finance/commercial activate a rule.
 *
 * Market references for the configurable options:
 * - Activity-based expiry: AlFursan miles stay valid as long as the member
 *   earns or redeems once in 24 months (Saudia expiry policy); American
 *   AAdvantage discloses the same 24-month inactivity rule in its 10-K.
 * - Revenue-based earning: British Airways moved to full revenue-based
 *   earning on 1 April 2025; AlFursan still earns by distance x fare class.
 */
export type EarningBasis = "legacy_spend" | "revenue_base_fare";
export type ExpiryMode = "fixed_from_earn" | "activity";

export type ProgramRule = {
  id: number | null;
  name: string;
  source: "default" | "configured";
  effectiveFrom: Date | null;
  earningBasis: EarningBasis;
  /** Miles per SAR of the earning base (two decimals). */
  milesPerSar: number;
  /** Share of net paid treated as base fare, in basis points (10000 = all). */
  baseFareShareBps: number;
  expiryMode: ExpiryMode;
  expiryMonths: number;
  /** Days before projected expiry at which the member is notified. */
  expiryNoticeDays: number[];
  tierQualificationMonths: number | null;
  redemptionCoolingOffHours: number;
  redemptionVelocityPerDay: number;
  profileChangeVelocityPerDay: number;
};

export const DEFAULT_PROGRAM_RULE: ProgramRule = {
  id: null,
  name: "legacy-default",
  source: "default",
  effectiveFrom: null,
  earningBasis: "legacy_spend",
  milesPerSar: 1,
  baseFareShareBps: 10000,
  expiryMode: "fixed_from_earn",
  expiryMonths: 24,
  expiryNoticeDays: [60, 30],
  tierQualificationMonths: null,
  redemptionCoolingOffHours: 24,
  redemptionVelocityPerDay: 5,
  profileChangeVelocityPerDay: 3,
};

export function parseNoticeDays(value: string | null | undefined): number[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map(part => Number(part.trim()))
        .filter(n => Number.isInteger(n) && n > 0 && n <= 365)
    ),
  ].sort((a, b) => b - a);
}

export function ruleFromRow(
  row: typeof loyaltyProgramRules.$inferSelect
): ProgramRule {
  return {
    id: row.id,
    name: row.name,
    source: "configured",
    effectiveFrom: row.effectiveFrom,
    earningBasis: row.earningBasis,
    milesPerSar: Number(row.milesPerSar),
    baseFareShareBps: row.baseFareShareBps,
    expiryMode: row.expiryMode,
    expiryMonths: row.expiryMonths,
    expiryNoticeDays: parseNoticeDays(row.expiryNoticeDays),
    tierQualificationMonths: row.tierQualificationMonths,
    redemptionCoolingOffHours: row.redemptionCoolingOffHours,
    redemptionVelocityPerDay: row.redemptionVelocityPerDay,
    profileChangeVelocityPerDay: row.profileChangeVelocityPerDay,
  };
}

/** Latest active rule effective at `now`; the legacy default when none exists. */
export async function getActiveProgramRule(
  tx: SettlementTx,
  now = new Date()
): Promise<ProgramRule> {
  const rows = await tx
    .select()
    .from(loyaltyProgramRules)
    .where(
      and(
        eq(loyaltyProgramRules.status, "active"),
        lte(loyaltyProgramRules.effectiveFrom, now)
      )
    )
    .orderBy(desc(loyaltyProgramRules.effectiveFrom))
    .limit(5);
  const row = rows.find(r => !r.effectiveTo || r.effectiveTo > now);
  return row ? ruleFromRow(row) : DEFAULT_PROGRAM_RULE;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/** Per-lot expiry under the rule; activity-based programmes expire by account inactivity instead. */
export function lotExpiryFor(rule: ProgramRule, now = new Date()): Date | null {
  return rule.expiryMode === "activity"
    ? null
    : addMonths(now, rule.expiryMonths);
}

/** Date at which all miles lapse under activity-based expiry; null for fixed-lot programmes. */
export function activityExpiryAt(
  rule: ProgramRule,
  account: {
    lastActivityAt: Date | null;
    memberSince?: Date | null;
    createdAt?: Date | null;
  }
): Date | null {
  if (rule.expiryMode !== "activity") return null;
  const anchor =
    account.lastActivityAt ?? account.memberSince ?? account.createdAt ?? null;
  return anchor ? addMonths(anchor, rule.expiryMonths) : null;
}

/**
 * Base miles for a net paid amount in SAR minor units.
 * legacy_spend: floor(net SAR x milesPerSar) — identical to the historical
 * `MILES_PER_SAR = 1` when the default rule applies.
 * revenue_base_fare: floor(base-fare share of net SAR x milesPerSar).
 */
export function baseMilesFor(rule: ProgramRule, netPaidMinor: number): number {
  if (!Number.isFinite(netPaidMinor) || netPaidMinor <= 0) return 0;
  const shareBps =
    rule.earningBasis === "revenue_base_fare" ? rule.baseFareShareBps : 10000;
  const milesPerSarHundredths = Math.round(rule.milesPerSar * 100);
  // Integer arithmetic: minor units x bps x hundredths / (10000 x 100 x 100).
  return Math.floor(
    (netPaidMinor * shareBps * milesPerSarHundredths) / 100_000_000
  );
}

export const TIER_ORDER = ["bronze", "silver", "gold", "platinum"] as const;
export type Tier = (typeof TIER_ORDER)[number];
export function higherTier(a: Tier, b: Tier): Tier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

/**
 * Roll the tier qualification window when the rule defines one. Points reset
 * at the start of each window; the tier earned in the previous window is held
 * through the new one (it can rise mid-window, not fall). Without a window the
 * legacy cumulative behaviour is returned untouched.
 */
export function rollTierPeriod(
  rule: ProgramRule,
  account: {
    tier: Tier;
    tierPoints: number;
    tierPeriodStartedAt: Date | null;
  },
  now = new Date()
): {
  tierPoints: number;
  retainedTier: Tier;
  tierPeriodStartedAt: Date | null;
  rolled: boolean;
} {
  const months = rule.tierQualificationMonths;
  if (!months)
    return {
      tierPoints: account.tierPoints,
      retainedTier: account.tier,
      tierPeriodStartedAt: account.tierPeriodStartedAt,
      rolled: false,
    };
  let start = account.tierPeriodStartedAt ?? now;
  let rolled = false;
  while (addMonths(start, months) <= now) {
    start = addMonths(start, months);
    rolled = true;
  }
  return {
    tierPoints: rolled ? 0 : account.tierPoints,
    retainedTier: account.tier,
    tierPeriodStartedAt: start,
    rolled,
  };
}

export type ProgramRuleInput = {
  name: string;
  effectiveFrom: Date;
  earningBasis: EarningBasis;
  milesPerSar: number;
  baseFareShareBps: number;
  expiryMode: ExpiryMode;
  expiryMonths: number;
  expiryNoticeDays: number[];
  tierQualificationMonths: number | null;
  redemptionCoolingOffHours: number;
  redemptionVelocityPerDay: number;
  profileChangeVelocityPerDay: number;
  notes?: string | null;
};

/** Activate a new rule set and close the currently active one at its effective date. */
export async function setProgramRule(
  db: SettlementTx,
  input: ProgramRuleInput,
  actorId: number | null
) {
  if (input.effectiveFrom.getTime() < Date.now() - 86_400_000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A programme rule cannot be back-dated by more than one day",
    });
  return await db.transaction(async tx => {
    const active = await tx
      .select()
      .from(loyaltyProgramRules)
      .where(eq(loyaltyProgramRules.status, "active"));
    for (const row of active)
      await tx
        .update(loyaltyProgramRules)
        .set({ status: "superseded", effectiveTo: input.effectiveFrom })
        .where(eq(loyaltyProgramRules.id, row.id));
    const [created] = await tx.insert(loyaltyProgramRules).values({
      name: input.name,
      effectiveFrom: input.effectiveFrom,
      status: "active",
      earningBasis: input.earningBasis,
      milesPerSar: input.milesPerSar.toFixed(2),
      baseFareShareBps: input.baseFareShareBps,
      expiryMode: input.expiryMode,
      expiryMonths: input.expiryMonths,
      expiryNoticeDays: input.expiryNoticeDays.join(","),
      tierQualificationMonths: input.tierQualificationMonths,
      redemptionCoolingOffHours: input.redemptionCoolingOffHours,
      redemptionVelocityPerDay: input.redemptionVelocityPerDay,
      profileChangeVelocityPerDay: input.profileChangeVelocityPerDay,
      createdBy: actorId,
      notes: input.notes ?? null,
    });
    const [row] = await tx
      .select()
      .from(loyaltyProgramRules)
      .where(eq(loyaltyProgramRules.id, created.insertId))
      .limit(1);
    if (!row) throw new Error("Programme rule was not stored");
    return ruleFromRow(row);
  });
}
