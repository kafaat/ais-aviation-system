import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import type Stripe from "stripe";
import {
  bookings,
  ordinaryBookingRefundParts,
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
import {
  assertNoWithdrawnDispute,
  CHARGEBACK_SETTLED,
  DISPUTE_HOLD_ERROR,
  DISPUTE_HOLD_RETRY_MS,
  lostDisputeCover,
  savedRefundDisputeGate,
  withdrawnDisputeError,
} from "./payment-dispute.service";
import {
  cancelAfterPartialRefund,
  completeRefundParts,
  settleVerifiedRefund,
} from "./payment-settlement.service";
import { recordEvent } from "./outbox.service";
import { isAdmin } from "./rbac.service";
import { quoteCancellationPolicy } from "./cancellation-policy.service";

type Intent = typeof ordinaryBookingRefunds.$inferSelect;
type Part = typeof ordinaryBookingRefundParts.$inferSelect;
const OPEN_STATUSES = ["queued", "requesting", "pending"];
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

/** Decision 7: the per-intent parts of a cancellation drawn on more than one
 * collection, in draw order. Empty for a single-intent cancellation. */
export async function getRefundParts(tx: SettlementTx, bookingId: number) {
  return await tx
    .select()
    .from(ordinaryBookingRefundParts)
    .where(eq(ordinaryBookingRefundParts.bookingId, bookingId))
    .orderBy(ordinaryBookingRefundParts.sequence);
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
      await assertNoWithdrawnDispute(tx, booking.id, [paymentIntentId]);
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

/** Decision 7 (#327, option A): an upgrade collected its difference on its own
 * payment intent, so the cancellation refund draws on every collection that
 * still holds money, the most recent (the upgrade) first and the original
 * booking intent last. One part per intent, never 0. Bases come from the
 * provider's refund history of each intent, as for the single-intent command,
 * and are checked against each receipt under the booking lock. */
export async function reserveOrdinaryRefundAcrossIntents(
  db: SettlementTx,
  input: {
    bookingId: number;
    actor: { id: number; role: string };
    userId: number;
    tenantId: number | null;
    request: Stripe.RefundCreateParams;
    baseRefundedAmount: number;
    upgradeBases: ReadonlyMap<string, number>;
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
      const parts = await tx
        .select()
        .from(ordinaryBookingRefundParts)
        .where(eq(ordinaryBookingRefundParts.bookingId, booking.id))
        .for("update");
      if (
        !parts.length ||
        saved.paymentIntentId !== receipt.paymentIntentId ||
        saved.collectedAmount !== receipt.amount
      )
        throw unavailable(
          "Cancellation collection changed; reconciliation is required"
        );
      return saved;
    }
    const upgrades = (
      await tx
        .select()
        .from(paymentReceipts)
        .where(
          and(
            eq(paymentReceipts.bookingId, booking.id),
            eq(paymentReceipts.kind, "modification"),
            eq(paymentReceipts.settlementStatus, "applied")
          )
        )
        .orderBy(paymentReceipts.paymentIntentId)
        .for("update")
    ).filter(row => row.paymentIntentId !== paymentIntentId);
    const amount = input.request.amount;
    const base = input.baseRefundedAmount;
    const collections = [
      // Most recent collection first; the original intent is drawn last.
      ...upgrades
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.paymentIntentId.localeCompare(a.paymentIntentId)
        )
        .map(row => ({
          receipt: row,
          base: input.upgradeBases.get(row.paymentIntentId),
        })),
      { receipt, base },
    ];
    const invalid = collections.some(
      ({ receipt: row, base: held }) =>
        held === undefined ||
        !Number.isSafeInteger(held) ||
        held < 0 ||
        held > row.amount ||
        row.refundedAmount > held ||
        row.currency.toUpperCase() !== "SAR" ||
        row.userId !== booking.userId
    );
    const total = collections.reduce(
      (sum, { receipt: row, base: held }) => sum + row.amount - (held ?? 0),
      0
    );
    if (
      invalid ||
      upgrades.length !== input.upgradeBases.size ||
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > total
    )
      throw unavailable(
        "Refund does not match the booking's collected balance"
      );
    if (booking.paymentStatus !== "paid" || booking.status !== "confirmed")
      throw unavailable(
        "Only a confirmed paid booking can start a cancellation refund"
      );
    if (input.policyQuoteHash) {
      const quote = await quoteCancellationPolicy(tx, booking);
      if (
        quote.quoteHash !== input.policyQuoteHash ||
        quote.refundAmount !== amount
      )
        throw unavailable(
          "Cancellation quote changed; review the current fare and refund before confirming"
        );
    }
    await assertNoCollectionReview(tx, booking.id);
    await assertNoWithdrawnDispute(
      tx,
      booking.id,
      collections.map(c => c.receipt.paymentIntentId)
    );
    await assertBookingDepartureReleasable(tx, booking);
    await assertNoFlownCouponForCancellation(tx, booking.id);
    const operationId = requestOperationId(input.request);
    let remaining = amount;
    const parts: (typeof ordinaryBookingRefundParts.$inferInsert)[] = [];
    for (const { receipt: row, base: held = 0 } of collections) {
      const take = Math.min(remaining, row.amount - held);
      // A part of 0 would read as a cancellation without a refund.
      if (take <= 0) continue;
      remaining -= take;
      const partOperationId = `${operationId}:${row.paymentIntentId}`;
      parts.push({
        id: randomUUID(),
        bookingId: booking.id,
        sequence: parts.length + 1,
        paymentIntentId: row.paymentIntentId,
        operationId: partOperationId,
        amount: take,
        collectedAmount: row.amount,
        baseRefundedAmount: held,
        requestPayload: JSON.stringify({
          payment_intent: row.paymentIntentId,
          amount: take,
          reason: input.request.reason,
          metadata: {
            bookingId: String(booking.id),
            refundOperationId: partOperationId,
            cancellationOperationId: operationId,
          },
        } satisfies Stripe.RefundCreateParams),
        status: "queued",
        nextAttemptAt: new Date(),
      });
    }
    if (remaining !== 0 || !parts.length)
      throw unavailable(
        "Refund does not match the booking's collected balance"
      );
    if (parts.every(part => part.paymentIntentId === paymentIntentId))
      throw unavailable("Cancellation payment changed; refresh the booking");
    await tx.insert(ordinaryBookingRefunds).values({
      bookingId: booking.id,
      paymentIntentId: receipt.paymentIntentId,
      operationId,
      actorId: input.actor.id,
      amount,
      collectedAmount: receipt.amount,
      baseRefundedAmount: base,
      requestPayload: JSON.stringify(input.request),
      refundId: null,
      status: "queued",
      nextAttemptAt: new Date(),
    });
    await tx.insert(ordinaryBookingRefundParts).values(parts);
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
  if (await recordVerifiedRefundPart(tx, refund, eventId)) return true;
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

async function lockParts(tx: SettlementTx, bookingId: number) {
  const intent = await lockIntent(tx, bookingId);
  const parts = await tx
    .select()
    .from(ordinaryBookingRefundParts)
    .where(eq(ordinaryBookingRefundParts.bookingId, bookingId))
    .orderBy(ordinaryBookingRefundParts.sequence)
    .for("update");
  return { intent, parts };
}

function matchesPart(part: Part, refund: Stripe.Refund) {
  return (
    reference(refund.payment_intent) === part.paymentIntentId &&
    refund.amount === part.amount &&
    refund.currency.toUpperCase() === "SAR" &&
    refund.metadata?.bookingId === String(part.bookingId) &&
    refund.metadata?.refundOperationId === part.operationId &&
    (!part.refundId || part.refundId === refund.id)
  );
}

async function updatePart(
  tx: SettlementTx,
  part: Part,
  set: Partial<typeof ordinaryBookingRefundParts.$inferInsert>
) {
  await tx
    .update(ordinaryBookingRefundParts)
    .set(set)
    .where(eq(ordinaryBookingRefundParts.id, part.id));
}

/** The cancellation row mirrors its parts until every part has succeeded,
 * when completeRefundParts closes it: review or failure of any part stops
 * the whole command; otherwise it stays queued/requesting/pending, due when
 * its earliest open part is due, so the worker retries only open parts. */
async function syncPartitionedCancellation(
  tx: SettlementTx,
  bookingId: number
) {
  const { intent, parts } = await lockParts(tx, bookingId);
  if (intent.completedAt || parts.every(p => p.status === "succeeded")) return;
  const review = parts.find(p => p.status === "review_required");
  const failed = parts.find(p => p.status === "failed");
  const open = parts.filter(p => OPEN_STATUSES.includes(p.status));
  const requested = parts
    .map(p => p.requestedAt)
    .filter((at): at is Date => Boolean(at));
  const requestedAt = requested.length
    ? new Date(Math.min(...requested.map(at => at.getTime())))
    : null;
  const nextAttemptAt = open.length
    ? new Date(Math.min(...open.map(p => p.nextAttemptAt.getTime())))
    : intent.nextAttemptAt;
  await tx
    .update(ordinaryBookingRefunds)
    .set(
      review
        ? {
            status: "review_required",
            errorCode: review.errorCode,
            providerStatus: review.providerStatus,
            requestedAt,
          }
        : failed
          ? {
              status: "failed",
              errorCode: "provider_refund_failed",
              providerStatus: failed.providerStatus,
              requestedAt,
            }
          : {
              status: open.some(p => p.status === "pending")
                ? "pending"
                : requestedAt
                  ? "requesting"
                  : "queued",
              errorCode: open.find(p => p.errorCode)?.errorCode ?? null,
              providerStatus: null,
              requestedAt,
              nextAttemptAt,
            }
    )
    .where(eq(ordinaryBookingRefunds.bookingId, bookingId));
}

async function requirePartReview(
  tx: SettlementTx,
  part: Part,
  code: string,
  refund: Stripe.Refund,
  eventId: string
) {
  if (
    part.status === "review_required" &&
    part.errorCode === code &&
    part.providerStatus === refund.status
  )
    return;
  await updatePart(tx, part, {
    status: "review_required",
    errorCode: code,
    providerStatus: refund.status,
  });
  await tx
    .update(paymentReceipts)
    .set({
      settlementStatus: "review_required",
      settlementError: `Cancellation refund requires review: ${code}`,
    })
    .where(eq(paymentReceipts.paymentIntentId, part.paymentIntentId));
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, part.bookingId))
    .limit(1);
  await recordEvent(tx, {
    aggregateType: "payment",
    aggregateId: part.paymentIntentId,
    tenantId: booking?.tenantId,
    eventType: "payment.settlement_review_required",
    payload: {
      bookingId: part.bookingId,
      paymentIntentId: part.paymentIntentId,
      reason: code,
      refundId: refund.id,
      providerStatus: refund.status,
      providerAmount: refund.amount,
      providerEventId: eventId,
    },
  });
  await syncPartitionedCancellation(tx, part.bookingId);
}

