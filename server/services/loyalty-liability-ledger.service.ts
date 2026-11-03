import { and, eq, sql } from "drizzle-orm";
import { loyaltyContractLiabilityEvents } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import {
  allocateLoyaltyContractLiability,
  type ApprovedLoyaltyPolicy,
} from "./loyalty-accounting-policy";

export interface LoyaltyAllocationPostingInput {
  tenantId: number;
  bookingId: number;
  userId: number;
  awardedMiles: number;
  transactionPriceMinor: number;
  travelStandalonePriceMinor: number;
  occurredAt: Date;
  policy: ApprovedLoyaltyPolicy;
  settlementReferences: string[];
}

export function loyaltyAllocationIdempotencyKey(
  input: LoyaltyAllocationPostingInput
) {
  return [
    "loyalty-allocation-v1",
    input.tenantId,
    input.bookingId,
    input.policy.id,
    input.transactionPriceMinor,
    input.awardedMiles,
  ].join(":");
}

/** Posts an immutable allocation receipt. Replays converge on the same row. */
export async function postLoyaltyAllocation(
  tx: SettlementTx,
  input: LoyaltyAllocationPostingInput
) {
  if (input.policy.tenantId !== input.tenantId)
    throw new Error("Loyalty policy belongs to another tenant");
  if (!input.settlementReferences.length)
    throw new Error("Loyalty allocation requires settlement evidence");
  const allocation = allocateLoyaltyContractLiability(input);
  const idempotencyKey = loyaltyAllocationIdempotencyKey(input);
  await tx
    .insert(loyaltyContractLiabilityEvents)
    .values({
      tenantId: input.tenantId,
      policyProfileId: input.policy.id,
      bookingId: input.bookingId,
      userId: input.userId,
      idempotencyKey,
      eventType: "allocate",
      miles: input.awardedMiles,
      allocatedAmountMinor: allocation.allocatedAmountMinor,
      expectedBreakageMinor: allocation.expectedBreakageMinor,
      recognizedAmountMinor: 0,
      deferredAmountAfterMinor: allocation.deferredAmountMinor,
      currency: input.policy.currency,
      evidence: {
        policyVersion: input.policy.version,
        transactionPriceMinor: allocation.transactionPriceMinor,
        travelStandalonePriceMinor: input.travelStandalonePriceMinor,
        loyaltyStandaloneValueMinor: allocation.loyaltyStandaloneValueMinor,
        settlementReferences: [...new Set(input.settlementReferences)].sort(),
      },
      occurredAt: input.occurredAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        idempotencyKey: sql`${loyaltyContractLiabilityEvents.idempotencyKey}`,
      },
    });
  const [posted] = await tx
    .select()
    .from(loyaltyContractLiabilityEvents)
    .where(
      and(
        eq(loyaltyContractLiabilityEvents.tenantId, input.tenantId),
        eq(loyaltyContractLiabilityEvents.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (!posted) throw new Error("Loyalty allocation receipt was not persisted");
  if (
    posted.policyProfileId !== input.policy.id ||
    posted.bookingId !== input.bookingId ||
    posted.allocatedAmountMinor !== allocation.allocatedAmountMinor ||
    posted.expectedBreakageMinor !== allocation.expectedBreakageMinor
  )
    throw new Error("Loyalty allocation idempotency conflict");
  return posted;
}
