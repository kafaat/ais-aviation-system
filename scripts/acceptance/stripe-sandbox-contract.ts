import assert from "node:assert/strict";
import type Stripe from "stripe";

/** Pure preflight: report missing prerequisites without accessing a provider or a database. */
export function sandboxConfigurationIssues(env: NodeJS.ProcessEnv) {
  const issues: string[] = [];
  if (env.NODE_ENV !== "test") issues.push("NODE_ENV must be test");
  if (env.AIS_DISPOSABLE_DATABASE !== "true")
    issues.push("AIS_DISPOSABLE_DATABASE must be true");
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (url.protocol !== "mysql:" || !/^\/[a-z0-9_]+_test$/i.test(url.pathname))
      throw new Error("not a disposable database name");
  } catch {
    issues.push(
      "DATABASE_URL must identify a disposable MySQL *_test database"
    );
  }
  if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))
    issues.push("Configure STRIPE_TEST_SECRET_KEY with a Stripe sk_test_ key");
  return issues;
}

/** Direct provider retrieval is evidence of capture, not of webhook delivery. */
export function verifyCapturedTestPayment(
  intent: Pick<
    Stripe.PaymentIntent,
    | "id"
    | "livemode"
    | "status"
    | "amount"
    | "amount_received"
    | "currency"
    | "metadata"
    | "latest_charge"
  >,
  expected: { amount: number; metadata: Record<string, string> }
) {
  assert.equal(
    intent.livemode,
    false,
    "Live payment cannot enter sandbox acceptance"
  );
  assert.equal(intent.status, "succeeded", "Test payment has not succeeded");
  assert(Number.isSafeInteger(expected.amount) && expected.amount > 0);
  assert.equal(
    intent.amount,
    expected.amount,
    "Payment amount differs from the frozen invoice"
  );
  assert.equal(
    intent.amount_received,
    expected.amount,
    "Captured amount differs from the frozen invoice"
  );
  assert.equal(
    intent.currency,
    "sar",
    "Payment currency differs from the invoice"
  );
  for (const key of [
    "type",
    "bookingId",
    "userId",
    "splitId",
    "checkoutRequestId",
    "invoiceHash",
  ])
    assert(
      expected.metadata[key],
      `Frozen split invoice identity missing: ${key}`
    );
  assert.equal(expected.metadata.type, "split_payment");
  for (const [key, value] of Object.entries(expected.metadata))
    assert.equal(
      intent.metadata[key],
      value,
      `Payment identity mismatch: ${key}`
    );
  const chargeId =
    typeof intent.latest_charge === "string"
      ? intent.latest_charge
      : intent.latest_charge?.id;
  assert(chargeId, "Captured payment has no charge identity");
  return {
    paymentIntentId: intent.id,
    amount: intent.amount_received,
    currency: intent.currency,
    metadata: intent.metadata,
    eventId: `sandbox_direct_retrieval:${intent.id}`,
  };
}
