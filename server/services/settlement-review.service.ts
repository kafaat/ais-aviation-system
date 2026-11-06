import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { paymentReceipts } from "../../drizzle/schema";
import { DepartureReleaseError } from "./booking-settlement.service";
import { getDb } from "../db";
import { stripe } from "../stripe";
import { createServiceLogger } from "../_core/logger";
const log = createServiceLogger("settlement-review");

export async function listSettlementReviews(limit: number) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return await db
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.settlementStatus, "review_required"))
    .orderBy(asc(paymentReceipts.createdAt))
    .limit(limit);
}

/** Keep a selected review observable after its verified refund removes it from
 * the pending queue. Ordinary applied collections are outside this workflow. */
export async function getSettlementReview(paymentIntentId: string) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [receipt] = await db
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, paymentIntentId))
    .limit(1);
  if (!receipt || receipt.settlementStatus === "applied")
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Settlement review not found",
    });
  return receipt;
}

/** Platform admin route only. Provider acknowledgement never changes the local
 * receipt; the verified cumulative refund webhook is the sole refund authority. */
export async function requestSettlementReviewRefund(
  paymentIntentId: string,
  actorId: number
) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [receipt] = await db
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, paymentIntentId))
    .limit(1);
  if (!receipt || receipt.settlementStatus === "applied") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Unsettled collection not found",
    });
  }
  if (
    receipt.settlementStatus === "review_refunded" ||
    (receipt.refundedAmount > 0 && receipt.refundedAmount === receipt.amount)
  ) {
    return { state: "refunded" as const, refundId: null };
  }
  if (DepartureReleaseError.isReason(receipt.settlementError))
    throw new DepartureReleaseError(receipt.settlementError);
  // Omitting amount refunds the provider's actual remaining balance. The stable
  // key makes operator/network retries identical, including partial refunds.
  log.info({ paymentIntentId, actorId }, "Settlement review refund requested");
  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      metadata: { purpose: "settlement_review" },
    },
    { idempotencyKey: `ais-review-refund:${paymentIntentId}` }
  );
  if (refund.status === "failed" || refund.status === "canceled") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Provider rejected the refund request",
    });
  }
  return { state: "awaiting_webhook" as const, refundId: refund.id };
}
