import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createServiceLogger } from "../_core/logger";
const log = createServiceLogger("order-refunds");
import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "../db";
import { stripe } from "../stripe";
import {
  auditLogs,
  bookings,
  flightCancellationJobs,
  orderServiceRefundAttempts,
  orderServiceRefunds,
  paymentReceipts,
  bookingRefundPlans,
  ordinaryBookingRefunds,
  type Booking,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { allocateSplitRefund } from "./split-refund.service";
import {
  reviewCancelledServicingUpgrade,
  settleVerifiedRefund,
} from "./payment-settlement.service";
import { recordEvent } from "./outbox.service";
import {
  CHARGEBACK_PARTIAL_COVER,
  CHARGEBACK_SETTLED,
  DISPUTE_HOLD_ERROR,
  DISPUTE_HOLD_RETRY_MS,
  lostDisputeCover,
  savedRefundDisputeGate,
} from "./payment-dispute.service";

type OrderServiceRefund = typeof orderServiceRefunds.$inferSelect;
type PaymentReceipt = typeof paymentReceipts.$inferSelect;

/** A servicing refund in one of these statuses is an open liability. A
 * succeeded refund and one an operator cancelled with a reason are closed. */
export const OPEN_ORDER_REFUND_STATUSES = [
  "queued",
  "requesting",
  "pending",
  "failed",
  "review_required",
] as const;
/** The provider refused the refund (refund status failed or canceled). */
export const PROVIDER_REFUND_FAILED = "provider_refund_failed";
/** A refund of an earlier, archived attempt reports success. It never settles
 * from the event: the row is reviewed and reconciled from the provider. */
export const EARLIER_ATTEMPT_SUCCEEDED = "earlier_attempt_succeeded";
/** A provider refund that has not failed arrived for a cancelled request. */
export const REFUND_AFTER_CANCEL = "provider_refund_after_cancel";
/** Reconcile closed a request reopened by such a refund that the receipt had
 * already recorded: no second settlement. */
export const SUCCEEDED_AFTER_CANCEL = "succeeded_after_cancel";
const REVIEW_CODES = [
  "provider_history_limit",
  "duplicate_provider_refund",
  "provider_refund_balance_conflict",
  "unknown_provider_outcome",
];

const providerFailed = (refund: Pick<Stripe.Refund, "status">) =>
  refund.status === "failed" || refund.status === "canceled";

/** Attempt 1 carries no attempt metadata, as every request made before
 * attempts existed; a later attempt carries its number. */
function refundAttempt(refund: Stripe.Refund) {
  const raw = refund.metadata?.attempt;
  if (raw === undefined) return 1;
  return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : Number.NaN;
}

/** Attempt 1 keeps the key every earlier release sent. */
export function orderRefundIdempotencyKey(id: string, attempt: number) {
  return attempt > 1 ? `order-refund:${id}:a${attempt}` : `order-refund:${id}`;
}

export async function assertNoOrderRefundPending(
  tx: SettlementTx,
  bookingId: number
) {
  const [pending] = await tx
    .select()
    .from(orderServiceRefunds)
    .where(
      and(
        eq(orderServiceRefunds.bookingId, bookingId),
        inArray(orderServiceRefunds.status, [...OPEN_ORDER_REFUND_STATUSES])
      )
    )
    .limit(1);
  if (pending)
    throw new Error(
      "An order-service refund liability must be reconciled first"
    );
}
export async function planOrderRefund(
  tx: SettlementTx,
  booking: Booking,
  modificationId: number | null,
  amount: number,
  cancellationFlightId?: number
) {
  await assertNoOrderRefundPending(tx, booking.id);
  const [cancellation] = await tx
    .select()
    .from(bookingRefundPlans)
    .where(eq(bookingRefundPlans.bookingId, booking.id))
    .limit(1);
  if (cancellation)
    throw new Error("Cancellation refund plan prevents an exchange refund");
  const [ordinaryCancellation] = await tx
    .select()
    .from(ordinaryBookingRefunds)
    .where(eq(ordinaryBookingRefunds.bookingId, booking.id))
    .limit(1);
  if (ordinaryCancellation)
    throw new Error("Cancellation refund command prevents an exchange refund");
  const receipts = await tx
    .select()
    .from(paymentReceipts)
    .where(
      and(
        eq(paymentReceipts.bookingId, booking.id),
        eq(paymentReceipts.settlementStatus, "applied"),
        inArray(paymentReceipts.kind, [
          "booking",
          "split_payment",
          "modification",
        ])
      )
    )
    .orderBy(asc(paymentReceipts.paymentIntentId))
    .for("update");
  const balances = receipts.filter(r => r.amount > r.refundedAmount);
  if (
    !balances.length ||
    balances.length > 20 ||
    balances.some(r => r.currency !== "SAR") ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > balances.reduce((n, r) => n + r.amount - r.refundedAmount, 0)
  )
    throw new Error(
      "Original refundable payer receipts are unavailable; wallet or external funding needs its own refund authority"
    );
  const allocation =
    balances.length === 1
      ? [{ splitId: 0, refundAmount: amount }]
      : allocateSplitRefund(
          balances.map((r, i) => ({
            splitId: i,
            amount: r.amount - r.refundedAmount,
          })),
          amount
        );
  for (const part of allocation) {
    if (!part.refundAmount) continue;
    const receipt = balances[part.splitId];
    if (!receipt) throw new Error("Refund payer mapping missing");
    await tx.insert(orderServiceRefunds).values({
      id: randomUUID(),
      bookingId: booking.id,
      modificationId,
      cancellationFlightId: cancellationFlightId ?? null,
      paymentIntentId: receipt.paymentIntentId,
      amount: part.refundAmount,
      baseRefundedAmount: receipt.refundedAmount,
      status: "queued",
      nextAttemptAt: new Date(Math.floor(Date.now() / 1000) * 1000),
    });
  }
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "order.refund_planned",
    payload: { modificationId, amount, payers: allocation.length },
  });
}

