import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { securityEvents } from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import { rateLimitService, STRICT_RATE_LIMITS } from "./rate-limit.service";
import type { ProgramRule } from "./loyalty-rules.service";

/**
 * Loyalty account-takeover (ATO) controls.
 *
 * Account takeover is the dominant loyalty fraud vector: travel companies saw
 * a >50% year-on-year rise in ATO attacks (Ravelin survey, Mastercard
 * Insights 2024), and 2025 brought drained Alaska Mileage Plan accounts and a
 * 383K-mile Miles & More theft. The pattern is: take the account, change the
 * credentials or contact details, then drain the balance quickly. These
 * controls sit on the drain step:
 *  - velocity limits on redemptions and on credential/profile changes
 *    (rate-limit.service tiers, per user, 24h window; the daily cap comes
 *    from the active programme rule),
 *  - a cooling-off period on redemption after a password, MFA, email or
 *    phone change (configurable per rule set),
 *  - an audit row per redemption with IP, user agent and device id taken
 *    from the request context, so a drain can be traced and restored.
 * Step-up TOTP on redemption lives in loyalty.service (consumeActionTotp).
 */
export type RedemptionContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
};

/** Security event types that start the redemption cooling-off clock. */
export const CREDENTIAL_CHANGE_EVENTS = [
  "credential_changed",
  "password_changed",
  "password_reset",
  "email_changed",
  "phone_changed",
  "mfa_enabled",
  "mfa_disabled",
] as const;

export type CredentialChangeKind =
  | "password"
  | "email"
  | "phone"
  | "mfa_enabled"
  | "mfa_disabled"
  | "backup_codes";

export class LoyaltyControlError extends TRPCError {
  constructor(
    public readonly control: "velocity" | "cooling_off",
    code: "FORBIDDEN" | "TOO_MANY_REQUESTS",
    message: string
  ) {
    super({ code, message });
  }
}

export function redemptionContextFromRequest(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): RedemptionContext {
  const header = (name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
    userAgent: header("user-agent")?.slice(0, 1000) ?? null,
    deviceId: header("x-device-id")?.slice(0, 128) ?? null,
  };
}

/** Attempts (not only successes) count: a burst of failed drains is the signal. */
export async function assertRedemptionVelocity(
  userId: number,
  rule: ProgramRule
) {
  const result = await rateLimitService.checkRateLimit(
    `user:${userId}`,
    {
      ...STRICT_RATE_LIMITS.loyaltyRedemption,
      requestsPerWindow: rule.redemptionVelocityPerDay,
    },
    "loyalty-redeem"
  );
  if (!result.allowed)
    throw new LoyaltyControlError(
      "velocity",
      "TOO_MANY_REQUESTS",
      `Redemption limit of ${rule.redemptionVelocityPerDay} per day reached; try again in ${Math.ceil((result.retryAfterSeconds ?? 0) / 60)} minutes`
    );
}

export async function latestCredentialChange(
  tx: SettlementTx,
  userId: number,
  since: Date
) {
  const [event] = await tx
    .select({
      createdAt: securityEvents.createdAt,
      eventType: securityEvents.eventType,
    })
    .from(securityEvents)
    .where(
      and(
        eq(securityEvents.userId, userId),
        inArray(securityEvents.eventType, [...CREDENTIAL_CHANGE_EVENTS]),
        gt(securityEvents.createdAt, since)
      )
    )
    .orderBy(desc(securityEvents.createdAt))
    .limit(1);
  return event ?? null;
}

/** Redemption is paused for `redemptionCoolingOffHours` after any credential change. */
export async function assertRedemptionCoolingOff(
  tx: SettlementTx,
  userId: number,
  rule: ProgramRule,
  now = new Date()
) {
  const hours = rule.redemptionCoolingOffHours;
  if (!hours) return;
  const since = new Date(now.getTime() - hours * 3_600_000);
  const change = await latestCredentialChange(tx, userId, since);
  if (!change) return;
  const resumesAt = new Date(change.createdAt.getTime() + hours * 3_600_000);
  throw new LoyaltyControlError(
    "cooling_off",
    "FORBIDDEN",
    `Redemptions are paused for ${hours} hours after a security change (${change.eventType}); available again at ${resumesAt.toISOString()}`
  );
}

export async function recordRedemptionAudit(
  tx: SettlementTx,
  input: {
    userId: number;
    miles: number;
    bookingId?: number | null;
    outcome: "redeemed" | "blocked";
    reason?: string;
    context?: RedemptionContext;
  }
) {
  await tx.insert(securityEvents).values({
    eventType:
      input.outcome === "redeemed"
        ? "loyalty_redemption"
        : "loyalty_redemption_blocked",
    severity: input.outcome === "redeemed" ? "low" : "medium",
    userId: input.userId,
    ipAddress: input.context?.ipAddress ?? null,
    userAgent: input.context?.userAgent ?? null,
    description:
      input.outcome === "redeemed"
        ? `Redeemed ${input.miles} miles`
        : `Blocked redemption of ${input.miles} miles: ${input.reason ?? "control"}`,
    metadata: JSON.stringify({
      miles: input.miles,
      bookingId: input.bookingId ?? null,
      deviceId: input.context?.deviceId ?? null,
      reason: input.reason ?? null,
    }),
    actionTaken: input.outcome === "redeemed" ? "allowed" : "denied",
  });
}

/** Best effort: a blocked attempt is recorded outside the rolled-back redemption transaction. */
export async function recordBlockedRedemption(input: {
  userId: number;
  miles: number;
  bookingId?: number | null;
  reason: string;
  context?: RedemptionContext;
}) {
  try {
    const db = getDb();
    if (!db) return;
    await recordRedemptionAudit(db, { ...input, outcome: "blocked" });
  } catch (error) {
    console.error("[Loyalty] Failed to record blocked redemption", error);
  }
}

/**
 * Record a credential/profile change: enforces the profile-change velocity
 * limit and writes the security event that starts the redemption cooling-off
 * clock. Call it before the change is applied.
 */
export async function recordCredentialChange(
  userId: number,
  kind: CredentialChangeKind,
  context: RedemptionContext,
  rule?: Pick<ProgramRule, "profileChangeVelocityPerDay">
) {
  const perDay =
    rule?.profileChangeVelocityPerDay ??
    STRICT_RATE_LIMITS.loyaltyProfileChange.requestsPerWindow;
  const result = await rateLimitService.checkRateLimit(
    `user:${userId}`,
    { ...STRICT_RATE_LIMITS.loyaltyProfileChange, requestsPerWindow: perDay },
    "profile-change"
  );
  if (!result.allowed)
    throw new LoyaltyControlError(
      "velocity",
      "TOO_MANY_REQUESTS",
      `Too many security changes today; try again in ${Math.ceil((result.retryAfterSeconds ?? 0) / 60)} minutes`
    );
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const eventType =
    kind === "mfa_enabled"
      ? "mfa_enabled"
      : kind === "mfa_disabled"
        ? "mfa_disabled"
        : kind === "password"
          ? "password_changed"
          : kind === "email"
            ? "email_changed"
            : kind === "phone"
              ? "phone_changed"
              : "credential_changed";
  await db.insert(securityEvents).values({
    eventType,
    severity: "medium",
    userId,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
    description: `Credential change: ${kind}`,
    metadata: JSON.stringify({ kind, deviceId: context.deviceId ?? null }),
    actionTaken: "redemption_cooling_off_started",
  });
}
