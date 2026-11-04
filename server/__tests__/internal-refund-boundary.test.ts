import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../stripe", () => ({ stripe: {} }));
import { refundInternalFunding } from "../services/internal-refund.service";

type Tender = "user_credit" | "wallet" | "corporate_credit";
let fixture: ReturnType<typeof transactionMemory>;
const request = (overrides = {}) => ({
  bookingId: 71,
  requestId: randomUUID(),
  amount: 4000,
  approvalReference: "synthetic-finance-approval",
  reason: "Approved return to the original funding account",
  cancelItinerary: false,
  ...overrides,
});
const booking = () => fixture.rows("bookings")[0];
const wallet = () => fixture.rows("wallets")[0];
const receipts = () => fixture.rows("financial_ledger");
const refunds = () => receipts().filter(row => row.type !== "charge");
const snapshot = () =>
  structuredClone(
    Object.fromEntries(
      [
        "bookings",
        "booking_segments",
        "flights",
        "wallets",
        "wallet_transactions",
        "user_credits",
        "credit_usage",
        "corporate_accounts",
        "financial_ledger",
        "ticket_coupons",
        "outbox",
        "idempotency_requests",
      ].map(name => [name, fixture.rows(name)])
    )
  );
function funding(tender: Tender) {
  const prefix = {
    user_credit: "internal-credit",
    wallet: "wallet-credit",
    corporate_credit: "corporate-credit",
  }[tender];
  receipts()[0].stripeEventId = `${prefix}:71`;
  receipts()[0].metadata = JSON.stringify({
    tender,
    ...(tender === "corporate_credit" ? { corporateAccountId: 5 } : {}),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-11-04T12:00:00Z"));
  fixture = transactionMemory({
    users: [
      { id: 9, tenantId: 3, role: "user" },
      { id: 10, tenantId: 3, role: "finance" },
    ],
    bookings: [
      {
        id: 71,
        tenantId: 3,
        userId: 9,
        flightId: 41,
        bookingReference: "FIN071",
        pnr: "FIN071",
        status: "confirmed",
        paymentStatus: "paid",
        totalAmount: 10001,
        seatsReserved: true,
        checkedIn: false,
        numberOfPassengers: 1,
        cabinClass: "economy",
        fareClassId: null,
      },
    ],
    booking_segments: [
      {
        id: 72,
        bookingId: 71,
        flightId: 41,
        status: "confirmed",
        seatsReserved: true,
      },
    ],
    flights: [
      {
        id: 41,
        tenantId: 3,
        status: "scheduled",
        departureTime: new Date("2030-11-20T12:00:00Z"),
        economyAvailable: 4,
        dcsClosedAt: null,
      },
    ],
    financial_ledger: [
      {
        id: 50,
        bookingId: 71,
        userId: 9,
        type: "charge",
        currency: "SAR",
        amount: "100.01",
        stripePaymentIntentId: null,
      },
    ],
    wallets: [
      { id: 3, userId: 9, currency: "SAR", balance: 4000, status: "active" },
    ],
    user_credits: [
      {
        id: 21,
        userId: 9,
        amount: 6000,
        usedAmount: 6000,
        expiresAt: new Date("2030-11-01T00:00:00Z"),
      },
      { id: 22, userId: 9, amount: 4001, usedAmount: 4001, expiresAt: null },
    ],
    credit_usage: [
      { id: 1, userId: 9, bookingId: 71, userCreditId: 21, amountUsed: 6000 },
      { id: 2, userId: 9, bookingId: 71, userCreditId: 22, amountUsed: 4001 },
    ],
    corporate_accounts: [{ id: 5, balance: -10001 }],
    corporate_bookings: [{ id: 1, bookingId: 71, corporateAccountId: 5 }],
    seat_inventory: [],
    ticket_coupons: [
      {
        id: 1,
        bookingId: 71,
        passengerId: 8,
        flightId: 41,
        couponNumber: 1,
        status: "O",
      },
    ],
  });
  state.db = fixture.db;
  funding("wallet");
});
afterEach(() => vi.useRealTimers());

describe("approved internal refunds through real services and rollback fixture", () => {
  it.each<Tender>(["user_credit", "wallet", "corporate_credit"])(
    "returns partial and final %s funding once, conserving the original invoice",
    async tender => {
      funding(tender);
      const partial = request();
      const first = await refundInternalFunding(partial, 10);
      expect(first).toMatchObject({
        tender,
        amount: 4000,
        remaining: 6001,
        cancelled: false,
        currency: "SAR",
      });
      expect(booking()).toMatchObject({
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        totalAmount: 10001,
      });
      expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
      expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
      expect(await refundInternalFunding(partial, 10)).toEqual(first);
      expect(refunds()).toHaveLength(1);

      const finalRequest = request({ amount: 6001, cancelItinerary: true });
      const final = await refundInternalFunding(finalRequest, 10);
      expect(final).toMatchObject({ remaining: 0, cancelled: true });
      expect(await refundInternalFunding(finalRequest, 10)).toEqual(final);
      expect(booking()).toMatchObject({
        status: "cancelled",
        paymentStatus: "refunded",
        seatsReserved: false,
        totalAmount: 10001,
      });
      expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
      expect(fixture.rows("booking_segments")[0]).toMatchObject({
        status: "cancelled",
        seatsReserved: false,
      });
      expect(fixture.rows("ticket_coupons")[0].status).toBe("R");
      expect(refunds().map(row => [row.type, row.amount])).toEqual([
        ["partial_refund", "40.00"],
        ["refund", "60.01"],
      ]);
      expect(
        fixture
          .rows("outbox")
          .filter(row => row.eventType === "booking.cancelled")
      ).toHaveLength(1);
      expect(
        fixture
          .rows("outbox")
          .filter(row => row.eventType === "payment.internal_refunded")
      ).toHaveLength(2);
      expect(fixture.rows("booking_status_history")).toHaveLength(1);
      if (tender === "wallet") {
        expect(wallet().balance).toBe(14001);
        expect(
          fixture.rows("wallet_transactions").map(row => row.amount)
        ).toEqual([4000, 6001]);
      } else if (tender === "corporate_credit") {
        expect(fixture.rows("corporate_accounts")[0].balance).toBe(0);
      } else {
        expect(fixture.rows("user_credits").map(row => row.usedAmount)).toEqual(
          [0, 0]
        );
        expect(fixture.rows("user_credits")[0].expiresAt).toEqual(
          new Date("2030-11-01T00:00:00Z")
        );
        expect(
          fixture
            .rows("credit_usage")
            .reduce((sum, row) => sum + row.amountUsed, 0)
        ).toBe(0);
      }
    }
  );

  it.each([
    ["wrong role", { role: "support" }],
    ["other airline", { tenantId: 4 }],
    ["unscoped finance", { tenantId: null }],
  ])("denies %s before any financial write", async (_name, patch) => {
    Object.assign(fixture.rows("users")[1], patch);
    const before = snapshot();
    await expect(refundInternalFunding(request(), 10)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(snapshot()).toEqual(before);
  });

  it("reauthorizes cached responses after a role change and rejects changed payload replays", async () => {
    const input = request();
    await refundInternalFunding(input, 10);
    const before = snapshot();
    await expect(
      refundInternalFunding({ ...input, amount: 4001 }, 10)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    fixture.rows("users")[1].role = "user";
    await expect(refundInternalFunding(input, 10)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(snapshot()).toEqual(before);
  });

  it("rechecks actor authority inside the write transaction", async () => {
    const transaction = fixture.db.transaction.bind(fixture.db);
    fixture.db.transaction = (
      run: Parameters<typeof fixture.db.transaction>[0]
    ) => {
      fixture.rows("users")[1].tenantId = 4;
      return transaction(run);
    };
    const before = snapshot();
    await expect(refundInternalFunding(request(), 10)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(snapshot()).toEqual(before);
  });

  it.each([
    [10002, false],
    [10001, false],
    [4000, true],
  ])(
    "refuses amount/cancellation mismatch %i/%s",
    async (amount, cancelItinerary) => {
      const before = snapshot();
      await expect(
        refundInternalFunding(request({ amount, cancelItinerary }), 10)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(snapshot()).toEqual(before);
    }
  );

  it.each([
    [
      "booking checked in",
      () => {
        booking().checkedIn = true;
      },
    ],
    [
      "completed sector",
      () => {
        fixture.rows("booking_segments")[0].status = "completed";
      },
    ],
    [
      "foreign flight",
      () => {
        fixture.rows("flights")[0].tenantId = 4;
      },
    ],
    [
      "departed flight",
      () => {
        fixture.rows("flights")[0].departureTime = new Date(
          "2030-11-03T12:00:00Z"
        );
      },
    ],
    [
      "completed flight",
      () => {
        fixture.rows("flights")[0].status = "completed";
      },
    ],
    [
      "unreserved itinerary",
      () => {
        booking().seatsReserved = false;
      },
    ],
    [
      "checked-in seat",
      () => {
        fixture
          .rows("seat_inventory")
          .push({ id: 1, bookingId: 71, checkedInAt: new Date() });
      },
    ],
    [
      "external receipt",
      () => {
        receipts()[0].stripePaymentIntentId = "pi_external_fixture";
      },
    ],
    [
      "wrong funding owner",
      () => {
        receipts()[0].userId = 999;
      },
    ],
    [
      "wrong funding identity",
      () => {
        receipts()[0].stripeEventId = "wallet-credit:72";
      },
    ],
    [
      "changed original invoice",
      () => {
        booking().totalAmount = 10000;
      },
    ],
    [
      "unrelated ledger adjustment",
      () => {
        receipts().push({
          ...receipts()[0],
          id: 51,
          type: "adjustment",
          amount: "1.00",
        });
      },
    ],
  ] as const)(
    "refuses %s without any partial financial effects",
    async (_name, mutate) => {
      mutate();
      const before = snapshot();
      await expect(refundInternalFunding(request(), 10)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(snapshot()).toEqual(before);
    }
  );

  it.each([
    ["closed", "SAR", 4000],
    ["active", "USD", 4000],
    ["active", "SAR", 2147483000],
  ])(
    "rejects unavailable wallet %s/%s/%i",
    async (status, currency, balance) => {
      Object.assign(wallet(), { status, currency, balance });
      const before = snapshot();
      await expect(refundInternalFunding(request(), 10)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(snapshot()).toEqual(before);
    }
  );

  it("rejects missing original credit allocation rather than minting a new credit lot", async () => {
    funding("user_credit");
    fixture.rows("credit_usage")[0].amountUsed--;
    const before = snapshot();
    await expect(refundInternalFunding(request(), 10)).rejects.toThrow(
      "Credit usage and refund receipts disagree"
    );
    expect(snapshot()).toEqual(before);
  });

  it("rolls back prior credit-lot restoration if a later original lot is inconsistent", async () => {
    funding("user_credit");
    fixture.rows("user_credits")[1].usedAmount = 0;
    const before = snapshot();
    await expect(
      refundInternalFunding(request({ amount: 7000 }), 10)
    ).rejects.toThrow("Original credit lot requires reconciliation");
    expect(snapshot()).toEqual(before);
  });

  it("rejects a changed corporate funding owner", async () => {
    funding("corporate_credit");
    fixture.rows("corporate_bookings")[0].corporateAccountId = 6;
    const before = snapshot();
    await expect(refundInternalFunding(request(), 10)).rejects.toThrow(
      "Corporate funding ownership changed"
    );
    expect(snapshot()).toEqual(before);
  });

  it.each<Tender>(["user_credit", "wallet", "corporate_credit"])(
    "rolls back %s restoration, cancellation, ledger and command claim when outbox persistence fails",
    async tender => {
      funding(tender);
      const before = snapshot();
      fixture.failInsert("outbox");
      await expect(
        refundInternalFunding(
          request({ amount: 10001, cancelItinerary: true }),
          10
        )
      ).rejects.toThrow("Injected insert failure");
      expect(snapshot()).toEqual(before);
    }
  );

  it("does not count another user's ledger refund as part of this funding receipt", async () => {
    receipts().push({
      ...receipts()[0],
      id: 51,
      userId: 999,
      type: "partial_refund",
      amount: "1.00",
      metadata: JSON.stringify({ tender: "wallet", originalLedgerId: 50 }),
    });
    const before = snapshot();
    await expect(refundInternalFunding(request(), 10)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(snapshot()).toEqual(before);
  });
});
