import { and, desc, eq, lte } from "drizzle-orm";
import { loyaltyPolicyProfiles } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import {
  validateApprovedLoyaltyPolicy,
  type ApprovedLoyaltyPolicy,
} from "./loyalty-accounting-policy";

export async function findApprovedLoyaltyPolicy(
  tx: SettlementTx,
  tenantId: number | null,
  at = new Date()
): Promise<ApprovedLoyaltyPolicy | null> {
  if (tenantId === null) return null;
  const [row] = await tx
    .select()
    .from(loyaltyPolicyProfiles)
    .where(
      and(
        eq(loyaltyPolicyProfiles.tenantId, tenantId),
        eq(loyaltyPolicyProfiles.status, "approved"),
        lte(loyaltyPolicyProfiles.effectiveAt, at)
      )
    )
    .orderBy(
      desc(loyaltyPolicyProfiles.effectiveAt),
      desc(loyaltyPolicyProfiles.id)
    )
    .limit(1);
  if (!row) return null;
  if (row.approvedBy === null || row.approvedAt === null)
    throw new Error("Approved loyalty policy lacks approval evidence");
  const policy: ApprovedLoyaltyPolicy = {
    id: row.id,
    tenantId: row.tenantId,
    version: row.version,
    status: "approved",
    expiryMode: row.expiryMode,
    expiryMonths: row.expiryMonths,
    mileStandaloneValueMinor: row.mileStandaloneValueMinor,
    expectedBreakageBasisPoints: row.expectedBreakageBasisPoints,
    currency: row.currency,
    effectiveAt: row.effectiveAt,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
  };
  validateApprovedLoyaltyPolicy(policy, at);
  return policy;
}
