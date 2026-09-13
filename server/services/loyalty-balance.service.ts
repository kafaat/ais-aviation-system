import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  loyaltyAccounts,
  loyaltyCreditLots,
  milesTransactions,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

type Account = typeof loyaltyAccounts.$inferSelect;
type Lot = typeof loyaltyCreditLots.$inferSelect;
type Ledger = typeof milesTransactions.$inferSelect;
export type MilesState = { account: Account; lots: Lot[] };
const MAX_MILES = 2147483647;
export function requireMiles(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_MILES)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A positive whole number of miles is required",
    });
}
function validate(state: MilesState) {
  const balance = state.account.currentMilesBalance;
  if (!Number.isSafeInteger(balance) || Math.abs(balance) > MAX_MILES)
    throw new Error("Miles balance exceeds storage bounds");
  for (const lot of state.lots) {
    const parts = [
      lot.remainingMiles,
      lot.spentMiles,
      lot.expiredMiles,
      lot.reversedMiles,
    ];
    if (
      !Number.isSafeInteger(lot.creditedMiles) ||
      lot.creditedMiles <= 0 ||
      parts.some(n => !Number.isSafeInteger(n) || n < 0) ||
      parts.reduce((a, b) => a + b, 0) !== lot.creditedMiles
    )
      throw new Error("Miles lot conservation failed");
  }
  if (
    state.lots.reduce((n, l) => n + l.remainingMiles, 0) !==
    Math.max(0, balance)
  )
    throw new Error("Legacy loyalty balance requires reconciliation");
}
function ordered(lots: Lot[]) {
  return [...lots].sort(
    (a, b) =>
      (a.expiresAt?.getTime() ?? Infinity) -
        (b.expiresAt?.getTime() ?? Infinity) ||
      a.transactionId - b.transactionId
  );
}
function spendAvailable(state: MilesState, amount: number) {
  let remaining = amount;
  for (const lot of ordered(state.lots)) {
    const debit = Math.min(remaining, lot.remainingMiles);
    lot.remainingMiles -= debit;
    lot.spentMiles += debit;
    remaining -= debit;
    if (!remaining) break;
  }
  return remaining;
}
function addCredit(
  state: MilesState,
  row: Pick<Ledger, "id" | "bookingId" | "amount" | "expiresAt">
) {
  requireMiles(row.amount);
  // Credits first repay a negative balance created by refunding already spent miles.
  const repaid = Math.min(
    row.amount,
    Math.max(0, -state.account.currentMilesBalance)
  );
  const lot: Lot = {
    transactionId: row.id,
    loyaltyAccountId: state.account.id,
    bookingId: row.bookingId,
    creditedMiles: row.amount,
    remainingMiles: row.amount - repaid,
    spentMiles: repaid,
    expiredMiles: 0,
    reversedMiles: 0,
    expiresAt: row.expiresAt,
  };
  state.lots.push(lot);
  state.account.currentMilesBalance += row.amount;
  validate(state);
  return lot;
}
/** Expired credit is reversed first; it cannot be deducted from the balance twice. */
function reverseCredit(
  state: MilesState,
  bookingId: number,
  grossMiles: number
) {
  let remaining = grossMiles,
    balanceDebit = 0,
    spentDebit = 0;
  const lots = ordered(state.lots.filter(l => l.bookingId === bookingId));
  for (const field of ["expiredMiles", "remainingMiles", "spentMiles"] as const)
    for (const lot of lots) {
      const debit = Math.min(remaining, lot[field]);
      lot[field] -= debit;
      lot.reversedMiles += debit;
      remaining -= debit;
      if (field !== "expiredMiles") balanceDebit += debit;
      if (field === "spentMiles") spentDebit += debit;
    }
  if (remaining)
    throw new Error("Booking miles reversal exceeds its recorded credit");
  // Recover previously spent/refunded credit from other available lots before creating debt.
  spendAvailable(state, spentDebit);
  state.account.currentMilesBalance -= balanceDebit;
  validate(state);
  return balanceDebit;
}

