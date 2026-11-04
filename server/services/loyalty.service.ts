import { withTransactionalIdempotency } from "./idempotency-v2.service";
import {
  lockMilesState,
  expireMilesLots,
  creditMiles,
  spendMiles,
  reverseBookingMilesCredit,
  requireMiles,
  rebaseMilesExpiry,
} from "./loyalty-balance.service";
import {
  postApprovedBookingGrant,
  recordLotMovement,
} from "./loyalty-liability-ledger.service";
import { resolveMilesExpiry } from "./loyalty-accounting-policy";
import { findApprovedLoyaltyPolicy } from "./loyalty-policy-repository";
import type { SettlementTx } from "./booking-settlement.service";
import { consumeActionTotp } from "./mfa.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  loyaltyAccounts,
  milesTransactions,
  bookings,
  paymentReceipts,
  walletTransactions,
  bookingLoyaltyAccruals,
  userCredits,
  users,
} from "../../drizzle/schema";
import { and, eq, desc, sql } from "drizzle-orm";

/**
 * Loyalty Service
 * Handles loyalty program operations
 */

/**
 * Tier thresholds (tier points required)
 */
const TIER_THRESHOLDS = {
  bronze: 0,
  silver: 10000,
  gold: 25000,
  platinum: 50000,
};

/**
 * Miles earning rate (miles per SAR spent)
 */
const MILES_PER_SAR = 1; // 1 mile per 1 SAR

/**
 * Tier multipliers for miles earning
 */
const TIER_MULTIPLIERS = {
  bronze: 1.0,
  silver: 1.25,
  gold: 1.5,
  platinum: 2.0,
};

/**
 * Get or create loyalty account for user
 */
export async function getOrCreateLoyaltyAccount(userId: number) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Try to get existing account
    const [existing] = await database
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.userId, userId))
      .limit(1);

    if (existing) {
      return existing;
    }

    // Create new account
    await database
      .insert(loyaltyAccounts)
      .values({
        userId,
        totalMilesEarned: 0,
        currentMilesBalance: 0,
        milesRedeemed: 0,
        tier: "bronze",
        tierPoints: 0,
      })
      .onDuplicateKeyUpdate({
        set: { userId: sql`${loyaltyAccounts.userId}` },
      });

    const [newAccount] = await database
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.userId, userId))
      .limit(1);

    if (!newAccount) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create loyalty account",
      });
    }
    return newAccount;
  } catch (error) {
    console.error("Error getting/creating loyalty account:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get loyalty account",
    });
  }
}

/**
 * Calculate tier based on tier points
 */
