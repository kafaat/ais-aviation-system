/**
 * Provider dispute (chargeback) evidence.
 *
 * A dispute is money the cardholder's bank takes back outside our refund flow.
 * Stripe reports it through `charge.dispute.*` webhooks. This module records
 * that evidence against the persisted payment receipt: a ledger row for every
 * verified dispute event (with the signed amount only when funds actually move),
 * a payment history entry for the booking, and an outbox event for operators.
 *
 * It never cancels a booking, releases inventory, or changes the booking or
 * payment status. A chargeback outcome is an operator decision that needs the
 * dispute evidence first. The booking's issued travel documents follow the
 * funds (S-08, owner decision 6, option B):
 * - funds withdrawn: its open (O) and checked-in (C) coupons are suspended (S);
 *   the prior status is kept on the coupon;
 * - closed lost: the coupons become void (V);
 * - closed won or funds reinstated: suspended coupons return to their prior
 *   status, once no other dispute on the booking still holds withdrawn funds.
 * Refunds are refused while any dispute holds the booking's funds, so the
 * customer is never repaid twice. Each dispute's outcome is derived from the
 * set of its recorded events, so reordered and replayed deliveries converge.
 *
 * Wallet top-ups are different: verified withdrawn funds must immediately stop
 * being available for new spending, even after prior spend has left the wallet
 * in debt. Already purchased travel remains untouched.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";
import {
  bookings,
  financialLedger,
  paymentHistory,
  paymentReceipts,
  payments,
  users,
  wallets,
  walletTransactions,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";
import { reconcileWalletFunding } from "./wallet-funding.service";
import {
  restoreSuspendedCoupons,
  suspendBookingCoupons,
  voidDisputedCoupons,
  type CouponTransition,
} from "./ticket-coupons.service";

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

const disputeEvidence = z.object({
  disputeId: z.string().min(1),
  eventType: z.enum(DISPUTE_EVENT_TYPES),
  status: z.string(),
});
type DisputeState = {
  withdrawn: boolean;
  reinstated: boolean;
  won: boolean;
  lost: boolean;
};

/** Current read of the booking's dispute evidence. The caller holds the
 * booking lock, which every dispute writer takes first. Rows are grouped by
 * dispute; each outcome is the set of its events, independent of order. */
async function bookingDisputes(tx: SettlementTx, bookingId: number) {
  const rows = await tx
    .select({
      description: financialLedger.description,
      metadata: financialLedger.metadata,
    })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.bookingId, bookingId),
        eq(financialLedger.type, "adjustment"),
        isNotNull(financialLedger.stripeEventId)
      )
    )
    .orderBy(financialLedger.id)
    .for("share");
  const disputes = new Map<string, DisputeState>();
  for (const row of rows) {
    if (!row.description?.startsWith("Provider dispute ")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.metadata ?? "");
    } catch {
      parsed = undefined;
    }
    const evidence = disputeEvidence.safeParse(parsed);
    if (!evidence.success)
      throw new Error("Booking dispute evidence requires reconciliation");
    const { disputeId, eventType, status } = evidence.data;
    const state = disputes.get(disputeId) ?? {
      withdrawn: false,
      reinstated: false,
      won: false,
      lost: false,
    };
    if (eventType === "charge.dispute.funds_withdrawn") state.withdrawn = true;
    if (eventType === "charge.dispute.funds_reinstated")
      state.reinstated = true;
    if (eventType === "charge.dispute.closed" && status === "won")
      state.won = true;
    if (eventType === "charge.dispute.closed" && status === "lost")
      state.lost = true;
    disputes.set(disputeId, state);
  }
  return disputes;
}

/** A lost dispute keeps the funds withdrawn for good. */
const holdsFunds = (state: DisputeState) =>
  (state.withdrawn || state.lost) && !state.reinstated && !state.won;

function couponOutcome(state: DisputeState) {
  if (state.reinstated || state.won) return "restore" as const;
  if (state.lost) return "void" as const;
  if (state.withdrawn) return "suspend" as const;
  return null;
}

export type BookingDisputeHold = {
  outcome: "suspended" | "void";
  disputeIds: string[];
};

/** The state a dispute imposes on the booking's open coupons, or null. A lost
 * dispute has voided them; an unresolved withdrawal has suspended them. */
export async function bookingDisputeHold(
  tx: SettlementTx,
  bookingId: number
): Promise<BookingDisputeHold | null> {
  const disputes = [...(await bookingDisputes(tx, bookingId))];
  const lost = disputes.filter(([, s]) => couponOutcome(s) === "void");
  if (lost.length)
    return { outcome: "void", disputeIds: lost.map(([id]) => id) };
  const held = disputes.filter(([, s]) => couponOutcome(s) === "suspend");
  return held.length
    ? { outcome: "suspended", disputeIds: held.map(([id]) => id) }
    : null;
}

