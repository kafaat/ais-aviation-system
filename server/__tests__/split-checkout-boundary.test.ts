import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({
  db: null as any,
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: state.create,
        retrieve: state.retrieve,
        expire: state.expire,
      },
    },
  },
}));
vi.mock("../services/email.service", () => ({}));
import {
  reserveSplitCheckout,
  createSplitCheckout,
  cancelPaymentSplits,
} from "../services/split-checkout.service";
import {
  initiateSplitPayment,
  recordSplitEmailDelivery,
  getPayerPaymentDetails,
  getSplitPaymentStatus,
  checkAllPaid,
} from "../services/split-payment.service";
import { payFromWallet } from "../services/wallet.service";
import { createBookingCheckout } from "../services/booking-checkout.service";
import {
  settleVerifiedPayment,
  settleVerifiedRefund,
} from "../services/payment-settlement.service";

let fixture: ReturnType<typeof transactionMemory>;
let sessions: Map<string, any>;
const token = "a".repeat(64);
const otherToken = "b".repeat(64);
const owner = { id: 9, role: "user" };
const cancel = () => cancelPaymentSplits({ bookingId: 7 }, owner);
const rows = () => fixture.rows("payment_splits");
const collect = (
  id: number,
  intent = `pi_${id}`,
  extra: Record<string, string> = {}
) =>
  fixture.db.transaction((tx: any) => {
    const split = rows().find(s => s.id === id)!;
    const metadata = split.checkoutRequestPayload
      ? JSON.parse(split.checkoutRequestPayload).metadata
      : {
          type: "split_payment",
          bookingId: "7",
          userId: "9",
          splitId: String(id),
        };
    return settleVerifiedPayment(tx, {
      paymentIntentId: intent,
      amount: split.amount,
      currency: "sar",
      eventId: `evt_${intent}`,
      metadata: { ...metadata, ...extra },
    });
  });
