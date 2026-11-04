import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express from "express";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as unknown, settle: vi.fn() }));
vi.mock("../../db", () => ({ getDb: () => state.db }));
vi.mock("../../stripe", async () => {
  const module = await vi.importActual<typeof import("stripe")>("stripe");
  return { stripe: new module.default("sk_test_local_signature_fixture") };
});
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

const secret = "whsec_local_signature_fixture";
const sdk = new Stripe("sk_test_local_signature_fixture");
const payload = JSON.stringify({
  id: "evt_signed_boundary_1",
  type: "payment_intent.succeeded",
  data: {
    object: {
      id: "pi_signed_boundary_1",
      status: "succeeded",
      amount_received: 12345,
      currency: "sar",
      metadata: { bookingId: "10", userId: "1" },
    },
  },
});
let server: Server | undefined;
let origin: string;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  state.db = transactionMemory({ stripe_events: [] }).db;
  state.settle.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close(error => (error ? reject(error) : resolve()))
    );
    server = undefined;
  }
  vi.unstubAllEnvs();
});

async function start() {
  const { handleStripeWebhook } = await import("../../webhooks/stripe");
  const app = express();
  app.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
  );
  server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
}

async function deliver(body: string, signature?: string) {
  const response = await fetch(`${origin}/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "stripe-signature": signature } : {}),
    },
    body,
  });
  return { status: response.status, body: await response.json() };
}

describe("Stripe raw-body HTTP signature boundary", () => {
  it("settles a valid locally signed raw body and deduplicates its redelivery", async () => {
    await start();
    const signature = sdk.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    expect(await deliver(payload, signature)).toEqual({
      status: 200,
      body: { received: true },
    });
    expect(await deliver(payload, signature)).toEqual({
      status: 200,
      body: { received: true, deduplicated: true },
    });
    expect(state.settle).toHaveBeenCalledTimes(1);
    expect(state.settle.mock.calls[0][1]).toMatchObject({
      amount: 12345,
      paymentIntentId: "pi_signed_boundary_1",
    });
  });

  it("rejects an absent signature before reading the database", async () => {
    state.db = null;
    await start();
    expect(await deliver(payload)).toEqual({
      status: 400,
      body: { error: "Missing signature", retryable: false },
    });
    expect(state.settle).not.toHaveBeenCalled();
  });

  it("rejects a signed request when the server secret is absent", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    await start();
    const signature = sdk.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    expect((await deliver(payload, signature)).status).toBe(400);
    expect(state.settle).not.toHaveBeenCalled();
  });

  it.each([
    "altered-body",
    "wrong-secret",
    "expired-signature",
    "malformed-json",
  ])(
    "rejects %s without exposing verification details or settling money",
    async scenario => {
      await start();
      const signedPayload =
        scenario === "malformed-json" ? "not-json" : payload;
      const signature = sdk.webhooks.generateTestHeaderString({
        payload: signedPayload,
        secret: scenario === "wrong-secret" ? "whsec_other_fixture" : secret,
        ...(scenario === "expired-signature"
          ? { timestamp: Math.floor(Date.now() / 1000) - 600 }
          : {}),
      });
      const body =
        scenario === "altered-body"
          ? payload.replace("12345", "99999")
          : signedPayload;
      expect(await deliver(body, signature)).toEqual({
        status: 400,
        body: { error: "Signature verification failed", retryable: false },
      });
      expect(state.settle).not.toHaveBeenCalled();
    }
  );

  it("fails startup when a production webhook secret is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    await expect(import("../../webhooks/stripe")).rejects.toThrow(
      "STRIPE_WEBHOOK_SECRET is required in production"
    );
  });
});
