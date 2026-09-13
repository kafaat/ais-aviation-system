import { randomUUID } from "node:crypto";
import { createServiceLogger } from "../_core/logger";
const log = createServiceLogger("order-refunds");
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "../db";
import { stripe } from "../stripe";
import {
  bookings,
  orderServiceRefunds,
  paymentReceipts,
  bookingRefundPlans,
  type Booking,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { allocateSplitRefund } from "./split-refund.service";
import { settleVerifiedRefund } from "./payment-settlement.service";
import { recordEvent } from "./outbox.service";

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
        inArray(orderServiceRefunds.status, [
          "queued",
          "requesting",
          "pending",
          "failed",
          "review_required",
        ])
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
  if (
    !booking ||
    !item ||
    item.paymentIntentId !== intent ||
    item.amount !== refund.amount ||
    refund.currency.toUpperCase() !== "SAR" ||
    (item.refundId && item.refundId !== refund.id)
  )
    throw new Error("Verified refund does not match the saved request");
  if (item.status === "succeeded") return true;
  const [receipt] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, item.paymentIntentId))
    .for("update");
  if (!receipt || receipt.refundedAmount !== item.baseRefundedAmount)
    throw new Error("Refund balance changed outside this servicing request");
  const status =
    refund.status === "succeeded"
      ? "succeeded"
      : refund.status === "failed" || refund.status === "canceled"
        ? "failed"
        : "pending";
  await tx
    .update(orderServiceRefunds)
    .set({
      status,
      refundId: refund.id,
      nextAttemptAt: new Date(Date.now() + 60000),
      completedAt: status === "succeeded" ? new Date() : null,
      errorCode: status === "failed" ? "provider_refund_failed" : null,
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
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "order.refund_updated",
    payload: {
      requestId: item.id,
      modificationId: item.modificationId,
      status,
      refundId: refund.id,
    },
  });
  return true;
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
    const requestedAt = r.requestedAt ?? new Date();
    await tx
      .update(orderServiceRefunds)
      .set({
        status: "requesting",
        requestedAt,
        nextAttemptAt: new Date(Date.now() + 60000),
      })
      .where(eq(orderServiceRefunds.id, id));
    return { ...r, requestedAt };
  });
  if (!item) return;
  try {
    let refund: Stripe.Refund | undefined;
    if (item.refundId) refund = await stripe.refunds.retrieve(item.refundId);
    else {
      let scanned = 0;
      let otherAmount = 0;
      for await (const found of stripe.refunds.list({
        payment_intent: item.paymentIntentId,
        limit: 100,
      })) {
        if (++scanned > 1000) throw new Error("provider_history_limit");
        if (found.metadata?.orderServiceRefundId === item.id) {
          if (refund) throw new Error("duplicate_provider_refund");
          refund = found;
        } else if (found.status !== "failed" && found.status !== "canceled")
          otherAmount += found.amount;
      }
      if (otherAmount !== item.baseRefundedAmount)
        throw new Error("provider_refund_balance_conflict");
      if (!refund) {
        if (Date.now() - item.requestedAt.getTime() >= 23 * 3600000)
          throw new Error("unknown_provider_outcome");
        refund = await stripe.refunds.create(
          {
            payment_intent: item.paymentIntentId,
            amount: item.amount,
            metadata: {
              orderServiceRefundId: item.id,
              ...(item.modificationId !== null
                ? { modificationId: String(item.modificationId) }
                : { cancellationFlightId: String(item.cancellationFlightId) }),
            },
          },
          { idempotencyKey: `order-refund:${item.id}` }
        );
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
    if (
      [
        "provider_history_limit",
        "duplicate_provider_refund",
        "provider_refund_balance_conflict",
        "unknown_provider_outcome",
      ].includes(code)
    )
      await db
        .update(orderServiceRefunds)
        .set({ status: "review_required", errorCode: code })
        .where(eq(orderServiceRefunds.id, id));
    else
      await db
        .update(orderServiceRefunds)
        .set({ errorCode: "transport_or_reconciliation_error" })
        .where(eq(orderServiceRefunds.id, id));
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