/** Historical balances are adopted only when the original ledger proves every transition. */
export function reconstructMilesLots(
  account: Account,
  rows: Ledger[]
): MilesState {
  const state: MilesState = {
    account: { ...account, currentMilesBalance: 0 },
    lots: [],
  };
  for (const row of rows) {
    if (row.loyaltyAccountId !== account.id || row.userId !== account.userId)
      throw new Error("Legacy loyalty ledger ownership mismatch");
    if (row.amount > 0 && ["earn", "bonus", "adjustment"].includes(row.type))
      addCredit(state, row);
    else if (row.type === "expire" && row.amount < 0) {
      let remaining = -row.amount;
      for (const lot of ordered(state.lots).filter(
        l => l.expiresAt && l.expiresAt <= row.createdAt
      )) {
        const debit = Math.min(remaining, lot.remainingMiles);
        lot.remainingMiles -= debit;
        lot.expiredMiles += debit;
        remaining -= debit;
      }
      if (remaining)
        throw new Error("Legacy miles expiration requires reconciliation");
      state.account.currentMilesBalance += row.amount;
    } else if (
      row.type === "adjustment" &&
      row.amount < 0 &&
      row.bookingId !== null
    ) {
      if (reverseCredit(state, row.bookingId, -row.amount) !== -row.amount)
        throw new Error(
          "Legacy refund after miles expiration requires reconciliation"
        );
    } else if (row.amount < 0 && ["redeem", "adjustment"].includes(row.type)) {
      if (spendAvailable(state, -row.amount))
        throw new Error("Legacy miles spending requires reconciliation");
      state.account.currentMilesBalance += row.amount;
    } else throw new Error("Legacy loyalty ledger requires reconciliation");
    if (state.account.currentMilesBalance !== row.balanceAfter)
      throw new Error("Legacy loyalty ledger balance requires reconciliation");
    validate(state);
  }
  if (
    state.account.currentMilesBalance !== account.currentMilesBalance ||
    (!rows.length && (account.totalMilesEarned || account.milesRedeemed))
  )
    throw new Error("Legacy loyalty balance requires reconciliation");
  return state;
}

