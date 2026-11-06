import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { transactionMemory } from "./helpers/transaction-memory";
import * as schema from "../../drizzle/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../stripe", () => ({ stripe: {} }));
import { payFromWallet } from "../services/wallet.service";
import {
  recordVerifiedDispute,
  type DisputeEventType,
} from "../services/payment-dispute.service";
import {
  settleVerifiedPayment,
  settleVerifiedRefund,
} from "../services/payment-settlement.service";
import { reconcileWalletFunding } from "../services/wallet-funding.service";

let fixture: ReturnType<typeof transactionMemory>;
const topUp = {
  paymentIntentId: "pi_funding",
  eventId: "evt_topup",
  amount: 10000,
  currency: "SAR",
  metadata: { type: "wallet_topup", topUpId: "10", userId: "9" },
};
const balance = () => fixture.rows("wallets")[0].balance;
const changes = () =>
  fixture.rows("wallet_transactions").filter(row => row.type !== "top_up");
const dispute = (
  eventId: string,
  eventType: DisputeEventType = "charge.dispute.funds_withdrawn",
  overrides = {}
) => ({
  eventId,
  eventType,
  disputeId: "dp_funding",
  chargeId: "ch_funding",
  paymentIntentId: "pi_funding",
  amount: 10000,
  currency: "SAR",
  status: "under_review",
  reason: "fraudulent",
  ...overrides,
});
const apply = (input: ReturnType<typeof dispute>) =>
  fixture.db.transaction((tx: any) => recordVerifiedDispute(tx, input));

beforeEach(async () => {
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    users: [{ id: 9, tenantId: 3 }],
    wallets: [
      { id: 1, userId: 9, balance: 0, currency: "SAR", status: "active" },
    ],
    wallet_transactions: [
      {
        id: 10,
        walletId: 1,
        userId: 9,
        type: "top_up",
        amount: 10000,
        balanceAfter: 0,
        status: "pending",
        description: "Synthetic top-up",
      },
    ],
    bookings: [7, 8].map(id => ({
      id,
      userId: 9,
      tenantId: 3,
      flightId: 4,
      bookingReference: `SYN00${id}`,
      status: "pending",
      paymentStatus: "pending",
      totalAmount: 10000,
      cabinClass: "economy",
      numberOfPassengers: 1,
      seatsReserved: false,
    })),
    flights: [
      {
        id: 4,
        tenantId: 3,
        airlineId: 2,
        status: "scheduled",
        economyAvailable: 5,
        businessAvailable: 5,
        departureTime: new Date("2030-11-20T12:00:00Z"),
      },
    ],
  });
  state.db = fixture.db;
  await fixture.db.transaction((tx: any) => settleVerifiedPayment(tx, topUp));
});

/** Mirrors the agreed shared hook; native acceptance exercises settleVerifiedRefund itself. */
async function refundWithSharedHook(
  amountRefunded: number,
  eventId = "evt_refund"
) {
  await fixture.db.transaction(async (tx: any) => {
    const [request] = await tx
      .select()
      .from(schema.walletTransactions)
      .where(eq(schema.walletTransactions.id, 10))
      .for("update");
    const [wallet] = await tx
      .select()
      .from(schema.wallets)
      .where(eq(schema.wallets.id, request.walletId))
      .for("update");
    const [receipt] = await tx
      .select()
      .from(schema.paymentReceipts)
      .where(eq(schema.paymentReceipts.paymentIntentId, "pi_funding"))
      .for("update");
    const delta = amountRefunded - receipt.refundedAmount;
    if (delta <= 0) return;
    await tx
      .update(schema.paymentReceipts)
      .set({ refundedAmount: amountRefunded })
      .where(eq(schema.paymentReceipts.paymentIntentId, "pi_funding"));
    await tx.insert(schema.financialLedger).values({
      bookingId: null,
      userId: 9,
      type: amountRefunded === receipt.amount ? "refund" : "partial_refund",
      amount: (delta / 100).toFixed(2),
      currency: "SAR",
      stripeEventId: eventId,
      stripePaymentIntentId: "pi_funding",
      description: "Verified refund delta",
    });
    await reconcileWalletFunding(tx, {
      receipt: { ...receipt, refundedAmount: amountRefunded },
      wallet,
      eventId,
    });
  });
}