function refundEventPayload(
  item: OrderServiceRefund,
  status: string,
  refund: Stripe.Refund,
  extra: Record<string, unknown> = {}
) {
  const attempt = refundAttempt(refund);
  return {
    requestId: item.id,
    modificationId: item.modificationId,
    status,
    refundId: refund.id,
    ...(attempt > 1 ? { attempt } : {}),
    ...extra,
  };
}

/** Moves a request to review for a provider refund that must not settle,
 * with one event when the state changes. The caller holds the booking lock. */
async function reviewProviderRefund(
  tx: SettlementTx,
  booking: Booking,
  item: OrderServiceRefund,
  refund: Stripe.Refund,
  code: string
) {
  if (item.status === "review_required" && item.errorCode === code) return;
  await tx
    .update(orderServiceRefunds)
    .set({ status: "review_required", errorCode: code })
    .where(eq(orderServiceRefunds.id, item.id));
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "order.refund_updated",
    payload: refundEventPayload(item, "review_required", refund, {
      errorCode: code,
      providerStatus: refund.status,
    }),
  });
}

/** Records a verified provider outcome on its request and settles a success
 * once. The caller holds the booking and request locks and has checked the
 * receipt balance. A request under review for an earlier attempt's success
 * stays under review after its own attempt settles. */
async function applyVerifiedRefund(
  tx: SettlementTx,
  booking: Booking,
  item: OrderServiceRefund,
  receipt: PaymentReceipt,
  refund: Stripe.Refund,
  eventId: string,
  keepEarlierAttemptReview: boolean
) {
  const status =
    refund.status === "succeeded"
      ? "succeeded"
      : providerFailed(refund)
        ? "failed"
        : "pending";
  await tx
    .update(orderServiceRefunds)
    .set({
      status,
      refundId: refund.id,
      nextAttemptAt: new Date(Date.now() + 60000),
      completedAt: status === "succeeded" ? new Date() : null,
      errorCode: status === "failed" ? PROVIDER_REFUND_FAILED : null,
    })
    .where(eq(orderServiceRefunds.id, item.id));
  if (status === "succeeded") {
    const chargeId =
      typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
    if (!chargeId) throw new Error("Verified refund charge missing");
    await settleVerifiedRefund(tx, {
      paymentIntentId: item.paymentIntentId,
      chargeId,
      amount: receipt.amount,
      amountRefunded: item.baseRefundedAmount + item.amount,
      currency: receipt.currency,
      eventId,
      refundId: refund.id,
    });
  }
  if (keepEarlierAttemptReview)
    await tx
      .update(orderServiceRefunds)
      .set({ status: "review_required", errorCode: EARLIER_ATTEMPT_SUCCEEDED })
      .where(eq(orderServiceRefunds.id, item.id));
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "order.refund_updated",
    payload: refundEventPayload(
      item,
      keepEarlierAttemptReview ? "review_required" : status,
      refund
    ),
  });
}

