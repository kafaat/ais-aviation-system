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
 * Only a dispute on a collection that funded the travel (an applied receipt,
 * or the booking's own recorded payment) affects coupons. A dispute on a
 * duplicate collection held for review blocks only the refund of that
 * duplicate. Every refund of the booking is refused, and every saved refund
 * command held, while a funding dispute has withdrawn the funds, so the
 * customer is never repaid twice. A lost dispute means the bank has already
 * returned its amount: saved refunds of that same collection that never
 * reached the provider are settled by the chargeback up to that amount, and
 * only the remainder is sent; new refunds of that collection stay refused.
 * Refunds of the booking's other collections proceed once no dispute still has
 * funds withdrawn. Each dispute's outcome is derived from the set of its
 * recorded events, so reordered and replayed deliveries converge.
 *
 * Wallet top-ups are different: verified withdrawn funds must immediately stop
 * being available for new spending, even after prior spend has left the wallet
 * in debt. Already purchased travel remains untouched.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";
import {
  bookingRefundItems,
  bookings,
  financialLedger,
  orderServiceRefunds,
  ordinaryBookingRefundParts,
  ordinaryBookingRefunds,
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
  paymentIntentId: string;
  /** The amount its funds_withdrawn adjustment moved, or null before it. */
  amount: number | null;
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
      paymentIntentId: financialLedger.stripePaymentIntentId,
      ledgerAmount: financialLedger.amount,
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
    if (!evidence.success || !row.paymentIntentId)
      throw new Error("Booking dispute evidence requires reconciliation");
    const { disputeId, eventType, status } = evidence.data;
    const state = disputes.get(disputeId) ?? {
      paymentIntentId: row.paymentIntentId,
      amount: null,
      withdrawn: false,
      reinstated: false,
      won: false,
      lost: false,
    };
    if (state.paymentIntentId !== row.paymentIntentId)
      throw new Error("Booking dispute evidence requires reconciliation");
    if (eventType === "charge.dispute.funds_withdrawn") {
      state.withdrawn = true;
      const moved = Math.round(Math.abs(Number(row.ledgerAmount)) * 100);
      if (!Number.isSafeInteger(moved) || moved <= 0)
        throw new Error("Booking dispute evidence requires reconciliation");
      state.amount = moved;
    }
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

/** The collections that funded the booking's travel: its applied receipts, and
 * its own recorded payment even while a refund review holds that receipt. A
 * duplicate or conflicting collection held for review never funded travel.
 * Current reads under the booking lock, like the dispute evidence. */
async function fundingCollections(tx: SettlementTx, bookingId: number) {
  const [booking] = await tx
    .select({ paymentIntentId: bookings.stripePaymentIntentId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("share");
  const receipts = await tx
    .select({
      paymentIntentId: paymentReceipts.paymentIntentId,
      kind: paymentReceipts.kind,
      settlementStatus: paymentReceipts.settlementStatus,
    })
    .from(paymentReceipts)
    .where(eq(paymentReceipts.bookingId, bookingId))
    .orderBy(paymentReceipts.paymentIntentId)
    .for("share");
  return new Set(
    receipts
      .filter(
        r =>
          r.kind !== "wallet_topup" &&
          (r.settlementStatus === "applied" ||
            r.paymentIntentId === booking?.paymentIntentId)
      )
      .map(r => r.paymentIntentId)
  );
}

/** Disputes on the collections that funded the booking's travel. */
async function fundingDisputes(tx: SettlementTx, bookingId: number) {
  const disputes = await bookingDisputes(tx, bookingId);
  if (!disputes.size) return disputes;
  const funding = await fundingCollections(tx, bookingId);
  return new Map(
    [...disputes].filter(([, state]) => funding.has(state.paymentIntentId))
  );
}

/** A lost dispute keeps the funds withdrawn for good. */
const holdsFunds = (state: DisputeState) =>
  (state.withdrawn || state.lost) && !state.reinstated && !state.won;
/** The bank has returned this dispute's amount to the cardholder. */
const lostFunds = (state: DisputeState) =>
  state.lost && !state.reinstated && !state.won;

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

/** The state a funding dispute imposes on the booking's open coupons, or null.
 * A lost dispute has voided them; an unresolved withdrawal has suspended them. */
export async function bookingDisputeHold(
  tx: SettlementTx,
  bookingId: number
): Promise<BookingDisputeHold | null> {
  const disputes = [...(await fundingDisputes(tx, bookingId))];
  const lost = disputes.filter(([, s]) => couponOutcome(s) === "void");
  if (lost.length)
    return { outcome: "void", disputeIds: lost.map(([id]) => id) };
  const held = disputes.filter(([, s]) => couponOutcome(s) === "suspend");
  return held.length
    ? { outcome: "suspended", disputeIds: held.map(([id]) => id) }
    : null;
}

/** Disputes that forbid refunding any of these payment intents now. A dispute
 * whose funds are withdrawn and unresolved holds every refund of the booking
 * when it is on a funding collection, and the refunds of its own collection
 * otherwise (a duplicate collection's own dispute). A lost dispute holds only
 * new refunds of its own collection: the bank has already returned that money,
 * and the booking's other collections may be refunded. The caller holds the
 * booking lock. */
async function refundHolds(
  tx: SettlementTx,
  bookingId: number,
  paymentIntentIds: readonly string[]
) {
  const disputes = await bookingDisputes(tx, bookingId);
  const held = [...disputes].filter(([, state]) => holdsFunds(state));
  if (!held.length) return { withdrawn: [], lost: [] };
  const funding = await fundingCollections(tx, bookingId);
  const own = (state: DisputeState) =>
    paymentIntentIds.includes(state.paymentIntentId);
  return {
    withdrawn: held
      .filter(
        ([, state]) =>
          !lostFunds(state) &&
          (funding.has(state.paymentIntentId) || own(state))
      )
      .map(([id]) => id),
    lost: held
      .filter(([, state]) => lostFunds(state) && own(state))
      .map(([id]) => id),
  };
}

export async function withdrawnDisputeIds(
  tx: SettlementTx,
  bookingId: number,
  paymentIntentIds: readonly string[] = []
) {
  const { withdrawn, lost } = await refundHolds(
    tx,
    bookingId,
    paymentIntentIds
  );
  return [...withdrawn, ...lost];
}

export type SavedRefundDisputeGate =
  | { state: "clear" }
  | { state: "held"; disputeIds: string[] }
  | { state: "lost"; disputeIds: string[] };

/** What a saved refund command of one collection may do now. "held": wait,
 * queued and retryable, while a dispute has withdrawn the funds. "lost": the
 * bank has returned a lost dispute's amount on this collection, so the part
 * of the command that never reached the provider is settled by the chargeback
 * (see lostDisputeCover). The caller holds the booking lock. */
export async function savedRefundDisputeGate(
  tx: SettlementTx,
  bookingId: number,
  paymentIntentId: string
): Promise<SavedRefundDisputeGate> {
  const { withdrawn, lost } = await refundHolds(tx, bookingId, [
    paymentIntentId,
  ]);
  if (withdrawn.length) return { state: "held", disputeIds: withdrawn };
  if (lost.length) return { state: "lost", disputeIds: lost };
  return { state: "clear" };
}

/** Saved refund commands that a lost dispute settles are closed with this
 * code and no provider refund; a part the chargeback does not cover is sent
 * to the provider. No ledger row is written for the settled part: the
 * chargeback is already recorded as the dispute's funds_withdrawn adjustment. */
export const CHARGEBACK_SETTLED = "settled_by_chargeback";
/** A split payer share or order refund only partly covered by the lost
 * amount goes to review. */
export const CHARGEBACK_PARTIAL_COVER = "chargeback_partial_cover";

type CoverSource = "ordinary" | "split" | "order" | "part";
const unsent = (row: {
  status: string;
  refundId: string | null;
  requestedAt: Date | null;
}) =>
  ["queued", "requesting", "pending"].includes(row.status) &&
  !row.refundId &&
  !row.requestedAt;

/** The part of one saved, never-sent refund command that the lost disputes on
 * its collection have already returned through the bank. The lost amount is
 * allocated across that collection's saved commands in creation order;
 * commands already settled by the chargeback, or sent to review for it, keep
 * their place, so every caller computes the same allocation. The lost amount
 * is the one its funds_withdrawn adjustment moved; null when a lost close
 * arrived before that withdrawal, and the command keeps waiting for it. The
 * caller holds the booking lock. */
export async function lostDisputeCover(
  tx: SettlementTx,
  bookingId: number,
  paymentIntentId: string,
  refund: { source: CoverSource; id: string }
): Promise<number | null> {
  const lost = [...(await bookingDisputes(tx, bookingId)).values()].filter(
    state => state.paymentIntentId === paymentIntentId && lostFunds(state)
  );
  if (lost.some(state => state.amount === null)) return null;
  let remaining = lost.reduce((sum, state) => sum + (state.amount ?? 0), 0);
  const allocated = (row: { status: string; errorCode: string | null }) =>
    (row.status === "succeeded" && row.errorCode === CHARGEBACK_SETTLED) ||
    (row.status === "review_required" &&
      row.errorCode === CHARGEBACK_PARTIAL_COVER);
  const ordinary = await tx
    .select()
    .from(ordinaryBookingRefunds)
    .where(eq(ordinaryBookingRefunds.paymentIntentId, paymentIntentId))
    .for("update");
  const split = await tx
    .select()
    .from(bookingRefundItems)
    .where(eq(bookingRefundItems.paymentIntentId, paymentIntentId))
    .for("update");
  const order = await tx
    .select()
    .from(orderServiceRefunds)
    .where(eq(orderServiceRefunds.paymentIntentId, paymentIntentId))
    .for("update");
  // Decision 7: a cancellation drawn on several intents refunds through its
  // parts; its own row is not a provider command of this collection.
  const parts = await tx
    .select()
    .from(ordinaryBookingRefundParts)
    .where(eq(ordinaryBookingRefundParts.paymentIntentId, paymentIntentId))
    .for("update");
  const partitioned = ordinary.length
    ? await tx
        .select({ bookingId: ordinaryBookingRefundParts.bookingId })
        .from(ordinaryBookingRefundParts)
        .where(
          inArray(
            ordinaryBookingRefundParts.bookingId,
            ordinary.map(row => row.bookingId)
          )
        )
    : [];
  // An ordinary command is the only refund owner of its collection (order
  // refunds and split plans refuse it), so its settled amount is not needed.
  const commands = [
    ...ordinary
      .filter(
        row =>
          unsent(row) && !partitioned.some(p => p.bookingId === row.bookingId)
      )
      .map(row => ({
        source: "ordinary" as const,
        id: String(row.bookingId),
        amount: row.amount,
        createdAt: row.createdAt,
      })),
    ...split
      .filter(row => unsent(row) || allocated(row))
      .map(row => ({
        source: "split" as const,
        id: row.id,
        amount: row.refundAmount,
        createdAt: row.createdAt,
      })),
    ...order
      .filter(row => unsent(row) || allocated(row))
      .map(row => ({
        source: "order" as const,
        id: row.id,
        amount: row.amount,
        createdAt: row.createdAt,
      })),
    ...parts
      .filter(row => unsent(row) || allocated(row))
      .map(row => ({
        source: "part" as const,
        id: row.id,
        amount: row.amount,
        createdAt: row.createdAt,
      })),
  ].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.source.localeCompare(b.source) ||
      a.id.localeCompare(b.id)
  );
  for (const command of commands) {
    const cover = Math.min(command.amount, remaining);
    if (command.source === refund.source && command.id === refund.id)
      return cover;
    remaining -= cover;
  }
  throw new Error("Saved refund command is not awaiting the dispute outcome");
}

export function withdrawnDisputeError(disputeIds: readonly string[]) {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Payment dispute ${disputeIds.join(", ")} has withdrawn this booking's funds; no refund can be issued until the dispute is resolved`,
  });
}

/** Every refund command calls this under the booking lock before any money
 * can move. */
export async function assertNoWithdrawnDispute(
  tx: SettlementTx,
  bookingId: number,
  paymentIntentIds: readonly string[] = []
) {
  const open = await withdrawnDisputeIds(tx, bookingId, paymentIntentIds);
  if (open.length) throw withdrawnDisputeError(open);
}

/** A saved refund command that is due waits, queued and retryable, while a
 * dispute has withdrawn the funds. It proceeds once the dispute is won or the
 * funds are reinstated; after a lost dispute it is settled by the chargeback. */
export const DISPUTE_HOLD_ERROR = "dispute_funds_withdrawn";
export const DISPUTE_HOLD_RETRY_MS = 60 * 60_000;

const couponEvents = new Set<DisputeEventType>([
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "charge.dispute.closed",
]);

/** Called after this event's ledger row is written, under the booking lock.
 * A dispute on a collection that did not fund the travel leaves coupons alone. */
async function applyDisputeToCoupons(
  tx: SettlementTx,
  bookingId: number,
  disputeId: string
): Promise<CouponTransition[]> {
  const disputes = await fundingDisputes(tx, bookingId);
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
