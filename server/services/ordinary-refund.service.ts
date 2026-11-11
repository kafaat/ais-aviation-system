import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import type Stripe from "stripe";
import {
  bookings,
  ordinaryBookingRefunds,
  paymentReceipts,
  paymentSplits,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { stripe } from "../stripe";
import {
  assertBookingDepartureReleasable,
  assertNoCollectionReview,
  type SettlementTx,
} from "./booking-settlement.service";
import { assertNoFlownCouponForCancellation } from "./ticket-coupons.service";
import { assertNoOrderRefundPending } from "./order-refunds.service";
import { settleVerifiedRefund } from "./payment-settlement.service";
import { recordEvent } from "./outbox.service";
import { isAdmin } from "./rbac.service";
import { quoteCancellationPolicy } from "./cancellation-policy.service";

type Intent = typeof ordinaryBookingRefunds.$inferSelect;
const reference = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;
const unavailable = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });

function requestOperationId(request: Stripe.RefundCreateParams) {
  const metadata = request.metadata;
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    typeof metadata.refundOperationId !== "string" ||
    !metadata.refundOperationId
  )
    throw unavailable("Saved cancellation request identity is invalid");
  return metadata.refundOperationId;
}

export async function getOrdinaryRefundCancellation(
  tx: SettlementTx,
  bookingId: number
) {
  const [intent] = await tx
    .select()
    .from(ordinaryBookingRefunds)
    .where(eq(ordinaryBookingRefunds.bookingId, bookingId))
    .limit(1);
  return intent;
}

/** The booking lock serializes cancellations with collection and order servicing.
 * No provider request is made while holding a database transaction. */
export async function reserveOrdinaryRefundCancellation(
  db: SettlementTx,
  input: {
    bookingId: number;
    actor: { id: number; role: string };
    userId: number;
    tenantId: number | null;
    request: Stripe.RefundCreateParams;
    baseRefundedAmount: number;
    existingRefund?: Stripe.Refund;
    policyQuoteHash?: string;
  }
) {
  const paymentIntentId = input.request.payment_intent;
  if (!paymentIntentId)
    throw unavailable("Cancellation payment intent missing");
  return await db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .for("update");
    if (!booking || booking.stripePaymentIntentId !== paymentIntentId)
      throw unavailable("Cancellation payment changed; refresh the booking");
    if (
      booking.userId !== input.userId ||
      booking.tenantId !== input.tenantId ||
      (!isAdmin(input.actor.role) && input.actor.id !== booking.userId)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Cancellation owner changed; refresh the booking",
      });
    const [saved] = await tx
      .select()
      .from(ordinaryBookingRefunds)
      .where(eq(ordinaryBookingRefunds.bookingId, booking.id))
      .for("update");
    const [split] = await tx
      .select()
      .from(paymentSplits)
      .where(
        and(
          eq(paymentSplits.bookingId, booking.id),
          isNotNull(paymentSplits.stripePaymentIntentId)
        )
      )
      .limit(1);
    if (split)
      throw unavailable(
        "Split-funded bookings require a per-payer cancellation plan"
      );
    await assertNoOrderRefundPending(tx, booking.id);
    const [receipt] = await tx
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentIntentId, paymentIntentId))
      .for("update");
    if (
      !receipt ||
      receipt.bookingId !== booking.id ||
      receipt.kind !== "booking" ||
      receipt.targetId !== booking.id ||
      receipt.userId !== booking.userId
    )
      throw unavailable(
        "Payment collection is not reconciled for this booking"
      );
    if (saved) {
      if (
        saved.paymentIntentId !== receipt.paymentIntentId ||
        saved.collectedAmount !== receipt.amount
      )
        throw unavailable(
          "Cancellation collection changed; reconciliation is required"
        );
      return saved;
    }
    const amount = input.request.amount;
    const base = input.baseRefundedAmount;
    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !Number.isSafeInteger(base) ||
      base < 0 ||
      base + amount > receipt.amount ||
      receipt.currency.toUpperCase() !== "SAR"
    )
      throw unavailable("Refund does not match the original collected balance");
    // Recovering an authenticated provider result must remain possible after
    // DCS closes. New commands still require unused, releasable carriage.
    if (!input.existingRefund) {
      if (booking.paymentStatus !== "paid" || booking.status !== "confirmed")
        throw unavailable(
          "Only a confirmed paid booking can start a cancellation refund"
        );
      if (receipt.refundedAmount > base)
        throw unavailable(
          "Refund balance changed; reconcile prior refunds first"
        );
      if (input.policyQuoteHash) {
        const quote = await quoteCancellationPolicy(tx, booking);
        if (
          quote.quoteHash !== input.policyQuoteHash ||
          quote.refundAmount !== amount ||
          amount === 0
        )
          throw unavailable(
            "Cancellation quote changed; review the current fare and refund before confirming"
          );
      }
      await assertNoCollectionReview(tx, booking.id);
      await assertBookingDepartureReleasable(tx, booking);
      await assertNoFlownCouponForCancellation(tx, booking.id);
    }
    const operationId = requestOperationId(input.request);
    await tx.insert(ordinaryBookingRefunds).values({
      bookingId: booking.id,
      paymentIntentId: receipt.paymentIntentId,
      operationId,
      actorId: input.actor.id,
      amount: amount,
      collectedAmount: receipt.amount,
      baseRefundedAmount: base,
      requestPayload: JSON.stringify(input.request),
      refundId: input.existingRefund?.id ?? null,
      status: "queued",
      nextAttemptAt: new Date(),
    });
    const reserved = await getOrdinaryRefundCancellation(tx, booking.id);
    if (!reserved) throw new Error("Cancellation command was not persisted");
    return reserved;
  });
}

