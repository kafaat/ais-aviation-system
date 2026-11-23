import { eq, sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
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
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

/**
 * Issue #382 (ADR 0003 follow-up): failed and review_required servicing
 * refunds (order_service_refunds) of both origins, exchange and flight
 * cancellation, are listed for operators and resolved in-app: reconcile
 * (provider read only), retry after a definitive provider failure (a new
 * attempt key), and cancel with a reason (the held upgrade money goes to
 * settlement review). Booking 71 collected 20000 on its original intent and
 * 6000 on an upgrade intent. These cases drive the payments router, the
 * refund worker and the verified Stripe event path on migrated native MySQL
 * tables; provider responses are synthetic.
 *
 * "fix" cases fail on 036417292c; "control" cases pass there too.
 */
const provider = vi.hoisted(() => ({
  db: null as any,
  refunds: [] as any[],
  refuse: new Set<string>(),
  failing: new Set<string>(),
  status: "succeeded",
  create: null as any,
  retrieve: null as any,
  list: null as any,
  email: null as any,
}));
vi.mock("../db", () => ({ getDb: () => provider.db }));
vi.mock("../services/email.service", () => ({
  sendRefundConfirmation: (...args: unknown[]) => provider.email(...args),
}));
vi.mock("../stripe", () => ({
  stripe: {
    refunds: {
      create: (...args: unknown[]) => provider.create(...args),
      retrieve: (...args: unknown[]) => provider.retrieve(...args),
      list: (...args: unknown[]) => provider.list(...args),
    },
  },
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { processStripeEvent } from "../webhooks/stripe";
import {
  assertNoOrderRefundPending,
  processPendingOrderRefunds,
} from "../services/order-refunds.service";
import {
  processFlightCancellations,
  requestFlightCancellation,
} from "../services/flight-cancellation.service";
import {
  listSettlementReviews,
  requestSettlementReviewRefund,
} from "../services/settlement-review.service";
import { lostDisputeCover } from "../services/payment-dispute.service";
import { getExchangeContext } from "../services/order-exchange-context.service";
import { paymentsRouter } from "../routers/payments";
import type { TrpcContext } from "../_core/context";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

const now = new Date("2030-05-20T06:00:00Z");
const original = "pi_r382_original";
const upgrade = "pi_r382_upgrade";
const requestId = "00000000-0000-4000-8000-000000000382";
const collected: Record<string, number> = {
  [original]: 20000,
  [upgrade]: 6000,
};
const later = (minutes: number) =>
  vi.setSystemTime(new Date(now.getTime() + minutes * 60_000));
const heldReason =
  "Booking refunded on its original collection while this upgrade collection still holds money";
const reason = "Customer refunded by bank transfer, case 4411";
const REVIEW_CODES = [
  "unknown_provider_outcome",
  "duplicate_provider_refund",
  "provider_refund_balance_conflict",
  "provider_history_limit",
] as const;
const NON_ADMIN_ROLES = ["user", "support", "airline_admin", "finance", "ops"];

function caller(role = "admin") {
  return paymentsRouter.createCaller({
    user: { id: 20, role, tenantId: 3 },
    tenantId: null,
    authMethod: "bearer",
    req: { ip: "198.51.100.82", headers: {} },
    res: {},
  } as unknown as TrpcContext);
}

nativeDescribe.sequential(
  "issue #382: operator resolution of failed servicing refunds on native MySQL",
  () => {
    let fixture: PaidBookingNativeFixture;
    let sequence = 0;

    const keys = () =>
      provider.create.mock.calls.map(
        ([, options]: [unknown, { idempotencyKey?: string }]) =>
          options?.idempotencyKey
      );
    async function row(id = requestId) {
      const [saved] = await fixture.db
        .select()
        .from(schema.orderServiceRefunds)
        .where(eq(schema.orderServiceRefunds.id, id));
      return saved;
    }
    async function rows() {
      return fixture.db
        .select()
        .from(schema.orderServiceRefunds)
        .orderBy(schema.orderServiceRefunds.paymentIntentId);
    }
    async function attempts() {
      return (
        await fixture.db
          .select()
          .from(schema.orderServiceRefundAttempts)
          .orderBy(schema.orderServiceRefundAttempts.attempt)
      ).map(({ requestId, attempt, refundId, status, errorCode }) => ({
        requestId,
        attempt,
        refundId,
        status,
        errorCode,
      }));
    }
    async function receipts() {
      const saved = await fixture.db.select().from(schema.paymentReceipts);
      return Object.fromEntries(
        saved.map(r => [r.paymentIntentId, r.refundedAmount])
      );
    }
    async function receiptSettlement(paymentIntentId: string) {
      const [saved] = await fixture.db
        .select({
          status: schema.paymentReceipts.settlementStatus,
          error: schema.paymentReceipts.settlementError,
        })
        .from(schema.paymentReceipts)
        .where(eq(schema.paymentReceipts.paymentIntentId, paymentIntentId));
      return saved;
    }
    async function refundLedger() {
      return (
        await fixture.db
          .select({
            type: schema.financialLedger.type,
            amount: schema.financialLedger.amount,
            paymentIntentId: schema.financialLedger.stripePaymentIntentId,
          })
          .from(schema.financialLedger)
          .orderBy(schema.financialLedger.id)
      ).filter(r => ["refund", "partial_refund"].includes(r.type));
    }
    async function events(eventType: string) {
      return (
        await fixture.db
          .select()
          .from(schema.outbox)
          .where(eq(schema.outbox.eventType, eventType))
          .orderBy(schema.outbox.id)
      ).map(r => r.payload as Record<string, unknown>);
    }
    async function booking() {
      const [saved] = await fixture.db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, 71));
      return saved;
    }
    async function resolutionAudits() {
      return (
        await fixture.db
          .select()
          .from(schema.auditLogs)
          .orderBy(schema.auditLogs.id)
      ).filter(r => r.eventType.startsWith("ORDER_REFUND_"));
    }
    async function liabilityOpen() {
      return fixture.db
        .transaction(tx => assertNoOrderRefundPending(tx as never, 71))
        .then(
          () => false,
          (error: Error) => /liability/.test(error.message)
        );
    }
    async function deliverRefund(refund: any, id = `evt_r382_${++sequence}`) {
      await fixture.db.transaction(tx =>
        processStripeEvent(
          tx as never,
          { id, type: "refund.updated", data: { object: refund } } as never
        )
      );
    }
    const chargeRefunded = (paymentIntentId: string, refunded: number) =>
      fixture.db.transaction(tx =>
        processStripeEvent(
          tx as never,
          {
            id: `evt_r382_${++sequence}`,
            type: "charge.refunded",
            data: {
              object: {
                id: `ch_${paymentIntentId}`,
                object: "charge",
                payment_intent: paymentIntentId,
                amount: collected[paymentIntentId],
                amount_refunded: refunded,
                currency: "sar",
              },
            },
          } as never
        )
      );
    async function deliverDispute(
      type: string,
      paymentIntentId: string,
      amount: number,
      status: string
    ) {
      await fixture.db.transaction(tx =>
        processStripeEvent(
          tx as never,
          {
            id: `evt_r382_${++sequence}`,
            type,
            data: {
              object: {
                id: `dp_r382_${paymentIntentId}`,
                object: "dispute",
                charge: `ch_${paymentIntentId}`,
                payment_intent: paymentIntentId,
                amount,
                currency: "sar",
                status,
                reason: "fraudulent",
              },
            },
          } as never
        )
      );
    }
    const withdraw = (paymentIntentId: string, amount: number) =>
      deliverDispute(
        "charge.dispute.funds_withdrawn",
        paymentIntentId,
        amount,
        "under_review"
      );
    const lose = (paymentIntentId: string, amount: number) =>
      deliverDispute("charge.dispute.closed", paymentIntentId, amount, "lost");
    async function saveServicing(
      values: Partial<typeof schema.orderServiceRefunds.$inferInsert> = {}
    ) {
      await fixture.db.insert(schema.orderServiceRefunds).values({
        id: requestId,
        bookingId: 71,
        modificationId: 9001,
        paymentIntentId: upgrade,
        amount: 6000,
        baseRefundedAmount: 0,
        status: "queued",
        nextAttemptAt: now,
        createdAt: new Date(now.getTime() - 60_000),
        ...values,
      });
    }
    // Saved as order servicing saves it, then refused by the provider through
    // the worker: failed, with the refused refund recorded.
    async function failServicing(
      values: Partial<typeof schema.orderServiceRefunds.$inferInsert> = {}
    ) {
      await saveServicing(values);
      const intent = values.paymentIntentId ?? upgrade;
      provider.refuse.add(intent);
      await processPendingOrderRefunds();
      provider.refuse.delete(intent);
      const saved = await row(values.id ?? requestId);
      expect(saved).toMatchObject({
        status: "failed",
        errorCode: "provider_refund_failed",
      });
      return provider.refunds.find(r => r.id === saved.refundId);
    }
    // Two operators retrying the same reviewed attempt at once, while a
    // transaction holds the booking lock: both must wait on it.
    async function waitForWaiters(count: number) {
      for (let i = 0; i < 250; i++) {
        const [found] = await fixture.admin.query<RowDataPacket[]>(
          "SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=?",
          [fixture.databaseName]
        );
        if (Number(found[0]?.waiting) >= count) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(`Expected ${count} InnoDB waiters on the booking lock`);
    }
    async function retryConcurrently() {
      const holder = await fixture.pool.getConnection();
      try {
        await holder.query("START TRANSACTION");
        await holder.query("SELECT id FROM bookings WHERE id = 71 FOR UPDATE");
        const first = caller().retryServicingRefund({ requestId, attempt: 1 });
        const second = caller().retryServicingRefund({ requestId, attempt: 1 });
        const settled = Promise.allSettled([first, second]);
        try {
          await waitForWaiters(2);
        } finally {
          await holder.query("COMMIT");
        }
        return await settled;
      } finally {
        holder.release();
      }
    }

    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_api_process");
    }, 60000);
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      await fixture.reset();
      await fixture.seed();
      sequence = 0;
      provider.db = fixture.db;
      provider.refunds = [];
      provider.refuse = new Set();
      provider.failing = new Set();
      provider.status = "succeeded";
      provider.email = vi.fn(async () => true);
      provider.retrieve = vi.fn(
        async (id: string) => provider.refunds.find(r => r.id === id) ?? null
      );
      provider.list = vi.fn((params: { payment_intent?: string }) => ({
        async *[Symbol.asyncIterator]() {
          for (const refund of provider.refunds)
            if (refund.payment_intent === params.payment_intent) yield refund;
        },
      }));
      provider.create = vi.fn(
        async (request: any, options?: { idempotencyKey?: string }) => {
          if (provider.failing.has(request.payment_intent))
            throw new Error("Synthetic provider outage");
          const replay = provider.refunds.find(
            r => r.idempotencyKey === options?.idempotencyKey
          );
          if (replay) return replay;
          const refund = {
            id: `re_${request.payment_intent}_${provider.refunds.length + 1}`,
            object: "refund",
            status: provider.refuse.has(request.payment_intent)
              ? "failed"
              : provider.status,
            // Without an amount the provider refunds what the intent holds.
            amount:
              request.amount ??
              collected[request.payment_intent] -
                provider.refunds
                  .filter(
                    r =>
                      r.payment_intent === request.payment_intent &&
                      r.status === "succeeded"
                  )
                  .reduce((sum, r) => sum + r.amount, 0),
            currency: "sar",
            payment_intent: request.payment_intent,
            charge: `ch_${request.payment_intent}`,
            metadata: request.metadata,
            idempotencyKey: options?.idempotencyKey,
          };
          provider.refunds.push(refund);
          return refund;
        }
      );
      await fixture.db.insert(schema.users).values({
        id: 20,
        openId: "native-r382-operator",
        tenantId: 3,
        role: "admin",
      });
      await fixture.db
        .update(schema.bookings)
        .set({
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
          stripePaymentIntentId: original,
          totalAmount: 26000,
          createdAt: new Date("2030-05-01T00:00:00Z"),
        })
        .where(eq(schema.bookings.id, 71));
      await fixture.db
        .update(schema.flights)
        .set({ economyAvailable: 6 })
        .where(eq(schema.flights.id, 41));
      await fixture.db.insert(schema.paymentReceipts).values([
        {
          paymentIntentId: original,
          bookingId: 71,
          targetId: 71,
          userId: 9,
          kind: "booking",
          amount: 20000,
          refundedAmount: 0,
          currency: "SAR",
          settlementStatus: "applied",
          createdAt: new Date("2030-05-01T00:00:00Z"),
        },
        {
          paymentIntentId: upgrade,
          bookingId: 71,
          targetId: 9001,
          userId: 9,
          kind: "modification",
          amount: 6000,
          refundedAmount: 0,
          currency: "SAR",
          settlementStatus: "applied",
          createdAt: new Date("2030-05-05T00:00:00Z"),
        },
      ]);
      await fixture.db.insert(schema.payments).values({
        tenantId: 3,
        bookingId: 71,
        amount: 20000,
        currency: "SAR",
        method: "card",
        provider: "stripe",
        status: "completed",
        stripePaymentIntentId: original,
      });
      for (const [i, passengerId] of [81, 82].entries()) {
        const ticketNumber = `06500000000${passengerId}`;
        await fixture.db
          .update(schema.passengers)
          .set({ ticketNumber })
          .where(eq(schema.passengers.id, passengerId));
        await fixture.db.insert(schema.ticketCoupons).values({
          bookingId: 71,
          passengerId,
          flightId: 41,
          ticketNumber,
          couponNumber: 1,
          status: "O",
        });
        await fixture.db.insert(schema.seatInventory).values({
          flightId: 41,
          seatMapId: 1,
          seatNumber: `12${i ? "B" : "A"}`,
          row: 12,
          column: i ? "B" : "A",
          cabinClass: "economy",
          seatType: "window",
          status: "available",
        });
      }
    }, 40000);
    afterEach(() => vi.useRealTimers());
    afterAll(async () => {
      await fixture?.close();
    });

    describe("operator list", () => {
      it("fix: a provider-failed exchange servicing refund is listed with its booking, intent, amount and error code", async () => {
        const refused = await failServicing();
        const listed = await caller().servicingRefundReviews({ limit: 50 });
        expect(listed).toEqual([
          expect.objectContaining({
            id: requestId,
            origin: "exchange",
            status: "failed",
            bookingId: 71,
            bookingReference: "NM0071",
            modificationId: 9001,
            cancellationFlightId: null,
            paymentIntentId: upgrade,
            amount: 6000,
            currency: "SAR",
            errorCode: "provider_refund_failed",
            refundId: refused.id,
            attempt: 1,
            requestedAt: expect.any(Date),
            createdAt: expect.any(Date),
          }),
        ]);
      }, 60000);

      it("fix: provider-failed flight-cancellation servicing refunds are listed too", async () => {
        provider.refuse = new Set([original, upgrade]);
        await requestFlightCancellation({
          flightId: 41,
          reason: "Native r382 flight cancellation",
          actorId: 20,
          tenantId: 3,
        });
        await processFlightCancellations();
        const listed = await caller().servicingRefundReviews({ limit: 50 });
        expect(
          listed
            .map(r => [
              r.origin,
              r.status,
              r.bookingReference,
              r.cancellationFlightId,
              r.modificationId,
              r.paymentIntentId,
              r.amount,
              r.errorCode,
              r.attempt,
            ])
            .sort((a, b) => String(a[5]).localeCompare(String(b[5])))
        ).toEqual([
          [
            "flight_cancellation",
            "failed",
            "NM0071",
            41,
            null,
            original,
            20000,
            "provider_refund_failed",
            1,
          ],
          [
            "flight_cancellation",
            "failed",
            "NM0071",
            41,
            null,
            upgrade,
            6000,
            "provider_refund_failed",
            1,
          ],
        ]);
      }, 60000);

      it("fix: only failed and review_required rows are listed, newest first, within the limit", async () => {
        const at = (minutes: number) =>
          new Date(now.getTime() + minutes * 60_000);
        const ids = (n: number) => `00000000-0000-4000-8000-00000000038${n}`;
        const statuses = [
          ["failed", 1],
          ["review_required", 2],
          ["failed", 3],
          ["succeeded", 4],
          ["queued", 5],
          ["cancelled", 6],
        ] as const;
        for (const [status, n] of statuses)
          await saveServicing({
            id: ids(n),
            modificationId: 9000 + n,
            status,
            errorCode:
              status === "review_required" ? "unknown_provider_outcome" : null,
            createdAt: at(n),
          });
        expect(
          (await caller().servicingRefundReviews({ limit: 50 })).map(r => r.id)
        ).toEqual([ids(3), ids(2), ids(1)]);
        expect(
          (await caller().servicingRefundReviews({ limit: 2 })).map(r => r.id)
        ).toEqual([ids(3), ids(2)]);
        await expect(
          caller().servicingRefundReviews({ limit: 101 })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }, 60000);
    });

    describe("reconcile", () => {
      it("fix: a review_required row whose provider refund later succeeded settles once, as a normal success would", async () => {
        // An exchange refund of 5000 on the original intent: its request was
        // sent a day ago and the provider showed no refund, so the worker
        // could not know the outcome.
        await saveServicing({
          paymentIntentId: original,
          amount: 5000,
          status: "requesting",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
          nextAttemptAt: new Date(now.getTime() - 60_000),
        });
        await processPendingOrderRefunds();
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
        });
        expect(provider.create).not.toHaveBeenCalled();
        // The provider now shows the request's refund, succeeded.
        const late = {
          id: "re_r382_late",
          object: "refund",
          status: "succeeded",
          amount: 5000,
          currency: "sar",
          payment_intent: original,
          charge: `ch_${original}`,
          metadata: { orderServiceRefundId: requestId, modificationId: "9001" },
        };
        provider.refunds.push(late);
        const answer = await caller().reconcileServicingRefund({ requestId });
        expect(answer).toEqual({
          requestId,
          status: "succeeded",
          attempt: 1,
          errorCode: null,
          refundId: late.id,
          outcome: "settled",
        });
        const settled = async () => {
          expect(await row()).toMatchObject({
            status: "succeeded",
            refundId: late.id,
            completedAt: expect.any(Date),
          });
          expect(await receipts()).toEqual({ [original]: 5000, [upgrade]: 0 });
          expect(await refundLedger()).toEqual([
            {
              type: "partial_refund",
              amount: "50.00",
              paymentIntentId: original,
            },
          ]);
          expect(await booking()).toMatchObject({
            status: "confirmed",
            paymentStatus: "paid",
          });
          expect(await events("order.refund_updated")).toEqual([
            {
              requestId,
              modificationId: 9001,
              status: "succeeded",
              refundId: late.id,
            },
          ]);
        };
        await settled();
        // Repeats change nothing and nothing is ever sent.
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "unchanged", status: "succeeded" });
        await deliverRefund(late);
        await chargeRefunded(original, 5000);
        await processPendingOrderRefunds();
        await settled();
        expect(provider.create).not.toHaveBeenCalled();
      }, 60000);

      it("fix: with no provider refund the row is unchanged and the answer says so; a provider outage changes nothing", async () => {
        await saveServicing({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        const before = await row();
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "no_provider_refund",
          status: "review_required",
        });
        provider.list.mockImplementation(() => ({
          async *[Symbol.asyncIterator]() {
            throw new Error("Synthetic provider outage");
          },
        }));
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
        expect(await row()).toEqual(before);
        expect(provider.create).not.toHaveBeenCalled();
      }, 60000);

      it("fix: a provider refund the saved balance no longer matches is a typed refusal and changes nothing", async () => {
        await saveServicing({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        provider.refunds.push({
          id: "re_r382_late_upgrade",
          object: "refund",
          status: "succeeded",
          amount: 6000,
          currency: "sar",
          payment_intent: upgrade,
          charge: `ch_${upgrade}`,
          metadata: { orderServiceRefundId: requestId, modificationId: "9001" },
        });
        // The receipt recorded another refund since the request was saved.
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: 1000 })
          .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
        const before = await row();
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: "Refund balance changed outside this servicing request",
        });
        expect(await row()).toEqual(before);
        expect(await refundLedger()).toEqual([]);
      }, 60000);
    });

    describe("retry after a definitive provider failure", () => {
      it("fix: two concurrent retries queue one attempt; the worker sends one refund under order-refund:<id>:a2 and its verified webhook settles it once", async () => {
        const refused = await failServicing();
        const results = await retryConcurrently();
        expect(results.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
        const values = results
          .map(r => (r as PromiseFulfilledResult<any>).value)
          .sort((a, b) => Number(a.replayed) - Number(b.replayed));
        expect(values).toEqual([
          {
            requestId,
            status: "queued",
            attempt: 2,
            errorCode: null,
            refundId: null,
            replayed: false,
          },
          expect.objectContaining({ attempt: 2, replayed: true }),
        ]);
        expect(await attempts()).toEqual([
          {
            requestId,
            attempt: 1,
            refundId: refused.id,
            status: "failed",
            errorCode: "provider_refund_failed",
          },
        ]);
        expect(await row()).toMatchObject({
          attempt: 2,
          status: "queued",
          refundId: null,
          requestedAt: null,
          errorCode: null,
        });
        expect(await liabilityOpen()).toBe(true);
        // Exactly one new provider refund, under the attempt key.
        provider.status = "pending";
        await processPendingOrderRefunds();
        expect(provider.create).toHaveBeenCalledTimes(2);
        expect(provider.create.mock.calls[1]).toEqual([
          {
            payment_intent: upgrade,
            amount: 6000,
            metadata: {
              orderServiceRefundId: requestId,
              modificationId: "9001",
              attempt: "2",
            },
          },
          { idempotencyKey: `order-refund:${requestId}:a2` },
        ]);
        const sent = provider.refunds.at(-1);
        expect(await row()).toMatchObject({
          status: "pending",
          refundId: sent.id,
        });
        sent.status = "succeeded";
        await deliverRefund(sent);
        const settledOnce = async () => {
          expect(await row()).toMatchObject({
            status: "succeeded",
            attempt: 2,
            refundId: sent.id,
          });
          expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
          expect(await refundLedger()).toEqual([
            { type: "refund", amount: "60.00", paymentIntentId: upgrade },
          ]);
          expect(
            (await events("order.refund_updated")).filter(
              e => e.status === "succeeded"
            )
          ).toHaveLength(1);
        };
        await settledOnce();
        await deliverRefund(sent);
        await chargeRefunded(upgrade, 6000);
        later(5);
        await processPendingOrderRefunds();
        await settledOnce();
        expect(provider.create).toHaveBeenCalledTimes(2);
        expect(await liabilityOpen()).toBe(false);
        // A repeated retry of the reviewed attempt changes nothing.
        expect(
          await caller().retryServicingRefund({ requestId, attempt: 1 })
        ).toMatchObject({ attempt: 2, status: "succeeded", replayed: true });
        expect(await attempts()).toHaveLength(1);
        expect(
          (await resolutionAudits()).map(r => [r.eventType, r.userId])
        ).toEqual([["ORDER_REFUND_RETRY_REQUESTED", 20]]);
      }, 60000);

      for (const providerStatus of ["failed", "canceled"] as const)
        it(`fix: a late ${providerStatus} event or charge aggregate for the archived attempt changes nothing, before and after the new attempt settles`, async () => {
          const refused = await failServicing();
          refused.status = providerStatus;
          await caller().retryServicingRefund({ requestId, attempt: 1 });
          expect((await attempts())[0].status).toBe(providerStatus);
          const queued = await row();
          const eventsBefore = await events("order.refund_updated");
          provider.retrieve.mockClear();
          provider.list.mockClear();
          await deliverRefund(refused);
          await chargeRefunded(upgrade, 0);
          expect(await row()).toEqual(queued);
          expect(await events("order.refund_updated")).toEqual(eventsBefore);
          expect(await refundLedger()).toEqual([]);
          // The webhook transaction never calls the provider.
          expect(provider.retrieve).not.toHaveBeenCalled();
          expect(provider.list).not.toHaveBeenCalled();
          // Attempt 2 succeeds; the late event for attempt 1 arrives after.
          await processPendingOrderRefunds();
          const settled = await row();
          expect(settled).toMatchObject({ status: "succeeded", attempt: 2 });
          await deliverRefund(refused);
          expect(await row()).toEqual(settled);
          expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
          expect(await refundLedger()).toHaveLength(1);
        }, 60000);

      for (const code of REVIEW_CODES)
        it(`fix: a review_required row with ${code} is never retried, even when the provider shows no refund that has not failed`, async () => {
          const refused = await failServicing();
          // Reconcile found an uncertain outcome; the refused refund stays.
          await fixture.db
            .update(schema.orderServiceRefunds)
            .set({ status: "review_required", errorCode: code })
            .where(eq(schema.orderServiceRefunds.id, requestId));
          const before = await row();
          await expect(
            caller().retryServicingRefund({ requestId, attempt: 1 })
          ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
          await fixture.db
            .update(schema.orderServiceRefunds)
            .set({ refundId: null })
            .where(eq(schema.orderServiceRefunds.id, requestId));
          await expect(
            caller().retryServicingRefund({ requestId, attempt: 1 })
          ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
          expect(await row()).toEqual({ ...before, refundId: null });
          expect(await attempts()).toEqual([]);
          await processPendingOrderRefunds();
          expect(provider.create).toHaveBeenCalledTimes(1);
          expect(refused.status).toBe("failed");
        }, 60000);

      it("fix: retry is refused when the collection no longer holds the refund at its saved balance", async () => {
        await failServicing();
        // Another refund of 1000 was recorded on the upgrade collection.
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: 1000 })
          .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
        const before = await row();
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await row()).toEqual(before);
        expect(await attempts()).toEqual([]);
      }, 60000);

      it("fix: retry is refused when the provider's other refunds of the collection differ from the saved balance", async () => {
        await failServicing();
        provider.refunds.push({
          id: "re_r382_elsewhere",
          object: "refund",
          status: "succeeded",
          amount: 1000,
          currency: "sar",
          payment_intent: upgrade,
          charge: `ch_${upgrade}`,
          metadata: {},
        });
        const before = await row();
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await row()).toEqual(before);
        expect(await attempts()).toEqual([]);
      }, 60000);

      it("fix: a retry for another attempt than the one reviewed is a conflict", async () => {
        await failServicing();
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 3 })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await expect(
          caller().retryServicingRefund({
            requestId: "00000000-0000-4000-8000-000000000999",
            attempt: 1,
          })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }, 60000);
    });

    describe("a provider refund that has not failed blocks retry and cancel", () => {
      it("fix: the provider reports the recorded refund as succeeded", async () => {
        const refused = await failServicing();
        refused.status = "succeeded";
        const before = await row();
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        await expect(
          caller().cancelServicingRefund({ requestId, attempt: 1, reason })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await row()).toEqual(before);
        expect(await attempts()).toEqual([]);
        expect(await resolutionAudits()).toEqual([]);
      }, 60000);

      it("fix: a pending refund for a request whose outcome was unknown", async () => {
        await saveServicing({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        provider.refunds.push({
          id: "re_r382_pending",
          object: "refund",
          status: "pending",
          amount: 6000,
          currency: "sar",
          payment_intent: upgrade,
          charge: `ch_${upgrade}`,
          metadata: { orderServiceRefundId: requestId, modificationId: "9001" },
        });
        const before = await row();
        await expect(
          caller().cancelServicingRefund({ requestId, attempt: 1, reason })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await row()).toEqual(before);
      }, 60000);
    });

    describe("never two successful refunds for one liability, whatever the event order", () => {
      async function retried() {
        const refused = await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        return refused;
      }
      const settledOnce = async () => {
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
        expect(await refundLedger()).toEqual([
          { type: "refund", amount: "60.00", paymentIntentId: upgrade },
        ]);
      };

      it("fix (a): attempt 2 succeeds, then attempt 1's failed event arrives late: settled once, no change", async () => {
        const refused = await retried();
        await processPendingOrderRefunds();
        const settled = await row();
        expect(settled).toMatchObject({ status: "succeeded", attempt: 2 });
        await deliverRefund(refused);
        expect(await row()).toEqual(settled);
        await settledOnce();
      }, 60000);

      it("fix (b): attempt 1 reports succeeded after attempt 2 settled: no second settlement, the row goes to review", async () => {
        const refused = await retried();
        await processPendingOrderRefunds();
        expect(await row()).toMatchObject({ status: "succeeded" });
        // Provider anomaly: the refused refund is reported as succeeded.
        refused.status = "succeeded";
        provider.retrieve.mockClear();
        await deliverRefund(refused);
        expect(provider.retrieve).not.toHaveBeenCalled();
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          completedAt: expect.any(Date),
        });
        expect((await events("order.refund_updated")).at(-1)).toMatchObject({
          status: "review_required",
          refundId: refused.id,
          errorCode: "earlier_attempt_succeeded",
        });
        await settledOnce();
        // Reconcile reads the refund from the provider and settles nothing.
        const answer = await caller().reconcileServicingRefund({ requestId });
        expect(provider.retrieve).toHaveBeenCalledWith(refused.id);
        expect(answer).toMatchObject({
          outcome: "review_required",
          status: "review_required",
        });
        await deliverRefund(refused);
        await deliverRefund(provider.refunds.at(-1));
        await settledOnce();
        expect(await liabilityOpen()).toBe(true);
      }, 60000);

      it("fix (c): attempt 1's success arrives while attempt 2 is queued: attempt 2 is never sent, and reconcile settles once from the provider", async () => {
        const refused = await retried();
        refused.status = "succeeded";
        await deliverRefund(refused);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          attempt: 2,
          refundId: null,
        });
        expect(await refundLedger()).toEqual([]);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        later(5);
        await processPendingOrderRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(keys()).toEqual([`order-refund:${requestId}`]);
        provider.retrieve.mockClear();
        const answer = await caller().reconcileServicingRefund({ requestId });
        expect(provider.retrieve).toHaveBeenCalledWith(refused.id);
        expect(answer).toMatchObject({
          outcome: "settled",
          status: "succeeded",
          refundId: refused.id,
        });
        await settledOnce();
        await deliverRefund(refused);
        await chargeRefunded(upgrade, 6000);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "unchanged" });
        later(10);
        await processPendingOrderRefunds();
        await settledOnce();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await row()).toMatchObject({
          status: "succeeded",
          refundId: refused.id,
        });
      }, 60000);
    });

    describe("the worker finds an earlier attempt's success", () => {
      it("fix: with no event, the queued attempt is never sent, its request time stays empty and reconcile settles once", async () => {
        const refused = await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        // Provider anomaly, seen only in the provider's history.
        refused.status = "succeeded";
        await processPendingOrderRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          attempt: 2,
          refundId: null,
          requestedAt: null,
        });
        expect((await events("order.refund_updated")).at(-1)).toMatchObject({
          status: "review_required",
          refundId: refused.id,
        });
        expect(await refundLedger()).toEqual([]);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "settled", refundId: refused.id });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
        expect(await refundLedger()).toEqual([
          { type: "refund", amount: "60.00", paymentIntentId: upgrade },
        ]);
        later(5);
        await processPendingOrderRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await refundLedger()).toHaveLength(1);
      }, 60000);
    });

    describe("cancel with a reason", () => {
      it("fix: cancelling a failed servicing refund removes the liability; the held upgrade goes to settlement review and is refunded there once, with an audit row", async () => {
        // Decision 7 legacy replay: the original intent is fully refunded
        // while a failed servicing refund covers the whole upgrade.
        await failServicing();
        await chargeRefunded(original, 20000);
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "refunded",
        });
        expect(await receiptSettlement(upgrade)).toEqual({
          status: "applied",
          error: null,
        });
        expect(await liabilityOpen()).toBe(true);
        const answer = await caller().cancelServicingRefund({
          requestId,
          attempt: 1,
          reason: `  ${reason}  `,
        });
        expect(answer).toMatchObject({
          requestId,
          status: "cancelled",
          attempt: 1,
          settlementReview: true,
          replayed: false,
        });
        expect(await row()).toMatchObject({
          status: "cancelled",
          resolvedBy: 20,
          resolvedAt: expect.any(Date),
          resolutionReason: reason,
          errorCode: "provider_refund_failed",
        });
        expect(await liabilityOpen()).toBe(false);
        expect(await receiptSettlement(upgrade)).toEqual({
          status: "review_required",
          error: heldReason,
        });
        expect(
          (await listSettlementReviews(50)).map(r => [
            r.paymentIntentId,
            r.kind,
            r.amount,
            r.refundedAmount,
          ])
        ).toEqual([[upgrade, "modification", 6000, 0]]);
        expect(await events("payment.settlement_review_required")).toEqual([
          { paymentIntentId: upgrade, bookingId: 71, reason: heldReason },
        ]);
        const audits = await resolutionAudits();
        expect(
          audits.map(a => ({
            eventType: a.eventType,
            eventCategory: a.eventCategory,
            userId: a.userId,
            resourceType: a.resourceType,
            resourceId: a.resourceId,
            newValue: JSON.parse(a.newValue ?? "null"),
          }))
        ).toEqual([
          {
            eventType: "ORDER_REFUND_CANCELLED",
            eventCategory: "refund",
            userId: 20,
            resourceType: "order_service_refund",
            resourceId: requestId,
            newValue: { status: "cancelled", reason },
          },
        ]);
        // The settlement review refund goes out once and settles the upgrade.
        await expect(
          requestSettlementReviewRefund(upgrade, 20)
        ).resolves.toMatchObject({ state: "awaiting_webhook" });
        expect(keys().at(-1)).toBe(`ais-review-refund:${upgrade}`);
        await chargeRefunded(upgrade, 6000);
        expect(await receipts()).toEqual({
          [original]: 20000,
          [upgrade]: 6000,
        });
        expect(await receiptSettlement(upgrade)).toEqual({
          status: "review_refunded",
          error: heldReason,
        });
        expect(await refundLedger()).toEqual([
          { type: "refund", amount: "200.00", paymentIntentId: original },
          { type: "refund", amount: "60.00", paymentIntentId: upgrade },
        ]);
        await chargeRefunded(upgrade, 6000);
        await expect(
          requestSettlementReviewRefund(upgrade, 20)
        ).resolves.toEqual({ state: "refunded", refundId: null });
        expect(
          keys().filter(k => k === `ais-review-refund:${upgrade}`)
        ).toHaveLength(1);
        expect(await refundLedger()).toHaveLength(2);
        // A repeated cancel changes nothing.
        expect(
          await caller().cancelServicingRefund({
            requestId,
            attempt: 1,
            reason,
          })
        ).toMatchObject({ status: "cancelled", replayed: true });
        expect(await resolutionAudits()).toHaveLength(1);
        expect(await events("payment.settlement_review_required")).toHaveLength(
          1
        );
        expect(await caller().servicingRefundReviews({ limit: 50 })).toEqual(
          []
        );
      }, 60000);

      it("fix: a cancelled exchange refund reads as review to the customer", async () => {
        await fixture.db.insert(schema.bookingModifications).values({
          id: 9001,
          bookingId: 71,
          userId: 9,
          modificationType: "change_flight",
          originalFlightId: 41,
          newFlightId: 42,
          originalAmount: 26000,
          newAmount: 20000,
          priceDifference: -6000,
          totalCost: -6000,
          status: "completed",
        });
        await saveServicing({
          status: "cancelled",
          errorCode: "provider_refund_failed",
          resolvedBy: 20,
          resolvedAt: now,
          resolutionReason: reason,
        });
        const context = await getExchangeContext(71, 9, 3);
        expect(context.latest?.refundStatus).toBe("review");
      }, 60000);

      it("fix: the reason must be 10 to 500 characters and the attempt must be the one reviewed", async () => {
        await failServicing();
        await expect(
          caller().cancelServicingRefund({
            requestId,
            attempt: 1,
            reason: "short",
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        await expect(
          caller().cancelServicingRefund({
            requestId,
            attempt: 1,
            reason: "x".repeat(501),
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        await expect(
          caller().cancelServicingRefund({ requestId, attempt: 2, reason })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await row()).toMatchObject({ status: "failed" });
      }, 60000);

      it("fix: a queued, pending or succeeded row cannot be cancelled", async () => {
        for (const [n, status] of (
          ["queued", "pending", "succeeded"] as const
        ).entries()) {
          const id = `00000000-0000-4000-8000-00000000039${n}`;
          await saveServicing({ id, modificationId: 9100 + n, status });
          await expect(
            caller().cancelServicingRefund({
              requestId: id,
              attempt: 1,
              reason,
            })
          ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
          expect((await row(id)).status).toBe(status);
        }
      }, 60000);

      it("fix: a flight-cancellation refund cannot be cancelled while its cancellation job still counts it as planned", async () => {
        provider.status = "pending";
        await requestFlightCancellation({
          flightId: 41,
          reason: "Native r382 flight cancellation",
          actorId: 20,
          tenantId: 3,
        });
        await processFlightCancellations();
        const upgradeRow = (await rows()).find(
          r => r.paymentIntentId === upgrade
        )!;
        const sent = provider.refunds.find(r => r.payment_intent === upgrade);
        // The provider refuses the upgrade refund; the job is not yet updated.
        sent.status = "failed";
        await deliverRefund(sent);
        expect(await row(upgradeRow.id)).toMatchObject({ status: "failed" });
        const jobs = async () =>
          (await fixture.db.select().from(schema.flightCancellationJobs)).map(
            j => j.status
          );
        expect(await jobs()).toEqual(["planned"]);
        await expect(
          caller().cancelServicingRefund({
            requestId: upgradeRow.id,
            attempt: 1,
            reason,
          })
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(
            /job still counts this refund as planned/
          ),
        });
        expect(await row(upgradeRow.id)).toMatchObject({ status: "failed" });
        later(2);
        await processFlightCancellations();
        expect(await jobs()).toEqual(["review_required"]);
        expect(
          await caller().cancelServicingRefund({
            requestId: upgradeRow.id,
            attempt: 1,
            reason,
          })
        ).toMatchObject({ status: "cancelled", settlementReview: false });
        // The original refund then succeeds: the booking is refunded and the
        // upgrade, no longer covered, goes to settlement review.
        const originalRefund = provider.refunds.find(
          r => r.payment_intent === original
        );
        originalRefund.status = "succeeded";
        await deliverRefund(originalRefund);
        expect(await booking()).toMatchObject({ paymentStatus: "refunded" });
        expect(await receiptSettlement(upgrade)).toEqual({
          status: "review_required",
          error: heldReason,
        });
      }, 60000);
    });

    describe("disputes keep their rows (lost-dispute allocation)", () => {
      for (const state of ["held", "lost"] as const)
        it(`fix: retry and cancel are refused while a dispute on the collection is ${state}`, async () => {
          await failServicing();
          await withdraw(upgrade, 6000);
          if (state === "lost") await lose(upgrade, 6000);
          const before = await row();
          await expect(
            caller().retryServicingRefund({ requestId, attempt: 1 })
          ).rejects.toMatchObject({
            code: "PRECONDITION_FAILED",
            message: expect.stringMatching(/stays with the dispute flow/),
          });
          await expect(
            caller().cancelServicingRefund({ requestId, attempt: 1, reason })
          ).rejects.toMatchObject({
            code: "PRECONDITION_FAILED",
            message: expect.stringMatching(/stays with the dispute flow/),
          });
          expect(await row()).toEqual(before);
          expect(await attempts()).toEqual([]);
        }, 60000);

      it("fix: a row partly covered by a lost dispute cannot be cancelled", async () => {
        await saveServicing({
          status: "review_required",
          errorCode: "chargeback_partial_cover",
        });
        const before = await row();
        await expect(
          caller().cancelServicingRefund({ requestId, attempt: 1, reason })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await row()).toEqual(before);
      }, 60000);

      it("control: after a refused retry and cancel, a lost dispute's allocation and the saved commands' chargeback closure are as on 036417292c", async () => {
        const failedId = requestId;
        const queuedId = "00000000-0000-4000-8000-000000000383";
        // A refused 2000 refund, then a later saved 3000 command, on the
        // upgrade collection; a lost dispute returns 1000 of it.
        await failServicing({ amount: 2000 });
        await saveServicing({
          id: queuedId,
          modificationId: 9002,
          amount: 3000,
          createdAt: now,
          nextAttemptAt: new Date(now.getTime() + 3600_000),
        });
        await withdraw(upgrade, 1000);
        await lose(upgrade, 1000);
        await expect(
          caller().retryServicingRefund({ requestId: failedId, attempt: 1 })
        ).rejects.toThrow();
        await expect(
          caller().cancelServicingRefund({
            requestId: failedId,
            attempt: 1,
            reason,
          })
        ).rejects.toThrow();
        later(120);
        await processPendingOrderRefunds();
        await expect(
          caller().cancelServicingRefund({
            requestId: queuedId,
            attempt: 1,
            reason,
          })
        ).rejects.toThrow();
        const cover = await fixture.db.transaction(tx =>
          lostDisputeCover(tx as never, 71, upgrade, {
            source: "order",
            id: queuedId,
          })
        );
        expect({
          cover,
          rows: (await rows())
            .sort((a, b) => a.amount - b.amount)
            .map(r => ({
              amount: r.amount,
              status: r.status,
              errorCode: r.errorCode,
              requested: r.requestedAt !== null,
              completed: r.completedAt !== null,
            })),
          sent: keys().length,
          ledger: await refundLedger(),
        }).toEqual({
          cover: 1000,
          rows: [
            {
              amount: 2000,
              status: "failed",
              errorCode: "provider_refund_failed",
              requested: true,
              completed: false,
            },
            {
              amount: 3000,
              status: "review_required",
              errorCode: "chargeback_partial_cover",
              requested: false,
              completed: false,
            },
          ],
          sent: 1,
          ledger: [],
        });
      }, 60000);
    });

    // Fix round 1 (#382, verifier findings V1, V3 to V6, and the surviving
    // mutants V_M1 to V_M9). "fix" cases fail on b216e20c; "control" cases
    // pass there too and each kills a named mutant.
    describe("fix round 1", () => {
      const code = (promise: Promise<unknown>) =>
        promise.then(
          () => "ok",
          (error: { code?: string }) => error.code ?? "error"
        );
      const reconciledAudits = async () =>
        (await resolutionAudits())
          .filter(a => a.eventType === "ORDER_REFUND_RECONCILED")
          .map(a => ({
            userId: a.userId,
            resourceId: a.resourceId,
            before: JSON.parse(a.previousValue ?? "null").status,
            after: JSON.parse(a.newValue ?? "null"),
          }));
      async function reopenedAfterCancel(late: any) {
        await saveServicing({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        await chargeRefunded(original, 20000);
        expect(
          await caller().cancelServicingRefund({
            requestId,
            attempt: 1,
            reason,
          })
        ).toMatchObject({ status: "cancelled", settlementReview: true });
        provider.refunds.push(late);
      }
      const lateSuccess = () => ({
        id: "re_r382_after_cancel",
        object: "refund",
        status: "succeeded",
        amount: 6000,
        currency: "sar",
        payment_intent: upgrade,
        charge: `ch_${upgrade}`,
        metadata: { orderServiceRefundId: requestId, modificationId: "9001" },
      });

      it("fix (V3): reconcile refuses a row a lost dispute partly covers and never rewrites its code", async () => {
        await saveServicing({
          status: "review_required",
          errorCode: "chargeback_partial_cover",
        });
        const before = await row();
        provider.list.mockClear();
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await row()).toEqual(before);
        expect(await events("order.refund_updated")).toEqual([]);
        expect(provider.list).not.toHaveBeenCalled();
      }, 60000);

      for (const state of ["held", "lost"] as const)
        it(`fix (V3): reconcile refuses while a dispute on the collection is ${state}, with the row and events unchanged`, async () => {
          await failServicing();
          await withdraw(upgrade, 6000);
          if (state === "lost") await lose(upgrade, 6000);
          const before = await row();
          const eventsBefore = await events("order.refund_updated");
          await expect(
            caller().reconcileServicingRefund({ requestId })
          ).rejects.toMatchObject({
            code: "PRECONDITION_FAILED",
            message: expect.stringMatching(/stays with the dispute flow/),
          });
          expect(await row()).toEqual(before);
          expect(await events("order.refund_updated")).toEqual(eventsBefore);
        }, 60000);

      it("fix (V4): charge.refunded first: reconcile closes the reopened row as succeeded_after_cancel with no second settlement", async () => {
        const late = lateSuccess();
        await reopenedAfterCancel(late);
        await chargeRefunded(upgrade, 6000);
        await deliverRefund(late);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_after_cancel",
        });
        expect(await liabilityOpen()).toBe(true);
        const ledger = await refundLedger();
        expect(ledger).toEqual([
          { type: "refund", amount: "200.00", paymentIntentId: original },
          { type: "refund", amount: "60.00", paymentIntentId: upgrade },
        ]);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "settled",
          status: "succeeded",
          errorCode: "succeeded_after_cancel",
          refundId: late.id,
        });
        expect(await row()).toMatchObject({
          status: "succeeded",
          errorCode: "succeeded_after_cancel",
          refundId: late.id,
          completedAt: expect.any(Date),
        });
        expect(await receipts()).toEqual({
          [original]: 20000,
          [upgrade]: 6000,
        });
        expect(await refundLedger()).toEqual(ledger);
        expect(await liabilityOpen()).toBe(false);
        expect((await events("order.refund_updated")).at(-1)).toMatchObject({
          status: "succeeded",
          refundId: late.id,
          errorCode: "succeeded_after_cancel",
        });
        expect(await reconciledAudits()).toEqual([
          {
            userId: 20,
            resourceId: requestId,
            before: "review_required",
            after: expect.objectContaining({
              status: "succeeded",
              providerRefundId: late.id,
            }),
          },
        ]);
        // Replays change nothing.
        await deliverRefund(late);
        await chargeRefunded(upgrade, 6000);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "unchanged" });
        expect(await refundLedger()).toEqual(ledger);
        expect(await reconciledAudits()).toHaveLength(1);
      }, 60000);

      it("fix (V4): refund.updated first: reconcile settles the reopened row once", async () => {
        const late = lateSuccess();
        await reopenedAfterCancel(late);
        await deliverRefund(late);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_after_cancel",
        });
        // The aggregate waits while the reopened request is unfinished.
        await chargeRefunded(upgrade, 6000);
        expect(await receipts()).toEqual({ [original]: 20000, [upgrade]: 0 });
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "settled", status: "succeeded" });
        const settled = async () => {
          expect(await receipts()).toEqual({
            [original]: 20000,
            [upgrade]: 6000,
          });
          expect(await refundLedger()).toEqual([
            { type: "refund", amount: "200.00", paymentIntentId: original },
            { type: "refund", amount: "60.00", paymentIntentId: upgrade },
          ]);
          expect(await liabilityOpen()).toBe(false);
        };
        await settled();
        expect(await reconciledAudits()).toEqual([
          {
            userId: 20,
            resourceId: requestId,
            before: "review_required",
            after: expect.objectContaining({
              status: "succeeded",
              providerRefundId: late.id,
            }),
          },
        ]);
        await chargeRefunded(upgrade, 6000);
        await deliverRefund(late);
        await settled();
      }, 60000);

      it("fix (V1): a retried request is not closed by a lost dispute's chargeback while the provider holds an earlier attempt's success", async () => {
        const refused = await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        await withdraw(upgrade, 6000);
        await lose(upgrade, 6000);
        refused.status = "succeeded";
        provider.list.mockClear();
        later(5);
        await processPendingOrderRefunds();
        expect(provider.list).toHaveBeenCalled();
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          attempt: 2,
          requestedAt: null,
          completedAt: null,
        });
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await refundLedger()).toEqual([]);
        // A later event for that refund changes nothing more.
        await deliverRefund(refused);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          completedAt: null,
        });
      }, 60000);

      it("fix (V1): a retried request is closed by the chargeback only after reading the provider's history", async () => {
        await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        await withdraw(upgrade, 6000);
        await lose(upgrade, 6000);
        provider.list.mockClear();
        later(5);
        await processPendingOrderRefunds();
        expect(provider.list).toHaveBeenCalledTimes(1);
        expect(await row()).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
          attempt: 2,
        });
        expect(provider.create).toHaveBeenCalledTimes(1);
      }, 60000);

      it("fix (V1): a dispute lost after the worker's history check and before its transaction closes nothing until the history is read", async () => {
        const refused = await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        refused.status = "succeeded";
        later(5);
        const dispute = (type: string, status: string) => ({
          id: `evt_r382_${++sequence}`,
          type,
          data: {
            object: {
              id: `dp_r382_${upgrade}`,
              object: "dispute",
              charge: `ch_${upgrade}`,
              payment_intent: upgrade,
              amount: 6000,
              currency: "sar",
              status,
              reason: "fraudulent",
            },
          },
        });
        provider.list.mockClear();
        let run: Promise<unknown> | undefined;
        // The worker checks the collection while no dispute exists, then
        // waits on the booking lock while the dispute is withdrawn and lost.
        await fixture.db.transaction(async tx => {
          await tx.execute(
            sql`SELECT id FROM bookings WHERE id = 71 FOR UPDATE`
          );
          run = processPendingOrderRefunds();
          await waitForWaiters(1);
          await processStripeEvent(
            tx as never,
            dispute("charge.dispute.funds_withdrawn", "under_review") as never
          );
          await processStripeEvent(
            tx as never,
            dispute("charge.dispute.closed", "lost") as never
          );
        });
        await run;
        expect(provider.list).not.toHaveBeenCalled();
        expect(await row()).toMatchObject({
          status: "queued",
          attempt: 2,
          errorCode: null,
          completedAt: null,
        });
        // The next run reads the history first and reviews the request.
        later(10);
        await processPendingOrderRefunds();
        expect(provider.list).toHaveBeenCalled();
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          completedAt: null,
        });
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("control (V1): an attempt-1 request is closed by a lost dispute's chargeback with no provider read, as on main", async () => {
        await saveServicing();
        await withdraw(upgrade, 6000);
        await lose(upgrade, 6000);
        provider.list.mockClear();
        provider.retrieve.mockClear();
        later(5);
        await processPendingOrderRefunds();
        expect(await row()).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
          attempt: 1,
          requestedAt: null,
          refundId: null,
        });
        expect(provider.list).not.toHaveBeenCalled();
        expect(provider.retrieve).not.toHaveBeenCalled();
        expect(provider.create).not.toHaveBeenCalled();
      }, 60000);

      it("fix (V5): a repeated reconcile that changes nothing adds no event and no audit", async () => {
        await failServicing();
        const before = await row();
        const eventsBefore = await events("order.refund_updated");
        for (let i = 0; i < 3; i++)
          expect(
            await caller().reconcileServicingRefund({ requestId })
          ).toMatchObject({ outcome: "provider_failed", status: "failed" });
        expect(await row()).toEqual(before);
        expect(await events("order.refund_updated")).toEqual(eventsBefore);
        expect(await reconciledAudits()).toEqual([]);
      }, 60000);

      it("fix (V6): every reconcile that changes the request writes one audit row with the actor, request, before and after status and provider refund id", async () => {
        // A provider finding: the other refunds of the collection differ.
        await failServicing();
        provider.refunds.push({
          id: "re_r382_elsewhere",
          object: "refund",
          status: "succeeded",
          amount: 1000,
          currency: "sar",
          payment_intent: upgrade,
          charge: `ch_${upgrade}`,
          metadata: {},
        });
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "review_required",
          errorCode: "provider_refund_balance_conflict",
        });
        expect(await reconciledAudits()).toEqual([
          {
            userId: 20,
            resourceId: requestId,
            before: "failed",
            after: {
              status: "review_required",
              errorCode: "provider_refund_balance_conflict",
              refundId: expect.any(String),
              providerRefundId: null,
            },
          },
        ]);
        // Repeated, it changes nothing and is not audited again.
        await caller().reconcileServicingRefund({ requestId });
        expect(await reconciledAudits()).toHaveLength(1);
      }, 60000);

      it("fix (V6): a reconcile that settles money is audited with the provider refund", async () => {
        await saveServicing({
          paymentIntentId: original,
          amount: 5000,
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        provider.refunds.push({
          id: "re_r382_settles",
          object: "refund",
          status: "succeeded",
          amount: 5000,
          currency: "sar",
          payment_intent: original,
          charge: `ch_${original}`,
          metadata: { orderServiceRefundId: requestId, modificationId: "9001" },
        });
        await caller().reconcileServicingRefund({ requestId });
        expect(await reconciledAudits()).toEqual([
          {
            userId: 20,
            resourceId: requestId,
            before: "review_required",
            after: {
              status: "succeeded",
              errorCode: null,
              refundId: "re_r382_settles",
              providerRefundId: "re_r382_settles",
            },
          },
        ]);
      }, 60000);

      for (const providerStatus of ["failed", "canceled"] as const)
        it(`control (V_M1): a late ${providerStatus} event for a cancelled request changes nothing`, async () => {
          const refused = await failServicing();
          await caller().cancelServicingRefund({
            requestId,
            attempt: 1,
            reason,
          });
          const cancelled = await row();
          const eventsBefore = await events("order.refund_updated");
          refused.status = providerStatus;
          await deliverRefund(refused);
          expect(await row()).toEqual(cancelled);
          expect(await events("order.refund_updated")).toEqual(eventsBefore);
          expect(await liabilityOpen()).toBe(false);
        }, 60000);

      it("control (V_M2): a worker run whose provider call fails after an operator retry leaves the new attempt alone", async () => {
        await saveServicing();
        provider.create.mockImplementationOnce(
          async (request: any, options: any) => {
            const refund = {
              id: "re_r382_inflight",
              object: "refund",
              status: "failed",
              amount: request.amount,
              currency: "sar",
              payment_intent: request.payment_intent,
              charge: `ch_${request.payment_intent}`,
              metadata: request.metadata,
              idempotencyKey: options?.idempotencyKey,
            };
            provider.refunds.push(refund);
            // The refusal arrives and an operator retries while this run's
            // provider call is still open; then the call fails.
            await deliverRefund(refund);
            await caller().retryServicingRefund({ requestId, attempt: 1 });
            throw new Error("duplicate_provider_refund");
          }
        );
        await processPendingOrderRefunds();
        expect(await row()).toMatchObject({
          status: "queued",
          attempt: 2,
          errorCode: null,
          refundId: null,
        });
      }, 60000);

      it("control (V_M3): retry and cancel refuse a request on a wallet top-up collection", async () => {
        const wallet = "pi_r382_wallet";
        await fixture.db.insert(schema.paymentReceipts).values({
          paymentIntentId: wallet,
          bookingId: null,
          targetId: 1,
          userId: 9,
          kind: "wallet_topup",
          amount: 6000,
          refundedAmount: 0,
          currency: "SAR",
          settlementStatus: "applied",
        });
        await saveServicing({
          paymentIntentId: wallet,
          status: "failed",
          errorCode: "provider_refund_failed",
          refundId: "re_r382_wallet",
        });
        provider.refunds.push({
          id: "re_r382_wallet",
          object: "refund",
          status: "failed",
          amount: 6000,
          currency: "sar",
          payment_intent: wallet,
          charge: `ch_${wallet}`,
          metadata: { orderServiceRefundId: requestId, modificationId: "9001" },
        });
        const before = await row();
        expect(
          await code(caller().retryServicingRefund({ requestId, attempt: 1 }))
        ).toBe("PRECONDITION_FAILED");
        expect(
          await code(
            caller().cancelServicingRefund({ requestId, attempt: 1, reason })
          )
        ).toBe("PRECONDITION_FAILED");
        expect(await row()).toEqual(before);
        expect(await attempts()).toEqual([]);
        expect(await resolutionAudits()).toEqual([]);
      }, 60000);

      it("control (V_M4): retry is a conflict when the refused refund changed between the provider read and the lock", async () => {
        await failServicing();
        provider.list.mockImplementationOnce(
          (params: { payment_intent?: string }) => ({
            async *[Symbol.asyncIterator]() {
              // A concurrent writer records another refused refund.
              await fixture.db
                .update(schema.orderServiceRefunds)
                .set({ refundId: "re_r382_other" })
                .where(eq(schema.orderServiceRefunds.id, requestId));
              for (const refund of provider.refunds)
                if (refund.payment_intent === params.payment_intent)
                  yield refund;
            },
          })
        );
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await row()).toMatchObject({
          status: "failed",
          attempt: 1,
          refundId: "re_r382_other",
        });
        expect(await attempts()).toEqual([]);
      }, 60000);

      it("control (V_M6): a verified refund naming a future attempt is refused and settles nothing", async () => {
        await saveServicing();
        const before = await row();
        await expect(
          deliverRefund({
            id: "re_r382_future",
            object: "refund",
            status: "succeeded",
            amount: 6000,
            currency: "sar",
            payment_intent: upgrade,
            charge: `ch_${upgrade}`,
            metadata: {
              orderServiceRefundId: requestId,
              modificationId: "9001",
              attempt: "2",
            },
          })
        ).rejects.toThrow(/does not match the saved request/);
        expect(await row()).toEqual(before);
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("control (V_M7, V_M7b): reconcile does not settle an earlier success once the live attempt was requested", async () => {
        const refused = await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        // Attempt 2 is requested, but the provider call fails in transit.
        provider.failing.add(upgrade);
        await processPendingOrderRefunds();
        provider.failing.delete(upgrade);
        expect(await row()).toMatchObject({
          attempt: 2,
          requestedAt: expect.any(Date),
          refundId: null,
        });
        refused.status = "succeeded";
        await deliverRefund(refused);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
        });
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "review_required",
          status: "review_required",
        });
        expect(await refundLedger()).toEqual([]);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
      }, 60000);

      it("control (V_M9): cancel is a conflict when the request changed between the provider read and the lock", async () => {
        await saveServicing({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        provider.list.mockImplementationOnce(
          (params: { payment_intent?: string }) => ({
            async *[Symbol.asyncIterator]() {
              // The provider's refusal of the request arrives meanwhile.
              const refusal = {
                id: "re_r382_raced",
                object: "refund",
                status: "failed",
                amount: 6000,
                currency: "sar",
                payment_intent: upgrade,
                charge: `ch_${upgrade}`,
                metadata: {
                  orderServiceRefundId: requestId,
                  modificationId: "9001",
                },
              };
              provider.refunds.push(refusal);
              await deliverRefund(refusal);
              for (const refund of provider.refunds)
                if (refund.payment_intent === params.payment_intent)
                  yield refund;
            },
          })
        );
        await expect(
          caller().cancelServicingRefund({ requestId, attempt: 1, reason })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await row()).toMatchObject({
          status: "failed",
          refundId: "re_r382_raced",
        });
        expect(await resolutionAudits()).toEqual([]);
      }, 60000);
    });

    // Fix round 2 (#382, verifier findings F1, F3 and F4, and the surviving
    // weakenings N1 to N16). "fix" cases fail on 30b25e62; "control" cases
    // pass there too and each kills a named weakening.
    describe("fix round 2", () => {
      const B = "00000000-0000-4000-8000-0000000003b2";
      const providerRefunded = (paymentIntentId: string) =>
        provider.refunds
          .filter(
            r =>
              r.payment_intent === paymentIntentId && r.status === "succeeded"
          )
          .reduce((sum, r) => sum + r.amount, 0);
      const late = (amount: number, extra: Record<string, unknown> = {}) => ({
        id: "re_r382_after_cancel",
        object: "refund",
        status: "succeeded",
        amount,
        currency: "sar",
        payment_intent: upgrade,
        charge: `ch_${upgrade}`,
        metadata: { orderServiceRefundId: requestId, modificationId: "9001" },
        ...extra,
      });
      const reconciledAudits = async () =>
        (await resolutionAudits())
          .filter(a => a.eventType === "ORDER_REFUND_RECONCILED")
          .map(a => JSON.parse(a.newValue ?? "null"));
      // A, 3000 on the upgrade intent, has an unknown outcome; the operator
      // cancels it because the customer was refunded another way.
      async function cancelledA(amount = 3000) {
        await saveServicing({
          amount,
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        expect(
          await caller().cancelServicingRefund({
            requestId,
            attempt: 1,
            reason,
          })
        ).toMatchObject({ status: "cancelled" });
      }
      // A synthetic reopened request (a late refund reopened it after a cancel).
      async function reopenedA(
        refund: Record<string, unknown>,
        receiptRefunded: number
      ) {
        await saveServicing({
          amount: 3000,
          status: "review_required",
          errorCode: "provider_refund_after_cancel",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
          resolvedBy: 20,
          resolvedAt: now,
          resolutionReason: reason,
        });
        provider.refunds.push(refund);
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: receiptRefunded })
          .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
        return row();
      }
      async function expectBalanceConflictKept(ledger: unknown) {
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_balance_conflict",
          completedAt: null,
        });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 3000 });
        expect(await refundLedger()).toEqual(ledger);
        expect(await liabilityOpen()).toBe(true);
        expect(providerRefunded(upgrade)).toBe(6000);
      }

      it("fix (F1a): another refund of the same amount on the intent keeps a reopened request in review instead of closing it", async () => {
        await cancelledA();
        // The customer was refunded 3000 in the provider dashboard.
        provider.refunds.push({
          id: "re_r382_dashboard",
          object: "refund",
          status: "succeeded",
          amount: 3000,
          currency: "sar",
          payment_intent: upgrade,
          charge: `ch_${upgrade}`,
          metadata: {},
        });
        await chargeRefunded(upgrade, providerRefunded(upgrade));
        const ledger = await refundLedger();
        expect(ledger).toEqual([
          { type: "partial_refund", amount: "30.00", paymentIntentId: upgrade },
        ]);
        // A's own refund then lands late, succeeded.
        const lateA = late(3000);
        provider.refunds.push(lateA);
        await deliverRefund(lateA);
        await chargeRefunded(upgrade, providerRefunded(upgrade));
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "review_required",
          status: "review_required",
          errorCode: "provider_refund_balance_conflict",
        });
        await expectBalanceConflictKept(ledger);
        expect(await reconciledAudits()).toEqual([
          expect.objectContaining({
            status: "review_required",
            errorCode: "provider_refund_balance_conflict",
          }),
        ]);
        // Repeated, nothing more changes.
        await caller().reconcileServicingRefund({ requestId });
        await expectBalanceConflictKept(ledger);
        expect(await reconciledAudits()).toHaveLength(1);
      }, 60000);

      it("fix (F1b): a second servicing request of the same amount keeps a reopened request in review instead of closing it", async () => {
        await cancelledA();
        await saveServicing({
          id: B,
          modificationId: 9002,
          amount: 3000,
          createdAt: now,
        });
        await processPendingOrderRefunds();
        expect(await row(B)).toMatchObject({ status: "succeeded" });
        await chargeRefunded(upgrade, providerRefunded(upgrade));
        const ledger = await refundLedger();
        expect(ledger).toEqual([
          { type: "partial_refund", amount: "30.00", paymentIntentId: upgrade },
        ]);
        const lateA = late(3000);
        provider.refunds.push(lateA);
        await deliverRefund(lateA);
        await chargeRefunded(upgrade, providerRefunded(upgrade));
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "review_required",
          errorCode: "provider_refund_balance_conflict",
        });
        await expectBalanceConflictKept(ledger);
      }, 60000);

      it("fix (F3): a cancelled request reopened by a pending late refund returns to cancelled when that refund fails, and is never retried", async () => {
        await cancelledA(6000);
        const cancelled = await row();
        const lateA = late(6000, { status: "pending" });
        provider.refunds.push(lateA);
        await deliverRefund(lateA);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_after_cancel",
        });
        // An operator sees the prior cancel in the list, which carries
        // exactly these fields.
        const [listed] = await caller().servicingRefundReviews({ limit: 50 });
        expect(Object.keys(listed).sort()).toEqual(
          [
            "amount",
            "attempt",
            "bookingId",
            "bookingReference",
            "cancellationFlightId",
            "createdAt",
            "currency",
            "errorCode",
            "id",
            "modificationId",
            "origin",
            "paymentIntentId",
            "refundId",
            "requestedAt",
            "resolutionReason",
            "resolvedAt",
            "status",
          ].sort()
        );
        expect(
          (await caller().servicingRefundReviews({ limit: 50 })).map(r => [
            r.id,
            r.resolutionReason,
            r.resolvedAt instanceof Date,
          ])
        ).toEqual([[requestId, reason, true]]);
        const eventsBefore = (await events("order.refund_updated")).length;
        lateA.status = "failed";
        await deliverRefund(lateA);
        expect(await row()).toMatchObject({
          status: "cancelled",
          errorCode: "provider_refund_after_cancel",
          refundId: lateA.id,
          resolvedBy: 20,
          resolvedAt: cancelled.resolvedAt,
          resolutionReason: reason,
        });
        const updates = await events("order.refund_updated");
        expect(updates).toHaveLength(eventsBefore + 1);
        expect(updates.at(-1)).toMatchObject({
          status: "cancelled",
          refundId: lateA.id,
        });
        expect(await liabilityOpen()).toBe(false);
        // A replayed failure changes nothing; retry is refused; nothing is sent.
        await deliverRefund(lateA);
        expect(await events("order.refund_updated")).toHaveLength(
          eventsBefore + 1
        );
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        later(5);
        await processPendingOrderRefunds();
        expect(provider.create).not.toHaveBeenCalled();
        expect(await attempts()).toEqual([]);
        expect(await refundLedger()).toEqual([]);
        expect(await caller().servicingRefundReviews({ limit: 50 })).toEqual(
          []
        );
      }, 60000);

      it("fix (F3): reconcile returns a reopened request to cancelled when its late refund failed and the event never arrived", async () => {
        await cancelledA(6000);
        const lateA = late(6000, { status: "pending" });
        provider.refunds.push(lateA);
        await deliverRefund(lateA);
        lateA.status = "failed";
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "provider_failed",
          status: "cancelled",
          refundId: lateA.id,
        });
        expect(await row()).toMatchObject({
          status: "cancelled",
          resolutionReason: reason,
        });
        expect(await reconciledAudits()).toEqual([
          expect.objectContaining({ status: "cancelled", refundId: lateA.id }),
        ]);
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      }, 60000);

      it("fix (F3): retry refuses any request an operator resolved, with the row unchanged", async () => {
        await failServicing();
        // A failed request that still carries an operator's cancel, as a
        // reopened request on 30b25e62 could.
        await fixture.db
          .update(schema.orderServiceRefunds)
          .set({ resolvedBy: 20, resolvedAt: now, resolutionReason: reason })
          .where(eq(schema.orderServiceRefunds.id, requestId));
        const before = await row();
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await row()).toEqual(before);
        expect(await attempts()).toEqual([]);
        expect(provider.create).toHaveBeenCalledTimes(1);
      }, 60000);

      it("fix (F4): a refund the history read finds but recording refuses sends that request to review, and the rest of the batch runs", async () => {
        await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        await withdraw(upgrade, 6000);
        await lose(upgrade, 6000);
        // A provider refund carrying this request's id, of another amount.
        provider.refunds.push({
          ...late(5000),
          id: "re_r382_odd",
          status: "pending",
        });
        await saveServicing({
          id: B,
          modificationId: 9002,
          paymentIntentId: original,
          amount: 1000,
          createdAt: now,
        });
        later(5);
        await expect(processPendingOrderRefunds()).resolves.toMatchObject({
          scanned: 2,
        });
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "duplicate_provider_refund",
          attempt: 2,
          completedAt: null,
        });
        expect(await row(B)).toMatchObject({ status: "succeeded" });
        expect(provider.create).toHaveBeenCalledTimes(2);
        expect(await refundLedger()).toEqual([
          {
            type: "partial_refund",
            amount: "10.00",
            paymentIntentId: original,
          },
        ]);
      }, 60000);

      it("control (N1): a reopened request with a second live refund of its own is not closed or settled", async () => {
        await cancelledA();
        const lateA = late(3000);
        provider.refunds.push(lateA);
        await deliverRefund(lateA);
        provider.refunds.push({
          ...late(3000),
          id: "re_r382_dup",
          status: "pending",
        });
        const before = await row();
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required" });
        expect(await row()).toEqual(before);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("control (N2): a reopened request is not closed by a refund that names another attempt", async () => {
        const before = await reopenedA(
          late(3000, {
            metadata: {
              orderServiceRefundId: requestId,
              modificationId: "9001",
              attempt: "2",
            },
          }),
          3000
        );
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required" });
        expect(await row()).toEqual(before);
      }, 60000);

      it("control (N3): reconcile of a reopened request is a conflict when its refund settled between the provider read and the lock", async () => {
        await cancelledA();
        const lateA = late(3000);
        provider.refunds.push(lateA);
        await deliverRefund(lateA);
        provider.list.mockImplementationOnce(
          (params: { payment_intent?: string }) => ({
            async *[Symbol.asyncIterator]() {
              // The success event is delivered again meanwhile and settles it.
              await deliverRefund(lateA);
              for (const refund of provider.refunds)
                if (refund.payment_intent === params.payment_intent)
                  yield refund;
            },
          })
        );
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await row()).toMatchObject({
          status: "succeeded",
          errorCode: null,
          refundId: lateA.id,
        });
        expect(await refundLedger()).toEqual([
          { type: "partial_refund", amount: "30.00", paymentIntentId: upgrade },
        ]);
      }, 60000);

      it("control (N3): reconcile of a reopened request is a conflict when only its refund id changed between the provider read and the lock", async () => {
        await cancelledA();
        const lateA = late(3000);
        provider.refunds.push(lateA);
        await deliverRefund(lateA);
        provider.list.mockImplementationOnce(
          (params: { payment_intent?: string }) => ({
            async *[Symbol.asyncIterator]() {
              // A concurrent writer records a refund id; status and code stay.
              await fixture.db
                .update(schema.orderServiceRefunds)
                .set({ refundId: "re_r382_other_writer" })
                .where(eq(schema.orderServiceRefunds.id, requestId));
              for (const refund of provider.refunds)
                if (refund.payment_intent === params.payment_intent)
                  yield refund;
            },
          })
        );
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_after_cancel",
          refundId: "re_r382_other_writer",
          completedAt: null,
        });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("control (N4): the general reconcile re-checks disputes under the lock before recording", async () => {
        await saveServicing({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        provider.refunds.push(late(6000));
        provider.list.mockImplementationOnce(
          (params: { payment_intent?: string }) => ({
            async *[Symbol.asyncIterator]() {
              await withdraw(upgrade, 6000);
              for (const refund of provider.refunds)
                if (refund.payment_intent === params.payment_intent)
                  yield refund;
            },
          })
        );
        const before = await row();
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(/stays with the dispute flow/),
        });
        expect(await row()).toEqual(before);
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("control (N10): a receipt that records more than this refund on top of its base does not close the reopened request", async () => {
        const before = await reopenedA(late(3000), 4000);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required" });
        expect(await row()).toEqual(before);
      }, 60000);

      it("control (N11): a history read over the provider's limit sends the retried request to review", async () => {
        await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        await withdraw(upgrade, 6000);
        await lose(upgrade, 6000);
        provider.list.mockImplementation(() => ({
          async *[Symbol.asyncIterator]() {
            for (let i = 0; i < 1001; i++)
              yield {
                id: `re_r382_old_${i}`,
                object: "refund",
                status: "failed",
                amount: 1,
                currency: "sar",
                payment_intent: upgrade,
                metadata: {},
              };
          },
        }));
        later(5);
        await processPendingOrderRefunds();
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_history_limit",
          attempt: 2,
          completedAt: null,
        });
      }, 60000);

      it("control (N12): a reopened request is not closed by its refund when the amount differs", async () => {
        const before = await reopenedA(late(2000), 3000);
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: "The provider refund does not match the saved request",
        });
        expect(await row()).toEqual(before);
      }, 60000);

      it("control (N15): a reopened request whose receipt holds neither its base nor base plus amount stays in review", async () => {
        const before = await reopenedA(late(3000), 1000);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required" });
        expect(await row()).toEqual(before);
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("control (N16): reconcile of a reopened request re-checks disputes under the lock", async () => {
        await cancelledA();
        const lateA = late(3000);
        provider.refunds.push(lateA);
        await deliverRefund(lateA);
        provider.list.mockImplementationOnce(
          (params: { payment_intent?: string }) => ({
            async *[Symbol.asyncIterator]() {
              await withdraw(upgrade, 6000);
              for (const refund of provider.refunds)
                if (refund.payment_intent === params.payment_intent)
                  yield refund;
            },
          })
        );
        const before = await row();
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(/stays with the dispute flow/),
        });
        expect(await row()).toEqual(before);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
      }, 60000);
    });

    // Fix round 3 (#382, verifier findings V4-1 to V4-3 and the factory's
    // R2-1 and R2-2, as G1 to G6 in the brief). "fix" cases fail on 547fb0b8;
    // "control" cases pass there too and each kills a named weakening.
    describe("fix round 3", () => {
      const B = "00000000-0000-4000-8000-0000000003b2";
      const refundOf = (
        id: string,
        amount: number,
        status: string,
        metadata: Record<string, string> = {
          orderServiceRefundId: requestId,
          modificationId: "9001",
        }
      ) => ({
        id,
        object: "refund",
        status,
        amount,
        currency: "sar",
        payment_intent: upgrade,
        charge: `ch_${upgrade}`,
        metadata,
      });
      const listedIds = async () =>
        (await caller().servicingRefundReviews({ limit: 50 })).map(r => [
          r.id,
          r.errorCode,
        ]);
      async function cancelledA(amount: number) {
        await saveServicing({
          amount,
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        await caller().cancelServicingRefund({ requestId, attempt: 1, reason });
        return row();
      }
      async function expectStillCancelled(cancelled: {
        resolvedAt: Date | null;
      }) {
        expect(await row()).toMatchObject({
          status: "cancelled",
          resolvedBy: 20,
          resolvedAt: cancelled.resolvedAt,
          resolutionReason: reason,
        });
        expect(await liabilityOpen()).toBe(false);
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        later(5);
        await processPendingOrderRefunds();
        expect(provider.create).not.toHaveBeenCalled();
      }

      it("fix (G1, Q1): a second refund of the request failing while the reopening refund is live is a visible duplicate, not a cancel", async () => {
        await cancelledA(6000);
        const x = refundOf("re_r382_X", 6000, "pending");
        provider.refunds.push(x);
        await deliverRefund(x);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_after_cancel",
          refundId: x.id,
        });
        const y = refundOf("re_r382_Y", 6000, "failed");
        provider.refunds.push(y);
        await deliverRefund(y);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "duplicate_provider_refund",
          refundId: x.id,
        });
        expect(await listedIds()).toEqual([
          [requestId, "duplicate_provider_refund"],
        ]);
        expect(await liabilityOpen()).toBe(true);
        // The reopening refund succeeds: it settles once and the duplicate
        // keeps the request in review.
        x.status = "succeeded";
        await deliverRefund(x);
        await deliverRefund(x);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "duplicate_provider_refund",
          refundId: x.id,
          completedAt: expect.any(Date),
        });
        const settled = async () => {
          expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
          expect(await refundLedger()).toEqual([
            { type: "refund", amount: "60.00", paymentIntentId: upgrade },
          ]);
        };
        await settled();
        expect(await liabilityOpen()).toBe(true);
        // The operator's reconcile closes it with no second settlement.
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "settled",
          status: "succeeded",
          errorCode: "succeeded_after_cancel",
        });
        await settled();
        expect(await liabilityOpen()).toBe(false);
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(provider.create).not.toHaveBeenCalled();
      }, 60000);

      it("fix (G1): a duplicate seen on a reopened request keeps it listed when the reopening refund then fails, and a balance finding does not relabel it", async () => {
        await cancelledA(2000);
        const x = refundOf("re_r382_X", 2000, "pending");
        provider.refunds.push(x);
        await deliverRefund(x);
        const y = refundOf("re_r382_Y", 2000, "succeeded");
        provider.refunds.push(y);
        await deliverRefund(y);
        const duplicate = {
          status: "review_required",
          errorCode: "duplicate_provider_refund",
          refundId: x.id,
        };
        expect(await row()).toMatchObject(duplicate);
        // A dashboard refund the receipt does not hold puts the balance off.
        provider.refunds.push(
          refundOf("re_r382_dashboard", 2000, "succeeded", {})
        );
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required", ...duplicate });
        x.status = "failed";
        await deliverRefund(x);
        expect(await row()).toMatchObject({ ...duplicate, completedAt: null });
        expect(await listedIds()).toEqual([
          [requestId, "duplicate_provider_refund"],
        ]);
        expect(await liabilityOpen()).toBe(true);
        // Y succeeded at the provider, so reconcile keeps the request open.
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required", ...duplicate });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
      }, 60000);

      it("fix (G1): reconcile returns a reopened request in duplicate review to cancelled once the provider shows every refund of it failed", async () => {
        const cancelled = await cancelledA(6000);
        const x = refundOf("re_r382_X", 6000, "pending");
        provider.refunds.push(x);
        await deliverRefund(x);
        const y = refundOf("re_r382_Y", 6000, "failed");
        provider.refunds.push(y);
        await deliverRefund(y);
        x.status = "failed";
        await deliverRefund(x);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "duplicate_provider_refund",
          refundId: x.id,
        });
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "provider_failed",
          status: "cancelled",
          errorCode: "provider_refund_after_cancel",
          refundId: x.id,
        });
        await expectStillCancelled(cancelled);
      }, 60000);

      it("fix (G1, Q7): a request returned to cancelled that then receives another live refund of its attempt is reopened and listed, and settles once", async () => {
        await cancelledA(6000);
        const a = refundOf("re_r382_after_cancel", 6000, "pending");
        provider.refunds.push(a);
        await deliverRefund(a);
        a.status = "failed";
        await deliverRefund(a);
        expect(await row()).toMatchObject({
          status: "cancelled",
          refundId: a.id,
        });
        const z = refundOf("re_r382_Z", 6000, "succeeded");
        provider.refunds.push(z);
        await deliverRefund(z);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_after_cancel",
          refundId: z.id,
        });
        expect(await listedIds()).toEqual([
          [requestId, "provider_refund_after_cancel"],
        ]);
        expect(await liabilityOpen()).toBe(true);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "settled", status: "succeeded" });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
        expect(await refundLedger()).toEqual([
          { type: "refund", amount: "60.00", paymentIntentId: upgrade },
        ]);
        expect(await liabilityOpen()).toBe(false);
      }, 60000);

      it("fix (G2, Q2): a reopened request relabelled as a balance conflict still returns to cancelled when its late refund fails", async () => {
        const cancelled = await cancelledA(3000);
        // Another refund on the intent, outside the request, pending.
        const o = refundOf("re_r382_other", 3000, "pending", {});
        provider.refunds.push(o);
        const a = refundOf("re_r382_after_cancel", 3000, "pending");
        provider.refunds.push(a);
        await deliverRefund(a);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ errorCode: "provider_refund_balance_conflict" });
        const eventsBefore = (await events("order.refund_updated")).length;
        o.status = "failed";
        a.status = "failed";
        await deliverRefund(a);
        expect(await row()).toMatchObject({ refundId: a.id });
        const updates = await events("order.refund_updated");
        expect(updates).toHaveLength(eventsBefore + 1);
        expect(updates.at(-1)).toMatchObject({ status: "cancelled" });
        await expectStillCancelled(cancelled);
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("fix (G2, factory R2-1): a dashboard refund not yet on the receipt, a balance conflict, then the late refund fails: the request returns to cancelled", async () => {
        const cancelled = await cancelledA(3000);
        provider.refunds.push(
          refundOf("re_r382_dashboard", 3000, "succeeded", {})
        );
        const a = refundOf("re_r382_after_cancel", 3000, "pending");
        provider.refunds.push(a);
        await deliverRefund(a);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ errorCode: "provider_refund_balance_conflict" });
        a.status = "failed";
        await deliverRefund(a);
        await expectStillCancelled(cancelled);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
      }, 60000);

      it("fix (G3, factory R2-2): reconcile returns a reopened request whose late refund failed to cancelled, with the first cancel's resolution, even beside another recorded refund", async () => {
        const cancelled = await cancelledA(3000);
        // The customer was refunded 3000 in the dashboard, and it is booked.
        provider.refunds.push(
          refundOf("re_r382_dashboard", 3000, "succeeded", {})
        );
        await chargeRefunded(upgrade, 3000);
        const ledger = await refundLedger();
        expect(ledger).toEqual([
          { type: "partial_refund", amount: "30.00", paymentIntentId: upgrade },
        ]);
        const a = refundOf("re_r382_after_cancel", 3000, "pending");
        provider.refunds.push(a);
        await deliverRefund(a);
        // It fails at the provider; the event never arrives.
        a.status = "failed";
        for (let i = 0; i < 2; i++)
          expect(
            await caller().reconcileServicingRefund({ requestId })
          ).toMatchObject({
            status: "cancelled",
            errorCode: "provider_refund_after_cancel",
            refundId: a.id,
            outcome: i === 0 ? "provider_failed" : "unchanged",
          });
        await expectStillCancelled(cancelled);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 3000 });
        expect(await refundLedger()).toEqual(ledger);
        expect((await resolutionAudits()).map(r => r.eventType)).toEqual([
          "ORDER_REFUND_CANCELLED",
          "ORDER_REFUND_RECONCILED",
        ]);
      }, 60000);

      it("control (G1, F3_reconcile_failedLate_ignores_live): reconcile does not return a reopened request to cancelled while another refund of it is live", async () => {
        await cancelledA(6000);
        const x = refundOf("re_r382_X", 6000, "pending");
        provider.refunds.push(x);
        await deliverRefund(x);
        // Neither event arrives: X fails and W appears, live.
        x.status = "failed";
        provider.refunds.push(refundOf("re_r382_W", 6000, "pending"));
        const before = await row();
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required" });
        expect(await row()).toEqual(before);
        expect(await liabilityOpen()).toBe(true);
      }, 60000);

      it("control (F3_webhook_only_failed): a reopened request whose late refund is canceled returns to cancelled", async () => {
        const cancelled = await cancelledA(6000);
        const a = refundOf("re_r382_after_cancel", 6000, "pending");
        provider.refunds.push(a);
        await deliverRefund(a);
        a.status = "canceled";
        await deliverRefund(a);
        await expectStillCancelled(cancelled);
      }, 60000);

      it("control (F1_settle_branch_unchecked): a reopened request whose refund the receipt does not hold yet is not settled while another refund of the collection is missing from it", async () => {
        await cancelledA(3000);
        provider.refunds.push(
          refundOf("re_r382_dashboard", 3000, "succeeded", {})
        );
        const a = refundOf("re_r382_after_cancel", 3000, "succeeded");
        provider.refunds.push(a);
        await deliverRefund(a);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "review_required",
          errorCode: "provider_refund_balance_conflict",
        });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
        expect(await row()).toMatchObject({ completedAt: null });
      }, 60000);

      it("control (G5, F3_list_resolvedAt_for_all): requests never cancelled list no resolution", async () => {
        await failServicing();
        await saveServicing({
          id: B,
          modificationId: 9002,
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          createdAt: now,
        });
        const listed = await caller().servicingRefundReviews({ limit: 50 });
        expect(listed).toHaveLength(2);
        expect(listed.map(r => [r.resolvedAt, r.resolutionReason])).toEqual([
          [null, null],
          [null, null],
        ]);
      }, 60000);

      it("control (F4_balance_code_dropped): a history-read refund refused for a receipt changed outside the request sends it to provider_refund_balance_conflict", async () => {
        await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        await withdraw(upgrade, 6000);
        await lose(upgrade, 6000);
        provider.refunds.push(
          refundOf("re_r382_attempt2", 6000, "pending", {
            orderServiceRefundId: requestId,
            modificationId: "9001",
            attempt: "2",
          })
        );
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: 1000 })
          .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
        later(5);
        await processPendingOrderRefunds();
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_balance_conflict",
          attempt: 2,
          completedAt: null,
        });
      }, 60000);

      it("control (F4_status_guard_removed): a refused history-read recording does not overwrite a request that left the queue meanwhile", async () => {
        await failServicing();
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        await withdraw(upgrade, 6000);
        await lose(upgrade, 6000);
        provider.refunds.push(refundOf("re_r382_odd", 5000, "pending"));
        provider.list.mockImplementationOnce(
          (params: { payment_intent?: string }) => ({
            async *[Symbol.asyncIterator]() {
              // A concurrent worker run closes the request meanwhile.
              await fixture.db
                .update(schema.orderServiceRefunds)
                .set({
                  status: "succeeded",
                  errorCode: "settled_by_chargeback",
                })
                .where(eq(schema.orderServiceRefunds.id, requestId));
              for (const refund of provider.refunds)
                if (refund.payment_intent === params.payment_intent)
                  yield refund;
            },
          })
        );
        later(5);
        await processPendingOrderRefunds();
        expect(await row()).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
        });
      }, 60000);
    });

    // Fix round 4 (#382; the factory's N1 and N2 on 0321264b, and the audit of
    // values read before the lock). "fix" cases fail on 0321264b.
    describe("fix round 4", () => {
      // A refund naming the request, or with no metadata when `attempt` is 0.
      const refundOf = (
        id: string,
        amount: number,
        status: string,
        attempt: number
      ) => ({
        id,
        object: "refund",
        status,
        amount,
        currency: "sar",
        payment_intent: upgrade,
        charge: `ch_${upgrade}`,
        metadata:
          attempt === 0
            ? {}
            : {
                orderServiceRefundId: requestId,
                modificationId: "9001",
                ...(attempt > 1 ? { attempt: String(attempt) } : {}),
              },
      });
      const listed = async () =>
        (await caller().servicingRefundReviews({ limit: 50 })).map(r => [
          r.id,
          r.errorCode,
        ]);
      // Attempt 1 refused, retried, attempt 2 refused, then cancelled on 2.
      async function cancelledOnAttempt2(amount: number) {
        await failServicing({ amount });
        await caller().retryServicingRefund({ requestId, attempt: 1 });
        provider.refuse.add(upgrade);
        await processPendingOrderRefunds();
        provider.refuse.delete(upgrade);
        const failed = await row();
        expect(failed).toMatchObject({
          attempt: 2,
          status: "failed",
          errorCode: "provider_refund_failed",
        });
        await caller().cancelServicingRefund({ requestId, attempt: 2, reason });
        return provider.refunds.find(r => r.id === failed.refundId);
      }
      async function cancelledOnAttempt1(amount: number) {
        await saveServicing({
          amount,
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        await caller().cancelServicingRefund({ requestId, attempt: 1, reason });
      }
      // The provider read sees only what existed before; Y succeeds after it,
      // and Y's single event lands before reconcile takes the lock.
      function succeedsAfterTheRead(y: ReturnType<typeof refundOf>) {
        provider.list.mockImplementationOnce(
          (params: { payment_intent?: string }) => ({
            async *[Symbol.asyncIterator]() {
              const seen = provider.refunds.filter(
                r => r.payment_intent === params.payment_intent
              );
              provider.refunds.push(y);
              await deliverRefund(y);
              for (const refund of seen) yield refund;
            },
          })
        );
      }

      it("fix (N1): an earlier attempt's success on a cancelled request stays visible when the cancelled attempt's failure event is sent again", async () => {
        const second = await cancelledOnAttempt2(2000);
        const earlier = refundOf("re_r382_Z1", 2000, "succeeded", 1);
        provider.refunds.push(earlier);
        await deliverRefund(earlier);
        const held = {
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          attempt: 2,
          refundId: second.id,
        };
        expect(await row()).toMatchObject({ ...held, completedAt: null });
        // Stripe sends attempt 2's failure again.
        await deliverRefund(second);
        expect(await row()).toMatchObject({ ...held, completedAt: null });
        expect(await listed()).toEqual([
          [requestId, "earlier_attempt_succeeded"],
        ]);
        expect(await liabilityOpen()).toBe(true);
        // Reconcile reads the provider and keeps it under review.
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required", ...held });
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("fix (N1): a reopened request holding an earlier attempt's success stays visible when its reopening refund fails, and a balance finding does not relabel it", async () => {
        await cancelledOnAttempt2(2000);
        const x = refundOf("re_r382_X", 2000, "pending", 2);
        provider.refunds.push(x);
        await deliverRefund(x);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_after_cancel",
          refundId: x.id,
        });
        const earlier = refundOf("re_r382_Z1", 2000, "succeeded", 1);
        provider.refunds.push(earlier);
        await deliverRefund(earlier);
        const held = {
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          refundId: x.id,
        };
        expect(await row()).toMatchObject({ ...held, completedAt: null });
        // A dashboard refund the receipt does not hold puts the balance off.
        provider.refunds.push(
          refundOf("re_r382_dashboard", 1000, "succeeded", 0)
        );
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required", ...held });
        x.status = "failed";
        await deliverRefund(x);
        expect(await row()).toMatchObject({ ...held, completedAt: null });
        expect(await listed()).toEqual([
          [requestId, "earlier_attempt_succeeded"],
        ]);
        expect(await liabilityOpen()).toBe(true);
      }, 60000);

      it("fix (N1): a reopened request holding an earlier attempt's success stays under review when its reopening refund settles", async () => {
        await cancelledOnAttempt2(2000);
        const x = refundOf("re_r382_X", 2000, "pending", 2);
        provider.refunds.push(x);
        await deliverRefund(x);
        const earlier = refundOf("re_r382_Z1", 2000, "succeeded", 1);
        provider.refunds.push(earlier);
        await deliverRefund(earlier);
        x.status = "succeeded";
        await deliverRefund(x);
        await deliverRefund(x);
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          refundId: x.id,
          completedAt: expect.any(Date),
        });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 2000 });
        expect(await refundLedger()).toEqual([
          { type: "partial_refund", amount: "20.00", paymentIntentId: upgrade },
        ]);
        expect(await listed()).toEqual([
          [requestId, "earlier_attempt_succeeded"],
        ]);
        expect(await liabilityOpen()).toBe(true);
      }, 60000);

      it("fix (N2): reconcile does not return a reopened request to cancelled on a provider read made stale by a duplicate recorded before the lock", async () => {
        await cancelledOnAttempt1(6000);
        const x = refundOf("re_r382_X", 6000, "pending", 1);
        provider.refunds.push(x);
        await deliverRefund(x);
        // X fails with no event.
        x.status = "failed";
        succeedsAfterTheRead(refundOf("re_r382_Y", 6000, "succeeded", 1));
        const held = {
          status: "review_required",
          errorCode: "duplicate_provider_refund",
          refundId: x.id,
        };
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await row()).toMatchObject({ ...held, completedAt: null });
        expect(await listed()).toEqual([
          [requestId, "duplicate_provider_refund"],
        ]);
        expect(await liabilityOpen()).toBe(true);
        // A fresh reconcile sees Y live and keeps the request under review.
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required", ...held });
      }, 60000);

      it("fix (audit): a balance finding does not overwrite a hold code an event recorded between the provider read and the lock", async () => {
        await cancelledOnAttempt1(3000);
        const x = refundOf("re_r382_X", 3000, "pending", 1);
        provider.refunds.push(x);
        await deliverRefund(x);
        provider.refunds.push(
          refundOf("re_r382_dashboard", 3000, "succeeded", 0)
        );
        succeedsAfterTheRead(refundOf("re_r382_Y", 3000, "succeeded", 1));
        await expect(
          caller().reconcileServicingRefund({ requestId })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "duplicate_provider_refund",
          refundId: x.id,
        });
        expect(await listed()).toEqual([
          [requestId, "duplicate_provider_refund"],
        ]);
      }, 60000);

      // Addendum (the verifier's V5-1 P1 and P2, V5-3, and weakenings W8,
      // W12 and W19). P3 is the first N1 test above.
      const archivedFirst = async () => {
        const [archived] = await attempts();
        return provider.refunds.find(r => r.id === archived.refundId);
      };

      it("fix (V5-1, P1): the archived attempt-1 refund reporting succeeded on a request cancelled at attempt 2 stays visible when attempt 2's failure is sent again", async () => {
        const second = await cancelledOnAttempt2(2000);
        const first = await archivedFirst();
        first.status = "succeeded";
        await deliverRefund(first);
        // Its charge aggregate arrives while the request is open.
        await chargeRefunded(upgrade, 2000);
        const held = {
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          attempt: 2,
          refundId: second.id,
        };
        expect(await row()).toMatchObject({ ...held, completedAt: null });
        await deliverRefund(second);
        expect(await row()).toMatchObject({ ...held, completedAt: null });
        expect(await listed()).toEqual([
          [requestId, "earlier_attempt_succeeded"],
        ]);
        expect(await liabilityOpen()).toBe(true);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required", ...held });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("fix (V5-1, P2): a reopened request stays visible when the archived attempt-1 refund reports succeeded and the reopening refund then fails", async () => {
        await cancelledOnAttempt2(2000);
        const first = await archivedFirst();
        const x = refundOf("re_r382_X", 2000, "pending", 2);
        provider.refunds.push(x);
        await deliverRefund(x);
        first.status = "succeeded";
        await deliverRefund(first);
        await chargeRefunded(upgrade, 2000);
        const held = {
          status: "review_required",
          errorCode: "earlier_attempt_succeeded",
          refundId: x.id,
        };
        expect(await row()).toMatchObject({ ...held, completedAt: null });
        x.status = "failed";
        await deliverRefund(x);
        expect(await row()).toMatchObject({ ...held, completedAt: null });
        expect(await listed()).toEqual([
          [requestId, "earlier_attempt_succeeded"],
        ]);
        expect(await liabilityOpen()).toBe(true);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({ outcome: "review_required", ...held });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("control (V5-3, W15): the reopening refund's success does not settle while the receipt holds another refund booked after the cancel", async () => {
        await cancelledOnAttempt1(3000);
        provider.refunds.push(
          refundOf("re_r382_dashboard", 3000, "succeeded", 0)
        );
        await chargeRefunded(upgrade, 3000);
        const booked = await refundLedger();
        expect(booked).toEqual([
          { type: "partial_refund", amount: "30.00", paymentIntentId: upgrade },
        ]);
        const x = refundOf("re_r382_X", 3000, "pending", 1);
        provider.refunds.push(x);
        await deliverRefund(x);
        x.status = "succeeded";
        await expect(deliverRefund(x)).rejects.toThrow(
          /balance changed outside/
        );
        expect(await row()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_after_cancel",
          refundId: x.id,
          completedAt: null,
        });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 3000 });
        expect(await refundLedger()).toEqual(booked);
        expect(await liabilityOpen()).toBe(true);
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "review_required",
          errorCode: "provider_refund_balance_conflict",
        });
        expect(await refundLedger()).toEqual(booked);
      }, 60000);

      it("control (W8): reconcile takes the reopening refund's failure, not the failed refund that preceded the cancel", async () => {
        await failServicing();
        await caller().cancelServicingRefund({ requestId, attempt: 1, reason });
        const cancelled = await row();
        const x = refundOf("re_r382_X", 6000, "pending", 1);
        provider.refunds.push(x);
        await deliverRefund(x);
        // X fails with no event; the refund that failed before the cancel is
        // listed first.
        x.status = "failed";
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "provider_failed",
          status: "cancelled",
          refundId: x.id,
        });
        expect(await row()).toMatchObject({
          status: "cancelled",
          errorCode: "provider_refund_after_cancel",
          resolvedAt: cancelled.resolvedAt,
          resolutionReason: reason,
        });
        expect(await liabilityOpen()).toBe(false);
        await expect(
          caller().retryServicingRefund({ requestId, attempt: 1 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      }, 60000);

      it("control (W12): a settled request an operator once cancelled follows the settled-row rules for another refund of its attempt", async () => {
        await cancelledOnAttempt1(6000);
        const x = refundOf("re_r382_X", 6000, "pending", 1);
        provider.refunds.push(x);
        await deliverRefund(x);
        x.status = "succeeded";
        await deliverRefund(x);
        const settled = await row();
        expect(settled).toMatchObject({ status: "succeeded", refundId: x.id });
        const w = refundOf("re_r382_W", 6000, "succeeded", 1);
        provider.refunds.push(w);
        await expect(deliverRefund(w)).rejects.toThrow(
          /does not match the saved request/
        );
        expect(await row()).toEqual(settled);
      }, 60000);

      it("control (W19): reconcile does not treat a failed refund as the reopening one when the request records none", async () => {
        await saveServicing({
          attempt: 2,
          amount: 6000,
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
        });
        await caller().cancelServicingRefund({ requestId, attempt: 2, reason });
        const earlier = refundOf("re_r382_E1", 6000, "pending", 1);
        provider.refunds.push(earlier);
        await deliverRefund(earlier);
        // It fails with no event.
        earlier.status = "failed";
        const before = await row();
        expect(before).toMatchObject({
          status: "review_required",
          errorCode: "duplicate_provider_refund",
          refundId: null,
        });
        expect(
          await caller().reconcileServicingRefund({ requestId })
        ).toMatchObject({
          outcome: "review_required",
          status: "review_required",
          errorCode: "duplicate_provider_refund",
        });
        expect(await row()).toEqual(before);
      }, 60000);
    });

    describe("authorization", () => {
      for (const role of NON_ADMIN_ROLES)
        it(`fix: ${role} is refused on all four procedures before any provider or row access`, async () => {
          await saveServicing({
            status: "failed",
            errorCode: "provider_refund_failed",
            refundId: "re_r382_refused",
          });
          const before = await row();
          const forbidden = { code: "FORBIDDEN" };
          await expect(
            caller(role).servicingRefundReviews({ limit: 50 })
          ).rejects.toMatchObject(forbidden);
          await expect(
            caller(role).reconcileServicingRefund({ requestId })
          ).rejects.toMatchObject(forbidden);
          await expect(
            caller(role).retryServicingRefund({ requestId, attempt: 1 })
          ).rejects.toMatchObject(forbidden);
          await expect(
            caller(role).cancelServicingRefund({
              requestId,
              attempt: 1,
              reason,
            })
          ).rejects.toMatchObject(forbidden);
          expect(provider.list).not.toHaveBeenCalled();
          expect(provider.retrieve).not.toHaveBeenCalled();
          expect(provider.create).not.toHaveBeenCalled();
          expect(await row()).toEqual(before);
        }, 60000);
    });

    describe("schema guard", () => {
      it("fix: the attempts table holds only failed or canceled refunds, one per attempt and per provider refund", async () => {
        const insert = (attempt: number, refundId: string, status: string) =>
          fixture.db.execute(
            sql`INSERT INTO order_service_refund_attempts (requestId, attempt, refundId, status) VALUES (${requestId}, ${attempt}, ${refundId}, ${status})`
          );
        for (const status of ["succeeded", "pending", "requires_action", ""])
          await expect(insert(1, `re_${status}`, status)).rejects.toThrow();
        await insert(1, "re_one", "failed");
        await insert(2, "re_two", "canceled");
        await expect(insert(2, "re_three", "failed")).rejects.toThrow();
        await expect(insert(3, "re_one", "failed")).rejects.toThrow();
        expect((await attempts()).map(a => [a.attempt, a.status])).toEqual([
          [1, "failed"],
          [2, "canceled"],
        ]);
      }, 60000);
    });

    describe("controls: the worker's existing behaviour", () => {
      it("control: queued to succeeded keeps the attempt-1 key order-refund:<id> and its exact request", async () => {
        await saveServicing();
        await processPendingOrderRefunds();
        expect(provider.create.mock.calls).toEqual([
          [
            {
              payment_intent: upgrade,
              amount: 6000,
              metadata: {
                orderServiceRefundId: requestId,
                modificationId: "9001",
              },
            },
            { idempotencyKey: `order-refund:${requestId}` },
          ],
        ]);
        expect(await row()).toMatchObject({ status: "succeeded" });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
        expect(await refundLedger()).toEqual([
          { type: "refund", amount: "60.00", paymentIntentId: upgrade },
        ]);
      }, 60000);

      it("control: the worker's review codes are unchanged", async () => {
        const id = (n: number) => `00000000-0000-4000-8000-00000000040${n}`;
        // No provider record a day after the request.
        await saveServicing({
          id: id(1),
          status: "requesting",
          requestedAt: new Date(now.getTime() - 24 * 3600_000),
          nextAttemptAt: new Date(now.getTime() - 60_000),
        });
        // Two provider refunds carrying the same request.
        await saveServicing({
          id: id(2),
          modificationId: 9002,
          paymentIntentId: original,
          amount: 1000,
        });
        for (const n of [1, 2])
          provider.refunds.push({
            id: `re_r382_duplicate_${n}`,
            object: "refund",
            status: "pending",
            amount: 1000,
            currency: "sar",
            payment_intent: original,
            charge: `ch_${original}`,
            metadata: { orderServiceRefundId: id(2) },
          });
        await processPendingOrderRefunds();
        expect(
          (await rows())
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(r => [r.status, r.errorCode])
        ).toEqual([
          ["review_required", "unknown_provider_outcome"],
          ["review_required", "duplicate_provider_refund"],
        ]);
        expect(provider.create).not.toHaveBeenCalled();
      }, 60000);
    });
  }
);