const refund = (intent: string, amount: number, amountRefunded: number) =>
  fixture.db.transaction((tx: any) =>
    settleVerifiedRefund(tx, {
      paymentIntentId: intent,
      chargeId: `ch_${intent}`,
      amount,
      amountRefunded,
      currency: "sar",
      eventId: `evt_refund_${intent}_${amountRefunded}`,
    })
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FRONTEND_URL", "https://app.example.test");
  sessions = new Map();
  fixture = transactionMemory({
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        cabinClass: "economy",
        numberOfPassengers: 1,
        bookingReference: "SPLIT7",
        pnr: "SPLIT7",
        totalAmount: 10000,
        status: "pending",
        paymentStatus: "pending",
        seatsReserved: false,
      },
    ],
    tenants: [{ id: 3, status: "active" }],
    flights: [
      {
        id: 4,
        tenantId: 3,
        airlineId: 2,
        status: "scheduled",
        economyAvailable: 5,
        businessAvailable: 5,
        departureTime: new Date("2035-01-01T10:00:00Z"),
      },
    ],
    payment_splits: [
      { id: 1, amount: 4000, paymentToken: token },
      { id: 2, amount: 6000, paymentToken: otherToken },
    ].map(s => ({
      ...s,
      bookingId: 7,
      payerEmail: `payer${s.id}@example.test`,
      payerName: "Payer",
      percentage: String(s.amount / 100),
      status: "pending",
      expiresAt: new Date(Date.now() + 3 * 86400000),
      checkoutRequestId: null,
      checkoutRequestPayload: null,
      checkoutRequestedAt: null,
      checkoutStatus: null,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
    })),
    wallets: [
      { id: 1, userId: 9, balance: 20000, currency: "SAR", status: "active" },
    ],
  });
  state.db = fixture.db;
  state.create.mockImplementation(async (request, options) => {
    const key = options.idempotencyKey;
    if (!sessions.has(key))
      sessions.set(key, {
        id: `cs_${sessions.size + 1}`,
        mode: "payment",
        amount_total: request.line_items[0].price_data.unit_amount,
        currency: "sar",
        metadata: request.metadata,
        status: "open",
        payment_status: "unpaid",
        url: "https://checkout.stripe.com/test",
      });
    return structuredClone(sessions.get(key));
  });
  state.retrieve.mockImplementation(async id =>
    structuredClone([...sessions.values()].find(s => s.id === id))
  );
  state.expire.mockImplementation(async id => {
    const session = [...sessions.values()].find(s => s.id === id)!;
    session.status = "expired";
    session.url = null;
    return structuredClone(session);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("durable split checkout lifecycle", () => {
  it("recovers a lost response with exactly the frozen provider payload and key", async () => {
    const create = state.create.getMockImplementation()!;
    state.create.mockImplementationOnce(async (...args) => {
      await create(...args);
      throw new Error("lost response");
    });
    await expect(createSplitCheckout(token)).rejects.toThrow("lost response");
    expect(rows()[0].checkoutStatus).toBe("creating");
    vi.stubEnv("FRONTEND_URL", "https://changed.example.test");
    const result = await createSplitCheckout(token);
    expect(state.create.mock.calls[0]).toEqual(state.create.mock.calls[1]);
    expect(sessions.size).toBe(1);
    expect(await createSplitCheckout(token)).toEqual(result);
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(fixture.rows("outbox")).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      status: "pending",
      checkoutStatus: "ready",
    });
    expect(state.create.mock.calls[0][0].metadata.paymentToken).toBeUndefined();
  });
  it("keeps a claim durable after outbox failure rolls the transaction back", async () => {
    fixture.failInsert("outbox");
    await expect(createSplitCheckout(token)).rejects.toThrow(
      "Injected insert failure"
    );
    expect(rows()[0].checkoutRequestId).toBeNull();
    expect(state.create).not.toHaveBeenCalled();
  });
  it("blocks an old unknown result without sending a fresh provider request", async () => {
    await reserveSplitCheckout(token);
    rows()[0].checkoutRequestedAt = new Date(Date.now() - 23 * 3600000);
    await expect(createSplitCheckout(token)).rejects.toThrow(
      "safe retry window"
    );
    await expect(cancel()).rejects.toThrow("safe retry window");
    expect(state.create).not.toHaveBeenCalled();
  });
  it.each(["amount_total", "currency", "metadata", "id", "mode"])(
    "rejects a mismatched provider %s before returning a URL",
    async field => {
      await createSplitCheckout(token);
      const original = await state.retrieve("cs_1");
      const bad = {
        amount_total: 1,
        currency: "usd",
        metadata: {},
        id: "cs_foreign",
        mode: "subscription",
      };
      state.retrieve.mockResolvedValue({
        ...original,
        [field]: bad[field as keyof typeof bad],
      });
      await expect(createSplitCheckout(token)).rejects.toThrow(
        "identity or invoice mismatch"
      );
      await expect(cancel()).rejects.toThrow("identity or invoice mismatch");
      expect(state.expire).not.toHaveBeenCalled();
      expect(rows()[0].status).toBe("pending");
    }
  );
  it("does not release a paid session just because cancellation was requested", async () => {
    await createSplitCheckout(token);
    sessions.values().next().value.status = "complete";
    sessions.values().next().value.payment_status = "paid";
    await expect(cancel()).rejects.toThrow("unpaid expired");
    expect(state.expire).not.toHaveBeenCalled();
    expect(rows().every(s => s.status === "pending")).toBe(true);
  });
  it("requires ownership before touching the provider, including direct service calls", async () => {
    await createSplitCheckout(token);
    state.retrieve.mockClear();
    await expect(
      cancelPaymentSplits({ bookingId: 7 }, { id: 8, role: "user" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.retrieve).not.toHaveBeenCalled();
    expect(state.expire).not.toHaveBeenCalled();
  });
  it("cancels all only after every session is expired, and permits a different payment rail", async () => {
    await createSplitCheckout(token);
    await createSplitCheckout(otherToken);
    await cancel();
    await cancel();
    expect(
      rows().every(
        s => s.status === "cancelled" && s.checkoutStatus === "expired"
      )
    ).toBe(true);
    expect(
      fixture
        .rows("outbox")
        .filter(e => e.eventType === "booking.split_payment_cancelled")
    ).toHaveLength(2);
    await payFromWallet(9, 7);
    expect(fixture.rows("wallets")[0].balance).toBe(10000);
  });
  it("does not partially cancel the plan if the last provider expiration fails", async () => {
    await createSplitCheckout(token);
    await createSplitCheckout(otherToken);
    const expire = state.expire.getMockImplementation()!;
    state.expire.mockImplementation(async id => {
      if (id === "cs_2") throw new Error("provider offline");
      return expire(id);
    });
    await expect(cancel()).rejects.toThrow("provider offline");
    expect(rows().every(s => s.status === "pending")).toBe(true);
    state.expire.mockImplementation(expire);
    await cancel();
    expect(rows().every(s => s.status === "cancelled")).toBe(true);
  });
  it("rejects a conflicting request created while provider expiration was in flight", async () => {
    await createSplitCheckout(token);
    const expire = state.expire.getMockImplementation()!;
    state.expire.mockImplementation(async id => {
      const result = await expire(id);
      rows()[0].checkoutRequestId = "new-concurrent-request";
      return result;
    });
    await expect(cancel()).rejects.toThrow("changed during cancellation");
    expect(rows().every(s => s.status === "pending")).toBe(true);
  });
  it("creates a new request only after provider-confirmed unpaid expiry", async () => {
    await createSplitCheckout(token);
    const first = rows()[0].checkoutRequestId;
    await state.expire("cs_1");
    await expect(createSplitCheckout(token)).rejects.toThrow(
      "Previous checkout expired"
    );
    expect(rows()[0].checkoutStatus).toBe("expired");
    expect((await createSplitCheckout(token)).sessionId).toBe("cs_2");
    expect(rows()[0].checkoutRequestId).not.toBe(first);
  });
  it("blocks changed invoices and legacy unknown sessions", async () => {
    await reserveSplitCheckout(token);
    rows()[0].payerEmail = "changed@example.test";
    await expect(createSplitCheckout(token)).rejects.toThrow(
      "Frozen split invoice"
    );
    rows()[1].stripeCheckoutSessionId = "cs_legacy";
    await expect(createSplitCheckout(otherToken)).rejects.toThrow(
      "Legacy checkout"
    );
    await expect(cancel()).rejects.toThrow("Legacy or incomplete");
  });
  it("does not overwrite a paid or closed share when email completion arrives late", async () => {
    await collect(1);
    await recordSplitEmailDelivery(1);
    expect(rows()[0].status).toBe("paid");
    rows()[1].status = "cancelled";
    await recordSplitEmailDelivery(2);
    expect(rows()[1].status).toBe("cancelled");
  });
  it("updates an email delivery while the share is still payable", async () => {
    await recordSplitEmailDelivery(1);
    expect(rows()[0].status).toBe("email_sent");
  });
  it("expired link reads are side-effect free and cannot erase a paid share", async () => {
    rows()[0].expiresAt = new Date(Date.now() - 1000);
    await expect(getPayerPaymentDetails(token)).resolves.toBeNull();
    expect(rows()[0].status).toBe("pending");
    await expect(createSplitCheckout(token)).rejects.toThrow(
      "no longer payable"
    );
    expect(rows()[0].status).toBe("pending");
  });
  it.each(["failed", "cancelled"])(
    "blocks wallet and a new split plan for unresolved %s checkout",
    async status => {
      rows().forEach(s => {
        s.status = status;
        s.stripeCheckoutSessionId = `cs_old_${s.id}`;
      });
      await expect(payFromWallet(9, 7)).rejects.toThrow(
        "unresolved split payment"
      );
      await expect(
        initiateSplitPayment({
          bookingId: 7,
          userId: 9,
          splits: [
            { name: "A", email: "a@example.test", amount: 5000 },
            { name: "B", email: "b@example.test", amount: 5000 },
          ],
        })
      ).rejects.toThrow("unresolved split payment");
    }
  );
  it("allows ordinary checkout after cancelling an unused plan", async () => {
    await cancel();
    // The existing booking service owns this transition; use its request shape.
    state.create.mockImplementationOnce(async request => ({
      id: "cs_booking",
      amount_total: 10000,
      currency: "sar",
      metadata: request.metadata,
      status: "open",
      payment_status: "unpaid",
      url: "https://checkout.stripe.com/booking",
    }));
    await createBookingCheckout({
      bookingId: 7,
      userId: 9,
      appBaseUrl: "https://app.example.test",
    });
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(1);
  });
});

describe("split collection and refund authority", () => {
  it("records distinct duplicate charges for review, while exact replays have no effect", async () => {
    await collect(1);
    await collect(1);
    await collect(1, "pi_duplicate");
    expect(fixture.rows("payment_receipts")).toHaveLength(2);
    expect(fixture.rows("payment_receipts")[1].settlementStatus).toBe(
      "review_required"
    );
    expect(rows()[0].stripePaymentIntentId).toBe("pi_1");
    expect(fixture.rows("financial_ledger")).toHaveLength(2);
    await refund("pi_duplicate", 4000, 4000);
    expect(fixture.rows("payment_receipts")[1].settlementStatus).toBe(
      "review_refunded"
    );
    expect(fixture.rows("bookings")[0].status).toBe("pending");
    await collect(2);
    expect(fixture.rows("bookings")[0].status).toBe("confirmed");
  });
  it.each(["cancelled", "expired"])(
    "retains a late collected payment on a %s share for review",
    async status => {
      rows()[0].status = status;
      await collect(1);
      expect(fixture.rows("payment_receipts")[0].settlementStatus).toBe(
        "review_required"
      );
      expect(rows()[0].status).toBe(status);
      expect(fixture.rows("bookings")[0].status).toBe("pending");
    }
  );
  it("does not apply a collected payment bearing an old checkout request identity", async () => {
    await reserveSplitCheckout(token);
    await collect(1, "pi_old", { checkoutRequestId: "different-request" });
    expect(fixture.rows("payment_receipts")[0].settlementStatus).toBe(
      "review_required"
    );
    expect(rows()[0].status).toBe("pending");
  });
  it("settles all shares once and releases seats once after cumulative refunds", async () => {
    await collect(1);
    await collect(2);
    await collect(2);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
    });
    expect(await checkAllPaid(7)).toBe(true);
    await refund("pi_1", 4000, 1000);
    expect((await getSplitPaymentStatus(7))?.paidAmount).toBe(9000);
    expect(await checkAllPaid(7)).toBe(false);
    await refund("pi_1", 4000, 4000);
    await refund("pi_2", 6000, 6000);
    await refund("pi_2", 6000, 6000);
    expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
    expect(fixture.rows("bookings")[0].paymentStatus).toBe("refunded");
    expect((await getSplitPaymentStatus(7))?.paidAmount).toBe(0);
  });
  it("never confirms a plan using funding already partly refunded", async () => {
    await collect(1);
    await refund("pi_1", 4000, 1000);
    await collect(2);
    expect(fixture.rows("bookings")[0].status).toBe("pending");
    expect(
      fixture
        .rows("payment_receipts")
        .every(r => r.settlementStatus === "review_required")
    ).toBe(true);
    await expect(reserveSplitCheckout(otherToken)).rejects.toThrow("review");
    expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
  });
  it("refuses to cancel a partly funded plan and rolls back late-payment review on outbox failure", async () => {
    await collect(1);
    await expect(cancel()).rejects.toThrow("Collected split payments");
    fixture.failInsert("outbox");
    await expect(collect(1, "pi_extra")).rejects.toThrow(
      "Injected insert failure"
    );
    expect(fixture.rows("payment_receipts")).toHaveLength(1);
  });
  it("rejects receipt replay with a different booking identity", async () => {
    await collect(1);
    fixture.rows("bookings").push({ ...fixture.rows("bookings")[0], id: 8 });
    await expect(collect(1, "pi_1", { bookingId: "8" })).rejects.toThrow(
      "receipt identity/amount mismatch"
    );
    expect(fixture.rows("payment_receipts")).toHaveLength(1);
  });
});