/** Routes a verified provider refund to its part by our own refund metadata
 * (booking id and operation id), so a refund on any intent of the
 * cancellation reaches the part that requested it. */
async function recordVerifiedRefundPart(
  tx: SettlementTx,
  refund: Stripe.Refund,
  eventId: string
) {
  const operationId = refund.metadata?.refundOperationId;
  const bookingId = refund.metadata?.bookingId;
  if (!operationId || !bookingId) return false;
  const [hint] = await tx
    .select()
    .from(ordinaryBookingRefundParts)
    .where(eq(ordinaryBookingRefundParts.operationId, operationId))
    .limit(1);
  if (!hint || String(hint.bookingId) !== bookingId) return false;
  const { parts } = await lockParts(tx, hint.bookingId);
  const part = parts.find(p => p.id === hint.id);
  if (!part) throw new Error("Cancellation refund part missing");
  if (!matchesPart(part, refund)) {
    await requirePartReview(
      tx,
      part,
      "provider_refund_conflict",
      refund,
      eventId
    );
    return true;
  }
  const failed = refund.status === "failed" || refund.status === "canceled";
  if (part.status === "succeeded") {
    if (failed || refund.status === "requires_action")
      await requirePartReview(
        tx,
        part,
        "provider_reversed_refund",
        refund,
        eventId
      );
    return true;
  }
  if (part.status === "failed") {
    if (refund.status === "succeeded")
      await requirePartReview(
        tx,
        part,
        "provider_terminal_conflict",
        refund,
        eventId
      );
    return true;
  }
  if (
    part.status === "review_required" &&
    part.errorCode !== "unknown_provider_outcome"
  ) {
    if (refund.status === "succeeded" || failed)
      await requirePartReview(
        tx,
        part,
        part.errorCode ?? "provider_refund_conflict",
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
  await updatePart(tx, part, {
    status,
    refundId: refund.id,
    providerStatus: refund.status,
    errorCode: failed
      ? "provider_refund_failed"
      : refund.status === "requires_action"
        ? "provider_action_required"
        : null,
    nextAttemptAt: new Date(Date.now() + 60_000),
  });
  if (status === "succeeded") {
    const chargeId = reference(refund.charge);
    if (!chargeId)
      throw new Error("Verified cancellation refund charge missing");
    // Completes the cancellation once every part has succeeded.
    await settleVerifiedRefund(tx, {
      paymentIntentId: part.paymentIntentId,
      chargeId,
      amount: part.collectedAmount,
      amountRefunded: part.baseRefundedAmount + part.amount,
      currency: refund.currency,
      eventId,
      refundId: refund.id,
    });
  }
  await syncPartitionedCancellation(tx, part.bookingId);
  return true;
}

/** S-08 for one part: a lost dispute on the part's own intent returned the
 * whole part through the bank. No provider call; the cancellation completes
 * when every other part has succeeded. */
async function settlePartByChargeback(tx: SettlementTx, part: Part) {
  await updatePart(tx, part, {
    status: "succeeded",
    providerStatus: CHARGEBACK_SETTLED,
    errorCode: CHARGEBACK_SETTLED,
  });
  const intent = await lockIntent(tx, part.bookingId);
  await completeRefundParts(tx, intent);
  await syncPartitionedCancellation(tx, part.bookingId);
}

/** One part of a cancellation drawn on several intents, under the same rules
 * as the single-intent command: the S-08 dispute gate for its own intent, its
 * own idempotency key, provider history recovery, and no reissue of a request
 * whose outcome is unknown. A part that succeeded is never sent again. */
async function resumeRefundPart(
  bookingId: number,
  partId: string,
  observedRefund?: Stripe.Refund
): Promise<Stripe.Refund | null> {
  const db = await getDb();
  if (!db) throw new Error("Refund storage unavailable");
  let held: string[] = [];
  let settled = false;
  let noNewRefund = false;
  let done = false;
  const part = await db.transaction(async tx => {
    const { parts } = await lockParts(tx, bookingId);
    let saved = parts.find(p => p.id === partId);
    if (!saved) throw new Error("Cancellation refund part missing");
    if (["succeeded", "failed"].includes(saved.status)) {
      done = true;
      return null;
    }
    if (
      saved.status === "review_required" &&
      saved.errorCode !== "unknown_provider_outcome"
    )
      throw unavailable("Cancellation refund requires reconciliation");
    if (!observedRefund && !saved.refundId) {
      let gate = await savedRefundDisputeGate(
        tx,
        bookingId,
        saved.paymentIntentId
      );
      const remainder = saved.operationId.endsWith(CHARGEBACK_REMAINDER);
      let cover: number | null = null;
      if (gate.state === "lost" && !remainder && !saved.requestedAt) {
        cover = await lostDisputeCover(tx, bookingId, saved.paymentIntentId, {
          source: "part",
          id: saved.id,
        });
        if (cover === null) gate = { ...gate, state: "held" };
      }
      if (gate.state === "held") {
        held = gate.disputeIds;
        if (OPEN_STATUSES.includes(saved.status))
          await updatePart(tx, saved, {
            errorCode: DISPUTE_HOLD_ERROR,
            nextAttemptAt: new Date(Date.now() + DISPUTE_HOLD_RETRY_MS),
          });
        await syncPartitionedCancellation(tx, bookingId);
        return null;
      }
      if (gate.state === "lost" && !remainder) {
        if (saved.requestedAt) noNewRefund = true;
        else if (cover !== null) {
          if (cover >= saved.amount) {
            await settlePartByChargeback(tx, saved);
            settled = true;
            return null;
          }
          if (cover > 0) {
            const request = JSON.parse(
              saved.requestPayload
            ) as Stripe.RefundCreateParams;
            const operationId = `${saved.operationId}${CHARGEBACK_REMAINDER}`;
            const amount = saved.amount - cover;
            const requestPayload = JSON.stringify({
              ...request,
              amount,
              metadata: {
                ...(request.metadata as Record<string, string>),
                refundOperationId: operationId,
                chargebackSettledAmount: String(cover),
              },
            });
            await updatePart(tx, saved, {
              amount,
              operationId,
              requestPayload,
              errorCode: null,
            });
            saved = {
              ...saved,
              amount,
              operationId,
              requestPayload,
              errorCode: null,
            };
          }
        }
      }
    }
    const requestedAt = saved.requestedAt ?? new Date();
    await updatePart(tx, saved, {
      requestedAt,
      status: saved.status === "queued" ? "requesting" : saved.status,
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    await syncPartitionedCancellation(tx, bookingId);
    return { ...saved, requestedAt };
  });
  if (!part) {
    if (settled || done) return null;
    if (held.length) throw withdrawnDisputeError(held);
    throw unavailable("Cancellation refund requires reconciliation");
  }
  try {
    let refund = observedRefund;
    if (!refund && part.refundId)
      refund = await stripe.refunds.retrieve(part.refundId);
    if (!refund) {
      let scanned = 0;
      for await (const existing of stripe.refunds.list({
        payment_intent: part.paymentIntentId,
        limit: 100,
      })) {
        if (++scanned > 1000)
          throw unavailable("Provider refund history requires reconciliation");
        if (existing.metadata?.refundOperationId === part.operationId) {
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
        noNewRefund ||
        ["succeeded", "failed", "pending"].includes(part.status) ||
        Date.now() - part.requestedAt.getTime() >= 23 * 3600_000
      ) {
        await db.transaction(async tx => {
          const { parts } = await lockParts(tx, bookingId);
          const current = parts.find(p => p.id === part.id);
          if (current && !["succeeded", "failed"].includes(current.status)) {
            await updatePart(tx, current, {
              status: "review_required",
              errorCode: "unknown_provider_outcome",
            });
            await syncPartitionedCancellation(tx, bookingId);
          }
        });
        throw unavailable(
          "Cancellation refund outcome requires reconciliation"
        );
      }
      const request = JSON.parse(
        part.requestPayload
      ) as Stripe.RefundCreateParams;
      if (
        request.payment_intent !== part.paymentIntentId ||
        request.amount !== part.amount ||
        requestOperationId(request) !== part.operationId
      )
        throw unavailable("Saved cancellation request is invalid");
      // Same known window as the single-intent command (S-08).
      refund = await stripe.refunds.create(request, {
        idempotencyKey: part.operationId,
      });
    }
    const verified = refund;
    const handled = await db.transaction(async tx => {
      const { parts } = await lockParts(tx, bookingId);
      const current = parts.find(p => p.id === part.id);
      if (!current) throw new Error("Cancellation refund part missing");
      if (!matchesPart(current, verified)) {
        await requirePartReview(
          tx,
          current,
          "provider_refund_conflict",
          verified,
          `refund-reconcile:${verified.id}`
        );
        return false;
      }
      return recordVerifiedRefundPart(
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
    await db.transaction(async tx => {
      const { parts } = await lockParts(tx, bookingId);
      const current = parts.find(p => p.id === part.id);
      if (current && OPEN_STATUSES.includes(current.status)) {
        await updatePart(tx, current, {
          errorCode: "provider_unavailable",
          nextAttemptAt: new Date(Date.now() + 60_000),
        });
        await syncPartitionedCancellation(tx, bookingId);
      }
    });
    throw error;
  }
}

/** Every open part is attempted, in draw order; one part failing does not
 * stop the others. The first failure is reported after all were tried, and
 * the command stays retryable for the parts that did not succeed. */
async function resumeRefundParts(
  bookingId: number,
  parts: readonly Part[],
  observedRefund?: Stripe.Refund
) {
  // Review or failure of any part stops the whole command, as for one intent.
  if (
    parts.some(
      p =>
        p.status === "failed" ||
        (p.status === "review_required" &&
          p.errorCode !== "unknown_provider_outcome")
    )
  )
    throw unavailable("Cancellation refund requires reconciliation");
  let failure: unknown = null;
  let last: Stripe.Refund | null = null;
  for (const part of parts) {
    if (["succeeded", "failed"].includes(part.status)) continue;
    const observed =
      observedRefund?.metadata?.refundOperationId === part.operationId
        ? observedRefund
        : undefined;
    try {
      last = (await resumeRefundPart(bookingId, part.id, observed)) ?? last;
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
  return last;
}

/** The provider outcome of a multi-intent cancellation, read back from its
 * saved parts after every open part was attempted. */
export async function processPartitionedRefundCancellation(bookingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Refund storage unavailable");
  const before = await getRefundParts(db, bookingId);
  if (!before.length) throw new Error("Cancellation refund parts missing");
  await resumeRefundParts(bookingId, before);
  const parts = await getRefundParts(db, bookingId);
  const paymentIntentIds = parts.map(p => p.paymentIntentId);
  // A part the provider refused fails the command. As the single-intent
  // command returns the refused provider refund, report the refused money
  // and the last refused provider refund, never the parts that were sent.
  const refused = parts.filter(p => p.status === "failed" && p.refundId);
  if (refused.length)
    return {
      refundId: refused[refused.length - 1].refundId as string,
      amount: refused.reduce((sum, p) => sum + p.amount, 0),
      status: "failed",
      paymentIntentIds,
    };
  const refunded = parts.filter(
    p => p.refundId && p.errorCode !== CHARGEBACK_SETTLED
  );
  if (!refunded.length)
    throw unavailable(
      "The lost payment dispute returned this cancellation refund; no provider refund is due"
    );
  return {
    refundId: refunded[refunded.length - 1].refundId as string,
    amount: refunded.reduce((sum, p) => sum + p.amount, 0),
    status: parts.every(p => p.status === "succeeded")
      ? "succeeded"
      : "pending",
    paymentIntentIds,
  };
}

/** Marks the command that carries the part of a cancellation refund a lost
 * dispute did not cover. Its own operation id is its own idempotency key. */
const CHARGEBACK_REMAINDER = ":chargeback-remainder";

/** A lost dispute returned the whole refund through the bank: close the command
 * with no provider refund and complete the cancellation. The amount sent to the
 * provider is recorded as 0 (the saved request keeps the original amount), so
 * the receipt's refunded amount and the ledger are unchanged. */
async function settleOrdinaryByChargeback(tx: SettlementTx, saved: Intent) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, saved.bookingId))
    .for("update");
  const [receipt] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, saved.paymentIntentId))
    .for("update");
  if (!booking || !receipt)
    throw new Error("Cancellation settlement owner missing");
  let completed = booking.status === "cancelled";
  if (!completed && receipt.settlementStatus === "applied")
    completed = await cancelAfterPartialRefund(
      tx,
      booking,
      saved.paymentIntentId,
      saved.actorId,
      "Cancelled by customer; refund settled by the lost payment dispute"
    );
  await tx
    .update(ordinaryBookingRefunds)
    .set(
      completed
        ? {
            status: "succeeded",
            amount: 0,
            providerStatus: CHARGEBACK_SETTLED,
            errorCode: CHARGEBACK_SETTLED,
            completedAt: new Date(),
          }
        : {
            status: "review_required",
            errorCode: "cancellation_reconciliation_required",
          }
    )
    .where(eq(ordinaryBookingRefunds.bookingId, saved.bookingId));
}

/** Resume one immutable command. Listing recovers a lost create response; a
 * missing outcome beyond Stripe's safe idempotency window is never reissued.
 * Resolves null when a lost dispute settled the whole refund. */
async function resumeOrdinaryRefund(
  bookingId: number,
  observedRefund?: Stripe.Refund
): Promise<Stripe.Refund | null> {
  const db = await getDb();
  if (!db) throw new Error("Refund storage unavailable");
  const parts = await getRefundParts(db, bookingId);
  if (parts.length) return await resumeRefundParts(bookingId, parts);
  let held: string[] = [];
  let settled = false;
  // A command that may already have reached the provider is never reissued
  // after a lost dispute: it is reconciled from provider history or reviewed.
  let noNewRefund = false;
  const intent = await db.transaction(async tx => {
    let saved = await lockIntent(tx, bookingId);
    if (saved.amount === 0 || saved.providerStatus === "not_required")
      throw unavailable(
        "This is a completed cancellation without a provider refund"
      );
    if (
      saved.status === "review_required" &&
      saved.errorCode !== "unknown_provider_outcome"
    )
      throw unavailable("Cancellation refund requires reconciliation");
    // A command saved before a dispute withdrew the funds must not reach the
    // provider while the dispute holds them. It stays queued and retryable;
    // an authenticated provider refund that already exists still reconciles.
    if (!observedRefund && !saved.refundId) {
      let gate = await savedRefundDisputeGate(
        tx,
        bookingId,
        saved.paymentIntentId
      );
      const remainder = saved.operationId.endsWith(CHARGEBACK_REMAINDER);
      let cover: number | null = null;
      if (gate.state === "lost" && !remainder && !saved.requestedAt) {
        cover = await lostDisputeCover(tx, bookingId, saved.paymentIntentId, {
          source: "ordinary",
          id: String(bookingId),
        });
        // A lost close delivered before its withdrawal waits for the amount.
        if (cover === null) gate = { ...gate, state: "held" };
      }
      if (gate.state === "held") {
        held = gate.disputeIds;
        if (["queued", "requesting", "pending"].includes(saved.status))
          await tx
            .update(ordinaryBookingRefunds)
            .set({
              errorCode: DISPUTE_HOLD_ERROR,
              nextAttemptAt: new Date(Date.now() + DISPUTE_HOLD_RETRY_MS),
            })
            .where(eq(ordinaryBookingRefunds.bookingId, bookingId));
        return null;
      }
      if (gate.state === "lost" && !remainder) {
        if (saved.requestedAt) noNewRefund = true;
        else if (cover !== null) {
          if (cover >= saved.amount) {
            await settleOrdinaryByChargeback(tx, saved);
            settled = true;
            return null;
          }
          if (cover > 0) {
            // Only the part the chargeback did not return goes to the provider,
            // under its own operation id and idempotency key.
            const request = JSON.parse(
              saved.requestPayload
            ) as Stripe.RefundCreateParams;
            const operationId = `${saved.operationId}${CHARGEBACK_REMAINDER}`;
            const amount = saved.amount - cover;
            const requestPayload = JSON.stringify({
              ...request,
              amount,
              metadata: {
                ...(request.metadata as Record<string, string>),
                refundOperationId: operationId,
                chargebackSettledAmount: String(cover),
              },
            });
            await tx
              .update(ordinaryBookingRefunds)
              .set({ amount, operationId, requestPayload, errorCode: null })
              .where(eq(ordinaryBookingRefunds.bookingId, bookingId));
            saved = {
              ...saved,
              amount,
              operationId,
              requestPayload,
              errorCode: null,
            };
          }
        }
      }
    }
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
  if (!intent) {
    if (settled) return null;
    if (held.length) throw withdrawnDisputeError(held);
    throw unavailable("Cancellation refund requires reconciliation");
  }
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
        noNewRefund ||
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
      // Known window (S-08): the dispute gate ran in the transaction that
      // committed requestedAt above. A funds_withdrawn committed after that
      // commit but before this call is not seen, and the refund is still sent
      // once. No database lock can be held across the provider call, so this
      // window cannot be closed here (pinned in
      // dispute-chargeback-settlement-mysql.test.ts, "known limits").
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

export async function processOrdinaryRefundCancellation(
  bookingId: number,
  observedRefund?: Stripe.Refund
) {
  const refund = await resumeOrdinaryRefund(bookingId, observedRefund);
  if (!refund)
    throw unavailable(
      "The lost payment dispute returned this cancellation refund; no provider refund is due"
    );
  return refund;
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
      await resumeOrdinaryRefund(intent.bookingId);
    } catch {
      failed++;
    }
  }
  return { scanned: due.length, failed };
}
