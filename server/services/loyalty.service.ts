import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { loyaltyAccounts, milesTransactions } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

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
    const [result] = await database.insert(loyaltyAccounts).values({
      userId,
      totalMilesEarned: 0,
      currentMilesBalance: 0,
      milesRedeemed: 0,
      tier: "bronze",
      tierPoints: 0,
    });

    const [newAccount] = await database
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.id, (result as any).insertId))
      .limit(1);

    return newAccount!;
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
export async function awardMilesForBooking(
  userId: number,
  bookingId: number,
  flightId: number,
  amountPaid: number // in cents
) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get or create loyalty account
    const account = await getOrCreateLoyaltyAccount(userId);

    // Calculate base miles (1 mile per SAR)
    const amountInSAR = amountPaid / 100;
    const baseMiles = Math.floor(amountInSAR * MILES_PER_SAR);

    // Apply tier multiplier
    const multiplier = TIER_MULTIPLIERS[account.tier];
    const totalMiles = Math.floor(baseMiles * multiplier);

    // Calculate tier points (same as base miles)
    const tierPoints = baseMiles;

    // Update account
    const newTotalEarned = account.totalMilesEarned + totalMiles;
    const newBalance = account.currentMilesBalance + totalMiles;
    const newTierPoints = account.tierPoints + tierPoints;
    const newTier = calculateTier(newTierPoints);

    await database
      .update(loyaltyAccounts)
      .set({
        totalMilesEarned: newTotalEarned,
        currentMilesBalance: newBalance,
        tierPoints: newTierPoints,
        tier: newTier,
        lastActivityAt: new Date(),
      })
      .where(eq(loyaltyAccounts.id, account.id));

    // Record transaction
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 2); // Miles expire in 2 years

    await database.insert(milesTransactions).values({
      userId,
      loyaltyAccountId: account.id,
      type: "earn",
      amount: totalMiles,
      balanceAfter: newBalance,
      bookingId,
      flightId,
      description: `Earned ${totalMiles} miles from booking`,
      reason: `Base: ${baseMiles} miles × ${multiplier}x (${account.tier} tier)`,
      expiresAt: expiryDate,
    });

    return {
      milesEarned: totalMiles,
      baseMiles,
      bonusMiles: totalMiles - baseMiles,
      newBalance,
      newTier,
      tierUpgraded: newTier !== account.tier,
    };
  } catch (error) {
    console.error("Error awarding miles:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to award miles",
    });
  }
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

    // Get loyalty account
    const account = await getOrCreateLoyaltyAccount(userId);

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

    await database
      .update(loyaltyAccounts)
      .set({
        currentMilesBalance: newBalance,
        milesRedeemed: newRedeemed,
        lastActivityAt: new Date(),
      })
      .where(eq(loyaltyAccounts.id, account.id));

    // Record transaction
    await database.insert(milesTransactions).values({
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
      // Get unexpired earn transactions that are now expired
      const expiredTransactions = await database
        .select()
        .from(milesTransactions)
        .where(eq(milesTransactions.userId, account.userId));

      // Filter to only expired earn transactions
      const toExpire = expiredTransactions.filter(
        t =>
          t.type === "earn" &&
          t.expiresAt &&
          new Date(t.expiresAt) <= now &&
          t.amount > 0
      );

      if (toExpire.length === 0) continue;

      // Calculate total miles to expire
      const milesToExpire = toExpire.reduce((sum, t) => sum + t.amount, 0);

      if (milesToExpire <= 0) continue;

      // Don't expire more than current balance
      const actualExpireAmount = Math.min(
        milesToExpire,
        account.currentMilesBalance
      );

      if (actualExpireAmount <= 0) continue;

      // Create expiration transaction
      await database.insert(milesTransactions).values({
        userId: account.userId,
        loyaltyAccountId: account.id,
        type: "expire",
        amount: -actualExpireAmount,
        balanceAfter: account.currentMilesBalance - actualExpireAmount,
        description: `انتهاء صلاحية ${actualExpireAmount} ميل - Miles expiration (${toExpire.length} transactions)`,
      });

      // Update account balance
      await database
        .update(loyaltyAccounts)
        .set({
          currentMilesBalance: account.currentMilesBalance - actualExpireAmount,
          lastActivityAt: now,
        })
        .where(eq(loyaltyAccounts.userId, account.userId));

      processedAccounts++;
      totalExpiredMiles += actualExpireAmount;

      console.info(
        `[Loyalty] Expired ${actualExpireAmount} miles for user ${account.userId}`
      );
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
  reason: string = "Booking cancelled"
): Promise<{ milesReversed: number }> {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    // Find original earn transaction for this booking
    const [originalTransaction] = await database
      .select()
      .from(milesTransactions)
      .where(eq(milesTransactions.bookingId, bookingId));

    if (!originalTransaction || originalTransaction.type !== "earn") {
      return { milesReversed: 0 };
    }

    const milesToReverse = originalTransaction.amount;

    // Get current account
    const [account] = await database
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.userId, userId));

    if (!account) {
      return { milesReversed: 0 };
    }

    const newBalance = Math.max(
      0,
      account.currentMilesBalance - milesToReverse
    );

    // Create adjustment transaction
    await database.insert(milesTransactions).values({
      userId,
      loyaltyAccountId: account.id,
      bookingId,
      type: "adjustment",
      amount: -milesToReverse,
      balanceAfter: newBalance,
      description: `استرداد ${milesToReverse} ميل - ${reason}`,
    });

    // Update account
    await database
      .update(loyaltyAccounts)
      .set({
        currentMilesBalance: newBalance,
        milesRedeemed: account.milesRedeemed + milesToReverse,
        lastActivityAt: new Date(),
      })
      .where(eq(loyaltyAccounts.userId, userId));

    console.info(
      `[Loyalty] Reversed ${milesToReverse} miles for user ${userId}, booking ${bookingId}`
    );

    return { milesReversed: milesToReverse };
  } catch (error) {
    console.error("Error reversing miles:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to reverse miles",
    });
  }
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
    const account = await getOrCreateLoyaltyAccount(userId);
    const newBalance = account.currentMilesBalance + miles;

    // Create bonus transaction
    await database.insert(milesTransactions).values({
      userId,
      loyaltyAccountId: account.id,
      type: "bonus",
      amount: miles,
      balanceAfter: newBalance,
      description: `مكافأة: ${reason}`,
      expiresAt: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000), // 2 years
    });

    // Update account
    await database
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
  } catch (error) {
    console.error("Error awarding bonus miles:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to award bonus miles",
    });
  }
}