/** Only a verified webhook or a directly retrieved provider object may call this. */
export async function recordVerifiedOrderRefund(
  tx: SettlementTx,
  refund: Stripe.Refund,
  eventId: string
) {
  const requestId = refund.metadata?.orderServiceRefundId;
  if (!requestId) return false;
  const [hint] = await tx
    .select()
    .from(orderServiceRefunds)
    .where(eq(orderServiceRefunds.id, requestId))
    .limit(1);
  if (!hint) throw new Error("Unknown order refund request");
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, hint.bookingId))
    .for("update");
  const [item] = await tx
    .select()
    .from(orderServiceRefunds)
    .where(eq(orderServiceRefunds.id, requestId))
    .for("update");
  const intent =
    typeof refund.payment_intent === "string"
      ? refund.payment_intent
      : refund.payment_intent?.id;
  const attempt = refundAttempt(refund);
  if (
    !booking ||
    !item ||
    item.paymentIntentId !== intent ||
    item.amount !== refund.amount ||
    refund.currency.toUpperCase() !== "SAR" ||
    !Number.isSafeInteger(attempt) ||
    attempt > item.attempt
  )
    throw new Error("Verified refund does not match the saved request");
  // A refund of an archived attempt is matched first. Archived refunds had
  // failed at the provider, a terminal state, so a later failed, canceled or
  // pending event for one changes nothing. A success never settles here.
  const [archived] = await tx
    .select()
    .from(orderServiceRefundAttempts)
    .where(eq(orderServiceRefundAttempts.refundId, refund.id))
    .limit(1);
  if (
    archived &&
    (archived.requestId !== item.id || archived.attempt !== attempt)
  )
    throw new Error("Verified refund does not match the saved request");
  if (archived || attempt < item.attempt) {
    if (
      refund.status !== "succeeded" &&
      (archived !== undefined || providerFailed(refund))
    ) {
      log.info(
        {
          refundRequestId: item.id,
          refundId: refund.id,
          attempt,
          providerStatus: refund.status,
          eventId,
        },
        "Earlier refund attempt event recorded; nothing changes"
      );
      return true;
    }
    // An earlier attempt the operator's reconcile settled replays as a no-op.
    if (item.completedAt && item.refundId === refund.id) return true;
    await reviewProviderRefund(
      tx,
      booking,
      item,
      refund,
      refund.status === "succeeded"
        ? EARLIER_ATTEMPT_SUCCEEDED
        : "duplicate_provider_refund"
    );
    return true;
  }
  if (item.refundId && item.refundId !== refund.id)
    throw new Error("Verified refund does not match the saved request");
  if (
    item.status === "succeeded" ||
    (item.completedAt && item.refundId === refund.id)
  )
    return true;
  if (item.status === "cancelled") {
    if (providerFailed(refund)) return true;
    await reviewProviderRefund(tx, booking, item, refund, REFUND_AFTER_CANCEL);
    return true;
  }
  const [receipt] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, item.paymentIntentId))
    .for("update");
  if (!receipt || receipt.refundedAmount !== item.baseRefundedAmount)
    throw new Error("Refund balance changed outside this servicing request");
  await applyVerifiedRefund(
    tx,
    booking,
    item,
    receipt,
    refund,
    eventId,
    item.status === "review_required" &&
      item.errorCode === EARLIER_ATTEMPT_SUCCEEDED
  );
  return true;
}
/** This request's provider refunds that have not failed, by our metadata. */
async function readLiveRequestRefunds(item: OrderServiceRefund) {
  const live: Stripe.Refund[] = [];
  let scanned = 0;
  for await (const refund of stripe.refunds.list({
    payment_intent: item.paymentIntentId,
    limit: 100,
  })) {
    if (++scanned > 1000) throw new Error("provider_history_limit");
    if (
      refund.metadata?.orderServiceRefundId === item.id &&
      !providerFailed(refund)
    )
      live.push(refund);
  }
  return live;
}
async function processOrderRefund(id: string) {
  const db = await getDb();
  if (!db) throw new Error("Refund storage unavailable");
  const [hint] = await db
    .select()
    .from(orderServiceRefunds)
    .where(eq(orderServiceRefunds.id, id))
    .limit(1);
  if (!hint) return;
  // Issue #382: a retried request (attempt > 1, so it has an archived
  // attempt) that was never sent is closed by a lost dispute's chargeback
  // only after the provider's history, read outside any transaction, shows no
  // refund of it that has not failed. Attempt 1 is unchanged.
  let historyRead = false;
  if (
    hint.attempt > 1 &&
    !hint.refundId &&
    !hint.requestedAt &&
    hint.status === "queued" &&
    hint.nextAttemptAt <= new Date() &&
    (await savedRefundDisputeGate(db, hint.bookingId, hint.paymentIntentId))
      .state === "lost"
  ) {
    let live: Stripe.Refund[];
    try {
      live = await readLiveRequestRefunds(hint);
    } catch (error) {
      log.error(
        { err: error, refundRequestId: id },
        "Refund history read before a chargeback closure failed"
      );
      if (error instanceof Error && error.message === "provider_history_limit")
        await db
          .update(orderServiceRefunds)
          .set({
            status: "review_required",
            errorCode: "provider_history_limit",
          })
          .where(
            and(
              eq(orderServiceRefunds.id, id),
              eq(orderServiceRefunds.attempt, hint.attempt),
              eq(orderServiceRefunds.status, "queued")
            )
          );
      return;
    }
    const [found] = live;
    if (found) {
      await db.transaction(tx =>
        recordVerifiedOrderRefund(
          tx,
          found,
          `order_refund_reconcile:${found.id}`
        )
      );
      return;
    }
    historyRead = true;
  }
  const item = await db.transaction(async tx => {
    await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, hint.bookingId))
      .for("update");
    const [r] = await tx
      .select()
      .from(orderServiceRefunds)
      .where(eq(orderServiceRefunds.id, id))
      .for("update");
    if (
      !r ||
      !["queued", "requesting", "pending"].includes(r.status) ||
      r.nextAttemptAt > new Date()
    )
      return null;
    // Flight-cancellation and exchange refunds wait, queued and retryable,
    // while a dispute holds the booking's funds. The cancellation or exchange
    // itself has already been applied. An existing provider refund still
    // reconciles. After a lost dispute on this collection the bank has
    // returned the money: a refund it covers is closed with no provider
    // refund; refunds of the booking's other collections proceed.
    let noNewRefund = false;
    let gate = r.refundId
      ? null
      : await savedRefundDisputeGate(tx, hint.bookingId, r.paymentIntentId);
    let cover: number | null = null;
    // A retried request waits for its history read (above) first.
    if (
      gate?.state === "lost" &&
      !r.requestedAt &&
      r.attempt > 1 &&
      !historyRead
    )
      return null;
    if (gate?.state === "lost" && !r.requestedAt) {
      cover = await lostDisputeCover(tx, hint.bookingId, r.paymentIntentId, {
        source: "order",
        id: r.id,
      });
      // A lost close delivered before its withdrawal waits for the amount.
      if (cover === null) gate = { ...gate, state: "held" };
    }
    if (gate?.state === "held") {
      await tx
        .update(orderServiceRefunds)
        .set({
          errorCode: DISPUTE_HOLD_ERROR,
          nextAttemptAt: new Date(Date.now() + DISPUTE_HOLD_RETRY_MS),
        })
        .where(eq(orderServiceRefunds.id, id));
      return null;
    }
    if (gate?.state === "lost") {
      // A request that may already have reached the provider is never
      // reissued: it is reconciled from provider history or reviewed.
      if (r.requestedAt) noNewRefund = true;
      else if (cover !== null) {
        if (cover >= r.amount) {
          await tx
            .update(orderServiceRefunds)
            .set({
              status: "succeeded",
              errorCode: CHARGEBACK_SETTLED,
              completedAt: new Date(),
            })
            .where(eq(orderServiceRefunds.id, id));
          return null;
        }
        // The request's amount is its planned payer liability; a remainder
        // needs its own request, so a partly covered refund is reviewed.
        if (cover > 0) {
          await tx
            .update(orderServiceRefunds)
            .set({
              status: "review_required",
              errorCode: CHARGEBACK_PARTIAL_COVER,
            })
            .where(eq(orderServiceRefunds.id, id));
          return null;
        }
      }
    }
    const requestedAt = r.requestedAt ?? new Date();
    await tx
      .update(orderServiceRefunds)
      .set({
        status: "requesting",
        requestedAt,
        nextAttemptAt: new Date(Date.now() + 60000),
      })
      .where(eq(orderServiceRefunds.id, id));
    return {
      ...r,
      requestedAt,
      noNewRefund,
      firstRequest: r.requestedAt === null,
    };
  });
  if (!item) return;
  try {
    let refund: Stripe.Refund | undefined;
    if (item.refundId) refund = await stripe.refunds.retrieve(item.refundId);
    else {
      let scanned = 0;
      let otherAmount = 0;
      let earlierSucceeded: Stripe.Refund | undefined;
      for await (const found of stripe.refunds.list({
        payment_intent: item.paymentIntentId,
        limit: 100,
      })) {
        if (++scanned > 1000) throw new Error("provider_history_limit");
        if (found.metadata?.orderServiceRefundId === item.id) {
          const attempt = refundAttempt(found);
          if (attempt === item.attempt) {
            if (refund) throw new Error("duplicate_provider_refund");
            refund = found;
          } else if (attempt < item.attempt && found.status === "succeeded")
            earlierSucceeded ??= found;
          else if (attempt > item.attempt || !providerFailed(found))
            throw new Error("duplicate_provider_refund");
        } else if (!providerFailed(found)) otherAmount += found.amount;
      }
      // An earlier attempt that succeeded at the provider is reviewed and this
      // attempt is never sent; a first request leaves no request time behind.
      const earlier = earlierSucceeded;
      if (earlier) {
        await db.transaction(tx =>
          recordVerifiedOrderRefund(
            tx,
            earlier,
            `order_refund_reconcile:${earlier.id}`
          )
        );
        if (item.firstRequest)
          await db
            .update(orderServiceRefunds)
            .set({ requestedAt: null })
            .where(
              and(
                eq(orderServiceRefunds.id, id),
                eq(orderServiceRefunds.attempt, item.attempt),
                isNull(orderServiceRefunds.refundId)
              )
            );
        return;
      } else {
        if (otherAmount !== item.baseRefundedAmount)
          throw new Error("provider_refund_balance_conflict");
        if (!refund) {
          if (
            item.noNewRefund ||
            Date.now() - item.requestedAt.getTime() >= 23 * 3600000
          )
            throw new Error("unknown_provider_outcome");
          refund = await stripe.refunds.create(
            {
              payment_intent: item.paymentIntentId,
              amount: item.amount,
              metadata: {
                orderServiceRefundId: item.id,
                ...(item.modificationId !== null
                  ? { modificationId: String(item.modificationId) }
                  : {
                      cancellationFlightId: String(item.cancellationFlightId),
                    }),
                ...(item.attempt > 1 ? { attempt: String(item.attempt) } : {}),
              },
            },
            { idempotencyKey: orderRefundIdempotencyKey(item.id, item.attempt) }
          );
        }
      }
    }
    await db.transaction(tx =>
      recordVerifiedOrderRefund(
        tx,
        refund as Stripe.Refund,
        `order_refund_reconcile:${refund?.id}`
      )
    );
  } catch (error) {
    log.error(
      { err: error, refundRequestId: id },
      "Refund transport or reconciliation failed"
    );
    const code = error instanceof Error ? error.message : "provider_error";
    // Only the attempt this run sent is marked; an operator retry since then
    // owns the request.
    const thisAttempt = and(
      eq(orderServiceRefunds.id, id),
      eq(orderServiceRefunds.attempt, item.attempt)
    );
    if (REVIEW_CODES.includes(code))
      await db
        .update(orderServiceRefunds)
        .set({ status: "review_required", errorCode: code })
        .where(thisAttempt);
    else
      await db
        .update(orderServiceRefunds)
        .set({ errorCode: "transport_or_reconciliation_error" })
        .where(thisAttempt);
  }
}
export async function processPendingOrderRefunds() {
  const db = await getDb();
  if (!db) throw new Error("Refund storage unavailable");
  const rows = await db
    .select({ id: orderServiceRefunds.id })
    .from(orderServiceRefunds)
    .where(
      and(
        inArray(orderServiceRefunds.status, [
          "queued",
          "requesting",
          "pending",
        ]),
        lte(orderServiceRefunds.nextAttemptAt, new Date())
      )
    )
    .limit(50);
  for (const r of rows) await processOrderRefund(r.id);
  return { scanned: rows.length };
}

