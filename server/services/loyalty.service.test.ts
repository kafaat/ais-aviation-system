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

vi.mock("./cache.service", () => ({
  cacheService: { isConnected: () => false },
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
      mfa_settings: [],
      loyalty_program_rules: [],
      loyalty_valuations: [],
      financial_ledger: [],
      security_events: [],
      loyalty_accounts: [{ ...account, creditLotsInitializedAt: new Date() }],
      loyalty_credit_lots:
        account.currentMilesBalance > 0
          ? [
              {
                transactionId: 900,
                loyaltyAccountId: account.id,
                bookingId: null,
                creditedMiles: account.currentMilesBalance,
                remainingMiles: account.currentMilesBalance,
                spentMiles: 0,
                expiredMiles: 0,
                reversedMiles: 0,
                expiresAt: new Date(Date.now() + 86400000),
              },
            ]
          : [],
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
    return fixture;
  }
  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb._reset();
    vi.mocked(getDb).mockReturnValue(
      mockDb as unknown as ReturnType<typeof getDb>
    );
    // The redemption velocity counter is process-wide; start each case clean.
    const { rateLimitService } = await import("./rate-limit.service");
    await rateLimitService.resetRateLimit(
      `user:${testUserId}`,
      "loyalty-redeem"
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

    const fixture = funded(accountWithMiles, testBookingId, 10000);

    const { redeemMiles } = await import("./loyalty.service");
    const result = await redeemMiles(testUserId, milesToRedeem);

    // 1 mile = 1 cent = 0.01 SAR
    expect(result.discountAmount).toBe(1000); // 10 SAR in cents
    expect(result.newBalance).toBe(10500);
    // The value exists as a spendable credit lot, written in the same
    // transaction as the miles debit; redeeming used to burn the miles only.
    expect(fixture.rows("user_credits")).toMatchObject([
      {
        userId: testUserId,
        amount: 1000,
        source: "bonus",
        usedAmount: 0,
        description: "Redeemed 1000 miles",
      },
    ]);
    expect(fixture.rows("user_credits")[0].expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 360 * 86400000
    );
  });

  it("consumes a fresh enrolled factor atomically with the miles debit", async () => {
    const { redeemMiles } = await import("./loyalty.service");
    const { encryptSecret } = await import("./mfa.service");
    const fixture = funded(
      { ...baseBronzeAccount, currentMilesBalance: 500 },
      testBookingId,
      1000
    );
    // RFC 6238 SHA-1 vector at 59 seconds, truncated to the configured six digits.
    const clock = vi.spyOn(Date, "now").mockReturnValue(59_000);
    fixture.rows("mfa_settings").push({
      userId: testUserId,
      isEnabled: true,
      lastUsedStep: null,
      secret: encryptSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"),
    });
    try {
      await expect(redeemMiles(testUserId, 100)).rejects.toThrow(
        "authenticator code"
      );
      await expect(
        redeemMiles(testUserId, 100, undefined, "000000")
      ).rejects.toThrow("authenticator code");
      await expect(
        redeemMiles(testUserId, 501, undefined, "287082")
      ).rejects.toThrow("Insufficient miles");
      expect(fixture.rows("mfa_settings")[0].lastUsedStep).toBeNull();
      await expect(
        redeemMiles(testUserId, 100, undefined, "287082")
      ).resolves.toMatchObject({ newBalance: 400 });
      await expect(
        redeemMiles(testUserId, 100, undefined, "287082")
      ).rejects.toThrow("authenticator code");
      expect(fixture.rows("user_credits")).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("rejects a foreign booking before recording credit or a miles debit", async () => {
    const { redeemMiles } = await import("./loyalty.service");
    const fixture = funded(
      { ...baseBronzeAccount, currentMilesBalance: 500 },
      testBookingId,
      1000
    );
    fixture.rows("bookings")[0].userId++;
    await expect(redeemMiles(testUserId, 100, testBookingId)).rejects.toThrow(
      "Booking not found"
    );
    expect(fixture.rows("user_credits")).toHaveLength(0);
    expect(fixture.rows("loyalty_accounts")[0].currentMilesBalance).toBe(500);
  });

  it("should throw error when redeeming more miles than available", async () => {
    const accountWithMiles = {
      ...baseBronzeAccount,
      currentMilesBalance: 10000,
    };

    funded(accountWithMiles, testBookingId, 10000);

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

  describe("programme rules: earning basis", () => {
    const revenueRule = {
      id: 1,
      name: "revenue-based",
      effectiveFrom: new Date("2020-01-01T00:00:00Z"),
      effectiveTo: null,
      status: "active",
      earningBasis: "revenue_base_fare",
      milesPerSar: "1.00",
      baseFareShareBps: 10000,
      expiryMode: "fixed_from_earn",
      expiryMonths: 24,
      expiryNoticeDays: "60,30",
      tierQualificationMonths: null,
      redemptionCoolingOffHours: 24,
      redemptionVelocityPerDay: 5,
      profileChangeVelocityPerDay: 3,
      approvedBy: null,
      createdBy: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("revenue-based earning at 1 mile/SAR over the whole fare matches the legacy basis", async () => {
      const amountPaid = 123_456; // 1,234.56 SAR
      const legacy = funded(
        { ...baseBronzeAccount },
        testBookingId,
        amountPaid
      );
      const { awardMilesForBooking } = await import("./loyalty.service");
      const legacyResult = await awardMilesForBooking(
        testUserId,
        testBookingId,
        testFlightId,
        amountPaid
      );
      const revenue = funded(
        { ...baseBronzeAccount },
        testBookingId,
        amountPaid
      );
      revenue.rows("loyalty_program_rules").push({ ...revenueRule });
      const revenueResult = await awardMilesForBooking(
        testUserId,
        testBookingId,
        testFlightId,
        amountPaid
      );
      expect(legacyResult.baseMiles).toBe(1234);
      expect(revenueResult.baseMiles).toBe(legacyResult.baseMiles);
      expect(revenueResult.milesEarned).toBe(legacyResult.milesEarned);
      expect(legacy.rows("loyalty_credit_lots")[0].expiresAt).toBeInstanceOf(
        Date
      );
    });

    it("revenue-based earning uses the base-fare share and configured rate", async () => {
      const fixture = funded({ ...baseBronzeAccount }, testBookingId, 100_000);
      // 85% base fare (15% VAT) at 1.5 miles per SAR: floor(850 x 1.5) = 1275.
      fixture.rows("loyalty_program_rules").push({
        ...revenueRule,
        baseFareShareBps: 8500,
        milesPerSar: "1.50",
        expiryMode: "activity",
      });
      const { awardMilesForBooking } = await import("./loyalty.service");
      const result = await awardMilesForBooking(
        testUserId,
        testBookingId,
        testFlightId,
        100_000
      );
      expect(result.baseMiles).toBe(1275);
      expect(result.milesEarned).toBe(1275);
      // Activity-based programmes do not stamp a per-lot expiry.
      expect(fixture.rows("loyalty_credit_lots")[0].expiresAt).toBeNull();
      // Issuance posted a contract-liability deferral (default 1 halala/mile).
      expect(fixture.rows("financial_ledger")).toMatchObject([
        { type: "loyalty_deferral", amount: "12.75", userId: testUserId },
      ]);
    });

    it("rolls the tier qualification window and holds the earned tier through the next window", async () => {
      const fixture = funded(
        {
          ...baseBronzeAccount,
          tier: "silver" as const,
          tierPoints: 12_000,
          currentMilesBalance: 100,
          totalMilesEarned: 100,
        },
        testBookingId,
        50_000
      );
      fixture.rows("loyalty_accounts")[0].tierPeriodStartedAt = new Date(
        Date.now() - 400 * 86_400_000
      );
      fixture.rows("loyalty_program_rules").push({
        ...revenueRule,
        earningBasis: "legacy_spend",
        tierQualificationMonths: 12,
      });
      const { awardMilesForBooking } = await import("./loyalty.service");
      const result = await awardMilesForBooking(
        testUserId,
        testBookingId,
        testFlightId,
        50_000
      );
      const account = fixture.rows("loyalty_accounts")[0];
      // Points reset to the new window's 500; silver is retained.
      expect(account.tierPoints).toBe(500);
      expect(result.newTier).toBe("silver");
      expect(account.tierPeriodStartedAt.getTime()).toBeGreaterThan(
        Date.now() - 40 * 86_400_000
      );
    });
  });

  describe("account-takeover controls on redemption", () => {
    it("pauses redemption during the cooling-off period after a credential change and audits the block", async () => {
      const fixture = funded(
        { ...baseBronzeAccount, currentMilesBalance: 5000 },
        testBookingId,
        1000
      );
      fixture.rows("security_events").push({
        id: 1,
        eventType: "mfa_disabled",
        severity: "medium",
        userId: testUserId,
        createdAt: new Date(Date.now() - 2 * 3_600_000),
      });
      const { redeemMiles } = await import("./loyalty.service");
      await expect(
        redeemMiles(testUserId, 100, undefined, undefined, {
          ipAddress: "203.0.113.9",
          userAgent: "vitest",
          deviceId: "dev-1",
        })
      ).rejects.toThrow("paused for 24 hours");
      expect(fixture.rows("loyalty_accounts")[0].currentMilesBalance).toBe(
        5000
      );
      expect(fixture.rows("user_credits")).toHaveLength(0);
      const blocked = fixture
        .rows("security_events")
        .find(e => e.eventType === "loyalty_redemption_blocked");
      expect(blocked).toMatchObject({
        userId: testUserId,
        ipAddress: "203.0.113.9",
        actionTaken: "denied",
      });
      expect(JSON.parse(blocked.metadata)).toMatchObject({
        miles: 100,
        deviceId: "dev-1",
        reason: "cooling_off",
      });

      // A change older than the window no longer blocks; the redemption is audited.
      fixture.rows("security_events")[0].createdAt = new Date(
        Date.now() - 25 * 3_600_000
      );
      await expect(
        redeemMiles(testUserId, 100, undefined, undefined, {
          ipAddress: "203.0.113.9",
          userAgent: "vitest",
        })
      ).resolves.toMatchObject({ newBalance: 4900 });
      expect(
        fixture
          .rows("security_events")
          .filter(e => e.eventType === "loyalty_redemption")
      ).toMatchObject([{ userId: testUserId, ipAddress: "203.0.113.9" }]);
    });

    it("enforces the per-day redemption velocity from the programme rule", async () => {
      const fixture = funded(
        { ...baseBronzeAccount, currentMilesBalance: 5000 },
        testBookingId,
        1000
      );
      fixture.rows("loyalty_program_rules").push({
        id: 1,
        name: "tight",
        effectiveFrom: new Date("2020-01-01T00:00:00Z"),
        effectiveTo: null,
        status: "active",
        earningBasis: "legacy_spend",
        milesPerSar: "1.00",
        baseFareShareBps: 10000,
        expiryMode: "fixed_from_earn",
        expiryMonths: 24,
        expiryNoticeDays: "60,30",
        tierQualificationMonths: null,
        redemptionCoolingOffHours: 0,
        redemptionVelocityPerDay: 2,
        profileChangeVelocityPerDay: 3,
        approvedBy: null,
        createdBy: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const { redeemMiles } = await import("./loyalty.service");
      await expect(redeemMiles(testUserId, 100)).resolves.toBeDefined();
      await expect(redeemMiles(testUserId, 100)).resolves.toBeDefined();
      await expect(redeemMiles(testUserId, 100)).rejects.toThrow(
        "Redemption limit of 2 per day"
      );
      expect(fixture.rows("loyalty_accounts")[0].currentMilesBalance).toBe(
        4800
      );
      expect(
        fixture
          .rows("security_events")
          .filter(e => e.eventType === "loyalty_redemption_blocked")
      ).toHaveLength(1);
    });
  });
});