function matches(intent: Intent, refund: Stripe.Refund) {
  return (
    reference(refund.payment_intent) === intent.paymentIntentId &&
    refund.amount === intent.amount &&
    refund.currency.toUpperCase() === "SAR" &&
    refund.metadata?.bookingId === String(intent.bookingId) &&
    refund.metadata?.refundOperationId === intent.operationId &&
    (!intent.refundId || intent.refundId === refund.id)
  );
}

async function lockIntent(tx: SettlementTx, bookingId: number) {
  await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  const [intent] = await tx
    .select()
    .from(ordinaryBookingRefunds)
    .where(eq(ordinaryBookingRefunds.bookingId, bookingId))
    .for("update");
  if (!intent) throw new Error("Cancellation command missing");
  return intent;
}

async function requireOrdinaryReview(
  tx: SettlementTx,
  intent: Intent,
  code: string,
  refund: Stripe.Refund,
  eventId: string
) {
  if (
    intent.status === "review_required" &&
    intent.errorCode === code &&
    intent.providerStatus === refund.status
  )
    return;
  await tx
    .update(ordinaryBookingRefunds)
    .set({
      status: "review_required",
      errorCode: code,
      providerStatus: refund.status,
    })
    .where(eq(ordinaryBookingRefunds.bookingId, intent.bookingId));
  // Contradictory provider evidence belongs in the settlement-review workflow;
  // it must never be silently acknowledged as a completed cancellation.
  await tx
    .update(paymentReceipts)
    .set({
      settlementStatus: "review_required",
      settlementError: `Cancellation refund requires review: ${code}`,
    })
    .where(eq(paymentReceipts.paymentIntentId, intent.paymentIntentId));
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, intent.bookingId))
    .limit(1);
  await recordEvent(tx, {
    aggregateType: "payment",
    aggregateId: intent.paymentIntentId,
    tenantId: booking?.tenantId,
    eventType: "payment.settlement_review_required",
    payload: {
      bookingId: intent.bookingId,
      paymentIntentId: intent.paymentIntentId,
      reason: code,
      refundId: refund.id,
      providerStatus: refund.status,
      providerAmount: refund.amount,
      providerEventId: eventId,
    },
  });
}

