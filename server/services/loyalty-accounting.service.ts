import { and, desc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  financialLedger,
  loyaltyAccounts,
  loyaltyCreditLots,
  loyaltyValuations,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import type { MilesState } from "./loyalty-balance.service";
import {
  activityExpiryAt,
  getActiveProgramRule,
  type ProgramRule,
} from "./loyalty-rules.service";

/**
 * Loyalty programme accounting (IFRS 15 / ASC 606).
 *
 * Miles granted with a ticket are a separate performance obligation: part of
 * the ticket price is deferred into a contract liability at the stand-alone
 * selling price (SSP) per mile and recognised when the miles are redeemed or
 * lapse. Expected breakage reduces the amount deferred, so the liability
 * carried per lot is round(remainingMiles x SSP x (1 - breakage)).
 *
 * Ledger design (financial_ledger, amounts in SAR, positive, type = side):
 *   loyalty_deferral  credit liability   on issuance
 *   loyalty_revenue   debit liability    on redemption (revenue recognised)
 *   loyalty_breakage  debit liability    on expiry (breakage recognised)
 *   loyalty_reversal  debit liability    on earn reversal after a refund
 * Liability balance = deferral - revenue - breakage - reversal, and the
 * invariant checked by tests is: sum over valued lots of
 * round(remaining x SSP x (1 - breakage)) == liability balance.
 *
 * Valuation (SSP, breakage) is locked on each lot at issuance; changes in
 * estimate apply prospectively to new lots (Southwest 10-K practice).
 * Re-measuring existing lots and the finance sign-off of SSP/breakage remain
 * external controls; approval here only records who pressed the button.
 */
export type Valuation = {
  id: number | null;
  currency: string;
  sspMinorPerMile: number;
  breakageRatePercent: number;
  status: "approved" | "unapproved-default";
  effectiveFrom: Date | null;
  approvedBy: number | null;
  approvedAt: Date | null;
};

/** 1 mile = 1 halala, matching the redemption value; breakage 0 until finance approves an estimate. */
export const DEFAULT_VALUATION: Valuation = {
  id: null,
  currency: "SAR",
  sspMinorPerMile: 1,
  breakageRatePercent: 0,
  status: "unapproved-default",
  effectiveFrom: null,
  approvedBy: null,
  approvedAt: null,
};

export async function getCurrentValuation(
  tx: SettlementTx,
  now = new Date()
): Promise<Valuation> {
  const [row] = await tx
    .select()
    .from(loyaltyValuations)
    .where(
      and(
        eq(loyaltyValuations.status, "approved"),
        lte(loyaltyValuations.effectiveFrom, now)
      )
    )
    .orderBy(desc(loyaltyValuations.effectiveFrom))
    .limit(1);
  if (!row) return DEFAULT_VALUATION;
  return {
    id: row.id,
    currency: row.currency,
    sspMinorPerMile: Number(row.sspMinorPerMile),
    breakageRatePercent: Number(row.breakageRatePercent),
    status: "approved",
    effectiveFrom: row.effectiveFrom,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
  };
}

type Lot = typeof loyaltyCreditLots.$inferSelect;
export type LotSnapshot = {
  spentMiles: number;
  expiredMiles: number;
  reversedMiles: number;
  deferredMinor: number;
};

function snapshotLot(lot: Lot): LotSnapshot {
  return {
    spentMiles: lot.spentMiles,
    expiredMiles: lot.expiredMiles,
    reversedMiles: lot.reversedMiles,
    deferredMinor: lot.deferredMinor,
  };
}

export function snapshotLots(lots: Lot[]): Map<number, LotSnapshot> {
  return new Map(lots.map(lot => [lot.transactionId, snapshotLot(lot)]));
}

/** Liability per mile after expected breakage, in minor units (may be fractional). */
export function unitLiabilityMinor(lot: {
  sspMinorPerMile: string | number | null;
  breakageRatePercent: string | number | null;
}): number | null {
  if (lot.sspMinorPerMile == null) return null;
  const ssp = Number(lot.sspMinorPerMile);
  const breakage = Number(lot.breakageRatePercent ?? 0);
  if (!Number.isFinite(ssp) || !Number.isFinite(breakage)) return null;
  return ssp * (1 - breakage / 100);
}

export function lotCarryingMinor(
  lot: Pick<Lot, "remainingMiles" | "sspMinorPerMile" | "breakageRatePercent">
): number {
  const unit = unitLiabilityMinor(lot);
  return unit === null ? 0 : Math.round(lot.remainingMiles * unit);
}

export type LoyaltyLedgerType =
  | "loyalty_deferral"
  | "loyalty_revenue"
  | "loyalty_breakage"
  | "loyalty_reversal";

export type LoyaltyPosting = {
  type: LoyaltyLedgerType;
  amountMinor: number;
  miles: number;
  lotTransactionId: number;
};

const SIDE: Record<LoyaltyLedgerType, "credit" | "debit"> = {
  loyalty_deferral: "credit",
  loyalty_revenue: "debit",
  loyalty_breakage: "debit",
  loyalty_reversal: "debit",
};

async function post(
  tx: SettlementTx,
  state: MilesState,
  lot: Lot,
  posting: LoyaltyPosting
) {
  if (!posting.amountMinor) return;
  await tx.insert(financialLedger).values({
    bookingId: lot.bookingId,
    userId: state.account.userId,
    type: posting.type,
    amount: (posting.amountMinor / 100).toFixed(2),
    currency: "SAR",
    description: `Loyalty contract liability ${SIDE[posting.type]}: ${posting.miles} miles (lot ${lot.transactionId})`,
    metadata: JSON.stringify({
      ledgerAccount: "loyalty_contract_liability",
      side: SIDE[posting.type],
      loyaltyAccountId: state.account.id,
      lotTransactionId: lot.transactionId,
      miles: posting.miles,
      valuationId: lot.valuationId,
      sspMinorPerMile: lot.sspMinorPerMile,
      breakageRatePercent: lot.breakageRatePercent,
    }),
  });
}

/**
 * Post the ledger movements implied by the difference between the lots as
 * last posted (state.posted) and their current counters, then bring each
 * lot's carrying liability to round(remaining x unit). Called by the balance
 * service inside the same transaction as the miles movement, so a miles write
 * never commits without its accounting entry.
 */
export async function postLoyaltyLedger(
  tx: SettlementTx,
  state: MilesState
): Promise<LoyaltyPosting[]> {
  const postings: LoyaltyPosting[] = [];
  for (const lot of state.lots) {
    const unit = unitLiabilityMinor(lot);
    const prev = state.posted.get(lot.transactionId);
    if (unit === null) {
      // Pre-policy lot: no liability was ever deferred for it.
      lot.deferredMinor = 0;
      state.posted.set(lot.transactionId, snapshotLot(lot));
      continue;
    }
    let carrying = prev ? prev.deferredMinor : 0;
    if (!prev) {
      const issued = Math.round(lot.creditedMiles * unit);
      const posting: LoyaltyPosting = {
        type: "loyalty_deferral",
        amountMinor: issued,
        miles: lot.creditedMiles,
        lotTransactionId: lot.transactionId,
      };
      await post(tx, state, lot, posting);
      postings.push(posting);
      carrying = issued;
    }
    const target = Math.round(lot.remainingMiles * unit);
    const release = carrying - target;
    if (release !== 0) {
      const base = prev ?? {
        spentMiles: 0,
        expiredMiles: 0,
        reversedMiles: 0,
        deferredMinor: 0,
      };
      const candidates: Array<[LoyaltyLedgerType, number]> = [
        ["loyalty_revenue", Math.max(0, lot.spentMiles - base.spentMiles)],
        ["loyalty_breakage", Math.max(0, lot.expiredMiles - base.expiredMiles)],
        [
          "loyalty_reversal",
          Math.max(0, lot.reversedMiles - base.reversedMiles),
        ],
      ];
      const weights = candidates.filter(([, miles]) => miles > 0);
      if (release < 0 || !weights.length) {
        // Remaining miles grew (not reachable through the balance service);
        // keep the ledger balanced with an explicit deferral adjustment.
        const posting: LoyaltyPosting = {
          type: release < 0 ? "loyalty_deferral" : "loyalty_reversal",
          amountMinor: Math.abs(release),
          miles: 0,
          lotTransactionId: lot.transactionId,
        };
        await post(tx, state, lot, posting);
        postings.push(posting);
      } else {
        const totalMiles = weights.reduce((n, [, m]) => n + m, 0);
        let allocated = 0;
        for (const [index, [type, miles]] of weights.entries()) {
          const amount =
            index === weights.length - 1
              ? release - allocated
              : Math.round((release * miles) / totalMiles);
          allocated += amount;
          const posting: LoyaltyPosting = {
            type,
            amountMinor: amount,
            miles,
            lotTransactionId: lot.transactionId,
          };
          await post(tx, state, lot, posting);
          postings.push(posting);
        }
      }
    }
    lot.deferredMinor = target;
    state.posted.set(lot.transactionId, snapshotLot(lot));
  }
  return postings;
}

async function sumLedger(db: SettlementTx, type: LoyaltyLedgerType) {
  const [row] = await db
    .select({ total: sql<string | null>`SUM(${financialLedger.amount})` })
    .from(financialLedger)
    .where(eq(financialLedger.type, type));
  return Math.round(Number(row?.total ?? 0) * 100);
}

export async function getLoyaltyLiabilityBalanceMinor(db: SettlementTx) {
  const [deferredMinor, revenueMinor, breakageMinor, reversalMinor] =
    await Promise.all([
      sumLedger(db, "loyalty_deferral"),
      sumLedger(db, "loyalty_revenue"),
      sumLedger(db, "loyalty_breakage"),
      sumLedger(db, "loyalty_reversal"),
    ]);
  return {
    deferredMinor,
    revenueMinor,
    breakageMinor,
    reversalMinor,
    balanceMinor: deferredMinor - revenueMinor - breakageMinor - reversalMinor,
  };
}

export const EXPIRY_HORIZON_DAYS = 90;

async function expiringWithin(
  db: SettlementTx,
  rule: ProgramRule,
  now: Date,
  horizonDays: number
) {
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  if (rule.expiryMode === "activity") {
    const accounts = await db
      .select({
        id: loyaltyAccounts.id,
        balance: loyaltyAccounts.currentMilesBalance,
        lastActivityAt: loyaltyAccounts.lastActivityAt,
        memberSince: loyaltyAccounts.memberSince,
        createdAt: loyaltyAccounts.createdAt,
      })
      .from(loyaltyAccounts)
      .where(gt(loyaltyAccounts.currentMilesBalance, 0));
    // Accounts already past their deadline stay at risk until the lifecycle
    // job posts the expiry, so they are counted too.
    const atRisk = accounts.filter(a => {
      const at = activityExpiryAt(rule, a);
      return at !== null && at <= horizon;
    });
    return {
      miles: atRisk.reduce((n, a) => n + a.balance, 0),
      accounts: atRisk.length,
      horizonDays,
    };
  }
  const lots = await db
    .select({
      loyaltyAccountId: loyaltyCreditLots.loyaltyAccountId,
      remainingMiles: loyaltyCreditLots.remainingMiles,
      expiresAt: loyaltyCreditLots.expiresAt,
    })
    .from(loyaltyCreditLots)
    .where(
      and(
        gt(loyaltyCreditLots.remainingMiles, 0),
        isNotNull(loyaltyCreditLots.expiresAt),
        lte(loyaltyCreditLots.expiresAt, horizon)
      )
    );
  return {
    miles: lots.reduce((n, l) => n + l.remainingMiles, 0),
    accounts: new Set(lots.map(l => l.loyaltyAccountId)).size,
    horizonDays,
  };
}

/** Admin report: outstanding miles, carried liability, breakage estimate and near-term expiry. */
export async function getLoyaltyAccountingSummary(
  db: SettlementTx,
  now = new Date()
) {
  const [valuation, rule, ledger] = await Promise.all([
    getCurrentValuation(db, now),
    getActiveProgramRule(db, now),
    getLoyaltyLiabilityBalanceMinor(db),
  ]);
  const lots = await db
    .select({
      remainingMiles: loyaltyCreditLots.remainingMiles,
      sspMinorPerMile: loyaltyCreditLots.sspMinorPerMile,
      breakageRatePercent: loyaltyCreditLots.breakageRatePercent,
      deferredMinor: loyaltyCreditLots.deferredMinor,
    })
    .from(loyaltyCreditLots)
    .where(gt(loyaltyCreditLots.remainingMiles, 0));
  let outstandingMiles = 0,
    valuedMiles = 0,
    grossValueMinor = 0,
    lotCarryingMinorTotal = 0;
  for (const lot of lots) {
    outstandingMiles += lot.remainingMiles;
    if (lot.sspMinorPerMile == null) continue;
    valuedMiles += lot.remainingMiles;
    grossValueMinor += lot.remainingMiles * Number(lot.sspMinorPerMile);
    lotCarryingMinorTotal += lot.deferredMinor;
  }
  grossValueMinor = Math.round(grossValueMinor);
  const expiring = await expiringWithin(db, rule, now, EXPIRY_HORIZON_DAYS);
  return {
    asOf: now,
    valuation,
    rule: {
      id: rule.id,
      name: rule.name,
      source: rule.source,
      earningBasis: rule.earningBasis,
      milesPerSar: rule.milesPerSar,
      expiryMode: rule.expiryMode,
      expiryMonths: rule.expiryMonths,
      expiryNoticeDays: rule.expiryNoticeDays,
      tierQualificationMonths: rule.tierQualificationMonths,
      redemptionCoolingOffHours: rule.redemptionCoolingOffHours,
    },
    outstandingMiles,
    valuedMiles,
    unvaluedMiles: outstandingMiles - valuedMiles,
    grossValueMinor,
    liabilityMinor: ledger.balanceMinor,
    lotCarryingMinor: lotCarryingMinorTotal,
    reconciliationDifferenceMinor: lotCarryingMinorTotal - ledger.balanceMinor,
    expectedBreakageMinor: grossValueMinor - lotCarryingMinorTotal,
    unvaluedMilesAtDefaultSspMinor: Math.round(
      (outstandingMiles - valuedMiles) * valuation.sspMinorPerMile
    ),
    ledger,
    expiringNext90Days: expiring,
  };
}

export async function listValuations(db: SettlementTx, limit = 50) {
  return await db
    .select()
    .from(loyaltyValuations)
    .orderBy(desc(loyaltyValuations.effectiveFrom))
    .limit(limit);
}

export async function createValuation(
  db: SettlementTx,
  input: {
    sspMinorPerMile: number;
    breakageRatePercent: number;
    effectiveFrom: Date;
    notes?: string | null;
  },
  actorId: number | null
) {
  if (input.sspMinorPerMile <= 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "SSP per mile must be positive",
    });
  if (input.breakageRatePercent < 0 || input.breakageRatePercent >= 100)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Breakage rate must be between 0 and 100 percent",
    });
  const [created] = await db.insert(loyaltyValuations).values({
    sspMinorPerMile: input.sspMinorPerMile.toFixed(4),
    breakageRatePercent: input.breakageRatePercent.toFixed(2),
    effectiveFrom: input.effectiveFrom,
    status: "draft",
    createdBy: actorId,
    notes: input.notes ?? null,
  });
  const [row] = await db
    .select()
    .from(loyaltyValuations)
    .where(eq(loyaltyValuations.id, created.insertId))
    .limit(1);
  if (!row) throw new Error("Valuation was not stored");
  return row;
}