/** Caller may already hold booking/group locks; every balance writer then locks this account. */
export async function lockMilesState(
  tx: SettlementTx,
  userId: number
): Promise<MilesState> {
  const [account] = await tx
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.userId, userId))
    .for("update");
  if (!account)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Loyalty account not found",
    });
  if (!account.creditLotsInitializedAt) {
    const rows = await tx
      .select()
      .from(milesTransactions)
      .where(
        and(
          eq(milesTransactions.userId, userId),
          eq(milesTransactions.loyaltyAccountId, account.id)
        )
      )
      .orderBy(asc(milesTransactions.id))
      .for("update");
    const state = reconstructMilesLots(account, rows);
    const existing = await tx
      .select()
      .from(loyaltyCreditLots)
      .where(eq(loyaltyCreditLots.loyaltyAccountId, account.id));
    if (existing.length)
      throw new Error(
        "Legacy loyalty lot initialization requires reconciliation"
      );
    if (state.lots.length)
      await tx.insert(loyaltyCreditLots).values(state.lots);
    const initialized = new Date();
    await tx
      .update(loyaltyAccounts)
      .set({ creditLotsInitializedAt: initialized })
      .where(eq(loyaltyAccounts.id, account.id));
    state.account.creditLotsInitializedAt = initialized;
    return state;
  }
  const state = {
    account,
    lots: await tx
      .select()
      .from(loyaltyCreditLots)
      .where(eq(loyaltyCreditLots.loyaltyAccountId, account.id))
      .for("update"),
  };
  validate(state);
  return state;
}
async function saveState(tx: SettlementTx, state: MilesState) {
  validate(state);
  for (const lot of state.lots)
    await tx
      .update(loyaltyCreditLots)
      .set({
        remainingMiles: lot.remainingMiles,
        spentMiles: lot.spentMiles,
        expiredMiles: lot.expiredMiles,
        reversedMiles: lot.reversedMiles,
      })
      .where(eq(loyaltyCreditLots.transactionId, lot.transactionId));
  await tx
    .update(loyaltyAccounts)
    .set({
      currentMilesBalance: state.account.currentMilesBalance,
      lastActivityAt: new Date(),
    })
    .where(eq(loyaltyAccounts.id, state.account.id));
}
export async function expireMilesLots(
  tx: SettlementTx,
  state: MilesState,
  now = new Date()
) {
  let expired = 0;
  for (const lot of ordered(state.lots)) {
    if (!lot.expiresAt || lot.expiresAt > now || !lot.remainingMiles) continue;
    const amount = lot.remainingMiles;
    lot.remainingMiles = 0;
    lot.expiredMiles += amount;
    state.account.currentMilesBalance -= amount;
    expired += amount;
    await tx.insert(milesTransactions).values({
      userId: state.account.userId,
      loyaltyAccountId: state.account.id,
      bookingId: lot.bookingId,
      type: "expire",
      amount: -amount,
      balanceAfter: state.account.currentMilesBalance,
      description: "Unused miles expired",
      reason: `credit-expiry:${lot.transactionId}`,
    });
  }
  if (expired) await saveState(tx, state);
  return expired;
}
export async function creditMiles(
  tx: SettlementTx,
  state: MilesState,
  input: {
    amount: number;
    type: "earn" | "bonus";
    bookingId?: number;
    flightId?: number;
    reason: string;
    expiresAt: Date;
  }
) {
  requireMiles(input.amount);
  const [created] = await tx.insert(milesTransactions).values({
    userId: state.account.userId,
    loyaltyAccountId: state.account.id,
    ...input,
    description: input.reason,
    balanceAfter: state.account.currentMilesBalance + input.amount,
  });
  const lot = addCredit(state, {
    id: created.insertId,
    amount: input.amount,
    bookingId: input.bookingId ?? null,
    expiresAt: input.expiresAt,
  });
  await tx.insert(loyaltyCreditLots).values(lot);
  await saveState(tx, state);
  return state.account.currentMilesBalance;
}
export async function spendMiles(
  tx: SettlementTx,
  state: MilesState,
  amount: number,
  input: { type: "redeem" | "adjustment"; bookingId?: number; reason: string }
) {
  requireMiles(amount);
  if (amount > state.account.currentMilesBalance)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Insufficient miles balance",
    });
  if (spendAvailable(state, amount))
    throw new Error("Miles spending exceeds available lots");
  state.account.currentMilesBalance -= amount;
  await tx.insert(milesTransactions).values({
    userId: state.account.userId,
    loyaltyAccountId: state.account.id,
    ...input,
    description: input.reason,
    amount: -amount,
    balanceAfter: state.account.currentMilesBalance,
  });
  if (input.type === "redeem") {
    state.account.milesRedeemed += amount;
    await tx
      .update(loyaltyAccounts)
      .set({ milesRedeemed: state.account.milesRedeemed })
      .where(eq(loyaltyAccounts.id, state.account.id));
  }
  await saveState(tx, state);
  return state.account.currentMilesBalance;
}
export async function reverseBookingMilesCredit(
  tx: SettlementTx,
  state: MilesState,
  bookingId: number,
  grossMiles: number
) {
  requireMiles(grossMiles);
  const debit = reverseCredit(state, bookingId, grossMiles);
  await tx.insert(milesTransactions).values({
    userId: state.account.userId,
    loyaltyAccountId: state.account.id,
    bookingId,
    type: "adjustment",
    amount: -debit,
    balanceAfter: state.account.currentMilesBalance,
    description: `Reverse ${grossMiles} net booking miles; ${grossMiles - debit} already expired`,
    reason: `booking-net:${bookingId}`,
  });
  await saveState(tx, state);
  return debit;
}