/** Only signature-verified events or authenticated Stripe responses enter here.
 * The saved purpose, not the mere existence of a partial refund, closes carriage. */
export async function recordVerifiedOrdinaryRefund(
  tx: SettlementTx,
  refund: Stripe.Refund,
  eventId: string
) {
  const paymentIntentId = reference(refund.payment_intent);
  if (!paymentIntentId) return false;
  const [hint] = await tx
    .select()
    .from(ordinaryBookingRefunds)
    .where(eq(ordinaryBookingRefunds.paymentIntentId, paymentIntentId))
    .limit(1);
  if (!hint || refund.metadata?.refundOperationId !== hint.operationId)
    return false;
  const intent = await lockIntent(tx, hint.bookingId);
  if (!matches(intent, refund)) {
    await requireOrdinaryReview(
      tx,
      intent,
      "provider_refund_conflict",
      refund,
      eventId
    );
    return true;
  }
  const failed = refund.status === "failed" || refund.status === "canceled";
  if (intent.status === "succeeded" || intent.completedAt) {
    if (failed || refund.status === "requires_action")
      await requireOrdinaryReview(
        tx,
        intent,
        "provider_reversed_refund",
        refund,
        eventId
      );
    return true;
  }
  if (intent.status === "failed") {
    if (refund.status === "succeeded")
      await requireOrdinaryReview(
        tx,
        intent,
        "provider_terminal_conflict",
        refund,
        eventId
      );
    return true;
  }
  if (
    intent.status === "review_required" &&
    intent.errorCode !== "unknown_provider_outcome"
  ) {
    if (refund.status === "succeeded" || failed)
      await requireOrdinaryReview(
        tx,
        intent,
        intent.errorCode ?? "provider_refund_conflict",
        refund,
        eventId
      );
    return true;
  }
  const status = failed
    ? "failed"
    : refund.status === "succeeded"
      ? "succeeded"
      : "pending";
  await tx
    .update(ordinaryBookingRefunds)
    .set({
      status,
      refundId: refund.id,
      providerStatus: refund.status,
      errorCode: failed
        ? "provider_refund_failed"
        : refund.status === "requires_action"
          ? "provider_action_required"
          : null,
      nextAttemptAt: new Date(Date.now() + 60_000),
    })
    .where(eq(ordinaryBookingRefunds.bookingId, intent.bookingId));
  if (status === "succeeded") {
    const chargeId = reference(refund.charge);
    if (!chargeId)
      throw new Error("Verified cancellation refund charge missing");
    await settleVerifiedRefund(tx, {
      paymentIntentId,
      chargeId,
      amount: intent.collectedAmount,
      amountRefunded: intent.baseRefundedAmount + intent.amount,
      currency: refund.currency,
      eventId,
      refundId: refund.id,
    });
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, intent.bookingId));
    if (!booking) throw new Error("Refund booking missing");
    await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: intent.bookingId,
      eventType: "booking.ordinary_refund_completed",
      tenantId: booking.tenantId,
      payload: {
        bookingId: intent.bookingId,
        userId: booking.userId,
        actorId: intent.actorId,
        amount: intent.amount,
        refundId: refund.id,
        paymentIntentId,
      },
    });
  }
  return true;
}

/** Resume one immutable command. Listing recovers a lost create response; a
 * missing outcome beyond Stripe's safe idempotency window is never reissued. */