/**
 * Record approval. This is a placeholder for the finance sign-off: the
 * approver's user id is stored, but the authority to set SSP and breakage
 * remains with finance outside this system.
 */
export async function approveValuation(
  db: SettlementTx,
  id: number,
  approverId: number
) {
  return await db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(loyaltyValuations)
      .where(eq(loyaltyValuations.id, id))
      .limit(1)
      .for("update");
    if (!row)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Valuation not found",
      });
    if (row.status !== "draft")
      throw new TRPCError({
        code: "CONFLICT",
        message: `Valuation is ${row.status}; only drafts can be approved`,
      });
    const approved = await tx
      .select()
      .from(loyaltyValuations)
      .where(eq(loyaltyValuations.status, "approved"));
    for (const other of approved)
      if (other.effectiveFrom <= row.effectiveFrom)
        await tx
          .update(loyaltyValuations)
          .set({ status: "superseded" })
          .where(eq(loyaltyValuations.id, other.id));
    const approvedAt = new Date();
    await tx
      .update(loyaltyValuations)
      .set({ status: "approved", approvedBy: approverId, approvedAt })
      .where(eq(loyaltyValuations.id, id));
    return {
      ...row,
      status: "approved" as const,
      approvedBy: approverId,
      approvedAt,
    };
  });
}