function calculateTier(
  tierPoints: number
): "bronze" | "silver" | "gold" | "platinum" {
  if (tierPoints >= TIER_THRESHOLDS.platinum) return "platinum";
  if (tierPoints >= TIER_THRESHOLDS.gold) return "gold";
  if (tierPoints >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

/**
 * Award miles for a booking
 */
/** Recompute from posted funding. Duplicate/out-of-order events converge on net value. */
export async function syncBookingMiles(
  tx: SettlementTx,
  bookingId: number,
  expectedUserId?: number
) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  if (
    !booking ||
    (expectedUserId !== undefined && booking.userId !== expectedUserId)
  )
    throw new Error("Loyalty booking ownership mismatch");
  const userId = booking.userId;
  await tx
    .insert(loyaltyAccounts)
    .values({ userId, tier: "bronze" })
    .onDuplicateKeyUpdate({ set: { userId: sql`${loyaltyAccounts.userId}` } });
  const state = await lockMilesState(tx, userId);
  await expireMilesLots(tx, state);
  const account = state.account;
  let [accrual] = await tx
    .select()
    .from(bookingLoyaltyAccruals)
    .where(eq(bookingLoyaltyAccruals.bookingId, bookingId))
    .for("update");
  if (!accrual) {
    const prior = await tx
      .select()
      .from(milesTransactions)
      .where(
        and(
          eq(milesTransactions.bookingId, bookingId),
          eq(milesTransactions.userId, userId),
          sql`${milesTransactions.type} IN ('earn','adjustment')`
        )
      );
    const earned = prior
      .filter(t => t.type === "earn")
      .reduce((n, t) => n + t.amount, 0);
    const previous = prior.reduce((n, t) => n + t.amount, 0);
    if (previous < 0 || prior.filter(t => t.type === "earn").length > 1)
      throw new Error("Legacy loyalty accrual requires reconciliation");
    const base = Math.floor(booking.totalAmount / 100);
    const multiplier =
      earned && base ? earned / base : TIER_MULTIPLIERS[account.tier];
    const values = {
      bookingId,
      userId,
      multiplier: multiplier.toFixed(2),
      awardedMiles: previous,
      awardedTierPoints: earned ? base : 0,
    };
    await tx.insert(bookingLoyaltyAccruals).values(values);
    accrual = { ...values, updatedAt: new Date() };
  }
  const receipts = await tx
    .select()
    .from(paymentReceipts)
    .where(
      and(
        eq(paymentReceipts.bookingId, bookingId),
        eq(paymentReceipts.settlementStatus, "applied")
      )
    )
    .for("update");
  const wallet = await tx
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.bookingId, bookingId),
        eq(walletTransactions.status, "completed")
      )
    );
  const net =
    receipts.reduce(
      (n, r) => n + (r.currency === "SAR" ? r.amount - r.refundedAmount : 0),
      0
    ) +
    wallet.reduce(
      (n, r) =>
        n +
        (r.type === "payment"
          ? Math.abs(r.amount)
          : r.type === "refund"
            ? -Math.abs(r.amount)
            : 0),
      0
    );
  const eligible =
    ["confirmed", "completed"].includes(booking.status) &&
    booking.paymentStatus === "paid";
  const baseMiles = eligible
    ? Math.floor(
        (Math.max(0, Math.min(booking.totalAmount, net)) / 100) * MILES_PER_SAR
      )
    : 0;
  const target = Math.floor(baseMiles * Number(accrual.multiplier));
  const delta = target - accrual.awardedMiles;
  const tierDelta = baseMiles - accrual.awardedTierPoints;
  if (delta > 0) {
    const now = new Date();
    const policy = await findApprovedLoyaltyPolicy(tx, booking.tenantId, now);
    const expiry = resolveMilesExpiry(policy, now, now);
    if (policy?.expiryMode === "activity" && expiry)
      rebaseMilesExpiry(state, expiry);
    const originalGrant = !state.lots.some(lot => lot.bookingId === bookingId);
    await creditMiles(tx, state, {
      amount: delta,
      type: "earn",
      bookingId,
      flightId: booking.flightId,
      reason: `booking-net:${bookingId}`,
      expiresAt: expiry,
    });
    const lot = state.lots[state.lots.length - 1];
    if (
      policy &&
      originalGrant &&
      !accrual.awardedMiles &&
      !lot.spentMiles &&
      net === booking.totalAmount &&
      receipts.length &&
      !wallet.length &&
      receipts.every(
        r =>
          r.kind === "booking" &&
          r.userId === userId &&
          r.currency === "SAR" &&
          r.amount > 0 &&
          !r.refundedAmount
      )
    ) {
      await postApprovedBookingGrant(tx, {
        policy,
        bookingId,
        userId,
        lotId: lot.transactionId,
        awardedMiles: delta,
        contractAt: booking.createdAt,
        occurredAt: now,
        totalAmount: booking.totalAmount,
        settlementReferences: receipts.map(r => "receipt:" + r.paymentIntentId),
      });
    }
  } else if (delta < 0)
    await reverseBookingMilesCredit(
      tx,
      state,
      bookingId,
      -delta,
      net === 0 &&
        !wallet.length &&
        receipts.length > 0 &&
        receipts.every(
          r =>
            r.kind === "booking" &&
            r.userId === userId &&
            r.currency === "SAR" &&
            r.amount > 0 &&
            r.amount === r.refundedAmount
        )
    );
  const newBalance = state.account.currentMilesBalance;
  const tierPoints = Math.max(0, account.tierPoints + tierDelta);
  const newTier = calculateTier(tierPoints);
  if (delta || tierDelta) {
    // A refund after redemption creates a negative balance, not free miles.
    // Redemption already requires a sufficient positive balance.
    await tx
      .update(loyaltyAccounts)
      .set({
        currentMilesBalance: newBalance,
        totalMilesEarned: Math.max(0, account.totalMilesEarned + delta),
        tierPoints,
        tier: newTier,
        lastActivityAt: new Date(),
      })
      .where(eq(loyaltyAccounts.id, account.id));
    await tx
      .update(bookingLoyaltyAccruals)
      .set({ awardedMiles: target, awardedTierPoints: baseMiles })
      .where(eq(bookingLoyaltyAccruals.bookingId, bookingId));
  }
  return {
    milesEarned: Math.max(0, delta),
    milesReversed: Math.max(0, -delta),
    baseMiles,
    bonusMiles: target - baseMiles,
    newBalance,
    newTier,
    tierUpgraded: tierPoints > account.tierPoints && newTier !== account.tier,
  };
}
export async function awardMilesForBooking(
  userId: number,
  bookingId: number,
  _flightId: number,
  _amountPaid: number
) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(tx => syncBookingMiles(tx, bookingId, userId));
}

