import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  refund: vi.fn(),
}));
vi.mock("../stripe/client-factory", () => ({
  createStripeClient: () => ({
    checkout: { sessions: { create: mocks.create } },
    refunds: { create: mocks.refund },
  }),
}));

import { StripeProvider } from "./stripe.provider";

const checkoutInput = {
  bookingId: 10,
  userId: 1,
  amount: 12345,
  currency: "SAR",
  bookingReference: "REF001",
  pnr: "PNR001",
  description: "Flight Booking - REF001",
  successUrl: "https://app.example.test/ok",
  cancelUrl: "https://app.example.test/cancel",
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_provider_boundary";
  mocks.create.mockResolvedValue({ id: "cs_1", url: "https://pay" });
  mocks.refund.mockResolvedValue({
    id: "re_1",
    status: "succeeded",
    amount: 500,
  });
});

describe("StripeProvider idempotency pass-through", () => {
  it("forwards the caller's operation key as the checkout idempotency key", async () => {
    const provider = new StripeProvider();
    await provider.createCheckoutSession({
      ...checkoutInput,
      idempotencyKey: "booking-checkout:claim-1",
    });
    await provider.createCheckoutSession({
      ...checkoutInput,
      idempotencyKey: "booking-checkout:claim-1",
    });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    for (const [params, options] of mocks.create.mock.calls) {
      expect(options).toEqual({
        idempotencyKey: "booking-checkout:claim-1",
        timeout: 15000,
        maxNetworkRetries: 0,
      });
      expect(JSON.stringify(params)).not.toMatch(/traceId/);
    }
    expect(mocks.create.mock.calls[0][0]).toEqual(
      mocks.create.mock.calls[1][0]
    );
  });

  it.each([undefined, "", " ", "key\r\n", "a".repeat(256)])(
    "rejects an invalid key before either provider write (%j)",
    async invalidKey => {
      const provider = new StripeProvider();
      // Untyped callers can bypass the required TypeScript field.
      const idempotencyKey = invalidKey as string;
      await expect(
        provider.createCheckoutSession({ ...checkoutInput, idempotencyKey })
      ).rejects.toThrow("Provider idempotency key is invalid");
      await expect(
        provider.refund({ transactionId: "pi_1", amount: 500, idempotencyKey })
      ).rejects.toThrow("Provider idempotency key is invalid");
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.refund).not.toHaveBeenCalled();
    }
  );

  it("keys a refund by the caller's refund operation identity", async () => {
    await new StripeProvider().refund({
      transactionId: "pi_1",
      amount: 500,
      idempotencyKey: "order-refund:44",
    });
    expect(mocks.refund.mock.calls[0][1]).toEqual({
      idempotencyKey: "order-refund:44",
      timeout: 15000,
      maxNetworkRetries: 0,
    });
  });
});
