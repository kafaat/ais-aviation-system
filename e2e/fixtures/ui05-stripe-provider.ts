import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

// Owned loopback provider fixture, not a Stripe sandbox or card-network test.
// The application still uses its real Stripe SDK, checkout claims, signed HTTP
// webhook handler, settlement transactions, receipts and financial ledger.
export const UI05_STRIPE_KEY = "sk_test_ui05_local_payment";
export const UI05_WEBHOOK_SECRET = "whsec_ui05_local_payment";

type Metadata = Record<string, string>;
type Session = {
  id: string;
  object: "checkout.session";
  mode: "payment";
  currency: "sar";
  amount_total: number;
  metadata: Metadata;
  payment_status: "unpaid" | "paid";
  status: "open" | "complete" | "expired";
  url: string;
  payment_intent: string | null;
  customer_email: string | null;
  expires_at: number;
  success_url: string;
  cancel_url: string;
};
type Refund = {
  id: string;
  object: "refund";
  amount: number;
  currency: "sar";
  payment_intent: string;
  charge: string;
  status: "succeeded";
  reason: string;
  metadata: Metadata;
  created: number;
};
export type Ui05ProviderSnapshot = {
  sessions: Array<
    Pick<
      Session,
      "id" | "amount_total" | "metadata" | "payment_status" | "payment_intent"
    >
  >;
  refunds: Refund[];
  requests: Array<{
    method: string;
    path: string;
    idempotencyKey: string | null;
  }>;
  webhooks: Array<{ eventId: string; sessionId: string; httpStatus: number }>;
  unexpected: string[];
};

