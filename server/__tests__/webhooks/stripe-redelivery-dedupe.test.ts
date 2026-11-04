import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../helpers/transaction-memory";

const state = vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_redelivery";
  return {
    db: null as ReturnType<typeof transactionMemory>["db"] | null,
    constructEvent: vi.fn(),
    settle: vi.fn(),
  };
});
vi.mock("../../db", () => ({ getDb: () => state.db }));
vi.mock("../../stripe", () => ({
  stripe: { webhooks: { constructEvent: state.constructEvent } },
}));
vi.mock("../../services/payment-settlement.service", () => ({
  settleVerifiedPayment: state.settle,
  settleVerifiedRefund: vi.fn(),
}));
vi.mock("../../services/order-service-checkout.service", () => ({
  expireVerifiedOrderServiceCheckout: vi.fn(),
}));
vi.mock("../../services/order-refunds.service", () => ({
  recordVerifiedOrderRefund: vi.fn(),
}));
vi.mock("../../services/split-refund.service", () => ({
  recordVerifiedSplitRefund: vi.fn(),
}));
vi.mock("../../services/payment-dispute.service", () => ({
  disputeFromStripe: vi.fn(),
  recordVerifiedDispute: vi.fn(),
}));
vi.mock("../../services/email.service", () => ({
  sendBookingConfirmation: vi.fn(),
}));
vi.mock("../../services/eticket.service", () => ({
  generateETicketForPassenger: vi.fn(),
}));
vi.mock("../../services/notification.service", () => ({
  createNotification: vi.fn(),
}));

import { handleStripeWebhook } from "../../webhooks/stripe";

const event = {
  id: "evt_redelivered_1",
  type: "payment_intent.succeeded",
  api_version: "2024-06-20",
  data: {
    object: {
      id: "pi_1",
      status: "succeeded",
      amount_received: 12345,
      currency: "sar",
      metadata: { type: "booking", bookingId: "10", userId: "1" },
    },
  },
};

function deliver() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return handleStripeWebhook(
    { headers: { "stripe-signature": "sig" }, body: "raw" } as never,
    res as never
  ).then(() => res);
}

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  vi.resetAllMocks();
  fixture = transactionMemory({ stripe_events: [] });
  state.db = fixture.db;
  state.constructEvent.mockReturnValue(event);
  state.settle.mockResolvedValue(undefined);
});