// ---------------------------------------------------------------------------
// Operator resolution (issue #382, ADR 0003). The list shows failed and
// review_required servicing refunds of both origins. Every action re-reads
// the provider outside any database transaction, then decides under the
// booking lock, in the worker's lock order (booking, request, receipt). No
// action creates a provider refund: a retry queues the next attempt for the
// worker.
// ---------------------------------------------------------------------------

export type ServicingRefundActor = { id: number; role: string };

const refused = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });
const raced = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "The servicing refund changed while the provider was read; read it again before acting",
  });
const staleAttempt = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "The servicing refund is on another attempt than the one reviewed; read it again before acting",
  });

function servicingDb() {
  const db = getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Refund storage unavailable",
    });
  return db;
}

export async function listServicingRefundReviews(limit: number) {
  const db = servicingDb();
  const rows = await db
    .select({
      request: orderServiceRefunds,
      bookingReference: bookings.bookingReference,
    })
    .from(orderServiceRefunds)
    .leftJoin(bookings, eq(bookings.id, orderServiceRefunds.bookingId))
    .where(inArray(orderServiceRefunds.status, ["failed", "review_required"]))
    .orderBy(desc(orderServiceRefunds.createdAt), desc(orderServiceRefunds.id))
    .limit(limit);
  return rows.map(({ request, bookingReference }) => ({
    id: request.id,
    origin:
      request.cancellationFlightId !== null
        ? ("flight_cancellation" as const)
        : ("exchange" as const),
    status: request.status as "failed" | "review_required",
    bookingId: request.bookingId,
    bookingReference,
    modificationId: request.modificationId,
    cancellationFlightId: request.cancellationFlightId,
    paymentIntentId: request.paymentIntentId,
    amount: request.amount,
    currency: "SAR" as const,
    errorCode: request.errorCode,
    refundId: request.refundId,
    attempt: request.attempt,
    requestedAt: request.requestedAt,
    createdAt: request.createdAt,
  }));
}

