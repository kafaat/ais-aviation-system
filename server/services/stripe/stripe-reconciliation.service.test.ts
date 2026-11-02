import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDb, retrieve, transaction } = vi.hoisted(() => ({
  getDb: vi.fn(),
  retrieve: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("../../db", () => ({ getDb }));
vi.mock("../outbox.service", () => ({}));
vi.mock("../booking-checkout.service", () => ({}));
vi.mock("../booking-settlement.service", () => ({}));
vi.mock("../baggage-custody.service", () => ({}));
vi.mock("../order-servicing.service", () => ({}));
vi.mock("./client-factory", () => ({
  createStripeClient: () => ({ paymentIntents: { retrieve } }),
}));

import { runStripeReconciliation } from "./stripe-reconciliation.service";

const payment = {
  paymentId: 1,
  bookingId: 2,
  bookingUserId: 3,
  paymentStatus: "pending",
  paymentCurrency: "SAR",
  paymentAmount: 1400,
  bookingTotal: 1400,
  stripePaymentIntentId: "pi_test",
};
const intent = {
  id: "pi_test",
  amount_received: 1400,
  currency: "sar",
  status: "succeeded",
  metadata: { bookingId: "2", userId: "3", type: "booking" },
};

describe("reconciliation provider observations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_SECRET_KEY", "test-fixture");
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      limit: () => [payment],
    };
    getDb.mockReturnValue({ select: () => query, transaction });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    { amount_received: 1300 },
    { currency: "usd" },
    { id: "pi_other" },
    { metadata: { bookingId: "5" } },
    { metadata: { userId: "6" } },
    { metadata: { type: "split_payment" } },
  ])(
    "refuses mismatched capture %# before opening a transaction",
    async patch => {
      retrieve.mockResolvedValue({ ...intent, ...patch });
      const result = await runStripeReconciliation();
      expect(result).toMatchObject({ scanned: 1, errors: 1, fixed: 0 });
      expect(transaction).not.toHaveBeenCalled();
    }
  );
  it("leaves an unresolved payment method open for a new attempt", async () => {
    retrieve.mockResolvedValue({
      ...intent,
      status: "requires_payment_method",
    });
    const result = await runStripeReconciliation();
    expect(result).toMatchObject({ errors: 0, failed: 0, skipped: 1 });
    expect(transaction).not.toHaveBeenCalled();
  });
  it("ends only the cancelled attempt and never cancels the booking", async () => {
    const update = vi.fn(() => ({ set: () => ({ where: vi.fn() }) }));
    transaction.mockImplementationOnce(callback => callback({ update }));
    retrieve.mockResolvedValue({ ...intent, status: "canceled" });
    const result = await runStripeReconciliation();
    expect(result).toMatchObject({ failed: 1, errors: 0 });
    expect(update).toHaveBeenCalledTimes(1);
  });
  it("rejects an invoice repriced while Stripe was being contacted", async () => {
    const lockedBooking = {
      ...payment,
      userId: payment.bookingUserId,
      totalAmount: 2000,
    };
    const query = {
      from: () => query,
      where: () => query,
      for: () => [lockedBooking],
    };
    const update = vi.fn();
    transaction.mockImplementationOnce(callback =>
      callback({ select: () => query, update })
    );
    retrieve.mockResolvedValue(intent);
    const result = await runStripeReconciliation();
    expect(result).toMatchObject({ errors: 1, fixed: 0 });
    expect(update).not.toHaveBeenCalled();
  });
  it("does not overwrite a payment already transitioned during provider retrieval", async () => {
    const booking = {
      id: payment.bookingId,
      userId: payment.bookingUserId,
      totalAmount: 1400,
    };
    const query = {
      from: () => query,
      where: () => query,
      for: () => [booking],
      limit: () => [],
    };
    const update = () => ({
      set: () => ({ where: () => [{ affectedRows: 0 }] }),
    });
    const insert = vi.fn();
    transaction.mockImplementationOnce(callback =>
      callback({ select: () => query, update, insert })
    );
    retrieve.mockResolvedValue(intent);
    const result = await runStripeReconciliation();
    expect(result).toMatchObject({ errors: 1, fixed: 0 });
    expect(insert).not.toHaveBeenCalled();
  });
  it("reports matching captures in dry-run without a write", async () => {
    retrieve.mockResolvedValue(intent);
    const result = await runStripeReconciliation({ dryRun: true });
    expect(result.details[0].action).toContain("WOULD_CONFIRM");
    expect(transaction).not.toHaveBeenCalled();
  });
});
