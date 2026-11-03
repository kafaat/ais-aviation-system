import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  bookingFareComponents,
  loyaltyCreditLots,
  loyaltyContractLiabilityEvents,
} from "../../drizzle/schema";
import { z } from "zod";
import type { SettlementTx } from "./booking-settlement.service";
import {
  allocateLoyaltyContractLiability,
  type ApprovedLoyaltyPolicy,
} from "./loyalty-accounting-policy";

export interface LoyaltyAllocationPostingInput {
  tenantId: number;
  bookingId: number;
  userId: number;
  lotId?: number;
  valuationReference?: string;
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
  if (input.lotId) return `loyalty-lot-v1:${input.lotId}:allocation`;
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
  const evidence = {
    lotId: input.lotId ?? null,
    valuationReference: input.valuationReference ?? null,
    policyVersion: input.policy.version,
    transactionPriceMinor: allocation.transactionPriceMinor,
    travelStandalonePriceMinor: input.travelStandalonePriceMinor,
    loyaltyStandaloneValueMinor: allocation.loyaltyStandaloneValueMinor,
    settlementReferences: [...new Set(input.settlementReferences)].sort(),
  };
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
      evidence,
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
    (input.lotId !== undefined &&
      !isDeepStrictEqual(posted.evidence, evidence)) ||
    posted.userId !== input.userId ||
    posted.currency !== input.policy.currency ||
    posted.miles !== input.awardedMiles ||
    posted.eventType !== "allocate" ||
    posted.policyProfileId !== input.policy.id ||
    posted.bookingId !== input.bookingId ||
    posted.allocatedAmountMinor !== allocation.allocatedAmountMinor ||
    posted.expectedBreakageMinor !== allocation.expectedBreakageMinor
  )
    throw new Error("Loyalty allocation idempotency conflict");
  return posted;
}

const valuationProfile = z.object({
  loyaltyAllocations: z.array(
    z.object({
      bookingId: z.number().int().positive(),
      currency: z.literal("SAR"),
      transactionPriceMinor: z.number().int().positive(),
      travelStandalonePriceMinor: z.number().int().positive(),
      reference: z.string().trim().min(1).max(255),
    })
  ),
});

/** Only a priced, fully funded original grant on a simple base + tax sale qualifies. */
export async function postApprovedBookingGrant(
  tx: SettlementTx,
  input: {
    bookingId: number;
    userId: number;
    lotId: number;
    awardedMiles: number;
    totalAmount: number;
    occurredAt: Date;
    contractAt: Date;
    policy: ApprovedLoyaltyPolicy;
    settlementReferences: string[];
  }
) {
  const { policy } = input;
  if (
    !input.contractAt ||
    policy.currency !== "SAR" ||
    policy.approvedAt > input.contractAt ||
    policy.effectiveAt > input.contractAt ||
    !policy.mileStandaloneValueMinor
  )
    return;
  const parsed = valuationProfile.safeParse(policy.sourceReferences);
  if (!parsed.success) return;
  const matches = parsed.data.loyaltyAllocations.filter(
    row => row.bookingId === input.bookingId
  );
  if (matches.length !== 1) return;
  const valuation = matches[0];
  const fare = await tx
    .select()
    .from(bookingFareComponents)
    .where(
      and(
        eq(bookingFareComponents.bookingId, input.bookingId),
        isNull(bookingFareComponents.reversedAt)
      )
    )
    .for("update");
  if (
    !fare.length ||
    fare.some(
      row =>
        row.tenantId !== policy.tenantId ||
        row.currency !== "SAR" ||
        !["base_fare", "tax"].includes(row.componentType) ||
        row.amount < 0
    ) ||
    fare.reduce((sum, row) => sum + row.amount, 0) !== input.totalAmount ||
    fare
      .filter(row => row.componentType === "base_fare")
      .reduce((sum, row) => sum + row.amount, 0) !==
      valuation.transactionPriceMinor
  )
    return;
  const existing = await tx
    .select()
    .from(loyaltyContractLiabilityEvents)
    .where(
      and(
        eq(loyaltyContractLiabilityEvents.bookingId, input.bookingId),
        eq(loyaltyContractLiabilityEvents.tenantId, policy.tenantId)
      )
    )
    .for("update");
  if (
    existing.some(
      row => row.idempotencyKey !== `loyalty-lot-v1:${input.lotId}:allocation`
    )
  )
    return;
  await postLoyaltyAllocation(tx, {
    ...input,
    tenantId: policy.tenantId,
    transactionPriceMinor: valuation.transactionPriceMinor,
    travelStandalonePriceMinor: valuation.travelStandalonePriceMinor,
    valuationReference: valuation.reference,
  });
}