async function readServicingRequest(
  db: SettlementTx,
  requestId: string
): Promise<OrderServiceRefund> {
  const [row] = await db
    .select()
    .from(orderServiceRefunds)
    .where(eq(orderServiceRefunds.id, requestId))
    .limit(1);
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Servicing refund not found",
    });
  return row;
}

/** Booking first, then the request and its collection, as the worker does. A
 * request with no booking, or on a collection that is not one of the
 * booking's own payer receipts (a wallet top-up), is refused. */
async function lockServicingRequest(
  tx: SettlementTx,
  requestId: string,
  bookingId: number
) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  const [item] = await tx
    .select()
    .from(orderServiceRefunds)
    .where(eq(orderServiceRefunds.id, requestId))
    .for("update");
  if (!item)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Servicing refund not found",
    });
  if (!booking || item.bookingId !== booking.id)
    throw refused(
      "This servicing refund has no booking; wallet or external funding needs its own refund authority"
    );
  const [receipt] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, item.paymentIntentId))
    .for("update");
  if (
    !receipt ||
    receipt.bookingId !== booking.id ||
    !["booking", "split_payment", "modification"].includes(receipt.kind) ||
    receipt.currency !== "SAR"
  )
    throw refused(
      "Original refundable payer receipts are unavailable; wallet or external funding needs its own refund authority"
    );
  return { booking, item, receipt };
}

type ProviderRequestState = {
  /** Every provider refund of this request, each with its current state. */
  refunds: Stripe.Refund[];
  /** Refunds of the collection outside this request that have not failed. */
  otherAmount: number;
  historyLimit: boolean;
};

/** The worker's reconciliation read: the collection's refunds matched by our
 * metadata, plus a direct retrieve of every refund id this request recorded
 * (the live attempt and the archived ones). Never inside a transaction. */
async function readProviderRequest(
  item: OrderServiceRefund,
  archivedRefundIds: string[]
): Promise<ProviderRequestState> {
  try {
    const found = new Map<string, Stripe.Refund>();
    let scanned = 0;
    let otherAmount = 0;
    for await (const refund of stripe.refunds.list({
      payment_intent: item.paymentIntentId,
      limit: 100,
    })) {
      if (++scanned > 1000)
        return { refunds: [], otherAmount, historyLimit: true };
      if (refund.metadata?.orderServiceRefundId === item.id)
        found.set(refund.id, refund);
      else if (!providerFailed(refund)) otherAmount += refund.amount;
    }
    for (const id of new Set([item.refundId, ...archivedRefundIds])) {
      if (!id) continue;
      const refund = await stripe.refunds.retrieve(id);
      if (refund) found.set(refund.id, refund);
    }
    return { refunds: [...found.values()], otherAmount, historyLimit: false };
  } catch (error) {
    log.error(
      { err: error, refundRequestId: item.id },
      "Servicing refund provider read failed"
    );
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message:
        "The payment provider could not be read; the servicing refund is unchanged",
      cause: error,
    });
  }
}

function archivedAttempts(db: SettlementTx, requestId: string) {
  return db
    .select()
    .from(orderServiceRefundAttempts)
    .where(eq(orderServiceRefundAttempts.requestId, requestId))
    .orderBy(asc(orderServiceRefundAttempts.attempt));
}

/** Retry and cancel stay with the dispute flow while a dispute holds or has
 * taken this collection's funds: a retried or cancelled request would change
 * the lost amount's allocation across the collection's saved commands. */
async function assertNoDisputeOnCollection(
  tx: SettlementTx,
  item: OrderServiceRefund
) {
  const gate = await savedRefundDisputeGate(
    tx,
    item.bookingId,
    item.paymentIntentId
  );
  if (gate.state !== "clear")
    throw refused(
      `Payment dispute ${gate.disputeIds.join(", ")} on this collection ${gate.state === "held" ? "holds" : "has taken"} its funds; this servicing refund stays with the dispute flow`
    );
}

async function auditResolution(
  tx: SettlementTx,
  actor: ServicingRefundActor,
  item: OrderServiceRefund,
  eventType: string,
  newValue: Record<string, unknown>,
  changeDescription: string
) {
  await tx.insert(auditLogs).values({
    eventId: randomUUID(),
    eventType,
    eventCategory: "refund",
    outcome: "success",
    severity: "high",
    userId: actor.id,
    userRole: actor.role,
    actorType: "admin",
    resourceType: "order_service_refund",
    resourceId: item.id,
    previousValue: JSON.stringify({
      status: item.status,
      errorCode: item.errorCode,
      refundId: item.refundId,
      attempt: item.attempt,
    }),
    newValue: JSON.stringify(newValue),
    changeDescription,
    metadata: JSON.stringify({
      bookingId: item.bookingId,
      paymentIntentId: item.paymentIntentId,
      amount: item.amount,
      currency: "SAR",
    }),
  });
}

export type ReconcileOutcome =
  | "settled"
  | "pending"
  | "provider_failed"
  | "no_provider_refund"
  | "review_required"
  | "unchanged";

function resolutionView(item: OrderServiceRefund) {
  return {
    requestId: item.id,
    status: item.status,
    attempt: item.attempt,
    errorCode: item.errorCode,
    refundId: item.refundId,
  };
}

/** Reconcile leaves a row with the dispute flow while a dispute holds or has
 * taken its collection's funds, and never rewrites a row a lost dispute
 * partly covers: either would change the lost amount's allocation. */
async function assertReconcileAllowed(
  tx: SettlementTx,
  item: OrderServiceRefund
) {
  if (item.errorCode === CHARGEBACK_PARTIAL_COVER)
    throw refused(
      "A servicing refund partly covered by a lost dispute stays with the dispute flow"
    );
  await assertNoDisputeOnCollection(tx, item);
}

