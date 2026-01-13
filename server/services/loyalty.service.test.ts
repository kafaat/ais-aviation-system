import { describe, expect, it, afterAll } from "vitest";
import { getDb } from "../db";
import { loyaltyAccounts, milesTransactions } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  getOrCreateLoyaltyAccount,
  awardMilesForBooking,
  redeemMiles,
  getLoyaltyAccountDetails,
} from "./loyalty.service";

describe("Loyalty Service", () => {
  const testUserId = 999999;
  const testBookingId = 888888;
  const testFlightId = 777777;

  afterAll(async () => {
    // Cleanup test data
    const db = await getDb();
    if (db) {
      await db
        .delete(milesTransactions)
        .where(eq(milesTransactions.userId, testUserId));
      await db
        .delete(loyaltyAccounts)
        .where(eq(loyaltyAccounts.userId, testUserId));
    }
  });

  it("should create a new loyalty account for a user", async () => {
    const account = await getOrCreateLoyaltyAccount(testUserId);

    expect(account).toBeDefined();
    expect(account.userId).toBe(testUserId);
    expect(account.tier).toBe("bronze");
    expect(account.currentMilesBalance).toBe(0);
    expect(account.totalMilesEarned).toBe(0);
  });

  it("should return existing loyalty account", async () => {
    const account1 = await getOrCreateLoyaltyAccount(testUserId);
    const account2 = await getOrCreateLoyaltyAccount(testUserId);

    expect(account1.id).toBe(account2.id);
  });

  it("should award miles for a booking (bronze tier)", async () => {
    const amountPaid = 50000; // 500 SAR in cents

    const result = await awardMilesForBooking(
      testUserId,
      testBookingId,
      testFlightId,
      amountPaid
    );

    // Bronze tier: 1x multiplier
    // 500 SAR = 500 base miles
    expect(result.baseMiles).toBe(500);
    expect(result.milesEarned).toBe(500);
    expect(result.bonusMiles).toBe(0);
    expect(result.newBalance).toBe(500);
    expect(result.newTier).toBe("bronze");
    expect(result.tierUpgraded).toBe(false);
  });

  it("should upgrade tier when threshold is reached", async () => {
    // Award enough miles to reach silver tier (10,000 tier points)
    const amountPaid = 1000000; // 10,000 SAR in cents

    const result = await awardMilesForBooking(
      testUserId,
      testBookingId + 1,
      testFlightId,
      amountPaid
    );

    // Should upgrade to silver tier
    expect(result.newTier).toBe("silver");
    expect(result.tierUpgraded).toBe(true);
  });

  it("should apply tier multiplier for silver tier", async () => {
    // Now user is silver tier (1.25x multiplier)
    const amountPaid = 40000; // 400 SAR in cents

    const result = await awardMilesForBooking(
      testUserId,
      testBookingId + 2,
      testFlightId,
      amountPaid
    );

    // Silver tier: 1.25x multiplier
    // 400 SAR = 400 base miles × 1.25 = 500 total miles
    expect(result.baseMiles).toBe(400);
    expect(result.milesEarned).toBe(500);
    expect(result.bonusMiles).toBe(100);
  });

  it("should redeem miles for discount", async () => {
    const milesToRedeem = 1000;

    const result = await redeemMiles(testUserId, milesToRedeem);

    // 1 mile = 1 cent = 0.01 SAR
    expect(result.discountAmount).toBe(1000); // 10 SAR in cents
    expect(result.newBalance).toBeGreaterThan(0);
  });

  it("should throw error when redeeming more miles than available", async () => {
    await expect(redeemMiles(testUserId, 999999999)).rejects.toThrow(
      "Insufficient miles balance"
    );
  });

  it("should get loyalty account details with next tier info", async () => {
    const details = await getLoyaltyAccountDetails(testUserId);

    expect(details).toBeDefined();
    expect(details.userId).toBe(testUserId);
    expect(details.tier).toBe("silver");
    expect(details.nextTier).toBe("gold");
    expect(details.pointsToNextTier).toBeGreaterThan(0);
    expect(details.tierMultiplier).toBe(1.25);
  });
});
