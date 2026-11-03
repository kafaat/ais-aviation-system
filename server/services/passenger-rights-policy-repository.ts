import { and, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { passengerRightsPolicyProfiles } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import {
  validatePassengerRightsProfile,
  type ApprovedPassengerRightsProfile,
  type PassengerRightsJurisdiction,
} from "./passenger-rights-policy";

const ruleSchema = z.object({
  event: z.enum([
    "delay",
    "cancellation",
    "denied_boarding",
    "downgrade",
    "baggage",
    "refund",
  ]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  minimumDelayMinutes: z.number().int().nonnegative().optional(),
  maximumDelayMinutes: z.number().int().nonnegative().optional(),
  minimumDistanceKm: z.number().int().nonnegative().optional(),
  maximumDistanceKm: z.number().int().nonnegative().optional(),
  amount: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("fixed"),
        minor: z.number().int().nonnegative(),
      }),
      z.object({
        kind: z.literal("fare_percentage"),
        basisPoints: z.number().int().min(0).max(100_000),
      }),
    ])
    .optional(),
  refundDeadlineBusinessDays: z.number().int().nonnegative().optional(),
  conditions: z.array(z.string().trim().min(1)).max(100),
});

const rulesSchema = z.array(ruleSchema).max(500);

export async function findApprovedPassengerRightsProfile(
  tx: SettlementTx,
  tenantId: number,
  jurisdiction: PassengerRightsJurisdiction,
  at: Date
): Promise<ApprovedPassengerRightsProfile | null> {
  const [row] = await tx
    .select()
    .from(passengerRightsPolicyProfiles)
    .where(
      and(
        eq(passengerRightsPolicyProfiles.tenantId, tenantId),
        eq(passengerRightsPolicyProfiles.jurisdiction, jurisdiction),
        eq(passengerRightsPolicyProfiles.status, "approved"),
        lte(passengerRightsPolicyProfiles.approvedAt, at),
        lte(passengerRightsPolicyProfiles.effectiveAt, at)
      )
    )
    .orderBy(
      desc(passengerRightsPolicyProfiles.effectiveAt),
      desc(passengerRightsPolicyProfiles.id)
    )
    .limit(1);
  if (!row) return null;
  if (row.approvedBy === null || row.approvedAt === null)
    throw new Error(
      "Approved passenger-rights profile lacks approval evidence"
    );
  const profile: ApprovedPassengerRightsProfile = {
    id: row.id,
    tenantId: row.tenantId,
    jurisdiction,
    version: row.version,
    status: "approved",
    sourceUri: row.sourceUri,
    effectiveAt: row.effectiveAt,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    rules: rulesSchema.parse(row.rules),
  };
  validatePassengerRightsProfile(profile, at);
  return profile;
}
