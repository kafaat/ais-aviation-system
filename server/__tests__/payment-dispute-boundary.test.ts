import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({
  db: null as any,
  checkout: vi.fn(),
  getFlight: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getFlightById: boundary.getFlight,
  generateBookingReference: () => "TEST01",
}));
vi.mock("../stripe", () => ({
  stripe: { checkout: { sessions: { create: boundary.checkout } } },
}));
vi.mock("../services/email.service", () => ({}));
vi.mock("../services/loyalty.service", () => ({}));
vi.mock("../services/eticket.service", () => ({}));
vi.mock("../services/notification.service", () => ({
  createNotification: vi.fn(),
}));
vi.mock("../services/metrics.service", () => ({
  trackBookingStarted: vi.fn(),
  trackBookingCancelled: vi.fn(),
}));
vi.mock("../services/flights.service", () => ({
  calculateFlightPrice: async () => ({ price: 100000 }),
}));
import { processStripeEvent } from "../webhooks/stripe";

let fixture: ReturnType<typeof transactionMemory>;
async function event(id: string, type: string, object: any) {
  await fixture.db.transaction((tx: any) =>
    processStripeEvent(tx, { id, type, data: { object } } as any)
  );
}
const checkout = (metadata: any = { bookingId: "7" }, amount = 100000) => ({
  id: "cs_1",
  metadata,
  amount_total: amount,
  currency: "sar",
  payment_status: "paid",
  payment_intent: "pi_1",
});
const dispute = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "dp_1",
  object: "dispute",
  charge: "ch_1",
  payment_intent: "pi_1",
  amount: 100000,
  currency: "sar",
  status: "needs_response",
  reason: "fraudulent",
  ...overrides,
});
const disputeRows = () =>
  fixture.rows("financial_ledger").filter(r => r.type === "adjustment");

beforeEach(() => {
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        bookingReference: "TEST01",
        status: "pending",
        paymentStatus: "pending",
        totalAmount: 100000,
        cabinClass: "economy",
        numberOfPassengers: 1,
        seatsReserved: false,
      },
    ],
    flights: [
      {
        id: 4,
        tenantId: 3,
        airlineId: 2,
        status: "scheduled",
        economyAvailable: 5,
        businessAvailable: 5,
        departureTime: new Date(Date.now() + 86400000),
      },
    ],
    wallets: [
      { id: 1, userId: 9, balance: 150000, status: "active", currency: "SAR" },
    ],
  });
  boundary.db = fixture.db;
  boundary.getFlight.mockResolvedValue(fixture.rows("flights")[0]);
});

describe("provider dispute evidence", () => {
  it("records the dispute lifecycle once per event and moves money only on funds events", async () => {
    await event("evt_pay", "checkout.session.completed", checkout());
    await event("evt_d1", "charge.dispute.created", dispute());
    await event(
      "evt_d2",
      "charge.dispute.funds_withdrawn",
      dispute({ status: "under_review" })
    );
    await event(
      "evt_d2",
      "charge.dispute.funds_withdrawn",
      dispute({ status: "under_review" })
    );
    await event("evt_d3", "charge.dispute.closed", dispute({ status: "lost" }));
    await event(
      "evt_d4",
      "charge.dispute.funds_reinstated",
      dispute({ status: "won" })
    );

    expect(disputeRows().map(r => r.amount)).toEqual([
      "0.00",
      "-1000.00",
      "0.00",
      "1000.00",
    ]);
    expect(disputeRows().map(r => r.stripeEventId)).toEqual([
      "evt_d1",
      "evt_d2",
      "evt_d3",
      "evt_d4",
    ]);
    expect(disputeRows()[0]).toMatchObject({
      bookingId: 7,
      userId: 9,
      currency: "SAR",
      stripePaymentIntentId: "pi_1",
      stripeChargeId: "ch_1",
    });
    expect(JSON.parse(disputeRows()[2].metadata)).toEqual({
      disputeId: "dp_1",
      eventType: "charge.dispute.closed",
      status: "lost",
      reason: "fraudulent",
    });

    const history = fixture.rows("payment_history");
    expect(history.map(h => h.event)).toEqual([
      "disputed",
      "chargeback",
      "chargeback",
      "disputed",
    ]);
    expect(history[0]).toMatchObject({
      paymentId: fixture.rows("payments")[0].id,
      bookingId: 7,
      fromStatus: "completed",
      toStatus: "completed",
      amount: 100000,
      providerReference: "dp_1",
      initiatedBy: "webhook",
    });

    const disputed = fixture
      .rows("outbox")
      .filter(o => o.eventType === "payment.disputed");
    expect(disputed).toHaveLength(4);
    expect(disputed[1]).toMatchObject({
      aggregateType: "payment",
      aggregateId: "pi_1",
      tenantId: 3,
      payload: { bookingId: 7, userId: 9, amount: -100000, disputeId: "dp_1" },
    });
  });

  it("leaves booking, inventory, receipt and payment status untouched", async () => {
    await event("evt_pay", "checkout.session.completed", checkout());
    await event("evt_d1", "charge.dispute.created", dispute());
    await event("evt_d2", "charge.dispute.funds_withdrawn", dispute());
    await event("evt_d3", "charge.dispute.closed", dispute({ status: "lost" }));
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
    expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(0);
    expect(fixture.rows("payments")[0].status).toBe("completed");
  });

  it.each([
    ["an unknown payment", { payment_intent: "pi_unknown" }, "unknown payment"],
    ["a foreign currency", { currency: "usd" }, "amount/currency"],
    ["more than was collected", { amount: 100001 }, "amount/currency"],
    ["a non-positive amount", { amount: 0 }, "Invalid dispute amount"],
    ["no payment intent", { payment_intent: null }, "payment intent"],
  ])("rolls back a dispute for %s", async (_name, overrides, message) => {
    await event("evt_pay", "checkout.session.completed", checkout());
    await expect(
      event("evt_bad", "charge.dispute.created", dispute(overrides))
    ).rejects.toThrow(message);
    expect(disputeRows()).toHaveLength(0);
    expect(fixture.rows("payment_history")).toHaveLength(0);
    expect(
      fixture.rows("outbox").filter(o => o.eventType === "payment.disputed")
    ).toHaveLength(0);
  });

  it("accepts a partial dispute and locks the booking before the receipt", async () => {
    await event("evt_pay", "checkout.session.completed", checkout());
    fixture.lockedTables.length = 0;
    await event(
      "evt_part",
      "charge.dispute.created",
      dispute({ amount: 2500 })
    );
    expect(fixture.lockedTables).toEqual(["bookings", "payment_receipts"]);
    expect(fixture.rows("payment_history")[0].amount).toBe(2500);
  });

  it("records a wallet top-up dispute in the ledger without booking history", async () => {
    await fixture.db
      .insert((await import("../../drizzle/schema")).walletTransactions)
      .values({
        id: 10,
        walletId: 1,
        userId: 9,
        type: "top_up",
        amount: 10000,
        status: "pending",
      });
    await event(
      "evt_topup",
      "checkout.session.completed",
      checkout({ type: "wallet_topup", topUpId: "10", userId: "9" }, 10000)
    );
    await event(
      "evt_wd",
      "charge.dispute.funds_withdrawn",
      dispute({ amount: 10000 })
    );
    expect(disputeRows()).toHaveLength(1);
    expect(disputeRows()[0]).toMatchObject({
      bookingId: null,
      userId: 9,
      amount: "-100.00",
    });
    expect(fixture.rows("payment_history")).toHaveLength(0);
    expect(fixture.rows("wallets")[0].balance).toBe(160000);
  });
});
