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
  const [account] = await tx
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.userId, userId))
    .for("update");
  if (!account) throw new Error("Loyalty account unavailable");
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
  const newBalance = account.currentMilesBalance + delta;
  const tierPoints = Math.max(0, account.tierPoints + tierDelta);
  const newTier = calculateTier(tierPoints);
  if (delta || tierDelta) {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 2);
    if (delta)
      await tx.insert(milesTransactions).values({
        userId,
        loyaltyAccountId: account.id,
        bookingId,
        flightId: booking.flightId,
        type: delta > 0 ? "earn" : "adjustment",
        amount: delta,
        balanceAfter: newBalance,
        description: "Net funded booking accrual",
        reason: `booking-net:${bookingId}`,
        expiresAt: delta > 0 ? expiry : null,
      });
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
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Use a transaction to prevent race conditions on balance updates
    return await database.transaction(async tx => {
      // Read account inside transaction for consistency
      const [account] = await tx
        .select()
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.userId, userId))
        .limit(1);

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Loyalty account not found",
        });
      }

      // Check if user has enough miles
      if (account.currentMilesBalance < milesToRedeem) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Insufficient miles balance",
        });
      }

      // Calculate discount (1 mile = 0.01 SAR = 1 cent)
      const discountAmount = milesToRedeem; // in cents

      // Update account
      const newBalance = account.currentMilesBalance - milesToRedeem;
      const newRedeemed = account.milesRedeemed + milesToRedeem;

      await tx
        .update(loyaltyAccounts)
        .set({
          currentMilesBalance: newBalance,
          milesRedeemed: newRedeemed,
          lastActivityAt: new Date(),
        })
        .where(eq(loyaltyAccounts.id, account.id));

      // Record transaction
      await tx.insert(milesTransactions).values({
        userId,
        loyaltyAccountId: account.id,
        type: "redeem",
        amount: -milesToRedeem,
        balanceAfter: newBalance,
        bookingId,
        description: `Redeemed ${milesToRedeem} miles for ${(discountAmount / 100).toFixed(2)} SAR discount`,
      });

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
  const database = await getDb();
  if (!database) {
    console.error("Database not available for miles expiration");
    return { processedAccounts: 0, totalExpiredMiles: 0 };
  }

  let processedAccounts = 0;
  let totalExpiredMiles = 0;

  try {
    const now = new Date();

    // Get all accounts with balances > 0
    const accounts = await database.select().from(loyaltyAccounts);

    for (const account of accounts) {
      // Process each account in its own transaction to prevent race conditions
      await database.transaction(async tx => {
        // Re-read account inside transaction to get fresh balance
        const [freshAccount] = await tx
          .select()
          .from(loyaltyAccounts)
          .where(eq(loyaltyAccounts.userId, account.userId))
          .limit(1);

        if (!freshAccount || freshAccount.currentMilesBalance <= 0) return;

        // Get expired earn transactions
        const expiredTransactions = await tx
          .select()
          .from(milesTransactions)
          .where(eq(milesTransactions.userId, account.userId));

        const toExpire = expiredTransactions.filter(
          t =>
            t.type === "earn" &&
            t.expiresAt &&
            new Date(t.expiresAt) <= now &&
            t.amount > 0
        );

        if (toExpire.length === 0) return;

        const milesToExpire = toExpire.reduce((sum, t) => sum + t.amount, 0);
        if (milesToExpire <= 0) return;

        // Use fresh balance for calculation
        const actualExpireAmount = Math.min(
          milesToExpire,
          freshAccount.currentMilesBalance
        );
        if (actualExpireAmount <= 0) return;

        // Create expiration transaction record
        await tx.insert(milesTransactions).values({
          userId: account.userId,
          loyaltyAccountId: freshAccount.id,
          type: "expire",
          amount: -actualExpireAmount,
          balanceAfter: freshAccount.currentMilesBalance - actualExpireAmount,
          description: `انتهاء صلاحية ${actualExpireAmount} ميل - Miles expiration (${toExpire.length} transactions)`,
        });

        // Use SQL-level arithmetic to safely update balance
        await tx
          .update(loyaltyAccounts)
          .set({
            currentMilesBalance: sql`GREATEST(${loyaltyAccounts.currentMilesBalance} - ${actualExpireAmount}, 0)`,
            lastActivityAt: now,
          })
          .where(eq(loyaltyAccounts.userId, account.userId));

        processedAccounts++;
        totalExpiredMiles += actualExpireAmount;

        console.info(
          `[Loyalty] Expired ${actualExpireAmount} miles for user ${account.userId}`
        );
      });
    }

    console.info(
      `[Loyalty] Miles expiration completed: ${processedAccounts} accounts, ${totalExpiredMiles} miles expired`
    );

    return { processedAccounts, totalExpiredMiles };
  } catch (error) {
    console.error("Error processing expired miles:", error);
    return { processedAccounts, totalExpiredMiles };
  }
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
      const [account] = await tx
        .select()
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.userId, userId))
        .limit(1);

      if (!account) throw new Error("Loyalty account not found");

      const newBalance = account.currentMilesBalance + miles;

      // Create bonus transaction
      await tx.insert(milesTransactions).values({
        userId,
        loyaltyAccountId: account.id,
        type: "bonus",
        amount: miles,
        balanceAfter: newBalance,
        description: `مكافأة: ${reason}`,
        expiresAt: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000), // 2 years
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
