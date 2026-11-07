import { describe, expect, it } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import {
  creditMiles,
  expireMilesLots,
  lockMilesState,
  reverseBookingMilesCredit,
  spendMiles,
} from "./loyalty-balance.service";
import {
  approveValuation,
  createValuation,
  getCurrentValuation,
  getLoyaltyAccountingSummary,
  getLoyaltyLiabilityBalanceMinor,
  lotCarryingMinor,
  DEFAULT_VALUATION,
} from "./loyalty-accounting.service";
import type { loyaltyAccounts } from "../../drizzle/schema";

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
  tierPeriodStartedAt: null,
  memberSince: now,
  lastActivityAt: now,
  createdAt: now,
  updatedAt: now,
  creditLotsInitializedAt: now,
} satisfies typeof loyaltyAccounts.$inferSelect;

/** SSP 2.5 halala per mile, 10% breakage: unit liability 2.25 halala/mile. */
const approvedValuation = {
  id: 11,
  currency: "SAR",
  sspMinorPerMile: "2.5000",
  breakageRatePercent: "10.00",
  // Issuance reads the valuation at the wall clock, so it is dated in the past.
  effectiveFrom: new Date("2020-01-01T00:00:00Z"),
  status: "approved",
  approvedBy: 99,
  approvedAt: new Date("2020-01-01T00:00:00Z"),
  createdBy: 99,
  notes: null,
  createdAt: now,
  updatedAt: now,
};

const fixture = (valuations: unknown[] = [approvedValuation]) =>
  transactionMemory({
    loyalty_accounts: [{ ...account }],
    loyalty_credit_lots: [],
    miles_transactions: [],
    financial_ledger: [],
    loyalty_valuations: valuations,
    loyalty_program_rules: [],
  });

/** The IFRS 15 invariant: carried liability per lot equals the ledger balance. */
async function expectBalanced(f: ReturnType<typeof transactionMemory>) {
  const lots = f.rows("loyalty_credit_lots");
  const expected = lots.reduce((n, lot) => n + lotCarryingMinor(lot), 0);
  const carried = lots.reduce((n, lot) => n + lot.deferredMinor, 0);
  const ledger = await getLoyaltyLiabilityBalanceMinor(f.db);
  expect(carried).toBe(expected);
  // Each lot rounds once, so the ledger may differ from the exact product
  // outstanding miles x SSP x (1 - breakage) by at most half a halala per lot.
  const exact = lots.reduce(
    (n, lot) =>
      lot.sspMinorPerMile === null
        ? n
        : n +
          lot.remainingMiles *
            Number(lot.sspMinorPerMile) *
            (1 - Number(lot.breakageRatePercent ?? 0) / 100),
    0
  );
  expect(Math.abs(ledger.balanceMinor - exact)).toBeLessThanOrEqual(
    Math.max(1, lots.length) * 0.5
  );
  expect(ledger.balanceMinor).toBe(carried);
  return ledger;
}