export async function processOrdinaryRefundCancellation(
  bookingId: number,
  observedRefund?: Stripe.Refund
) {
  const db = await getDb();
  if (!db) throw new Error("Refund storage unavailable");
  const intent = await db.transaction(async tx => {
    const saved = await lockIntent(tx, bookingId);
    if (saved.amount === 0 || saved.providerStatus === "not_required")
      throw unavailable(
        "This is a completed cancellation without a provider refund"
      );
    if (
      saved.status === "review_required" &&
      saved.errorCode !== "unknown_provider_outcome"
    )
      throw unavailable("Cancellation refund requires reconciliation");
    const requestedAt = saved.requestedAt ?? new Date();
    await tx
      .update(ordinaryBookingRefunds)
      .set({
        requestedAt,
        status: saved.status === "queued" ? "requesting" : saved.status,
        nextAttemptAt: new Date(Date.now() + 60_000),
      })
      .where(eq(ordinaryBookingRefunds.bookingId, bookingId));
    return { ...saved, requestedAt };
  });
  try {
    let refund = observedRefund;
    if (!refund && intent.refundId)
      refund = await stripe.refunds.retrieve(intent.refundId);
    if (!refund) {
      let scanned = 0;
      for await (const existing of stripe.refunds.list({
        payment_intent: intent.paymentIntentId,
        limit: 100,
      })) {
        if (++scanned > 1000)
          throw unavailable("Provider refund history requires reconciliation");
        if (existing.metadata?.refundOperationId === intent.operationId) {
          if (refund)
            throw unavailable(
              "Multiple provider refunds match this cancellation"
            );
          refund = existing;
        }
      }
    }
    if (!refund) {
      if (
        ["succeeded", "failed", "pending"].includes(intent.status) ||
        Date.now() - intent.requestedAt.getTime() >= 23 * 3600_000
      ) {
        await db.transaction(async tx => {
          const current = await lockIntent(tx, bookingId);
          if (!["succeeded", "failed"].includes(current.status))
            await tx
              .update(ordinaryBookingRefunds)
              .set({
                status: "review_required",
                errorCode: "unknown_provider_outcome",
              })
              .where(eq(ordinaryBookingRefunds.bookingId, bookingId));
        });
        throw unavailable(
          "Cancellation refund outcome requires reconciliation"
        );
      }
      const request = JSON.parse(
        intent.requestPayload
      ) as Stripe.RefundCreateParams;
      if (
        request.payment_intent !== intent.paymentIntentId ||
        request.amount !== intent.amount ||
        requestOperationId(request) !== intent.operationId
      )
        throw unavailable("Saved cancellation request is invalid");
      refund = await stripe.refunds.create(request, {
        idempotencyKey: intent.operationId,
      });
    }
    const verified = refund;
    const handled = await db.transaction(async tx => {
      const current = await lockIntent(tx, bookingId);
      if (!matches(current, verified)) {
        await requireOrdinaryReview(
          tx,
          current,
          "provider_refund_conflict",
          verified,
          `refund-reconcile:${verified.id}`
        );
        return false;
      }
      return recordVerifiedOrdinaryRefund(
        tx,
        verified,
        `refund-reconcile:${verified.id}`
      );
    });
    if (!handled)
      throw unavailable(
        "Provider refund does not match the saved cancellation"
      );
    return verified;
  } catch (error) {
    // Includes successful provider writes followed by failed local commits.
    // Keep the original command for a later authenticated reconciliation.
    await db.transaction(async tx => {
      const current = await lockIntent(tx, bookingId);
      if (["queued", "requesting", "pending"].includes(current.status))
        await tx
          .update(ordinaryBookingRefunds)
          .set({
            errorCode: "provider_unavailable",
            nextAttemptAt: new Date(Date.now() + 60_000),
          })
          .where(eq(ordinaryBookingRefunds.bookingId, bookingId));
    });
    throw error;
  }
}

export async function processPendingOrdinaryRefunds() {
  const db = await getDb();
  if (!db) throw new Error("Refund storage unavailable");
  const due = await db
    .select()
    .from(ordinaryBookingRefunds)
    .where(
      and(
        inArray(ordinaryBookingRefunds.status, [
          "queued",
          "requesting",
          "pending",
        ]),
        lte(ordinaryBookingRefunds.nextAttemptAt, new Date())
      )
    )
    .orderBy(
      ordinaryBookingRefunds.nextAttemptAt,
      ordinaryBookingRefunds.bookingId
    )
    .limit(5);
  let failed = 0;
  for (const intent of due) {
    try {
      await processOrdinaryRefundCancellation(intent.bookingId);
    } catch {
      failed++;
    }
  }
  return { scanned: due.length, failed };
}