/** Ordinary, split and admin refund commands call this under the booking lock
 * before any money can move. */
export async function assertNoWithdrawnDispute(
  tx: SettlementTx,
  bookingId: number
) {
  const open = [...(await bookingDisputes(tx, bookingId))]
    .filter(([, state]) => holdsFunds(state))
    .map(([id]) => id);
  if (open.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Payment dispute ${open.join(", ")} has withdrawn this booking's funds; no refund can be issued until the dispute is resolved`,
    });
}

const couponEvents = new Set<DisputeEventType>([
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "charge.dispute.closed",
]);

/** Called after this event's ledger row is written, under the booking lock. */
async function applyDisputeToCoupons(
  tx: SettlementTx,
  bookingId: number,
  disputeId: string
): Promise<CouponTransition[]> {
  const disputes = await bookingDisputes(tx, bookingId);
  const state = disputes.get(disputeId);
  const outcome = state ? couponOutcome(state) : null;
  if (outcome === "suspend") return suspendBookingCoupons(tx, bookingId);
  if (outcome === "void") return voidDisputedCoupons(tx, bookingId);
  if (outcome !== "restore") return [];
  // Split payments: another payer's dispute may still hold its funds.
  for (const [id, other] of disputes)
    if (id !== disputeId && holdsFunds(other)) return [];
  return restoreSuspendedCoupons(tx, bookingId);
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
  let ownerWallet;
  let ownerTenantId: number | null;
  if (hint.bookingId) {
    [ownerBooking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, hint.bookingId))
      .limit(1)
      .for("update");
    if (!ownerBooking || ownerBooking.userId !== hint.userId)
      throw new Error("Dispute booking missing");
    ownerTenantId = ownerBooking.tenantId;
  } else if (hint.kind === "wallet_topup") {
    // A wallet has no booking. Resolve its scope from the persisted account,
    // never from webhook metadata. Null is an explicit public account scope;
    // a missing account must not silently become a public event.
    const [owner] = await tx
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(eq(users.id, hint.userId))
      .limit(1)
      .for("update");
    if (!owner) throw new Error("Dispute wallet account missing");
    ownerTenantId = owner.tenantId;
    const [request] = await tx
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.id, hint.targetId))
      .limit(1)
      .for("update");
    if (!request || request.type !== "top_up" || request.userId !== hint.userId)
      throw new Error("Dispute wallet top-up owner missing");
    [ownerWallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, request.walletId))
      .limit(1)
      .for("update");
    if (!ownerWallet || ownerWallet.userId !== hint.userId)
      throw new Error("Dispute wallet missing");
  } else {
    throw new Error("Dispute purchase owner missing");
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
    receipt.userId !== hint.userId ||
    receipt.bookingId !== hint.bookingId ||
    receipt.kind !== hint.kind ||
    receipt.targetId !== hint.targetId
  )
    throw new Error("Dispute purchase owner changed");
  if (
    dispute.currency.toUpperCase() !== receipt.currency.toUpperCase() ||
    dispute.amount > receipt.amount
  )
    throw new Error(
      "Disputed amount/currency does not match the persisted purchase"
    );

  // The owner locks serialize distinct events and retries. A current read after
  // those locks prevents a repeatable-read snapshot from missing a just-committed
  // event. Legacy wallet events may have evidence but no wallet debit; reconcile
  // their projection while leaving their provider event/history/outbox idempotent.
  const [seen] = await tx
    .select({ id: financialLedger.id })
    .from(financialLedger)
    .where(eq(financialLedger.stripeEventId, dispute.eventId))
    .limit(1)
    .for("update");
  if (seen) {
    if (ownerWallet)
      await reconcileWalletFunding(tx, {
        receipt,
        wallet: ownerWallet,
        eventId: dispute.eventId,
      });
    return;
  }

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

  if (ownerWallet)
    await reconcileWalletFunding(tx, {
      receipt,
      wallet: ownerWallet,
      eventId: dispute.eventId,
    });

  const couponTransitions =
    receipt.bookingId && couponEvents.has(dispute.eventType)
      ? await applyDisputeToCoupons(tx, receipt.bookingId, dispute.disputeId)
      : [];

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
    tenantId: ownerTenantId,
    payload: {
      userId: receipt.userId,
      bookingId: receipt.bookingId,
      amount: signed,
      ...evidence,
      ...(couponTransitions.length
        ? { localCouponTransitions: couponTransitions }
        : {}),
    },
  });
}
