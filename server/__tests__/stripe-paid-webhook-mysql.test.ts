import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import * as schema from "../../drizzle/schema";
import {
  apiProcessWebhookSecret,
  startApiProcessFixture,
} from "./helpers/api-process-fixture";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
const sdk = new Stripe("sk_test_native_webhook_signature_only");

nativeDescribe.sequential(
  "paid Stripe events through the actual API and native MySQL",
  () => {
    let fixture: PaidBookingNativeFixture;
    let api: Awaited<ReturnType<typeof startApiProcessFixture>> | undefined;
    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_api_process");
    }, 60000);
    beforeEach(async () => {
      await fixture.reset();
      await fixture.seed();
      api = await startApiProcessFixture(fixture.databaseUrl);
    }, 40000);
    afterEach(async () => {
      await api?.close();
      api = undefined;
    }, 25000);
    afterAll(async () => {
      await fixture?.close();
    });

    function payload() {
      return JSON.stringify({
        id: `evt_native_paid_${randomUUID()}`,
        object: "event",
        type: "payment_intent.succeeded",
        livemode: false,
        data: {
          object: {
            id: `pi_native_paid_${randomUUID()}`,
            object: "payment_intent",
            status: "succeeded",
            amount: 20000,
            amount_received: 20000,
            currency: "sar",
            metadata: { type: "booking", bookingId: "71", userId: "9" },
          },
        },
      });
    }
    async function deliver(body: string, signed = true) {
      const response = await fetch(api!.origin + "/api/stripe/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(signed
            ? {
                "stripe-signature": sdk.webhooks.generateTestHeaderString({
                  payload: body,
                  secret: apiProcessWebhookSecret,
                }),
              }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(25000),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    }
    async function expectOneFunding() {
      const snapshot = await fixture.financialSnapshot();
      expect(snapshot.bookings).toMatchObject([
        {
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
          totalAmount: 20000,
        },
      ]);
      expect(
        snapshot.flights.find(row => row.id === 41)?.economyAvailable
      ).toBe(6);
      expect(snapshot.ledger).toHaveLength(1);
      expect(snapshot.receipts).toMatchObject([
        { amount: 20000, refundedAmount: 0, settlementStatus: "applied" },
      ]);
      expect(snapshot.confirmations).toHaveLength(1);
      expect(await fixture.db.select().from(schema.stripeEvents)).toMatchObject(
        [{ processed: true }]
      );
      return snapshot;
    }

    it("deduplicates an actual concurrent paid event insert and safely redelivers any losing request", async () => {
      const body = payload();
      const eventId = (JSON.parse(body) as { id: string }).id;
      const blocker = await fixture.pool.getConnection();
      const operations: Array<Promise<Awaited<ReturnType<typeof deliver>>>> =
        [];
      let results: Array<Awaited<ReturnType<typeof deliver>>> = [];
      try {
        await blocker.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await blocker.beginTransaction();
        // The empty-key gap blocks both inserts after their nonlocking reads.
        await blocker.query(
          "SELECT id FROM stripe_events WHERE id=? FOR UPDATE",
          [eventId]
        );
        operations.push(deliver(body));
        await fixture.waitForBlockedTransactions(1);
        operations.push(deliver(body));
        await fixture.waitForBlockedTransactions(2);
      } finally {
        await blocker.commit();
        blocker.release();
        results = await Promise.all(operations);
      }
      expect(results.some(result => result.status === 200)).toBe(true);
      for (const result of results) {
        expect([200, 500]).toContain(result.status);
        if (result.status === 500) expect(result.body.retryable).toBe(true);
      }
      expect((await deliver(body)).status).toBe(200);
      const committed = await expectOneFunding();
      expect(await deliver(body)).toEqual({
        status: 200,
        body: { received: true, deduplicated: true },
      });
      expect(await fixture.financialSnapshot()).toEqual(committed);
      expect(await fixture.db.select().from(schema.stripeEvents)).toHaveLength(
        1
      );
    }, 40000);

    it("rejects an unsigned paid body before financial mutation", async () => {
      const before = await fixture.financialSnapshot();
      expect(await deliver(payload(), false)).toEqual({
        status: 400,
        body: { error: "Missing signature", retryable: false },
      });
      expect(await fixture.financialSnapshot()).toEqual(before);
      expect(await fixture.db.select().from(schema.stripeEvents)).toHaveLength(
        0
      );
    });

    it("returns retryable 500 during an API-only database partition and settles the provider redelivery once after recovery", async () => {
      const body = payload();
      const before = await fixture.financialSnapshot();
      api!.proxy.disconnect();
      try {
        const failed = await deliver(body);
        expect(failed).toEqual({
          status: 500,
          body: { error: "Webhook processing failed", retryable: true },
        });
        expect(await fixture.financialSnapshot()).toEqual(before);
      } finally {
        api!.proxy.reconnect();
      }
      expect((await deliver(body)).status).toBe(200);
      const committed = await expectOneFunding();
      expect((await deliver(body)).status).toBe(200);
      expect(await fixture.financialSnapshot()).toEqual(committed);
    }, 40000);
  }
);