/**
 * Redeem miles for discount
 */
export async function redeemMiles(
  userId: number,
  milesToRedeem: number,
  bookingId: number | undefined,
  mfaToken: string | undefined,
  idempotencyKey: string
): Promise<{ discountAmount: number; newBalance: number }> {
  requireMiles(milesToRedeem);
  try {
    // Use a transaction to prevent race conditions on balance updates
    const redeem = async (tx: SettlementTx) => {
      if (!(await consumeActionTotp(tx, userId, mfaToken, "if-enrolled")))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A fresh authenticator code is required to redeem miles",
        });
      if (bookingId !== undefined) {
        const [owned] = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)))
          .limit(1)
          .for("update");
        if (!owned)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found",
          });
      }
      const state = await lockMilesState(tx, userId);
      await expireMilesLots(tx, state);
      const originalLots = state.lots.map(lot => ({ ...lot }));
      let movementId = 0;
      const newBalance = await spendMiles(tx, state, milesToRedeem, {
        type: "redeem",
        bookingId,
        reason: "Miles redeemed for discount",
        onDebit: id => {
          movementId = id;
        },
      });
      // 1 mile = 1 cent. The value must exist somewhere the customer can
      // spend it: a booking credit lot in the same transaction as the miles
      // debit. Until this was added the miles were debited and nothing was
      // granted. The lot follows the ordinary credit rules at checkout.
      const discountAmount = milesToRedeem;
      const expiresAt = new Date();
      expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
      const [createdCredit] = await tx.insert(userCredits).values({
        userId,
        amount: discountAmount,
        source: "bonus",
        description: `Redeemed ${milesToRedeem} miles`,
        expiresAt,
        bookingId: bookingId ?? null,
        createdBy: null,
        usedAmount: 0,
      });
      for (const [index, lot] of state.lots.entries())
        await recordLotMovement(
          tx,
          userId,
          originalLots[index],
          lot,
          movementId,
          { type: "redeem", creditId: createdCredit.insertId }
        );
      return {
        discountAmount,
        newBalance,
      };
    };
    return await withTransactionalIdempotency({
      scope: "loyalty.redeem",
      key: idempotencyKey,
      userId,
      request: { milesToRedeem, bookingId },
      run: redeem,
    });
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error redeeming miles:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to redeem miles",
    });
  }
}

/**
 * Get user's miles transactions history
 */
export async function getMilesTransactions(
  userId: number,
  limit: number = 50,
  offset: number = 0
) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const transactions = await database
      .select()
      .from(milesTransactions)
      .where(eq(milesTransactions.userId, userId))
      .orderBy(desc(milesTransactions.createdAt), desc(milesTransactions.id))
      .limit(limit)
      .offset(offset);

    return transactions;
  } catch (error) {
    console.error("Error getting miles transactions:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get miles transactions",
    });
  }
}

/**
 * Get loyalty account details
 */