describe("loyalty contract liability ledger", () => {
  it("defers at SSP net of breakage on issuance and releases on redemption, expiry and reversal", async () => {
    const f = fixture();
    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      await creditMiles(tx, state, {
        amount: 1000,
        type: "earn",
        bookingId: 8,
        reason: "Booking",
        expiresAt: now,
      });
      await creditMiles(tx, state, {
        amount: 400,
        type: "bonus",
        reason: "Promo",
        expiresAt: future,
      });
    });
    let ledger = await expectBalanced(f);
    // 1400 miles x 2.5 x 0.9 = 3150 halala deferred, nothing released yet.
    expect(ledger).toMatchObject({
      deferredMinor: 3150,
      revenueMinor: 0,
      breakageMinor: 0,
      reversalMinor: 0,
      balanceMinor: 3150,
    });

    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      // Spends from the earliest-expiring lot (booking 8).
      await spendMiles(tx, state, 300, { type: "redeem", reason: "Redeem" });
    });
    ledger = await expectBalanced(f);
    expect(ledger.revenueMinor).toBe(Math.round(300 * 2.25));
    expect(ledger.balanceMinor).toBe(3150 - 675);

    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      // Remaining 700 miles of booking 8 lapse: breakage release.
      expect(await expireMilesLots(tx, state, now)).toBe(700);
    });
    ledger = await expectBalanced(f);
    expect(ledger.breakageMinor).toBe(Math.round(700 * 2.25));
    expect(ledger.balanceMinor).toBe(Math.round(400 * 2.25));

    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      // Refund of booking 8: expired and spent miles are reversed first, the
      // spent 300 are recovered from the promo lot (revenue release there).
      await reverseBookingMilesCredit(tx, state, 8, 1000);
      expect(state.account.currentMilesBalance).toBe(100);
    });
    ledger = await expectBalanced(f);
    expect(ledger.balanceMinor).toBe(Math.round(100 * 2.25));
    expect(ledger.revenueMinor).toBe(Math.round(600 * 2.25));
    // Every row carries the account identity needed for an audit trail.
    for (const row of f.rows("financial_ledger")) {
      expect(row.currency).toBe("SAR");
      expect(Number(row.amount)).toBeGreaterThan(0);
      expect(JSON.parse(row.metadata)).toMatchObject({
        ledgerAccount: "loyalty_contract_liability",
        valuationId: 11,
        sspMinorPerMile: "2.5000",
      });
    }
  });

  it("stays balanced within rounding across a long random earn/burn/expire sequence", async () => {
    const f = fixture([
      {
        ...approvedValuation,
        sspMinorPerMile: "1.3333",
        breakageRatePercent: "7.50",
      },
    ]);
    let seed = 42;
    const rand = () =>
      (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let step = 0; step < 40; step++) {
      await f.db.transaction(async tx => {
        const state = await lockMilesState(tx, 7);
        const roll = rand();
        if (roll < 0.5 || state.account.currentMilesBalance < 50)
          await creditMiles(tx, state, {
            amount: 1 + Math.floor(rand() * 500),
            type: "earn",
            bookingId: 100 + step,
            reason: `earn-${step}`,
            expiresAt: rand() < 0.3 ? now : future,
          });
        else if (roll < 0.85)
          await spendMiles(
            tx,
            state,
            1 + Math.floor(rand() * (state.account.currentMilesBalance - 1)),
            { type: "redeem", reason: `redeem-${step}` }
          );
        else await expireMilesLots(tx, state, now);
      });
      await expectBalanced(f);
    }
    const ledger = await getLoyaltyLiabilityBalanceMinor(f.db);
    expect(ledger.deferredMinor).toBeGreaterThan(0);
    expect(ledger.balanceMinor).toBeGreaterThanOrEqual(0);
  });

  it("carries no liability for lots issued before the policy and reports them as unvalued", async () => {
    const f = fixture();
    f.rows("loyalty_accounts")[0].currentMilesBalance = 500;
    f.rows("loyalty_credit_lots").push({
      transactionId: 900,
      loyaltyAccountId: 1,
      bookingId: null,
      creditedMiles: 500,
      remainingMiles: 500,
      spentMiles: 0,
      expiredMiles: 0,
      reversedMiles: 0,
      expiresAt: future,
      valuationId: null,
      sspMinorPerMile: null,
      breakageRatePercent: null,
      deferredMinor: 0,
    });
    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      await spendMiles(tx, state, 100, { type: "redeem", reason: "Legacy" });
      await creditMiles(tx, state, {
        amount: 200,
        type: "earn",
        bookingId: 5,
        reason: "New policy lot",
        expiresAt: future,
      });
    });
    expect(f.rows("financial_ledger")).toHaveLength(1);
    const summary = await getLoyaltyAccountingSummary(f.db, now);
    expect(summary).toMatchObject({
      outstandingMiles: 600,
      valuedMiles: 200,
      unvaluedMiles: 400,
      grossValueMinor: 500,
      liabilityMinor: 450,
      lotCarryingMinor: 450,
      reconciliationDifferenceMinor: 0,
      expectedBreakageMinor: 50,
    });
    expect(summary.valuation.status).toBe("approved");
    expect(summary.rule.source).toBe("default");
  });

  it("uses the unapproved default valuation until finance approves one, then applies it prospectively", async () => {
    const f = fixture([]);
    expect(await getCurrentValuation(f.db, now)).toEqual(DEFAULT_VALUATION);
    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      await creditMiles(tx, state, {
        amount: 100,
        type: "bonus",
        reason: "Default valuation lot",
        expiresAt: future,
      });
    });
    const draft = await createValuation(
      f.db,
      {
        sspMinorPerMile: 3,
        breakageRatePercent: 20,
        effectiveFrom: new Date("2020-06-01T00:00:00Z"),
      },
      5
    );
    expect(draft.status).toBe("draft");
    expect((await getCurrentValuation(f.db, now)).id).toBeNull();
    const approved = await approveValuation(f.db, draft.id, 6);
    expect(approved).toMatchObject({ status: "approved", approvedBy: 6 });
    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 7);
      await creditMiles(tx, state, {
        amount: 100,
        type: "bonus",
        reason: "Approved valuation lot",
        expiresAt: future,
      });
    });
    const [legacyLot, newLot] = f.rows("loyalty_credit_lots");
    expect(legacyLot).toMatchObject({
      sspMinorPerMile: "1.0000",
      deferredMinor: 100,
    });
    expect(newLot).toMatchObject({
      sspMinorPerMile: "3.0000",
      deferredMinor: 240,
    });
    await expectBalanced(f);
    await expect(approveValuation(f.db, draft.id, 6)).rejects.toThrow(
      "only drafts"
    );
  });
});