const sameState = (a: OrderServiceRefund, b: OrderServiceRefund) =>
  a.status === b.status &&
  a.errorCode === b.errorCode &&
  a.refundId === b.refundId &&
  a.attempt === b.attempt &&
  (a.completedAt?.getTime() ?? null) === (b.completedAt?.getTime() ?? null);

function auditReconcile(
  tx: SettlementTx,
  actor: ServicingRefundActor,
  before: OrderServiceRefund,
  after: Pick<OrderServiceRefund, "status" | "errorCode" | "refundId">,
  providerRefundId: string | null
) {
  return auditResolution(
    tx,
    actor,
    before,
    "ORDER_REFUND_RECONCILED",
    {
      status: after.status,
      errorCode: after.errorCode,
      refundId: after.refundId,
      providerRefundId,
    },
    `Reconciled servicing refund ${before.id} from the provider: ${before.status} to ${after.status}`
  );
}

/** Moves the request to review for a provider finding, if it is unchanged
 * since the provider was read. */
function reviewFinding(
  db: SettlementTx,
  hint: OrderServiceRefund,
  code: string,
  actor: ServicingRefundActor
) {
  return db.transaction(async tx => {
    const { item } = await lockServicingRequest(tx, hint.id, hint.bookingId);
    if (
      item.status !== hint.status ||
      item.attempt !== hint.attempt ||
      item.refundId !== hint.refundId
    )
      throw raced();
    await assertReconcileAllowed(tx, item);
    const after = {
      ...item,
      status: "review_required" as const,
      errorCode: code,
    };
    if (item.status !== "review_required" || item.errorCode !== code) {
      await tx
        .update(orderServiceRefunds)
        .set({ status: "review_required", errorCode: code })
        .where(eq(orderServiceRefunds.id, item.id));
      await auditReconcile(tx, actor, item, after, null);
    }
    return { ...resolutionView(after), outcome: "review_required" as const };
  });
}

class ReconcileNoChange extends Error {}

/** The worker's recording step for a provider refund that reconcile read,
 * under the booking lock. A recording that changes nothing is rolled back, so
 * it leaves no event; one that changes the request is audited in the same
 * transaction. Its refusals are a state the operator must look at, not a
 * server fault. */
async function recordReconciledRefund(
  db: SettlementTx,
  hint: OrderServiceRefund,
  refund: Stripe.Refund,
  actor: ServicingRefundActor
): Promise<OrderServiceRefund> {
  const read = (tx: SettlementTx) =>
    tx
      .select()
      .from(orderServiceRefunds)
      .where(eq(orderServiceRefunds.id, hint.id))
      .for("update")
      .then(([row]) => row);
  try {
    return await db.transaction(async tx => {
      await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.id, hint.bookingId))
        .for("update");
      const before = await read(tx);
      if (!before)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Servicing refund not found",
        });
      await assertReconcileAllowed(tx, before);
      await recordVerifiedOrderRefund(
        tx,
        refund,
        `order_refund_reconcile:${refund.id}`
      );
      const after = await read(tx);
      if (sameState(before, after)) throw new ReconcileNoChange();
      await auditReconcile(tx, actor, before, after, refund.id);
      return after;
    });
  } catch (error) {
    if (error instanceof ReconcileNoChange)
      return readServicingRequest(db, hint.id);
    if (
      error instanceof Error &&
      /does not match the saved request|balance changed outside/.test(
        error.message
      )
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: error.message,
        cause: error,
      });
    throw error;
  }
}

/** A provider refund that has not failed reopened a cancelled request
 * (`provider_refund_after_cancel`). Reconcile closes it once from the
 * provider: when the receipt already records the refund (a charge aggregate
 * settled it after the cancel), the request is closed with no second
 * settlement; when it does not yet, the refund settles once. */
async function reconcileAfterCancel(
  db: SettlementTx,
  hint: OrderServiceRefund,
  provider: ProviderRequestState,
  archivedIds: Set<string>,
  actor: ServicingRefundActor
) {
  const unchanged = {
    ...resolutionView(hint),
    outcome: "review_required" as const,
  };
  const live = provider.refunds.filter(refund => !providerFailed(refund));
  const [success] = live;
  if (
    provider.historyLimit ||
    live.length !== 1 ||
    success.status !== "succeeded" ||
    archivedIds.has(success.id) ||
    refundAttempt(success) !== hint.attempt ||
    (hint.refundId !== null && hint.refundId !== success.id)
  )
    return unchanged;
  const intent =
    typeof success.payment_intent === "string"
      ? success.payment_intent
      : success.payment_intent?.id;
  if (
    intent !== hint.paymentIntentId ||
    success.amount !== hint.amount ||
    success.currency.toUpperCase() !== "SAR"
  )
    throw refused("The provider refund does not match the saved request");
  return await db.transaction(async tx => {
    const { booking, item, receipt } = await lockServicingRequest(
      tx,
      hint.id,
      hint.bookingId
    );
    if (
      item.status !== hint.status ||
      item.errorCode !== hint.errorCode ||
      item.refundId !== hint.refundId ||
      item.attempt !== hint.attempt
    )
      throw raced();
    await assertReconcileAllowed(tx, item);
    if (receipt.refundedAmount === item.baseRefundedAmount + item.amount) {
      const after = {
        ...item,
        status: "succeeded" as const,
        errorCode: SUCCEEDED_AFTER_CANCEL,
        refundId: success.id,
      };
      await tx
        .update(orderServiceRefunds)
        .set({
          status: "succeeded",
          errorCode: SUCCEEDED_AFTER_CANCEL,
          refundId: success.id,
          completedAt: new Date(),
        })
        .where(eq(orderServiceRefunds.id, item.id));
      await recordEvent(tx, {
        aggregateType: "booking",
        aggregateId: booking.id,
        tenantId: booking.tenantId,
        eventType: "order.refund_updated",
        payload: refundEventPayload(item, "succeeded", success, {
          errorCode: SUCCEEDED_AFTER_CANCEL,
        }),
      });
      await auditReconcile(tx, actor, item, after, success.id);
      return { ...resolutionView(after), outcome: "settled" as const };
    }
    if (receipt.refundedAmount !== item.baseRefundedAmount) return unchanged;
    await recordVerifiedOrderRefund(
      tx,
      success,
      `order_refund_reconcile:${success.id}`
    );
    const [after] = await tx
      .select()
      .from(orderServiceRefunds)
      .where(eq(orderServiceRefunds.id, item.id));
    await auditReconcile(tx, actor, item, after, success.id);
    return { ...resolutionView(after), outcome: "settled" as const };
  });
}

