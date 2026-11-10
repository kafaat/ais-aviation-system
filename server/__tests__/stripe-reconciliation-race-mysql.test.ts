import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
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

/**
 * Scenario S-06 of docs/architecture/improvement-plan-2026-11.md.
 *
 * Two writers can settle the same payment intent: the signed webhook through
 * the real API process, and the reconciliation job that retrieves the intent
 * from the provider. Each locks the booking row before it looks at the ledger.
 * This suite holds that row from a third connection until both writers are
 * observed waiting on it, releases, and checks that the booking is funded
 * exactly once whichever writer wins.
 */
const provider = vi.hoisted(() => ({
  intent: null as Record<string, unknown> | null,
  retrieved: 0,
}));
vi.mock("../services/stripe/client-factory", () => ({
  createStripeClient: () => ({
    paymentIntents: {
      retrieve: async () => {
        provider.retrieved += 1;
        if (!provider.intent) throw new Error("No intent fixture");
        return provider.intent;
      },
    },
  }),
}));

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

type ReconciliationModule =
  typeof import("../services/stripe/stripe-reconciliation.service");

const sdk = new Stripe("sk_test_native_reconciliation_signature_only");

nativeDescribe.sequential(
  "webhook settlement racing reconciliation on native MySQL",
  () => {
    let fixture: PaidBookingNativeFixture;
    let api: Awaited<ReturnType<typeof startApiProcessFixture>> | undefined;
    let reconciliation: ReconciliationModule;

    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_api_process");
      // The in-process reconciliation must open the application's lazy
      // connection against the disposable schema, like the API child does.
      process.env.DATABASE_URL = fixture.databaseUrl;
      process.env.STRIPE_SECRET_KEY = "sk_test_native_reconciliation_fixture";
      reconciliation =
        await import("../services/stripe/stripe-reconciliation.service");
    }, 60000);

    beforeEach(async () => {
      await fixture.reset();
      await fixture.seed();
      provider.intent = null;
      provider.retrieved = 0;
      api = await startApiProcessFixture(fixture.databaseUrl);
    }, 40000);

    afterEach(async () => {
      await api?.close();
      api = undefined;
    }, 25000);

    afterAll(async () => {
      await fixture?.close();
    });

    async function seedPendingPayment(intentId: string) {
      // Old enough for the job's checkout-lifetime guard (32 minutes).
      const createdAt = new Date(Date.now() - 60 * 60 * 1000);
      await fixture.db.insert(schema.payments).values({
        bookingId: 71,
        amount: 20000,
        currency: "SAR",
        method: "card",
        provider: "stripe",
        status: "pending",
        stripePaymentIntentId: intentId,
        transactionId: intentId,
        createdAt,
        updatedAt: createdAt,
      });
    }

    function intent(intentId: string) {
      return {
        id: intentId,
        object: "payment_intent",
        status: "succeeded",
        amount: 20000,
        amount_received: 20000,
        currency: "sar",
        latest_charge: `ch_native_${randomUUID()}`,
        metadata: { type: "booking", bookingId: "71", userId: "9" },
      };
    }

    async function deliverWebhook(intentId: string) {
      const body = JSON.stringify({
        id: `evt_native_race_${randomUUID()}`,
        object: "event",
        type: "payment_intent.succeeded",
        livemode: false,
        data: { object: intent(intentId) },
      });
      const response = await fetch(api!.origin + "/api/stripe/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": sdk.webhooks.generateTestHeaderString({
            payload: body,
            secret: apiProcessWebhookSecret,
          }),
        },
        body,
        signal: AbortSignal.timeout(25000),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    }

    /**
     * The two writers do not leave the same rows behind. The webhook path
     * (`settleVerifiedPayment` → `recordReceipt`) inserts a payment receipt, a
     * new completed `payments` row and the ledger charge; the reconciliation
     * path updates the seeded pending `payments` row, confirms the booking and
     * writes the ledger charge, but no receipt. Refund services read receipts
     * by intent id, so a booking funded only by reconciliation has no refund
     * evidence (review finding REC-01, #333). The invariants below are the
     * ones both paths must satisfy; the receipt and payment-row counts are
     * asserted per winner and will tighten once the paths converge.
     */
    async function expectFundedOnce(
      intentId: string,
      settledBy: "webhook" | "job" | "either"
    ) {
      const snapshot = await fixture.financialSnapshot();
      expect(snapshot.bookings).toMatchObject([
        {
          id: 71,
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
          totalAmount: 20000,
        },
      ]);
      expect(
        snapshot.flights.find(row => row.id === 41)?.economyAvailable
      ).toBe(6);
      const charges = snapshot.ledger.filter(
        row => row.type === "charge" && row.stripePaymentIntentId === intentId
      );
      expect(charges).toHaveLength(1);
      expect(snapshot.ledger).toHaveLength(1);
      expect(snapshot.confirmations).toHaveLength(1);
      if (settledBy === "webhook")
        expect(snapshot.receipts).toMatchObject([
          { amount: 20000, refundedAmount: 0, settlementStatus: "applied" },
        ]);
      else if (settledBy === "job") expect(snapshot.receipts).toHaveLength(0);
      else expect(snapshot.receipts.length).toBeLessThanOrEqual(1);
      const paymentRows = await fixture.db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.stripePaymentIntentId, intentId));
      // The seeded pending row must not survive as pending; the webhook path
      // adds a second completed row for the same intent (REC-01).
      expect(paymentRows.length).toBeGreaterThanOrEqual(1);
      expect(paymentRows.length).toBeLessThanOrEqual(2);
      expect(paymentRows.filter(row => row.status === "pending")).toEqual([]);
      expect(paymentRows.every(row => row.amount === 20000)).toBe(true);
      return snapshot;
    }

    it("funds the booking exactly once when the webhook and the job wait on the same booking row", async () => {
      const intentId = `pi_native_race_${randomUUID()}`;
      await seedPendingPayment(intentId);
      provider.intent = intent(intentId);

      const blocker = await fixture.pool.getConnection();
      let webhook:
        Promise<Awaited<ReturnType<typeof deliverWebhook>>> | undefined;
      let job:
        | Promise<
            Awaited<ReturnType<ReconciliationModule["runStripeReconciliation"]>>
          >
        | undefined;
      try {
        await blocker.beginTransaction();
        await blocker.query("SELECT id FROM bookings WHERE id=71 FOR UPDATE");
        webhook = deliverWebhook(intentId);
        await fixture.waitForBlockedTransactions(1);
        job = reconciliation.runStripeReconciliation({
          lookbackDays: 30,
          correlationId: "native-race",
        });
        await fixture.waitForBlockedTransactions(2);
      } finally {
        await blocker.commit();
        blocker.release();
      }
      if (!webhook || !job) throw new Error("Both writers must have started");
      const [delivered, result] = await Promise.all([webhook, job]);

      expect(delivered.status).toBe(200);
      expect(result.scanned).toBe(1);
      expect(provider.retrieved).toBe(1);
      // Whichever writer settled first, the other must have recognised the
      // funded booking: nothing is double counted and nothing is reported as a
      // failed payment.
      expect(result.failed).toBe(0);
      expect(result.fixed + result.skipped + result.errors).toBe(1);
      await expectFundedOnce(intentId, "either");
    });

    it("lets reconciliation fund a booking whose webhook never arrived, and a later webhook adds nothing", async () => {
      const intentId = `pi_native_late_${randomUUID()}`;
      await seedPendingPayment(intentId);
      provider.intent = intent(intentId);

      const result = await reconciliation.runStripeReconciliation({
        lookbackDays: 30,
        correlationId: "native-late-webhook",
      });
      expect(result).toMatchObject({
        scanned: 1,
        fixed: 1,
        failed: 0,
        errors: 0,
      });
      await expectFundedOnce(intentId, "job");

      // The late webhook finds the booking already paid for this intent and
      // returns without writing; it does not back-fill the missing receipt.
      const delivered = await deliverWebhook(intentId);
      expect(delivered.status).toBe(200);
      await expectFundedOnce(intentId, "job");
    });

    it("leaves a pending payment untouched when the provider still reports it unpaid", async () => {
      const intentId = `pi_native_unpaid_${randomUUID()}`;
      await seedPendingPayment(intentId);
      provider.intent = { ...intent(intentId), status: "processing" };

      const result = await reconciliation.runStripeReconciliation({
        lookbackDays: 30,
        correlationId: "native-unpaid",
      });
      expect(result).toMatchObject({ scanned: 1, fixed: 0, failed: 0 });
      const snapshot = await fixture.financialSnapshot();
      expect(snapshot.ledger).toHaveLength(0);
      expect(snapshot.receipts).toHaveLength(0);
      expect(snapshot.bookings[0]).toMatchObject({
        status: "pending",
        paymentStatus: "pending",
      });
      const [payment] = await fixture.db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.stripePaymentIntentId, intentId));
      expect(payment?.status).toBe("pending");
    });
  }
);
