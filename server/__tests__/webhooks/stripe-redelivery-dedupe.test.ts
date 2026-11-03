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