/** Re-reads the provider for one request and never creates a refund. */
export async function reconcileServicingRefund(
  requestId: string,
  actor: ServicingRefundActor
) {
  const db = servicingDb();
  const hint = await readServicingRequest(db, requestId);
  if (hint.status !== "failed" && hint.status !== "review_required")
    return { ...resolutionView(hint), outcome: "unchanged" as const };
  await db.transaction(async tx => {
    await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, hint.bookingId))
      .for("update");
    await assertReconcileAllowed(tx, hint);
  });
  const archived = await archivedAttempts(db, hint.id);
  const archivedIds = new Set(archived.map(row => row.refundId));
  const provider = await readProviderRequest(hint, [...archivedIds]);
  if (hint.errorCode === REFUND_AFTER_CANCEL)
    return reconcileAfterCancel(db, hint, provider, archivedIds, actor);
  if (provider.historyLimit)
    return reviewFinding(db, hint, "provider_history_limit", actor);
  const current = provider.refunds.filter(
    refund =>
      !archivedIds.has(refund.id) && refundAttempt(refund) === hint.attempt
  );
  const earlier = provider.refunds.filter(refund => !current.includes(refund));
  const earlierSucceeded = earlier.filter(
    refund => refund.status === "succeeded"
  );
  if (
    current.length > 1 ||
    earlier.some(
      refund => !providerFailed(refund) && refund.status !== "succeeded"
    )
  )
    return reviewFinding(db, hint, "duplicate_provider_refund", actor);
  if (earlierSucceeded.length) {
    const [success] = earlierSucceeded;
    // The provider reports an earlier attempt's refund as succeeded. It
    // settles the request once, and only when no other refund of this
    // request exists and the live attempt was never requested.
    if (
      earlierSucceeded.length === 1 &&
      !current.some(refund => !providerFailed(refund)) &&
      !hint.completedAt &&
      !hint.refundId &&
      !hint.requestedAt &&
      provider.otherAmount === hint.baseRefundedAmount
    )
      return db.transaction(async tx => {
        const { booking, item, receipt } = await lockServicingRequest(
          tx,
          hint.id,
          hint.bookingId
        );
        if (
          item.status !== hint.status ||
          item.attempt !== hint.attempt ||
          item.refundId ||
          item.requestedAt ||
          item.completedAt
        )
          throw raced();
        await assertReconcileAllowed(tx, item);
        const intent =
          typeof success.payment_intent === "string"
            ? success.payment_intent
            : success.payment_intent?.id;
        if (
          intent !== item.paymentIntentId ||
          success.amount !== item.amount ||
          success.currency.toUpperCase() !== "SAR" ||
          !(refundAttempt(success) < item.attempt)
        )
          throw refused("The provider refund does not match the saved request");
        if (receipt.refundedAmount !== item.baseRefundedAmount)
          throw refused(
            "Refund balance changed outside this servicing request"
          );
        await applyVerifiedRefund(
          tx,
          booking,
          item,
          receipt,
          success,
          `order_refund_reconcile:${success.id}`,
          false
        );
        const after = {
          ...item,
          status: "succeeded" as const,
          errorCode: null,
          refundId: success.id,
        };
        await auditReconcile(tx, actor, item, after, success.id);
        return { ...resolutionView(after), outcome: "settled" as const };
      });
    const after = await recordReconciledRefund(db, hint, success, actor);
    return { ...resolutionView(after), outcome: "review_required" as const };
  }
  if (provider.otherAmount !== hint.baseRefundedAmount)
    return reviewFinding(db, hint, "provider_refund_balance_conflict", actor);
  const [refund] = current;
  if (!refund)
    return { ...resolutionView(hint), outcome: "no_provider_refund" as const };
  const after = await recordReconciledRefund(db, hint, refund, actor);
  const outcome: ReconcileOutcome =
    after.status === "succeeded"
      ? "settled"
      : after.status === "pending"
        ? "pending"
        : after.status === "failed"
          ? "provider_failed"
          : "review_required";
  return { ...resolutionView(after), outcome };
}

const retryable = (item: OrderServiceRefund) =>
  item.status === "failed" &&
  item.errorCode === PROVIDER_REFUND_FAILED &&
  Boolean(item.refundId);

/** Queues the next attempt of a request whose provider refund definitively
 * failed. The worker then sends it under `order-refund:<id>:a<n>`. */
