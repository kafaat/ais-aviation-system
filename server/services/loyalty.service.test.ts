/**
 * Loyalty Service Tests
 *
 * Uses mocked database to test loyalty business logic
 * without requiring a live database connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import { getDb } from "../db";

// Create mock database with chainable methods
const createMockDb = () => {
  const results: unknown[][] = [];
  let callIndex = 0;

  const mockDb = {
    _setResults: (...data: unknown[][]) => {
      results.length = 0;
      results.push(...data);
      callIndex = 0;
    },
    _reset: () => {
      callIndex = 0;
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => ({
      ...mockDb,
      then: (resolve: (v: unknown) => void) => {
        const result = results[callIndex++] ?? [];
        resolve(result);
      },
      limit: vi.fn().mockImplementation(() => ({
        for() {
          return this;
        },
        then: (resolve: (v: unknown) => void) => {
          const result = results[callIndex++] ?? [];
          resolve(result);
        },
      })),
      orderBy: vi.fn().mockReturnThis(),
    })),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => ({
      for() {
        return this;
      },
      then: (resolve: (v: unknown) => void) => {
        const result = results[callIndex++] ?? [];
        resolve(result);
      },
    })),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockImplementation(() => ({
      onDuplicateKeyUpdate() {
        return this;
      },
      then: (resolve: (v: unknown) => void) => {
        const result = results[callIndex++] ?? [{ insertId: 1 }];
        resolve(result);
      },
    })),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi
      .fn()
      .mockImplementation((fn: (tx: typeof mockDb) => Promise<unknown>) =>
        fn(mockDb)
      ),
  };

  return mockDb;
};

const mockDb = createMockDb();

// Mock modules before any imports
vi.mock("../db", () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock("@trpc/server", () => ({
  TRPCError: class TRPCError extends Error {
    code: string;
    constructor({ code, message }: { code: string; message: string }) {
      super(message);
      this.code = code;
    }
  },
}));

describe("Loyalty Service", () => {
  const testUserId = 999999;
  const testBookingId = 888888;
  const testFlightId = 777777;

  const baseBronzeAccount = {
    id: 1,
    userId: testUserId,
    totalMilesEarned: 0,
    currentMilesBalance: 0,
    milesRedeemed: 0,
    tier: "bronze" as const,
    tierPoints: 0,
    lastActivityAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function funded(
    account:
      | typeof baseBronzeAccount
      | (Omit<typeof baseBronzeAccount, "tier"> & { tier: "silver" }),
    bookingId: number,
    amount: number
  ) {
    const fixture = transactionMemory({
      loyalty_accounts: [account],
      bookings: [
        {
          id: bookingId,
          userId: testUserId,
          flightId: testFlightId,
          status: "confirmed",
          paymentStatus: "paid",
          totalAmount: amount,
        },
      ],
      payment_receipts: [
        {
          paymentIntentId: "pi_loyalty_fixture",
          bookingId,
          userId: testUserId,
          kind: "booking",
          amount,
          refundedAmount: 0,
          currency: "SAR",
          settlementStatus: "applied",
        },
      ],
    });
    vi.mocked(getDb).mockReturnValue(fixture.db);
  }
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._reset();
    vi.mocked(getDb).mockReturnValue(
      mockDb as unknown as ReturnType<typeof getDb>
    );
  });

  it("should create a new loyalty account for a user", async () => {
    const newAccount = { ...baseBronzeAccount };

    mockDb._setResults(
      [], // select existing account - none found
      [{ insertId: 1 }], // insert new account
      [newAccount] // select newly created account
    );

    const { getOrCreateLoyaltyAccount } = await import("./loyalty.service");
    const account = await getOrCreateLoyaltyAccount(testUserId);

    expect(account).toBeDefined();
    expect(account.userId).toBe(testUserId);
    expect(account.tier).toBe("bronze");
    expect(account.currentMilesBalance).toBe(0);
    expect(account.totalMilesEarned).toBe(0);
  });

  it("should return existing loyalty account", async () => {
    const existingAccount = { ...baseBronzeAccount };

    mockDb._setResults(
      [existingAccount], // first call: account found
      [existingAccount] // second call: account found
    );

    const { getOrCreateLoyaltyAccount } = await import("./loyalty.service");
    const account1 = await getOrCreateLoyaltyAccount(testUserId);
    const account2 = await getOrCreateLoyaltyAccount(testUserId);

    expect(account1.id).toBe(account2.id);
  });

  it("should award miles for a booking (bronze tier)", async () => {
    const bronzeAccount = { ...baseBronzeAccount };
    const amountPaid = 50000; // 500 SAR in cents

    funded(bronzeAccount, testBookingId, amountPaid);

    const { awardMilesForBooking } = await import("./loyalty.service");
    const result = await awardMilesForBooking(
      testUserId,
      testBookingId,
      testFlightId,
      amountPaid
    );

    // Bronze tier: 1x multiplier, 500 SAR = 500 base miles
    expect(result.baseMiles).toBe(500);
    expect(result.milesEarned).toBe(500);
    expect(result.bonusMiles).toBe(0);
    expect(result.newBalance).toBe(500);
    expect(result.newTier).toBe("bronze");
    expect(result.tierUpgraded).toBe(false);
  });

  it("should upgrade tier when threshold is reached", async () => {
    // Account with 500 existing tierPoints from previous booking
    const bronzeAccountWithPoints = {
      ...baseBronzeAccount,
      tierPoints: 500,
      currentMilesBalance: 500,
      totalMilesEarned: 500,
    };

    const amountPaid = 1000000; // 10,000 SAR in cents

    funded(bronzeAccountWithPoints, testBookingId + 1, amountPaid);

    const { awardMilesForBooking } = await import("./loyalty.service");
    const result = await awardMilesForBooking(
      testUserId,
      testBookingId + 1,
      testFlightId,
      amountPaid
    );

    // tierPoints: 500 + 10000 = 10500 >= 10000 → silver
    expect(result.newTier).toBe("silver");
    expect(result.tierUpgraded).toBe(true);
  });

  it("should apply tier multiplier for silver tier", async () => {
    const silverAccount = {
      ...baseBronzeAccount,
      tier: "silver" as const,
      tierPoints: 10500,
      currentMilesBalance: 11000,
      totalMilesEarned: 11000,
    };

    const amountPaid = 40000; // 400 SAR in cents

    funded(silverAccount, testBookingId + 2, amountPaid);

    const { awardMilesForBooking } = await import("./loyalty.service");
    const result = await awardMilesForBooking(
      testUserId,
      testBookingId + 2,
      testFlightId,
      amountPaid
    );

    // Silver tier: 1.25x multiplier
    // 400 SAR = 400 base miles x 1.25 = 500 total miles
    expect(result.baseMiles).toBe(400);
    expect(result.milesEarned).toBe(500);
    expect(result.bonusMiles).toBe(100);
  });

  it("should redeem miles for discount", async () => {
    const accountWithMiles = {
      ...baseBronzeAccount,
      tier: "silver" as const,
      currentMilesBalance: 11500,
      totalMilesEarned: 11500,
      milesRedeemed: 0,
    };

    const milesToRedeem = 1000;

    mockDb._setResults(
      [accountWithMiles], // tx: select account inside transaction
      [], // tx: no previous earning for this booking
      [], // tx: update account
      [{ insertId: 4 }] // tx: insert redemption transaction
    );

    const { redeemMiles } = await import("./loyalty.service");
    const result = await redeemMiles(testUserId, milesToRedeem);

    // 1 mile = 1 cent = 0.01 SAR
    expect(result.discountAmount).toBe(1000); // 10 SAR in cents
    expect(result.newBalance).toBe(10500);
  });

  it("should throw error when redeeming more miles than available", async () => {
    const accountWithMiles = {
      ...baseBronzeAccount,
      currentMilesBalance: 10000,
    };

    mockDb._setResults(
      [accountWithMiles] // tx: select account inside transaction (will throw insufficient)
    );

    const { redeemMiles } = await import("./loyalty.service");
    await expect(redeemMiles(testUserId, 999999999)).rejects.toThrow(
      "Insufficient miles balance"
    );
  });

  it("should get loyalty account details with next tier info", async () => {
    const silverAccount = {
      ...baseBronzeAccount,
      tier: "silver" as const,
      tierPoints: 10500,
      currentMilesBalance: 10500,
      totalMilesEarned: 11500,
    };

    mockDb._setResults(
      [silverAccount] // getOrCreateLoyaltyAccount: select
    );

    const { getLoyaltyAccountDetails } = await import("./loyalty.service");
    const details = await getLoyaltyAccountDetails(testUserId);

    expect(details).toBeDefined();
    expect(details.userId).toBe(testUserId);
    expect(details.tier).toBe("silver");
    expect(details.nextTier).toBe("gold");
    expect(details.pointsToNextTier).toBeGreaterThan(0);
    expect(details.tierMultiplier).toBe(1.25);
  });
});
