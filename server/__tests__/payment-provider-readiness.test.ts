import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutWithProvider,
  getAllProviderInfo,
  getAllProviders,
  getAvailableProviderInfo,
  getAvailableProviders,
  getProvider,
  verifyPaymentWithProvider,
} from "../services/payment-providers";
import type { CheckoutSessionInput } from "../services/payment-providers/types";

const alternatives = [
  "hyperpay",
  "tabby",
  "tamara",
  "stc_pay",
  "floosak",
  "jawali",
  "onecash",
  "easycash",
] as const;
const configured = [
  "HYPERPAY_ENTITY_ID",
  "HYPERPAY_ACCESS_TOKEN",
  "TABBY_PUBLIC_KEY",
  "TABBY_SECRET_KEY",
  "TAMARA_API_TOKEN",
  "STC_PAY_MERCHANT_ID",
  "STC_PAY_API_KEY",
  "FLOOSAK_MERCHANT_ID",
  "FLOOSAK_API_KEY",
  "JAWALI_MERCHANT_ID",
  "JAWALI_API_KEY",
  "ONECASH_MERCHANT_ID",
  "ONECASH_API_KEY",
  "EASYCASH_MERCHANT_ID",
  "EASYCASH_API_KEY",
];
const input: CheckoutSessionInput = {
  bookingId: 71,
  userId: 9,
  amount: 10000,
  currency: "SAR",
  bookingReference: "SYN071",
  pnr: "SYN071",
  description: "Synthetic payment contract",
  successUrl: "https://synthetic.example.test/paid",
  cancelUrl: "https://synthetic.example.test/cancelled",
  idempotencyKey: "synthetic-checkout-operation",
};
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const key of configured) vi.stubEnv(key, `synthetic-${key}`);
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  // A successful-looking transport response must not turn an unaccepted adapter
  // into a usable payment authority. Nothing here contacts a remote endpoint.
  request = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "synthetic-provider-id",
      checkout_id: "synthetic-checkout-id",
      order_id: "synthetic-order-id",
      payment_id: "synthetic-payment-id",
      refund_id: "synthetic-refund-id",
      StatusCode: 0,
      STCPayPmtReference: "synthetic-stc-id",
      RefundReference: "synthetic-stc-refund",
      status: "completed",
      PaymentStatus: "Paid",
      result: { code: "000.000.000" },
    }),
  }));
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("alternative payment acceptance is required at every entrypoint", () => {
  it("inventories exactly eight unavailable alternative adapters without probing providers", () => {
    const actual = getAllProviders().filter(
      provider => provider.id !== "stripe"
    );
    expect(actual.map(provider => provider.id).sort()).toEqual(
      [...alternatives].sort()
    );
    for (const provider of actual) {
      expect(provider.isAvailable()).toBe(false);
      expect(provider.getInfo()).toMatchObject({
        id: provider.id,
        enabled: false,
        integrationState: "unverified",
        unavailableReason: expect.stringContaining(
          "settlement and refund integration"
        ),
      });
    }
    expect(request).not.toHaveBeenCalled();
  });

  describe.each(alternatives)("%s", providerId => {
    it("rejects central selection, checkout and verification even with credentials", () => {
      expect(() => getProvider(providerId)).toThrow(/before activation/);
      expect(() => createCheckoutWithProvider(providerId, input)).toThrow(
        /before activation/
      );
      expect(() =>
        verifyPaymentWithProvider(providerId, "synthetic-session")
      ).toThrow(/before activation/);
      expect(request).not.toHaveBeenCalled();
    });

    it.each(["open", "isolated"])(
      "blocks direct checkout, status and refund under %s boundary",
      async boundary => {
        vi.stubEnv("AIS_PROVIDER_BOUNDARY", boundary);
        const provider = getAllProviders().find(row => row.id === providerId)!;
        const denial = {
          code: "PRECONDITION_FAILED",
          message: expect.stringContaining("before activation"),
        };
        await expect(
          provider.createCheckoutSession(input)
        ).rejects.toMatchObject(denial);
        await expect(
          provider.verifyPayment("synthetic-session")
        ).rejects.toMatchObject(denial);
        await expect(
          provider.refund({
            transactionId: "synthetic-transaction",
            amount: 10000,
            idempotencyKey: "synthetic-refund-operation",
          })
        ).rejects.toMatchObject(denial);
        expect(request).not.toHaveBeenCalled();
      }
    );
  });

  it("keeps available and full metadata consistent while retaining the configured Stripe route", () => {
    expect(getAvailableProviders()).toEqual([]);
    expect(getAvailableProviderInfo()).toEqual([]);
    expect(getAllProviderInfo().every(provider => !provider.enabled)).toBe(
      true
    );
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_synthetic");
    expect(getAvailableProviders().map(provider => provider.id)).toEqual([
      "stripe",
    ]);
    expect(getAvailableProviderInfo()).toEqual(
      getAllProviderInfo().filter(provider => provider.enabled)
    );
    expect(getAvailableProviderInfo()).toMatchObject([
      { id: "stripe", enabled: true, integrationState: "implemented" },
    ]);
    expect(getProvider("stripe").id).toBe("stripe");
    expect(request).not.toHaveBeenCalled();
  });
});
