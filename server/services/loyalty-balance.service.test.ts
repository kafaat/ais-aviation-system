import { describe, expect, it } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import {
  creditMiles,
  expireMilesLots,
  lockMilesState,
  reconstructMilesLots,
  reverseBookingMilesCredit,
  spendMiles,
} from "./loyalty-balance.service";
import type { loyaltyAccounts, milesTransactions } from "../../drizzle/schema";
const now = new Date("2030-01-01T00:00:00Z");
const future = new Date("2032-01-01T00:00:00Z");
const account = {
  id: 1,
  userId: 7,
  currentMilesBalance: 0,
  totalMilesEarned: 0,
  milesRedeemed: 0,
  tier: "bronze",
  tierPoints: 0,
  memberSince: now,
  lastActivityAt: now,
  createdAt: now,
  updatedAt: now,
  creditLotsInitializedAt: now,
} satisfies typeof loyaltyAccounts.$inferSelect;
const fixture = () =>
  transactionMemory({
    loyalty_accounts: [{ ...account }],
    loyalty_credit_lots: [],
    miles_transactions: [],
  });

describe("miles conservation through spending, expiry and refunds", () => {
  it("expires unused credit once and cannot consume a later bonus on replay", async () => {
    const f = fixture();
    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      await creditMiles(tx, state, {
        amount: 100,
        type: "bonus",
        reason: "Fixture bonus",
        expiresAt: now,
      });
      expect(await expireMilesLots(tx, state, now)).toBe(100);
      await creditMiles(tx, state, {
        amount: 50,
        type: "bonus",
        reason: "New bonus",
        expiresAt: future,
      });
    });
    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      expect(await expireMilesLots(tx, state, now)).toBe(0);
      expect(state.account.currentMilesBalance).toBe(50);
    });
    expect(
      f.rows("miles_transactions").filter(r => r.type === "expire")
    ).toHaveLength(1);
  });

  it("a refund after partial spending and expiry only recovers the spent miles", async () => {
    const f = fixture();
    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      await creditMiles(tx, state, {
        amount: 100,
        type: "earn",
        bookingId: 8,
        reason: "Booking",
        expiresAt: now,
      });
      await spendMiles(tx, state, 40, {
        type: "redeem",
        reason: "Spend before expiry",
      });
      expect(await expireMilesLots(tx, state, now)).toBe(60);
      expect(await reverseBookingMilesCredit(tx, state, 8, 100)).toBe(40);
      expect(state.account.currentMilesBalance).toBe(-40);
      expect(state.account.milesRedeemed).toBe(40);
      await creditMiles(tx, state, {
        amount: 70,
        type: "bonus",
        reason: "Later bonus repays debt",
        expiresAt: future,
      });
      expect(state.account.currentMilesBalance).toBe(30);
      expect(await expireMilesLots(tx, state, future)).toBe(30);
      expect(state.account.currentMilesBalance).toBe(0);
    });
    expect(f.rows("miles_transactions").reduce((n, t) => n + t.amount, 0)).toBe(
      0
    );
  });

  it("recovers refunded spent credit from other available lots without double spending them", async () => {
    const f = fixture();
    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      await creditMiles(tx, state, {
        amount: 100,
        type: "earn",
        bookingId: 8,
        reason: "First",
        expiresAt: future,
      });
      await spendMiles(tx, state, 100, { type: "redeem", reason: "Spend" });
      await creditMiles(tx, state, {
        amount: 100,
        type: "earn",
        bookingId: 9,
        reason: "Second",
        expiresAt: future,
      });
      await reverseBookingMilesCredit(tx, state, 8, 100);
      expect(state.account.currentMilesBalance).toBe(0);
      await expect(
        spendMiles(tx, state, 1, {
          type: "redeem",
          reason: "Cannot spend recovered credit",
        })
      ).rejects.toThrow("Insufficient");
      await reverseBookingMilesCredit(tx, state, 9, 100);
      expect(state.account.currentMilesBalance).toBe(-100);
    });
  });

  it("rolls back both lot and account when expiration receipt cannot be saved", async () => {
    const f = fixture();
    await f.db.transaction(async tx =>
      creditMiles(tx, await lockMilesState(tx, 7), {
        amount: 100,
        type: "bonus",
        reason: "Bonus",
        expiresAt: now,
      })
    );
    f.failInsert("miles_transactions");
    await expect(
      f.db.transaction(async tx =>
        expireMilesLots(tx, await lockMilesState(tx, 7), now)
      )
    ).rejects.toThrow();
    expect(f.rows("loyalty_accounts")[0].currentMilesBalance).toBe(100);
    expect(f.rows("loyalty_credit_lots")[0].remainingMiles).toBe(100);
  });

  const legacyCredit: typeof milesTransactions.$inferSelect = {
    id: 1,
    userId: 7,
    loyaltyAccountId: 1,
    type: "earn",
    amount: 100,
    balanceAfter: 100,
    bookingId: 8,
    flightId: null,
    description: "Legacy earning",
    reason: null,
    expiresAt: future,
    createdAt: now,
  };
  it("adopts proven historical credit without changing an account's balance", () => {
    const state = reconstructMilesLots(
      { ...account, creditLotsInitializedAt: null, currentMilesBalance: 60 },
      [
        legacyCredit,
        {
          ...legacyCredit,
          id: 2,
          bookingId: null,
          type: "redeem",
          amount: -40,
          balanceAfter: 60,
        },
      ]
    );
    expect(state.account.currentMilesBalance).toBe(60);
    expect(state.lots[0]).toMatchObject({ remainingMiles: 60, spentMiles: 40 });
  });
  it("rejects unrecorded family deductions and repeated historical expirations", () => {
    expect(() =>
      reconstructMilesLots({ ...account, currentMilesBalance: 60 }, [
        legacyCredit,
      ])
    ).toThrow("reconciliation");
    const expiration = {
      ...legacyCredit,
      id: 2,
      type: "expire" as const,
      amount: -100,
      balanceAfter: 0,
      createdAt: future,
    };
    expect(() =>
      reconstructMilesLots(account, [
        legacyCredit,
        expiration,
        { ...expiration, id: 3, balanceAfter: -100 },
      ])
    ).toThrow("reconciliation");
  });
});
