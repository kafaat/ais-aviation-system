import { and, eq } from "drizzle-orm";
import {
  financialLedger,
  paymentReceipts,
  wallets,
  walletTransactions,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

type FundingReceipt = Pick<
  typeof paymentReceipts.$inferSelect,
  | "paymentIntentId"
  | "kind"
  | "targetId"
  | "bookingId"
  | "userId"
  | "amount"
  | "currency"
  | "refundedAmount"
>;
type FundingWallet = Pick<
  typeof wallets.$inferSelect,
  "id" | "userId" | "balance" | "currency" | "status"
>;
type LedgerRow = typeof financialLedger.$inferSelect;

/** A projection mismatch needs an explicit financial reconciliation, not a guess. */
export class WalletFundingReviewRequiredError extends Error {
  constructor(reason: string) {
    super(`Wallet funding requires reconciliation: ${reason}`);
    this.name = "WalletFundingReviewRequiredError";
  }
}

function review(reason: string): never {
  throw new WalletFundingReviewRequiredError(reason);
}

function validateOwner(receipt: FundingReceipt, wallet: FundingWallet) {
  if (
    receipt.kind !== "wallet_topup" ||
    receipt.bookingId !== null ||
    receipt.userId !== wallet.userId ||
    receipt.currency.toUpperCase() !== wallet.currency.toUpperCase() ||
    wallet.currency !== "SAR" ||
    !Number.isSafeInteger(receipt.targetId) ||
    receipt.targetId <= 0 ||
    !Number.isSafeInteger(receipt.amount) ||
    receipt.amount <= 0 ||
    !Number.isSafeInteger(receipt.refundedAmount) ||
    receipt.refundedAmount < 0 ||
    receipt.refundedAmount > receipt.amount
  )
    review("persisted top-up owner, amount or currency is inconsistent");
}

function metadata(row: LedgerRow): Record<string, unknown> {
  if (!row.metadata) return {};
  try {
    const parsed: unknown = JSON.parse(row.metadata);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // Unrelated legacy ledger metadata need not be JSON. Cash dispute rows do.
  }
  if (row.description?.startsWith("Provider dispute "))
    review("dispute evidence is unreadable");
  return {};
}

function fundingMarker(
  evidence: Record<string, unknown>,
  receipt: FundingReceipt,
  wallet: FundingWallet
) {
  if (evidence.walletFunding === undefined) return undefined;
  if (
    !evidence.walletFunding ||
    typeof evidence.walletFunding !== "object" ||
    Array.isArray(evidence.walletFunding)
  )
    review("wallet funding evidence is invalid");
  const marker = evidence.walletFunding as Record<string, unknown>;
  if (
    marker.version !== 1 ||
    marker.walletId !== wallet.id ||
    typeof marker.adjustment !== "number" ||
    !Number.isSafeInteger(marker.adjustment) ||
    typeof marker.loss !== "number" ||
    !Number.isSafeInteger(marker.loss) ||
    marker.loss < 0 ||
    marker.loss > receipt.amount
  )
    review("wallet funding evidence is invalid");
  return { adjustment: marker.adjustment, loss: marker.loss };
}

function minorUnits(amount: string): number {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(amount)) review("ledger amount is invalid");
  const value = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(value)) review("ledger amount exceeds safe limits");
  return value;
}

/**
 * The receipt owns cumulative refunds. Cash dispute evidence owns the outstanding
 * disputed principal, independent of delivery order. Repeated provider events for
 * one dispute are observations of its amount, not additional withdrawals.
 *
 * walletFunding.adjustment is the actual signed wallet delta committed with that
 * ledger row. Unmarked historical refunds were debited by the previous refund
 * implementation; unmarked historical disputes never prove a wallet debit.
 */
function fundingState(
  receipt: FundingReceipt,
  wallet: FundingWallet,
  rows: LedgerRow[],
  pendingEventId?: string
) {
  validateOwner(receipt, wallet);
  let appliedLoss = 0;
  const disputes = new Map<string, { withdrawn: number; reinstated: number }>();
  for (const row of rows) {
    const evidence = metadata(row);
    const cashEvent =
      evidence.eventType === "charge.dispute.funds_withdrawn" ||
      evidence.eventType === "charge.dispute.funds_reinstated";
    const refund = row.type === "refund" || row.type === "partial_refund";
    if (cashEvent || refund || evidence.walletFunding !== undefined) {
      if (
        row.userId !== receipt.userId ||
        row.bookingId !== null ||
        row.currency.toUpperCase() !== receipt.currency.toUpperCase()
      )
        review("ledger owner or currency does not match its top-up receipt");
    }
    const marker = fundingMarker(evidence, receipt, wallet);
    if (marker) {
      appliedLoss -= marker.adjustment;
    } else if (refund && row.stripeEventId !== pendingEventId) {
      const amount = minorUnits(row.amount);
      if (amount <= 0) review("historical refund evidence is invalid");
      appliedLoss += amount;
    }
    if (!cashEvent) continue;
    if (typeof evidence.disputeId !== "string" || !evidence.disputeId)
      review("dispute identity is missing");
    const amount = minorUnits(row.amount);
    const withdrawn = evidence.eventType === "charge.dispute.funds_withdrawn";
    if (
      (withdrawn ? amount >= 0 : amount <= 0) ||
      Math.abs(amount) > receipt.amount
    )
      review("dispute amount does not match its top-up receipt");
    const state = disputes.get(evidence.disputeId) ?? {
      withdrawn: 0,
      reinstated: 0,
    };
    const field = withdrawn ? "withdrawn" : "reinstated";
    state[field] = Math.max(state[field], Math.abs(amount));
    disputes.set(evidence.disputeId, state);
  }
  if (!Number.isSafeInteger(appliedLoss) || appliedLoss < 0)
    review("recorded wallet adjustments exceed removed funding");
  let disputed = 0;
  for (const state of disputes.values())
    disputed += Math.max(0, state.withdrawn - state.reinstated);
  const fundingLoss = Math.min(
    receipt.amount,
    receipt.refundedAmount + disputed
  );
  return { appliedLoss, fundingLoss };
}

