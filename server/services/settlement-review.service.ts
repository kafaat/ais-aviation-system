import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { bookings, paymentReceipts } from "../../drizzle/schema";
import {
  DepartureReleaseError,
  type SettlementTx,
} from "./booking-settlement.service";
import { assertNoOrderRefundPending } from "./order-refunds.service";
import { assertNoWithdrawnDispute } from "./payment-dispute.service";
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

/** Settlement ignores every other refund of an intent while a servicing refund
 * on it is unfinished, so a review refund sent then would move money that the
 * receipt and ledger do not record. Like the other refund commands, it waits
 * until the booking's servicing refunds are reconciled. */
async function assertNoServicingRefundPending(
  tx: SettlementTx,
  bookingId: number
) {
  try {
    await assertNoOrderRefundPending(tx, bookingId);
  } catch (error) {
    if (!(error instanceof Error) || !/refund liability/.test(error.message))
      throw error;
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "An order-service refund on this booking is unfinished; the settlement review refund can be requested once it has been reconciled",
      cause: error,
    });
  }
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
  // A booking collection is never refunded while its own dispute, or a dispute
  // on the booking's funding collection, holds the funds, nor while a
  // servicing refund on the booking is unfinished. Wallet top-ups have their
  // own dispute funding rules.
  const bookingId = receipt.bookingId;
  if (bookingId !== null)
    await db.transaction(async tx => {
      await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for("update");
      await assertNoWithdrawnDispute(tx, bookingId, [paymentIntentId]);
      await assertNoServicingRefundPending(tx, bookingId);
    });
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
