/**
 * Provider dispute (chargeback) evidence.
 *
 * A dispute is money the cardholder's bank takes back outside our refund flow.
 * Stripe reports it through `charge.dispute.*` webhooks. This module records
 * that evidence against the persisted payment receipt: a ledger row for every
 * verified dispute event (with the signed amount only when funds actually move),
 * a payment history entry for the booking, and an outbox event for operators.
 *
 * It deliberately never cancels a booking, releases inventory, or changes the
 * payment status. A chargeback outcome is an operator decision that needs the
 * dispute evidence first; this module only makes that evidence durable.
 */
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import {
  bookings,
  financialLedger,
  paymentHistory,
  paymentReceipts,
  payments,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";

export const DISPUTE_EVENT_TYPES = [
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "charge.dispute.closed",
] as const;
export type DisputeEventType = (typeof DISPUTE_EVENT_TYPES)[number];

export interface VerifiedDispute {
  eventId: string;
  eventType: DisputeEventType;
  disputeId: string;
  chargeId: string;
  paymentIntentId: string;
  /** Disputed amount in minor units, always positive as reported by the provider. */
  amount: number;
  currency: string;
  status: string;
  reason: string;
}

/** Only a signature-verified event may be converted; the caller owns that check. */
export function disputeFromStripe(
  eventType: DisputeEventType,
  dispute: Stripe.Dispute,
  eventId: string
): VerifiedDispute {
  const paymentIntentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!paymentIntentId)
    throw new Error("Dispute is missing its payment intent");
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) throw new Error("Dispute is missing its charge");
  return {
    eventId,
    eventType,
    disputeId: dispute.id,
    chargeId,
    paymentIntentId,
    amount: dispute.amount,
    currency: dispute.currency,
    status: dispute.status,
    reason: dispute.reason,
  };
}

/** Funds move only on the two funds events; every other event is lifecycle evidence. */
export function signedDisputeAmount(dispute: VerifiedDispute): number {
  if (dispute.eventType === "charge.dispute.funds_withdrawn")
    return -dispute.amount;
  if (dispute.eventType === "charge.dispute.funds_reinstated")
    return dispute.amount;
  return 0;
}

function historyEvent(dispute: VerifiedDispute): "chargeback" | "disputed" {
  if (dispute.eventType === "charge.dispute.funds_withdrawn")
    return "chargeback";
  if (
    dispute.eventType === "charge.dispute.closed" &&
    dispute.status === "lost"
  )
    return "chargeback";
  return "disputed";
}

/**
 * Record one verified dispute event inside the webhook's database transaction.
 * Idempotent per provider event id; a replay writes nothing.
 */
export async function recordVerifiedDispute(
  tx: SettlementTx,
  dispute: VerifiedDispute
): Promise<void> {
  if (!Number.isSafeInteger(dispute.amount) || dispute.amount <= 0)
    throw new Error("Invalid dispute amount");
  const [seen] = await tx
    .select({ id: financialLedger.id })
    .from(financialLedger)
    .where(eq(financialLedger.stripeEventId, dispute.eventId))
    .limit(1);
  if (seen) return;

  // Same lock order as refunds: owner first, then the receipt with a locking read.
  const [hint] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, dispute.paymentIntentId))
    .limit(1);
  if (!hint)
    throw new Error(
      "Dispute references an unknown payment; retry after payment receipt"
    );
  let ownerBooking;
  if (hint.bookingId) {
    [ownerBooking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, hint.bookingId))
      .limit(1)
      .for("update");
    if (!ownerBooking || ownerBooking.userId !== hint.userId)
      throw new Error("Dispute booking missing");
  }
  const [receipt] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, dispute.paymentIntentId))
    .limit(1)
    .for("update");
  if (!receipt)
    throw new Error(
      "Dispute references an unknown payment; retry after payment receipt"
    );
  if (
    dispute.currency.toUpperCase() !== receipt.currency.toUpperCase() ||
    dispute.amount > receipt.amount
  )
    throw new Error(
      "Disputed amount/currency does not match the persisted purchase"
    );

  const signed = signedDisputeAmount(dispute);
  const evidence = {
    disputeId: dispute.disputeId,
    eventType: dispute.eventType,
    status: dispute.status,
    reason: dispute.reason,
  };
  await tx.insert(financialLedger).values({
    bookingId: receipt.bookingId,
    userId: receipt.userId,
    type: "adjustment",
    amount: (signed / 100).toFixed(2),
    currency: receipt.currency,
    stripeEventId: dispute.eventId,
    stripePaymentIntentId: dispute.paymentIntentId,
    stripeChargeId: dispute.chargeId,
    description: `Provider dispute ${dispute.eventType.slice("charge.dispute.".length)}`,
    metadata: JSON.stringify(evidence),
  });

  if (receipt.bookingId) {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.stripePaymentIntentId, dispute.paymentIntentId))
      .limit(1);
    if (payment)
      await tx.insert(paymentHistory).values({
        paymentId: payment.id,
        bookingId: receipt.bookingId,
        event: historyEvent(dispute),
        fromStatus: payment.status,
        toStatus: payment.status,
        amount: dispute.amount,
        currency: receipt.currency,
        providerReference: dispute.disputeId,
        metadata: JSON.stringify(evidence),
        initiatedBy: "webhook",
      });
  }

  await recordEvent(tx, {
    aggregateType: "payment",
    aggregateId: dispute.paymentIntentId,
    eventType: "payment.disputed",
    tenantId: ownerBooking?.tenantId,
    payload: {
      userId: receipt.userId,
      bookingId: receipt.bookingId,
      amount: signed,
      ...evidence,
    },
  });
}