function fundingRows(tx: SettlementTx, paymentIntentId: string) {
  // A current read is required even when discovery established a repeatable-read
  // snapshot before another webhook acquired the wallet lock.
  return tx
    .select()
    .from(financialLedger)
    .where(eq(financialLedger.stripePaymentIntentId, paymentIntentId))
    .orderBy(financialLedger.id)
    .for("update");
}

/** Pure projection for a scoped maintenance preview; never writes or calls a provider. */
export function inspectWalletFunding(
  receipt: FundingReceipt,
  wallet: FundingWallet,
  rows: LedgerRow[]
) {
  const { appliedLoss, fundingLoss } = fundingState(receipt, wallet, rows);
  return { appliedLoss, fundingLoss, adjustment: appliedLoss - fundingLoss };
}

/**
 * Call inside the provider transaction AFTER locking top-up request -> wallet ->
 * receipt and inserting the event ledger row. For a refund, receipt.refundedAmount
 * must already contain the new cumulative amount, and its new ledger row must not
 * yet have been applied to the wallet. The event marker, balance and movement are
 * committed atomically. Existing marker adjustments are retained during repair.
 */
export async function reconcileWalletFunding(
  tx: SettlementTx,
  input: { receipt: FundingReceipt; wallet: FundingWallet; eventId: string }
) {
  const { receipt, wallet, eventId } = input;
  validateOwner(receipt, wallet);
  const [request] = await tx
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.id, receipt.targetId))
    .limit(1)
    .for("update");
  if (
    !request ||
    request.type !== "top_up" ||
    request.status !== "completed" ||
    request.walletId !== wallet.id ||
    request.userId !== receipt.userId ||
    request.amount !== receipt.amount ||
    request.stripePaymentIntentId !== receipt.paymentIntentId
  )
    review("persisted top-up target does not match its wallet and receipt");

  const rows = await fundingRows(tx, receipt.paymentIntentId);
  const targets = rows.filter(row => row.stripeEventId === eventId);
  const [target] = targets;
  if (!target || targets.length !== 1)
    review("event ledger identity is missing or ambiguous");
  const evidence = metadata(target);
  const priorMarker = fundingMarker(evidence, receipt, wallet);
  const { appliedLoss, fundingLoss } = fundingState(
    receipt,
    wallet,
    rows,
    eventId
  );
  const adjustment = appliedLoss - fundingLoss;
  const balance = wallet.balance + adjustment;
  if (
    !Number.isSafeInteger(balance) ||
    balance < -2147483648 ||
    balance > 2147483647
  )
    review("wallet balance exceeds storage limits");
  if (adjustment !== 0) {
    await tx
      .update(wallets)
      .set({
        balance,
        ...(balance < 0 && wallet.status === "active"
          ? { status: "frozen" as const }
          : {}),
      })
      .where(eq(wallets.id, wallet.id));
    await tx.insert(walletTransactions).values({
      walletId: wallet.id,
      userId: wallet.userId,
      type: adjustment < 0 ? "withdrawal" : "refund",
      amount: adjustment,
      balanceAfter: balance,
      description:
        adjustment < 0
          ? "Provider reversed wallet funding"
          : "Provider reinstated wallet funding",
      stripePaymentIntentId: receipt.paymentIntentId,
      status: "completed",
    });
  }
  await tx
    .update(financialLedger)
    .set({
      metadata: JSON.stringify({
        ...evidence,
        walletFunding: {
          version: 1,
          walletId: wallet.id,
          adjustment: (priorMarker?.adjustment ?? 0) + adjustment,
          loss: fundingLoss,
        },
      }),
    })
    .where(eq(financialLedger.id, target.id));
  return { balance, adjustment, fundingLoss };
}

/**
 * Under the wallet lock, refuse fresh spending against historical dispute rows
 * whose wallet debit was never committed. This check makes no balance repairs.
 * Discover through the owner/kind index without taking receipt locks; lock each
 * known receipt by its primary key, then its ledger, in a consistent order. New top-ups
 * not visible in discovery are credited/reconciled atomically by the current
 * settlement boundary; historical receipts are already visible in the snapshot.
 */
export async function assertWalletFundingReconciled(
  tx: SettlementTx,
  wallet: FundingWallet
) {
  const hints = await tx
    .select({ paymentIntentId: paymentReceipts.paymentIntentId })
    .from(paymentReceipts)
    .where(
      and(
        eq(paymentReceipts.userId, wallet.userId),
        eq(paymentReceipts.kind, "wallet_topup")
      )
    );
  hints.sort((a, b) => a.paymentIntentId.localeCompare(b.paymentIntentId));
  for (const hint of hints) {
    const [receipt] = await tx
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentIntentId, hint.paymentIntentId))
      .limit(1)
      .for("update");
    if (!receipt) review("top-up receipt disappeared");
    const rows = await fundingRows(tx, receipt.paymentIntentId);
    const state = fundingState(receipt, wallet, rows);
    if (state.appliedLoss !== state.fundingLoss)
      review(
        "verified provider reversals have not been reconciled to this wallet"
      );
  }
}
