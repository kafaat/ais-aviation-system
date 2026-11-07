import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import { getDb } from "../db";

vi.mock("../db", () => ({ getDb: vi.fn() }));
const notify = vi.hoisted(() => ({
  createNotification: vi.fn(async () => ({ id: 501 })),
  sendNotificationEmail: vi.fn(async () => true),
}));
vi.mock("./notification.service", () => ({
  createNotification: notify.createNotification,
}));
vi.mock("./email.service", () => ({
  sendNotificationEmail: notify.sendNotificationEmail,
}));

import {
  runLoyaltyLifecycle,
  planExpiries,
  dueNoticeDays,
} from "./loyalty-lifecycle.service";
import { getLoyaltyLiabilityBalanceMinor } from "./loyalty-accounting.service";
import { DEFAULT_PROGRAM_RULE, addMonths } from "./loyalty-rules.service";

const now = new Date("2030-06-15T00:00:00Z");
const activityRule = {
  id: 3,
  name: "alfursan-style",
  effectiveFrom: new Date("2029-01-01T00:00:00Z"),
  effectiveTo: null,
  status: "active",
  earningBasis: "legacy_spend",
  milesPerSar: "1.00",
  baseFareShareBps: 10000,
  expiryMode: "activity",
  expiryMonths: 24,
  expiryNoticeDays: "60,30",
  tierQualificationMonths: null,
  redemptionCoolingOffHours: 24,
  redemptionVelocityPerDay: 5,
  profileChangeVelocityPerDay: 3,
  approvedBy: null,
  createdBy: null,
  notes: null,
  createdAt: now,
  updatedAt: now,
};
const valuation = {
  id: 1,
  currency: "SAR",
  sspMinorPerMile: "2.0000",
  breakageRatePercent: "0.00",
  effectiveFrom: new Date("2029-01-01T00:00:00Z"),
  status: "approved",
  approvedBy: 1,
  approvedAt: now,
  createdBy: 1,
  notes: null,
  createdAt: now,
  updatedAt: now,
};
function member(id: number, lastActivityAt: Date, miles: number) {
  return {
    account: {
      id,
      userId: 100 + id,
      currentMilesBalance: miles,
      totalMilesEarned: miles,
      milesRedeemed: 0,
      tier: "bronze",
      tierPoints: 0,
      tierPeriodStartedAt: null,
      memberSince: lastActivityAt,
      lastActivityAt,
      createdAt: lastActivityAt,
      updatedAt: lastActivityAt,
      creditLotsInitializedAt: lastActivityAt,
    },
    lot: {
      transactionId: 1000 + id,
      loyaltyAccountId: id,
      bookingId: null,
      creditedMiles: miles,
      remainingMiles: miles,
      spentMiles: 0,
      expiredMiles: 0,
      reversedMiles: 0,
      expiresAt: null,
      valuationId: 1,
      sspMinorPerMile: "2.0000",
      breakageRatePercent: "0.00",
      deferredMinor: miles * 2,
    },
  };
}
function seed() {
  const lapsed = member(1, addMonths(now, -25), 1000); // inactive > 24 months
  // Expires in 45 days: the 60-day notice is due, the 30-day one is not yet.
  const soon = member(
    2,
    new Date(addMonths(now, -24).getTime() + 45 * 86_400_000),
    300
  );
  const active = member(3, addMonths(now, -2), 50);
  return transactionMemory({
    loyalty_accounts: [lapsed.account, soon.account, active.account],
    loyalty_credit_lots: [lapsed.lot, soon.lot, active.lot],
    miles_transactions: [],
    financial_ledger: [
      // Opening liability for the three lots (2 halala per mile).
      { id: 1, type: "loyalty_deferral", amount: "27.00", currency: "SAR" },
    ],
    loyalty_valuations: [valuation],
    loyalty_program_rules: [activityRule],
    loyalty_expiry_notices: [],
    users: [{ id: 102, email: "member@example.com" }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notify.createNotification.mockResolvedValue({ id: 501 });
  // Balance writes stamp lastActivityAt with the wall clock; pin it to the
  // fixture date so activity-based deadlines are computed from one clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("loyalty lifecycle: activity-based expiry and expiry notices", () => {
  it("expires only inactive members, posts breakage and schedules the due notice once", async () => {
    const f = seed();
    vi.mocked(getDb).mockReturnValue(f.db);
    const first = await runLoyaltyLifecycle({ now, batchSize: 2 });
    expect(first).toMatchObject({
      accountsScanned: 3,
      accountsExpired: 1,
      milesExpired: 1000,
      noticesCreated: 1,
      notificationsSent: 1,
      failures: [],
    });
    expect(f.rows("loyalty_accounts").map(a => a.currentMilesBalance)).toEqual([
      0, 300, 50,
    ]);
    expect(
      f.rows("miles_transactions").filter(t => t.type === "expire")
    ).toMatchObject([{ amount: -1000, reason: "activity-expiry:1001" }]);
    const ledger = await getLoyaltyLiabilityBalanceMinor(f.db);
    expect(ledger.breakageMinor).toBe(2000);
    expect(ledger.balanceMinor).toBe(2700 - 2000);
    const [notice] = f.rows("loyalty_expiry_notices");
    expect(notice).toMatchObject({
      loyaltyAccountId: 2,
      userId: 102,
      daysBefore: 60,
      milesAtRisk: 300,
      notificationId: 501,
    });
    expect(notify.createNotification).toHaveBeenCalledWith(
      102,
      "system",
      expect.stringContaining("300 miles expire in 60 days"),
      expect.stringContaining("another 24 months"),
      expect.objectContaining({ link: "/loyalty", daysBefore: 60 })
    );
    expect(notify.sendNotificationEmail).toHaveBeenCalledWith(
      "member@example.com",
      expect.any(String),
      expect.any(String)
    );

    // Second run on the same day: nothing new is posted or sent.
    const second = await runLoyaltyLifecycle({ now });
    expect(second).toMatchObject({
      milesExpired: 0,
      noticesCreated: 0,
      notificationsSent: 0,
    });
    expect(f.rows("financial_ledger")).toHaveLength(2);
    expect(f.rows("loyalty_expiry_notices")).toHaveLength(1);
    expect(notify.createNotification).toHaveBeenCalledTimes(1);

    // Twenty days later the 30-day notice becomes due; the 60-day one is not repeated.
    const later = new Date(now.getTime() + 20 * 86_400_000);
    vi.setSystemTime(later);
    const third = await runLoyaltyLifecycle({ now: later });
    expect(third).toMatchObject({ noticesCreated: 1, notificationsSent: 1 });
    expect(f.rows("loyalty_expiry_notices").map(n => n.daysBefore)).toEqual([
      60, 30,
    ]);
  });

  it("retries delivery of a notice whose notification failed, without duplicating the notice", async () => {
    const f = seed();
    vi.mocked(getDb).mockReturnValue(f.db);
    notify.createNotification.mockRejectedValueOnce(new Error("mail down"));
    const first = await runLoyaltyLifecycle({ now });
    expect(first.noticesCreated).toBe(1);
    expect(first.notificationsSent).toBe(0);
    expect(first.failures).toMatchObject([{ userId: 102 }]);
    expect(f.rows("loyalty_expiry_notices")[0].notificationId).toBeNull();
    const second = await runLoyaltyLifecycle({ now });
    expect(second).toMatchObject({
      noticesCreated: 0,
      notificationsSent: 1,
      failures: [],
    });
    expect(f.rows("loyalty_expiry_notices")).toHaveLength(1);
    expect(f.rows("loyalty_expiry_notices")[0].notificationId).toBe(501);
  });

  it("any earn or burn resets the activity clock and moves the projected expiry", async () => {
    const f = seed();
    vi.mocked(getDb).mockReturnValue(f.db);
    await runLoyaltyLifecycle({ now });
    // Member 2 redeems: lastActivityAt moves, the old notice no longer matches.
    const { lockMilesState, spendMiles } =
      await import("./loyalty-balance.service");
    await f.db.transaction(async tx => {
      const state = await lockMilesState(tx, 102);
      await spendMiles(tx, state, 10, { type: "redeem", reason: "activity" });
    });
    const result = await runLoyaltyLifecycle({ now });
    expect(result.noticesCreated).toBe(0);
    const state = {
      account: f.rows("loyalty_accounts")[1],
      lots: f.rows("loyalty_credit_lots").filter(l => l.loyaltyAccountId === 2),
      posted: new Map(),
    };
    const plan = planExpiries(state, {
      ...DEFAULT_PROGRAM_RULE,
      expiryMode: "activity",
    });
    expect(plan[0].milesAtRisk).toBe(290);
    expect(plan[0].projectedExpiryAt.getTime()).toBeGreaterThan(
      addMonths(now, 23).getTime()
    );
    expect(dueNoticeDays(plan[0], [60, 30], now)).toEqual([]);
  });

  it("fixed-lot programmes group notices by lot expiry date", () => {
    const lot = (id: number, miles: number, expiresAt: Date | null) => ({
      transactionId: id,
      loyaltyAccountId: 1,
      bookingId: null,
      creditedMiles: miles,
      remainingMiles: miles,
      spentMiles: 0,
      expiredMiles: 0,
      reversedMiles: 0,
      expiresAt,
      valuationId: null,
      sspMinorPerMile: null,
      breakageRatePercent: null,
      deferredMinor: 0,
    });
    const in40 = new Date(now.getTime() + 40 * 86_400_000);
    const in200 = new Date(now.getTime() + 200 * 86_400_000);
    const plans = planExpiries(
      {
        account: { ...member(1, now, 600).account, currentMilesBalance: 600 },
        lots: [lot(1, 100, in40), lot(2, 200, in40), lot(3, 300, in200)],
        posted: new Map(),
      },
      DEFAULT_PROGRAM_RULE
    );
    expect(plans).toEqual([
      { projectedExpiryAt: in40, milesAtRisk: 300 },
      { projectedExpiryAt: in200, milesAtRisk: 300 },
    ]);
    expect(dueNoticeDays(plans[0], [60, 30], now)).toEqual([60]);
    expect(dueNoticeDays(plans[1], [60, 30], now)).toEqual([]);
  });
});