export async function retryServicingRefund(
  input: { requestId: string; attempt: number },
  actor: ServicingRefundActor
) {
  const db = servicingDb();
  const hint = await readServicingRequest(db, input.requestId);
  // A repeated request for the attempt already retried changes nothing.
  if (hint.attempt === input.attempt + 1)
    return { ...resolutionView(hint), replayed: true };
  if (hint.attempt !== input.attempt) throw staleAttempt();
  const notRetryable = () =>
    refused(
      "Only a servicing refund the provider definitively refused can be retried; reconcile or cancel it instead"
    );
  if (!retryable(hint)) throw notRetryable();
  const archived = await archivedAttempts(db, hint.id);
  const provider = await readProviderRequest(
    hint,
    archived.map(row => row.refundId)
  );
  if (provider.historyLimit)
    throw refused(
      "The provider's refund history for this collection is too long to verify"
    );
  if (provider.refunds.some(refund => !providerFailed(refund)))
    throw refused(
      "The provider holds a refund for this request that has not failed; reconcile it instead"
    );
  const failed = provider.refunds.find(refund => refund.id === hint.refundId);
  if (!failed) throw refused("The provider has no record of the failed refund");
  if (provider.otherAmount !== hint.baseRefundedAmount)
    throw refused(
      "The provider's other refunds of this collection differ from the saved balance"
    );
  return db.transaction(async tx => {
    const { item, receipt } = await lockServicingRequest(
      tx,
      hint.id,
      hint.bookingId
    );
    if (item.attempt === input.attempt + 1)
      return { ...resolutionView(item), replayed: true };
    if (item.attempt !== input.attempt) throw staleAttempt();
    if (!retryable(item)) throw notRetryable();
    if (item.refundId !== hint.refundId) throw raced();
    await assertNoDisputeOnCollection(tx, item);
    if (
      receipt.refundedAmount !== item.baseRefundedAmount ||
      receipt.amount - receipt.refundedAmount < item.amount
    )
      throw refused(
        "The collection no longer holds this refund's amount at its saved balance"
      );
    await tx.insert(orderServiceRefundAttempts).values({
      requestId: item.id,
      attempt: item.attempt,
      refundId: failed.id,
      status: failed.status === "canceled" ? "canceled" : "failed",
      errorCode: item.errorCode,
    });
    const attempt = item.attempt + 1;
    const [moved] = await tx
      .update(orderServiceRefunds)
      .set({
        attempt,
        status: "queued",
        refundId: null,
        requestedAt: null,
        errorCode: null,
        completedAt: null,
        nextAttemptAt: new Date(Math.floor(Date.now() / 1000) * 1000),
      })
      .where(
        and(
          eq(orderServiceRefunds.id, item.id),
          eq(orderServiceRefunds.attempt, item.attempt),
          eq(orderServiceRefunds.status, "failed")
        )
      );
    if (moved.affectedRows !== 1) throw raced();
    await auditResolution(
      tx,
      actor,
      item,
      "ORDER_REFUND_RETRY_REQUESTED",
      { status: "queued", attempt },
      `Queued attempt ${attempt} of servicing refund ${item.id} after provider refund ${failed.id} failed`
    );
    return {
      ...resolutionView({
        ...item,
        attempt,
        status: "queued",
        refundId: null,
        errorCode: null,
      }),
      replayed: false,
    };
  });
}

const cancellable = (item: OrderServiceRefund) =>
  (item.status === "failed" || item.status === "review_required") &&
  item.errorCode !== CHARGEBACK_PARTIAL_COVER;

/** Closes a servicing refund liability with a recorded reason. */
export async function cancelServicingRefund(
  input: { requestId: string; attempt: number; reason: string },
  actor: ServicingRefundActor
) {
  const db = servicingDb();
  const hint = await readServicingRequest(db, input.requestId);
  const replay = (item: OrderServiceRefund) => ({
    ...resolutionView(item),
    settlementReview: false,
    replayed: true,
  });
  if (hint.status === "cancelled") return replay(hint);
  if (hint.attempt !== input.attempt) throw staleAttempt();
  const notCancellable = (item: OrderServiceRefund) =>
    refused(
      item.errorCode === CHARGEBACK_PARTIAL_COVER
        ? "A servicing refund partly covered by a lost dispute stays with the dispute flow"
        : "Only a failed or review_required servicing refund can be cancelled"
    );
  if (!cancellable(hint)) throw notCancellable(hint);
  const archived = await archivedAttempts(db, hint.id);
  const provider = await readProviderRequest(
    hint,
    archived.map(row => row.refundId)
  );
  if (provider.historyLimit)
    throw refused(
      "The provider's refund history for this collection is too long to verify"
    );
  if (provider.refunds.some(refund => !providerFailed(refund)))
    throw refused(
      "The provider holds a refund for this request that has not failed; reconcile it instead"
    );
  return db.transaction(async tx => {
    const { booking, item } = await lockServicingRequest(
      tx,
      hint.id,
      hint.bookingId
    );
    if (item.status === "cancelled") return replay(item);
    if (item.attempt !== input.attempt) throw staleAttempt();
    if (!cancellable(item)) throw notCancellable(item);
    if (
      item.status !== hint.status ||
      item.errorCode !== hint.errorCode ||
      item.refundId !== hint.refundId
    )
      throw raced();
    await assertNoDisputeOnCollection(tx, item);
    if (item.cancellationFlightId !== null) {
      const [job] = await tx
        .select()
        .from(flightCancellationJobs)
        .where(
          and(
            eq(flightCancellationJobs.flightId, item.cancellationFlightId),
            eq(flightCancellationJobs.bookingId, item.bookingId)
          )
        )
        .for("update");
      if (job?.status === "planned")
        throw refused(
          "The flight cancellation job still counts this refund as planned; cancel it once the job has moved to review"
        );
    }
    const resolvedAt = new Date();
    await tx
      .update(orderServiceRefunds)
      .set({
        status: "cancelled",
        resolvedBy: actor.id,
        resolvedAt,
        resolutionReason: input.reason,
      })
      .where(eq(orderServiceRefunds.id, item.id));
    await auditResolution(
      tx,
      actor,
      item,
      "ORDER_REFUND_CANCELLED",
      { status: "cancelled", reason: input.reason },
      `Cancelled servicing refund ${item.id}: ${input.reason}`
    );
    // Its upgrade money then goes to settlement review, where it stays in
    // view and can be refunded in-app.
    const settlementReview = await reviewCancelledServicingUpgrade(
      tx,
      booking,
      item.paymentIntentId
    );
    return {
      ...resolutionView({ ...item, status: "cancelled" }),
      settlementReview,
      replayed: false,
    };
  });
}
