import { describe, expect, it } from "vitest";
import {
  sandboxConfigurationIssues,
  verifyCapturedTestPayment,
} from "../../scripts/acceptance/stripe-sandbox-contract";

describe("Stripe sandbox evidence boundaries", () => {
  const env = {
    NODE_ENV: "test",
    AIS_DISPOSABLE_DATABASE: "true",
    DATABASE_URL: "mysql://test:test@localhost/ais_sandbox_test",
    STRIPE_SECRET_KEY: "sk_test_" + "synthetic_only",
  };
  it("requires all prerequisites without returning credentials", () => {
    expect(sandboxConfigurationIssues(env)).toEqual([]);
    const issues = sandboxConfigurationIssues({
      ...env,
      NODE_ENV: "production",
      AIS_DISPOSABLE_DATABASE: "false",
      DATABASE_URL: "mysql://test:password@localhost/ais",
      STRIPE_SECRET_KEY: "sk_live_" + "synthetic_only",
    });
    expect(issues).toHaveLength(4);
    expect(JSON.stringify(issues)).not.toContain("password");
    expect(JSON.stringify(issues)).not.toContain("synthetic_only");
  });
  it.each([
    undefined,
    "invalid",
    "postgres://test:test@localhost/ais_test",
    "mysql://test:test@localhost/ais_production",
  ])("rejects unsafe or missing database configuration: %s", database => {
    expect(
      sandboxConfigurationIssues({ ...env, DATABASE_URL: database })
    ).toHaveLength(1);
  });
  const metadata = {
    type: "split_payment",
    bookingId: "1",
    userId: "2",
    splitId: "3",
    checkoutRequestId: "saved-claim",
    invoiceHash: "saved-invoice",
  };
  const payment: Parameters<typeof verifyCapturedTestPayment>[0] = {
    id: "pi_synthetic",
    livemode: false,
    status: "succeeded",
    amount: 4000,
    amount_received: 4000,
    currency: "sar",
    metadata,
    latest_charge: "ch_synthetic",
  };
  const expected = { amount: 4000, metadata };
  it("marks direct retrieval distinctly from a signed webhook", () => {
    expect(verifyCapturedTestPayment(payment, expected)).toMatchObject({
      paymentIntentId: payment.id,
      amount: 4000,
      eventId: "sandbox_direct_retrieval:pi_synthetic",
    });
  });
  it.each([
    { livemode: true },
    { status: "processing" as const },
    { amount: 4001 },
    { amount_received: 3999 },
    { currency: "usd" },
    { latest_charge: null },
    { metadata: { ...metadata, userId: "foreign-owner" } },
    { metadata: { ...metadata, checkoutRequestId: "other-claim" } },
  ])("rejects unproven or mismatched capture %#", changed => {
    expect(() =>
      verifyCapturedTestPayment({ ...payment, ...changed }, expected)
    ).toThrow();
  });
  it("cannot prove capture without a frozen invoice identity", () => {
    expect(() =>
      verifyCapturedTestPayment(payment, { amount: 4000, metadata: {} })
    ).toThrow("identity missing");
  });
});
