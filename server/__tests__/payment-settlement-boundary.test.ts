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
import { topUpWallet, payFromWallet } from "../services/wallet.service";
import { createBooking } from "../services/bookings.service";

let fixture: ReturnType<typeof transactionMemory>;
const payment = (
  metadata: any = { bookingId: "7" },
  amount = 100000,
  pi = "pi_1"
) => ({
  id: "cs_1",
  metadata,
  amount_total: amount,
  currency: "sar",
  payment_status: "paid",
  payment_intent: pi,
});
async function event(type: string, object: any) {
  await fixture.db.transaction((tx: any) =>
    processStripeEvent(tx, { id: `evt_${type}`, type, data: { object } } as any)
  );
}
beforeEach(() => {
  fixture = transactionMemory({
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
      { id: 5, status: "scheduled", economyAvailable: 5, businessAvailable: 5 },
    ],
    wallets: [
      { id: 1, userId: 9, balance: 150000, status: "active", currency: "SAR" },
    ],
  });
  boundary.db = fixture.db;
  boundary.getFlight.mockResolvedValue(fixture.rows("flights")[0]);
  boundary.checkout.mockResolvedValue({
    id: "cs_topup",
    url: "https://checkout.stripe.com/test",
  });
});

describe("verified payment settlement", () => {
  it.each([true, false])(
    "settles PI-first=%s once with inventory, ledger and a durable notification",
    async piFirst => {
      const pi = {
        id: "pi_1",
        metadata: { bookingId: "7" },
        amount_received: 100000,
        currency: "sar",
        status: "succeeded",
      };
      if (piFirst) await event("payment_intent.succeeded", pi);
      await event("checkout.session.completed", payment());
      await event("payment_intent.succeeded", pi);
      expect(fixture.rows("bookings")[0]).toMatchObject({
        status: "confirmed",
        seatsReserved: true,
        paymentStatus: "paid",
      });
      expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
      expect(fixture.rows("financial_ledger")).toHaveLength(1);
      expect(fixture.rows("outbox")).toHaveLength(1);
    }
  );
  it("keeps a ten-percent split pending until every share funds the persisted total", async () => {
    await fixture.db
      .insert((await import("../../drizzle/schema")).paymentSplits)
      .values([
        { id: 1, bookingId: 7, amount: 10000, status: "pending" },
        { id: 2, bookingId: 7, amount: 90000, status: "pending" },
      ]);
    await event(
      "checkout.session.completed",
      payment({ type: "split_payment", splitId: "1", bookingId: "7" }, 10000)
    );
    expect(fixture.rows("bookings")[0].status).toBe("pending");
    expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
    await event(
      "checkout.session.completed",
      payment(
        { type: "split_payment", splitId: "2", bookingId: "7" },
        90000,
        "pi_2"
      )
    );
    expect(fixture.rows("bookings")[0].status).toBe("confirmed");
    expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
  });
  it.each([
    [10000, "sar"],
    [100000, "usd"],
  ])("rolls back a mismatched purchase %s %s", async (amount, currency) => {
    await expect(
      event("checkout.session.completed", {
        ...payment(undefined, amount),
        currency,
      })
    ).rejects.toThrow("amount/currency");
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
    expect(fixture.rows("bookings")[0].status).toBe("pending");
  });
  it("does not confirm an unpaid Checkout completion", async () => {
    await event("checkout.session.completed", {
      ...payment(),
      payment_status: "unpaid",
    });
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
  });
  it("processes a modification of an already paid booking and moves capacity once", async () => {
    await event("checkout.session.completed", payment());
    await fixture.db
      .insert((await import("../../drizzle/schema")).bookingModifications)
      .values({
        id: 8,
        bookingId: 7,
        userId: 9,
        status: "pending",
        originalFlightId: 4,
        originalCabinClass: "economy",
        originalAmount: 100000,
        newFlightId: 5,
        newCabinClass: "business",
        newAmount: 120000,
        totalCost: 20000,
      });
    const modification = payment(
      { bookingId: "7", type: "modification", modificationId: "8" },
      20000,
      "pi_change"
    );
    await event("checkout.session.completed", modification);
    await event("checkout.session.completed", modification);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      flightId: 5,
      cabinClass: "business",
      totalAmount: 120000,
    });
    expect(fixture.rows("booking_modifications")[0].status).toBe("completed");
    expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
    expect(fixture.rows("flights")[1].businessAvailable).toBe(4);
  });
  it("resolves metadata-free refunds by payment reference and books only cumulative deltas", async () => {
    await event("checkout.session.completed", payment());
    for (const amount of [40000, 60000, 60000, 100000, 100000])
      await event("charge.refunded", {
        id: "ch_1",
        metadata: {},
        payment_intent: "pi_1",
        amount: 100000,
        amount_refunded: amount,
        currency: "sar",
      });
    const refunds = fixture
      .rows("financial_ledger")
      .filter(r => r.type !== "charge");
    expect(refunds.map(r => r.amount)).toEqual(["400.00", "200.00", "400.00"]);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "cancelled",
      paymentStatus: "refunded",
      seatsReserved: false,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
  });
  it("rolls back financial state when seats cannot be reserved", async () => {
    fixture.rows("flights")[0].economyAvailable = 0;
    await expect(
      event("checkout.session.completed", payment())
    ).rejects.toThrow("Insufficient");
    expect(fixture.rows("payment_receipts")).toHaveLength(0);
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
  });
});

describe("wallet funding and atomic booking creation", () => {
  it("creates a pending Checkout without minting balance; verified replay credits once", async () => {
    const result = await topUpWallet(9, 10000, "Top-up");
    expect(result.status).toBe("pending");
    expect(fixture.rows("wallets")[0].balance).toBe(150000);
    expect(fixture.rows("wallet_transactions")[0].status).toBe("pending");
    const metadata = boundary.checkout.mock.calls.at(-1)![0].metadata;
    await event("checkout.session.completed", payment(metadata, 10000));
    await event("checkout.session.completed", payment(metadata, 10000));
    expect(fixture.rows("wallets")[0].balance).toBe(160000);
  });
  it("debits the server price once and rejects another owner's booking", async () => {
    await expect(payFromWallet(8, 7)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await payFromWallet(9, 7);
    await payFromWallet(9, 7);
    expect(fixture.rows("wallets")[0].balance).toBe(50000);
    expect(fixture.rows("bookings")[0].status).toBe("confirmed");
    expect(fixture.rows("wallet_transactions")).toHaveLength(1);
  });
  it("rolls back booking and hold if writing passengers fails", async () => {
    fixture.failInsert("passengers");
    await expect(
      createBooking({
        userId: 9,
        flightId: 4,
        tenantId: 3,
        cabinClass: "economy",
        sessionId: "session",
        passengers: [{ type: "adult", firstName: "Test", lastName: "User" }],
      })
    ).rejects.toThrow();
    expect(fixture.rows("bookings")).toHaveLength(1);
    expect(fixture.rows("inventory_locks")).toHaveLength(0);
  });
  it("keeps the created booking's hold active until payment", async () => {
    const result = await createBooking({
      userId: 9,
      flightId: 4,
      tenantId: 3,
      cabinClass: "economy",
      sessionId: "session",
      passengers: [{ type: "adult", firstName: "Test", lastName: "User" }],
    });
    expect(
      fixture.rows("bookings").find(b => b.id === result.bookingId)?.status
    ).toBe("pending");
    expect(fixture.rows("inventory_locks")[0].status).toBe("active");
  });
});