describe("withdrawn top-up funding cannot buy new travel", () => {
  it("blocks the actual wallet payment after a 100 SAR funding withdrawal", async () => {
    await apply(dispute("evt_withdrawn"));
    await expect(payFromWallet(9, 7, 10000)).rejects.toThrow(
      "Insufficient active wallet balance"
    );
    expect(balance()).toBe(0);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "pending",
      seatsReserved: false,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
    expect(changes()).toMatchObject([
      {
        type: "withdrawal",
        amount: -10000,
        balanceAfter: 0,
        status: "completed",
      },
    ]);
  });

  it.each([
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
  ] as const)(
    "%s is evidence, not an inferred cash withdrawal",
    async eventType => {
      await apply(dispute("evt_lifecycle", eventType, { status: "lost" }));
      expect(balance()).toBe(10000);
      await expect(payFromWallet(9, 7, 10000)).resolves.toMatchObject({
        amountPaid: 10000,
        balance: 0,
      });
    }
  );

  it("deduplicates the provider event and the same dispute's economic effect", async () => {
    await apply(dispute("evt_withdrawn"));
    await apply(dispute("evt_withdrawn"));
    await apply(dispute("evt_equivalent"));
    expect(balance()).toBe(0);
    expect(changes()).toHaveLength(1);
    const ledger = fixture
      .rows("financial_ledger")
      .filter(row => row.type === "adjustment");
    expect(ledger).toHaveLength(2);
    expect(JSON.parse(ledger[1].metadata).walletFunding).toEqual({
      version: 1,
      walletId: 1,
      adjustment: 0,
      loss: 10000,
    });
    expect(
      fixture.rows("outbox").filter(row => row.eventType === "payment.disputed")
    ).toHaveLength(2);
  });

  it("reinstates an active wallet exactly once and permits a new funded purchase", async () => {
    await apply(dispute("evt_withdrawn"));
    await apply(
      dispute("evt_restored", "charge.dispute.funds_reinstated", {
        status: "won",
      })
    );
    await apply(
      dispute("evt_restored", "charge.dispute.funds_reinstated", {
        status: "won",
      })
    );
    await apply(
      dispute("evt_restored_again", "charge.dispute.funds_reinstated", {
        status: "won",
      })
    );
    await apply(dispute("evt_delayed_withdrawn"));
    expect(balance()).toBe(10000);
    expect(changes().map(row => row.amount)).toEqual([-10000, 10000]);
    await expect(payFromWallet(9, 7, 10000)).resolves.toMatchObject({
      amountPaid: 10000,
      balance: 0,
    });
  });

  it("does not mint credit when reinstatement arrives before withdrawal", async () => {
    await apply(
      dispute("evt_restored", "charge.dispute.funds_reinstated", {
        status: "won",
      })
    );
    await apply(
      dispute("evt_closed", "charge.dispute.closed", { status: "won" })
    );
    await apply(dispute("evt_delayed_withdrawn"));
    expect(balance()).toBe(10000);
    expect(changes()).toHaveLength(0);
    await expect(payFromWallet(9, 7, 10000)).resolves.toMatchObject({
      amountPaid: 10000,
    });
  });

  it("allows only remaining funded principal after a partial dispute", async () => {
    await apply(dispute("evt_partial", undefined, { amount: 6000 }));
    expect(balance()).toBe(4000);
    await expect(payFromWallet(9, 7, 10000)).rejects.toThrow(
      "Insufficient active wallet balance"
    );
    await fixture.db
      .update(schema.bookings)
      .set({ totalAmount: 4000 })
      .where(eq(schema.bookings.id, 7));
    await expect(payFromWallet(9, 7, 4000)).resolves.toMatchObject({
      balance: 0,
    });
  });

  it("preserves purchased travel and records debt when withdrawn funding was partly spent", async () => {
    await fixture.db
      .update(schema.bookings)
      .set({ totalAmount: 6000 })
      .where(eq(schema.bookings.id, 7));
    await payFromWallet(9, 7, 6000);
    await apply(dispute("evt_withdrawn"));
    expect(fixture.rows("wallets")[0]).toMatchObject({
      balance: -6000,
      status: "frozen",
    });
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
    await expect(payFromWallet(9, 8, 10000)).rejects.toThrow(
      "Insufficient active wallet balance"
    );
    await expect(payFromWallet(9, 7, 6000)).resolves.toMatchObject({
      amountPaid: 6000,
    });
    await apply(dispute("evt_restored", "charge.dispute.funds_reinstated"));
    expect(fixture.rows("wallets")[0]).toMatchObject({
      balance: 4000,
      status: "frozen",
    });
  });

  it.each(["frozen", "closed"])(
    "never reactivates a previously %s wallet",
    async status => {
      await fixture.db
        .update(schema.wallets)
        .set({ status })
        .where(eq(schema.wallets.id, 1));
      await apply(dispute("evt_withdrawn"));
      await apply(dispute("evt_restored", "charge.dispute.funds_reinstated"));
      expect(fixture.rows("wallets")[0]).toMatchObject({
        balance: 10000,
        status,
      });
    }
  );

  it("recognizes a legacy top-up refund as an already applied wallet debit", async () => {
    await fixture.db.transaction((tx: any) =>
      settleVerifiedRefund(tx, {
        paymentIntentId: "pi_funding",
        chargeId: "ch_funding",
        amount: 10000,
        amountRefunded: 10000,
        currency: "SAR",
        eventId: "evt_old_refund",
      })
    );
    expect(balance()).toBe(0);
    await apply(dispute("evt_withdrawn"));
    await apply(dispute("evt_restored", "charge.dispute.funds_reinstated"));
    expect(balance()).toBe(0);
    expect(changes()).toHaveLength(1);
  });

  it.each(["refund-first", "dispute-first"])(
    "caps overlapping reversals at principal (%s)",
    async order => {
      if (order === "refund-first") await refundWithSharedHook(10000);
      await apply(dispute("evt_withdrawn"));
      if (order === "dispute-first") await refundWithSharedHook(10000);
      await refundWithSharedHook(10000, "evt_refund_repeat");
      await apply(dispute("evt_repeated_withdrawal"));
      await apply(dispute("evt_restored", "charge.dispute.funds_reinstated"));
      expect(balance()).toBe(0);
      expect(changes()).toHaveLength(1);
      expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(10000);
    }
  );

  it("restores only the portion not refunded after overlapping partial reversals", async () => {
    await apply(dispute("evt_withdrawn"));
    await refundWithSharedHook(4000);
    expect(balance()).toBe(0);
    await apply(dispute("evt_restored", "charge.dispute.funds_reinstated"));
    expect(balance()).toBe(6000);
    expect(changes().map(row => row.amount)).toEqual([-10000, 6000]);
    await refundWithSharedHook(10000, "evt_refund_remainder");
    expect(balance()).toBe(0);
  });

  it("caps independent disputes together without duplicate credits on restoration", async () => {
    await apply(dispute("evt_a", undefined, { amount: 7000 }));
    await apply(
      dispute("evt_b", undefined, { disputeId: "dp_b", amount: 6000 })
    );
    expect(balance()).toBe(0);
    await apply(
      dispute("evt_restore_a", "charge.dispute.funds_reinstated", {
        amount: 7000,
      })
    );
    expect(balance()).toBe(4000);
    await apply(
      dispute("evt_restore_b", "charge.dispute.funds_reinstated", {
        disputeId: "dp_b",
        amount: 6000,
      })
    );
    expect(balance()).toBe(10000);
  });

  it("blocks historical withdrawal evidence with no wallet debit and permits explicit repair", async () => {
    await fixture.db.insert(schema.financialLedger).values({
      bookingId: null,
      userId: 9,
      type: "adjustment",
      amount: "-100.00",
      currency: "SAR",
      stripePaymentIntentId: "pi_funding",
      stripeEventId: "evt_legacy",
      description: "Provider dispute funds_withdrawn",
      metadata: JSON.stringify({
        disputeId: "dp_funding",
        eventType: "charge.dispute.funds_withdrawn",
        status: "under_review",
        reason: "fraudulent",
      }),
    });
    const before = structuredClone(fixture.rows("wallet_transactions"));
    await expect(payFromWallet(9, 7, 10000)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("requires reconciliation"),
    });
    expect(balance()).toBe(10000);
    expect(fixture.rows("wallet_transactions")).toEqual(before);
    await apply(dispute("evt_legacy"));
    expect(balance()).toBe(0);
    expect(
      fixture.rows("outbox").filter(row => row.eventType === "payment.disputed")
    ).toHaveLength(0);
    await apply(dispute("evt_restored", "charge.dispute.funds_reinstated"));
    await expect(payFromWallet(9, 7, 10000)).resolves.toMatchObject({
      amountPaid: 10000,
    });
  });

  it.each([
    ["receipt owner", "payment_receipts", { userId: 99 }],
    ["receipt currency", "payment_receipts", { currency: "USD" }],
    ["top-up amount", "wallet_transactions", { amount: 9000 }],
    [
      "top-up payment",
      "wallet_transactions",
      { stripePaymentIntentId: "pi_other" },
    ],
    ["wallet owner", "wallets", { userId: 99 }],
    ["wallet currency", "wallets", { currency: "USD" }],
  ])("rolls back %s corruption", async (_label, table, patch) => {
    Object.assign(fixture.rows(table as string)[0], patch);
    const before = structuredClone(fixture.rows("financial_ledger"));
    await expect(apply(dispute("evt_corrupt"))).rejects.toThrow();
    expect(balance()).toBe(10000);
    expect(fixture.rows("financial_ledger")).toEqual(before);
    expect(changes()).toHaveLength(0);
  });

  it("rolls back wallet, ledger marker and evidence when movement insertion fails", async () => {
    fixture.failInsert("wallet_transactions");
    await expect(apply(dispute("evt_failure"))).rejects.toThrow(
      "Injected insert failure"
    );
    expect(balance()).toBe(10000);
    expect(
      fixture.rows("financial_ledger").filter(row => row.type === "adjustment")
    ).toHaveLength(0);
    expect(
      fixture.rows("outbox").filter(row => row.eventType === "payment.disputed")
    ).toHaveLength(0);
  });
});