async function form(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    assert(size <= 262144, "Fixture request exceeded its size limit");
    chunks.push(value);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
function metadata(input: URLSearchParams, prefix = "metadata"): Metadata {
  return Object.fromEntries(
    [...input]
      .filter(([key]) => key.startsWith(`${prefix}[`))
      .map(([key, value]) => [key.slice(prefix.length + 1, -1), value])
  );
}
function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

export async function startUi05StripeProvider(appOrigin: string) {
  assert.equal(new URL(appOrigin).origin, appOrigin);
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(appOrigin).hostname)
  );
  assert.equal(new URL(appOrigin).protocol, "http:");
  const sessions = new Map<string, Session>();
  const refunds = new Map<string, Refund>();
  const intents = new Map<
    string,
    { amount: number; charge: string; metadata: Metadata }
  >();
  const idempotent = new Map<
    string,
    { body: string; result: Session | Refund }
  >();
  const events = new Map<string, { id: string; payload: string }>();
  const requests: Ui05ProviderSnapshot["requests"] = [];
  const webhooks: Ui05ProviderSnapshot["webhooks"] = [];
  const unexpected: string[] = [];
  let origin = "";
  const reference = (prefix: string) =>
    `${prefix}_ui05_${randomUUID().replaceAll("-", "")}`;
  const activeRefunds = (intent: string) =>
    [...refunds.values()].filter(r => r.payment_intent === intent);
  const list = (path: string, data: unknown[]) => ({
    object: "list",
    url: path,
    has_more: false,
    data,
  });
  function snapshot(): Ui05ProviderSnapshot {
    return {
      sessions: [...sessions.values()].map(s => ({
        id: s.id,
        amount_total: s.amount_total,
        metadata: s.metadata,
        payment_status: s.payment_status,
        payment_intent: s.payment_intent,
      })),
      refunds: [...refunds.values()],
      requests,
      webhooks,
      unexpected,
    };
  }
  async function deliver(session: Session) {
    let event = events.get(session.id);
    if (!event) {
      assert.equal(session.status, "open");
      const intent = reference("pi");
      intents.set(intent, {
        amount: session.amount_total,
        charge: reference("ch"),
        metadata: session.metadata,
      });
      session.payment_intent = intent;
      session.payment_status = "paid";
      session.status = "complete";
      const id = reference("evt"); // Deliberately does not use the app's evt_test_ bypass.
      event = {
        id,
        payload: JSON.stringify({
          id,
          object: "event",
          type: "checkout.session.completed",
          api_version: "2025-12-15.clover",
          created: Math.floor(Date.now() / 1000),
          livemode: false,
          data: { object: session },
        }),
      };
      events.set(session.id, event);
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", UI05_WEBHOOK_SECRET)
      .update(`${timestamp}.${event.payload}`)
      .digest("hex");
    const response = await fetch(`${appOrigin}/api/stripe/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}`,
      },
      body: event.payload,
      signal: AbortSignal.timeout(30000),
    });
    webhooks.push({
      eventId: event.id,
      sessionId: session.id,
      httpStatus: response.status,
    });
    assert.equal(
      response.status,
      200,
      `Real webhook rejected local event: ${await response.text()}`
    );
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", origin);
      const path = url.pathname;
      const method = request.method ?? "GET";
      if (method === "GET" && path === "/__fixture/state")
        return json(response, snapshot());
      const replay = path.match(/^\/__fixture\/replay\/(cs_[a-z0-9_]+)$/);
      if (method === "POST" && replay) {
        const session = sessions.get(replay[1]);
        assert(
          session && events.has(session.id),
          "Only completed local sessions can be replayed"
        );
        await deliver(session);
        return json(response, { delivered: true });
      }
      const checkout = path.match(/^\/checkout\/(cs_[a-z0-9_]+)(\/complete)?$/);
      if (checkout) {
        const session = sessions.get(checkout[1]);
        assert(session, "Unknown local checkout");
        if (method === "GET" && !checkout[2]) {
          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(
            `<!doctype html><html lang="en"><title>Local payment fixture</title><h1>Local simulated payment</h1><p>This fixture does not contact Stripe or a card network.</p><p>Amount: <strong>${(session.amount_total / 100).toFixed(2)} SAR</strong></p><form method="post" action="${path}/complete"><button>Complete simulated payment</button></form></html>`
          );
          return;
        }
        if (method === "POST" && checkout[2]) {
          await deliver(session);
          const target = new URL(
            session.success_url.replace("{CHECKOUT_SESSION_ID}", session.id)
          );
          assert.equal(
            target.origin,
            appOrigin,
            "Provider redirect must return to the owned app"
          );
          response.writeHead(303, { location: target.href });
          response.end();
          return;
        }
      }
      if (path === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }
      assert.equal(
        request.headers.authorization,
        `Bearer ${UI05_STRIPE_KEY}`,
        "Only the synthetic provider key is accepted"
      );
      const key =
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : null;
      requests.push({ method, path, idempotencyKey: key });
      if (method === "GET" && path === "/v1/balance")
        return json(response, {
          object: "balance",
          available: [{ amount: 0, currency: "sar" }],
          pending: [],
          livemode: false,
        });
      if (
        method === "POST" &&
        ["/v1/checkout/sessions", "/v1/refunds"].includes(path)
      ) {
        const input = await form(request);
        assert(key, "Money operations must carry a stable idempotency key");
        const identity = `${path}:${key}`;
        const body = input.toString();
        const previous = idempotent.get(identity);
        if (previous) {
          assert.equal(
            previous.body,
            body,
            "Idempotency replay changed its provider request"
          );
          return json(response, previous.result);
        }
        let result: Session | Refund;
        if (path === "/v1/checkout/sessions") {
          const amount = Number(
            input.get("line_items[0][price_data][unit_amount]")
          );
          assert(Number.isSafeInteger(amount) && amount > 0);
          assert.equal(input.get("line_items[0][quantity]"), "1");
          assert.equal(input.get("line_items[0][price_data][currency]"), "sar");
          assert.equal(input.get("mode"), "payment");
          const meta = metadata(input);
          assert.deepEqual(
            metadata(input, "payment_intent_data[metadata]"),
            meta
          );
          assert(meta.bookingId && meta.checkoutRequestId && meta.userId);
          const successUrl = input.get("success_url");
          const cancelUrl = input.get("cancel_url");
          assert(successUrl && cancelUrl);
          for (const target of [successUrl, cancelUrl])
            assert.equal(new URL(target).origin, appOrigin);
          const id = reference("cs");
          result = {
            id,
            object: "checkout.session",
            mode: "payment",
            currency: "sar",
            amount_total: amount,
            metadata: meta,
            payment_status: "unpaid",
            status: "open",
            url: `${origin}/checkout/${id}`,
            payment_intent: null,
            customer_email: input.get("customer_email"),
            expires_at: Number(input.get("expires_at")),
            success_url: successUrl,
            cancel_url: cancelUrl,
          };
          sessions.set(id, result);
        } else {
          const intentId = input.get("payment_intent") ?? "";
          const intent = intents.get(intentId);
          assert(intent, "Refund must refer to a completed local payment");
          const amount = Number(input.get("amount"));
          assert(Number.isSafeInteger(amount) && amount > 0);
          assert(
            amount +
              activeRefunds(intentId).reduce((sum, r) => sum + r.amount, 0) <=
              intent.amount
          );
          result = {
            id: reference("re"),
            object: "refund",
            amount,
            currency: "sar",
            payment_intent: intentId,
            charge: intent.charge,
            status: "succeeded",
            reason: input.get("reason") ?? "requested_by_customer",
            metadata: metadata(input),
            created: Math.floor(Date.now() / 1000),
          };
          refunds.set(result.id, result);
        }
        idempotent.set(identity, { body, result });
        return json(response, result);
      }
      const sessionPath = path.match(
        /^\/v1\/checkout\/sessions\/(cs_[a-z0-9_]+)(\/expire)?$/
      );
      if (sessionPath) {
        const session = sessions.get(sessionPath[1]);
        assert(session, "Unknown provider session");
        if (method === "GET" && !sessionPath[2]) return json(response, session);
        if (method === "POST" && sessionPath[2]) {
          assert.equal(session.payment_status, "unpaid");
          session.status = "expired";
          return json(response, session);
        }
      }
      if (method === "GET" && path === "/v1/refunds")
        return json(
          response,
          list(
            path,
            activeRefunds(url.searchParams.get("payment_intent") ?? "")
          )
        );
      const refundPath = path.match(/^\/v1\/refunds\/(re_[a-z0-9_]+)$/);
      if (method === "GET" && refundPath) {
        const refund = refunds.get(refundPath[1]);
        assert(refund, "Unknown provider refund");
        return json(response, refund);
      }
      const chargePath = path.match(/^\/v1\/charges\/(ch_[a-z0-9_]+)$/);
      if (method === "GET" && chargePath) {
        const entry = [...intents].find(
          ([, intent]) => intent.charge === chargePath[1]
        );
        assert(entry, "Unknown provider charge");
        const [id, intent] = entry;
        const amountRefunded = activeRefunds(id).reduce(
          (sum, refund) => sum + refund.amount,
          0
        );
        return json(response, {
          id: intent.charge,
          object: "charge",
          amount: intent.amount,
          amount_refunded: amountRefunded,
          currency: "sar",
          payment_intent: id,
          paid: true,
          refunded: amountRefunded === intent.amount,
          refunds: list("/v1/refunds", activeRefunds(id)),
        });
      }
      throw new Error(
        `Unimplemented local provider request: ${method} ${path}`
      );
    })().catch(error => {
      unexpected.push(error instanceof Error ? error.message : String(error));
      json(
        response,
        {
          error: { type: "invalid_request_error", message: unexpected.at(-1) },
        },
        400
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      ),
  };
}