type Lot = typeof loyaltyCreditLots.$inferSelect;
type LotMovement =
  | { type: "redeem"; creditId: number }
  | { type: "reverse"; fullyRefunded: boolean }
  | { type: "expire" }
  | { type: "adjustment" };

/** The caller holds the account and lot locks. Conversion into booking credit carries deferred value forward. */
export async function recordLotMovement(
  tx: SettlementTx,
  userId: number,
  before: Lot,
  after: Lot,
  movementId: number,
  movement: LotMovement
) {
  if (!before.bookingId) return;
  const miles = Math.max(
    Math.abs(after.remainingMiles - before.remainingMiles),
    Math.abs(after.reversedMiles - before.reversedMiles)
  );
  if (!miles) return;
  const events = await tx
    .select()
    .from(loyaltyContractLiabilityEvents)
    .where(
      and(
        eq(loyaltyContractLiabilityEvents.bookingId, before.bookingId),
        eq(loyaltyContractLiabilityEvents.userId, userId)
      )
    )
    .orderBy(asc(loyaltyContractLiabilityEvents.id))
    .for("update");
  const prefix = `loyalty-lot-v1:${before.transactionId}:`;
  const history = events.filter(row => row.idempotencyKey.startsWith(prefix));
  const allocation = history.find(
    row =>
      row.idempotencyKey === prefix + "allocation" &&
      row.eventType === "allocate"
  );
  if (!allocation) return;
  const key = prefix + "movement:" + movementId;
  if (history.some(row => row.idempotencyKey === key)) return;
  const previous = history[history.length - 1];
  const cleanRefund =
    movement.type === "reverse" &&
    movement.fullyRefunded &&
    after.reversedMiles === after.creditedMiles &&
    history.length === 1 &&
    before.remainingMiles === before.creditedMiles;
  const converted = movement.type === "redeem";
  await tx.insert(loyaltyContractLiabilityEvents).values({
    tenantId: allocation.tenantId,
    policyProfileId: allocation.policyProfileId,
    bookingId: before.bookingId,
    userId,
    idempotencyKey: key,
    eventType: converted
      ? "redeem"
      : movement.type === "expire"
        ? "expire"
        : "reverse",
    miles,
    allocatedAmountMinor: cleanRefund ? -allocation.allocatedAmountMinor : 0,
    expectedBreakageMinor: cleanRefund ? -allocation.expectedBreakageMinor : 0,
    recognizedAmountMinor: 0,
    deferredAmountAfterMinor: cleanRefund
      ? 0
      : previous.deferredAmountAfterMinor,
    currency: allocation.currency,
    evidence: {
      lotId: before.transactionId,
      movementId,
      source: movement.type,
      creditId: converted ? movement.creditId : null,
      disposition: cleanRefund
        ? "full_unused_grant_refund"
        : converted
          ? "converted_to_unfulfilled_credit"
          : "finance_review",
      spentMiles: after.spentMiles,
      expiredMiles: after.expiredMiles,
      reversedMiles: after.reversedMiles,
    },
    occurredAt: new Date(),
  });
}