describe("Stripe webhook redelivery", () => {
  it("returns a retryable failure when the database is unavailable without settling", async () => {
    state.db = null;
    const result = await deliver();
    expect(result.statusCode).toBe(500);
    expect(result.body).toEqual({
      error: "Database not available",
      retryable: true,
    });
    expect(state.settle).not.toHaveBeenCalled();
  });

  it.each(["ER_DUP_ENTRY", "23505", "23000"])(
    "acknowledges an already processed insert-race winner (%s)",
    async code => {
      const insert = fixture.db.insert.bind(fixture.db);
      vi.spyOn(fixture.db, "insert").mockImplementationOnce(
        (table: unknown) => ({
          values: async (values: Record<string, unknown>) => {
            await insert(table).values({ ...values, processed: true });
            throw Object.assign(new Error("duplicate"), { code });
          },
        })
      );
      const result = await deliver();
      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({ received: true, deduplicated: true });
      expect(state.settle).not.toHaveBeenCalled();
      expect(fixture.rows("stripe_events")[0].processed).toBe(true);
    }
  );

  it("processes an unprocessed insert-race winner once", async () => {
    const insert = fixture.db.insert.bind(fixture.db);
    vi.spyOn(fixture.db, "insert").mockImplementationOnce((table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        await insert(table).values(values);
        throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      },
    }));
    expect((await deliver()).statusCode).toBe(200);
    expect(state.settle).toHaveBeenCalledTimes(1);
    expect(fixture.rows("stripe_events")).toHaveLength(1);
    expect(fixture.rows("stripe_events")[0].processed).toBe(true);
  });

  it("rechecks processed status after the transaction acquires the row lock", async () => {
    const transaction = fixture.db.transaction.bind(fixture.db);
    vi.spyOn(fixture.db, "transaction").mockImplementationOnce(
      async (run: (db: unknown) => Promise<unknown>) => {
        // Deterministic competing-commit fixture, not a native lock simulation.
        fixture.rows("stripe_events")[0].processed = true;
        return transaction(run);
      }
    );
    expect((await deliver()).statusCode).toBe(200);
    expect(state.settle).not.toHaveBeenCalled();
    expect(fixture.rows("stripe_events")[0].processed).toBe(true);
  });

  it("keeps an unrelated insert failure retryable instead of treating it as a duplicate", async () => {
    fixture.failInsert("stripe_events");
    const result = await deliver();
    expect(result.statusCode).toBe(500);
    expect(result.body).toEqual({
      error: "Webhook processing failed",
      retryable: true,
    });
    expect(state.settle).not.toHaveBeenCalled();
    expect(fixture.rows("stripe_events")).toHaveLength(0);
  });

  it("does not overwrite a successful competing delivery while recording a failure", async () => {
    state.settle.mockRejectedValueOnce(new Error("transient failure"));
    const transaction = fixture.db.transaction.bind(fixture.db);
    vi.spyOn(fixture.db, "transaction").mockImplementationOnce(
      async (run: (db: unknown) => Promise<unknown>) => {
        try {
          return await transaction(run);
        } catch (error) {
          // The failed transaction has rolled back; a different worker commits.
          Object.assign(fixture.rows("stripe_events")[0], {
            processed: true,
            processedAt: new Date(),
            error: null,
          });
          throw error;
        }
      }
    );
    expect((await deliver()).statusCode).toBe(500);
    expect(fixture.rows("stripe_events")[0]).toMatchObject({
      processed: true,
      error: null,
      retryCount: 0,
    });
    expect((await deliver()).body).toEqual({
      received: true,
      deduplicated: true,
    });
    expect(state.settle).toHaveBeenCalledTimes(1);
  });

  it("returns a retryable response even when recording failure metadata also fails", async () => {
    state.settle.mockRejectedValueOnce(new Error("settlement unavailable"));
    vi.spyOn(fixture.db, "update").mockImplementation(() => ({
      set: () => ({ where: async () => Promise.reject(new Error("offline")) }),
    }));
    const result = await deliver();
    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({ retryable: true });
    expect(fixture.rows("stripe_events")[0].processed).toBe(false);
  });

  it("settles once for the same event id and acknowledges the redelivery", async () => {
    const first = await deliver();
    const second = await deliver();
    expect(first.statusCode).toBe(200);
    expect(first.body).toEqual({ received: true });
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual({ received: true, deduplicated: true });
    expect(state.settle).toHaveBeenCalledTimes(1);
    expect(state.settle.mock.calls[0][1]).toMatchObject({
      paymentIntentId: "pi_1",
      amount: 12345,
      eventId: "evt_redelivered_1",
    });
    const rows = fixture.rows("stripe_events");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "evt_redelivered_1",
      processed: true,
      retryCount: 0,
    });
  });

  it("keeps a failed delivery retryable and settles exactly once on the retry", async () => {
    state.settle.mockRejectedValueOnce(new Error("database deadlock"));
    const failed = await deliver();
    expect(failed.statusCode).toBe(500);
    expect(failed.body).toMatchObject({ retryable: true });
    expect(fixture.rows("stripe_events")[0]).toMatchObject({
      processed: false,
      retryCount: 1,
      error: "database deadlock",
    });
    const retried = await deliver();
    expect(retried.statusCode).toBe(200);
    expect(retried.body).toEqual({ received: true });
    expect(state.settle).toHaveBeenCalledTimes(2);
    expect(fixture.rows("stripe_events")[0]).toMatchObject({
      processed: true,
      error: null,
    });
    const third = await deliver();
    expect(third.body).toEqual({ received: true, deduplicated: true });
    expect(state.settle).toHaveBeenCalledTimes(2);
  });

  it("treats a different event id for the same intent as a separate delivery, leaving the receipt to settlement", async () => {
    await deliver();
    state.constructEvent.mockReturnValue({ ...event, id: "evt_other_2" });
    await deliver();
    expect(state.settle).toHaveBeenCalledTimes(2);
    expect(fixture.rows("stripe_events").map(r => r.id)).toEqual([
      "evt_redelivered_1",
      "evt_other_2",
    ]);
  });
});