export async function getLoyaltyAccountDetails(userId: number) {
  try {
    const account = await getOrCreateLoyaltyAccount(userId);

    // Calculate points needed for next tier
    let nextTier: string | null = null;
    let pointsToNextTier: number | null = null;

    if (account.tier === "bronze") {
      nextTier = "silver";
      pointsToNextTier = TIER_THRESHOLDS.silver - account.tierPoints;
    } else if (account.tier === "silver") {
      nextTier = "gold";
      pointsToNextTier = TIER_THRESHOLDS.gold - account.tierPoints;
    } else if (account.tier === "gold") {
      nextTier = "platinum";
      pointsToNextTier = TIER_THRESHOLDS.platinum - account.tierPoints;
    }

    return {
      ...account,
      nextTier,
      pointsToNextTier,
      tierMultiplier: TIER_MULTIPLIERS[account.tier],
      milesValue: (account.currentMilesBalance / 100).toFixed(2), // in SAR
    };
  } catch (error) {
    console.error("Error getting loyalty account details:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get loyalty account details",
    });
  }
}

/**
 * Process expired miles (run daily via cron job)
 * Expires miles older than 2 years and updates account balances
 */
export async function processExpiredMiles(): Promise<{
  processedAccounts: number;
  totalExpiredMiles: number;
}> {
  const database = getDb();
  if (!database) throw new Error("Database unavailable for miles expiration");
  const accounts = await database
    .select({ userId: loyaltyAccounts.userId })
    .from(loyaltyAccounts);
  let processedAccounts = 0,
    totalExpiredMiles = 0;
  const failures: unknown[] = [];
  const failedUsers: number[] = [];
  for (const account of accounts) {
    try {
      const expired = await database.transaction(async tx => {
        const state = await lockMilesState(tx, account.userId);
        return await expireMilesLots(tx, state);
      });
      if (expired) processedAccounts++;
      totalExpiredMiles += expired;
    } catch (error) {
      failedUsers.push(account.userId);
      failures.push(
        new Error(`Miles expiration failed for user ${account.userId}`, {
          cause: error,
        })
      );
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `Loyalty expiration incomplete for ${failures.length} accounts; user IDs: ${failedUsers.slice(0, 20).join(", ")}${failedUsers.length > 20 ? " (first 20)" : ""}`
    );
  return { processedAccounts, totalExpiredMiles };
}

/**
 * Reverse miles for cancelled/refunded booking
 */
export async function reverseMilesForBooking(
  userId: number,
  bookingId: number,
  _reason = "Booking cancelled"
): Promise<{ milesReversed: number }> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.transaction(tx =>
    syncBookingMiles(tx, bookingId, userId)
  );
  return { milesReversed: result.milesReversed };
}

/**
 * Award bonus miles (admin function)
 */
export async function awardBonusMiles(
  userId: number,
  miles: number,
  reason: string
): Promise<{ newBalance: number }> {
  requireMiles(miles);
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    // Ensure account exists
    await getOrCreateLoyaltyAccount(userId);

    // Use a transaction to prevent race conditions on balance updates
    return await database.transaction(async tx => {
      const state = await lockMilesState(tx, userId);
      await expireMilesLots(tx, state);
      const account = state.account;
      const [owner] = await tx
        .select({ tenantId: users.tenantId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const now = new Date();
      const policy = await findApprovedLoyaltyPolicy(
        tx,
        owner?.tenantId ?? null,
        now
      );
      const expiry = resolveMilesExpiry(policy, now, now);
      if (policy?.expiryMode === "activity" && expiry)
        rebaseMilesExpiry(state, expiry);
      const newBalance = await creditMiles(tx, state, {
        amount: miles,
        type: "bonus",
        reason,
        expiresAt: expiry,
      });

      // Update account
      await tx
        .update(loyaltyAccounts)
        .set({
          currentMilesBalance: newBalance,
          totalMilesEarned: account.totalMilesEarned + miles,
          lastActivityAt: new Date(),
        })
        .where(eq(loyaltyAccounts.userId, userId));

      console.info(
        `[Loyalty] Awarded ${miles} bonus miles to user ${userId}: ${reason}`
      );

      return { newBalance };
    });
  } catch (error) {
    console.error("Error awarding bonus miles:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to award bonus miles",
    });
  }
}
