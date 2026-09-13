import {
  lockMilesState,
  expireMilesLots,
  creditMiles,
  spendMiles,
  reverseBookingMilesCredit,
  requireMiles,
} from "./loyalty-balance.service";
import type { SettlementTx } from "./booking-settlement.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  loyaltyAccounts,
  milesTransactions,
  bookings,
  paymentReceipts,
  walletTransactions,
  bookingLoyaltyAccruals,
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
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 2);
    await creditMiles(tx, state, {
      amount: delta,
      type: "earn",
      bookingId,
      flightId: booking.flightId,
      reason: `booking-net:${bookingId}`,
      expiresAt: expiry,
    });
  } else if (delta < 0)
    await reverseBookingMilesCredit(tx, state, bookingId, -delta);
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
  bookingId?: number
): Promise<{ discountAmount: number; newBalance: number }> {
  requireMiles(milesToRedeem);
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Use a transaction to prevent race conditions on balance updates
    return await database.transaction(async tx => {
      const state = await lockMilesState(tx, userId);
      await expireMilesLots(tx, state);
      const newBalance = await spendMiles(tx, state, milesToRedeem, {
        type: "redeem",
        bookingId,
        reason: "Miles redeemed for discount",
      });
      const discountAmount = milesToRedeem;
      return {
        discountAmount,
        newBalance,
      };
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
export async function getMilesTransactions(userId: number, limit: number = 50) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const transactions = await database
      .select()
      .from(milesTransactions)
      .where(eq(milesTransactions.userId, userId))
      .orderBy(desc(milesTransactions.createdAt))
      .limit(limit);

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
      const newBalance = await creditMiles(tx, state, {
        amount: miles,
        type: "bonus",
        reason,
        expiresAt: new Date(Date.now() + 2 * 365 * 86400000),
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
