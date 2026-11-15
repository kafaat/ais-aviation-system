import { eq } from "drizzle-orm";
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
 * S-08, owner decision 6 (issue #327): settling held refunds by the chargeback
 * after a lost dispute. The bank has already returned a lost dispute's amount
 * L, taken from its funds_withdrawn adjustment. Saved refunds of the lost
 * collection that never reached the provider share L in creation order: a
 * fully covered refund closes with no provider call; an ordinary command sends
 * only the uncovered remainder under its own key; a split payer share or order
 * refund only partly covered goes to review; a refund already sent is never
 * sent again. These cases drive the verified Stripe event path and the refund
 * workers on migrated native MySQL tables; provider responses are synthetic.
 * Coupon cases pin the suspension rules the refund paths depend on.
 */
const provider = vi.hoisted(() => ({
  db: null as any,
  refund: null as any,
  create: null as any,
  byId: {} as Record<string, any>,
}));
vi.mock("../db", () => ({ getDb: () => provider.db }));
vi.mock("../stripe", () => ({
  stripe: {
    refunds: {
      create: (...args: unknown[]) => provider.create(...args),
      retrieve: async (id: string) => provider.byId[id] ?? provider.refund,
      list: (params: { payment_intent?: string }) => ({
        async *[Symbol.asyncIterator]() {
          if (provider.refund?.payment_intent === params.payment_intent)
            yield provider.refund;
        },
      }),
    },
  },
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { processStripeEvent } from "../webhooks/stripe";
import { createRefund } from "../services/refunds.service";
import {
  getSplitRefundCancellation,
  processPendingSplitRefunds,
  reserveSplitRefundCancellation,
} from "../services/split-refund.service";
import { quotePaidOrderService } from "../services/order-servicing.service";
import { checkInPassengers } from "../services/departure-control.service";
import { readTicketDocument } from "../services/ticket-documents.service";
import {
  processOrdinaryRefundCancellation,
  processPendingOrdinaryRefunds,
  reserveOrdinaryRefundCancellation,
} from "../services/ordinary-refund.service";
import { processPendingOrderRefunds } from "../services/order-refunds.service";
import { getRefundStats } from "../services/refunds-stats.service";
import {
  getFlightCancellationStatus,
  processFlightCancellations,
  requestFlightCancellation,
} from "../services/flight-cancellation.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

// Six hours before flight 41: check-in is open.
const now = new Date("2030-06-10T06:00:00Z");
const intent = "pi_native_s08";
const owner = { userId: 9, tenantId: 3, role: "user" };
const customer = { id: 9, role: "user", tenantId: 3 };
const admin = { id: 20, role: "admin" };
const ticket = (passengerId: number) => `06500000000${passengerId}`;
const later = (minutes: number) =>
  vi.setSystemTime(new Date(now.getTime() + minutes * 60_000));
const payerA = {
  id: "dp_native_s08_a",
  payment_intent: `${intent}_a`,
  amount: 10000,
};
const payerB = {
  id: "dp_native_s08_b",
  payment_intent: `${intent}_b`,
  amount: 10000,
};
const outage = () => new Error("Synthetic provider outage");
const flightCancellation = {
  flightId: 41,
  reason: "Native S-08 flight cancellation",
  actorId: 20,
  tenantId: 3,
};
// Order refund ids. Where two refunds are due together, the later-created one
// has the smaller id, so the worker may meet it first; allocation still
// follows creation order.
const largeId = "ffffffff-0000-4000-8000-000000000001";
const smallId = "00000000-0000-4000-8000-000000000002";

nativeDescribe.sequential(
  "S-08 chargeback settlement of held refunds on native MySQL",
  () => {
    let fixture: PaidBookingNativeFixture;
    let sequence = 0;

    async function deliver(
      type: string,
      overrides: Record<string, unknown> = {},
      id = `evt_native_s08_${++sequence}`
    ) {
      const object = {
        id: "dp_native_s08",
        object: "dispute",
        charge: "ch_native_s08",
        payment_intent: intent,
        amount: 20000,
        currency: "sar",
        status: "needs_response",
        reason: "fraudulent",
        ...overrides,
      };
      await fixture.db.transaction(tx =>
        processStripeEvent(
          tx as never,
          {
            id,
            type,
            data: { object },
          } as never
        )
      );
      return id;
    }
    const withdraw = (overrides: Record<string, unknown> = {}, id?: string) =>
      deliver(
        "charge.dispute.funds_withdrawn",
        { status: "under_review", ...overrides },
        id
      );
    const close = (
      status: "lost" | "won",
      overrides: Record<string, unknown> = {},
      id?: string
    ) => deliver("charge.dispute.closed", { ...overrides, status }, id);

    async function coupons() {
      return fixture.db
        .select({
          passengerId: schema.ticketCoupons.passengerId,
          status: schema.ticketCoupons.status,
          suspendedFromStatus: schema.ticketCoupons.suspendedFromStatus,
        })
        .from(schema.ticketCoupons)
        .where(eq(schema.ticketCoupons.bookingId, 71))
        .orderBy(schema.ticketCoupons.passengerId);
    }
    async function bookingStatus() {
      const [booking] = await fixture.db
        .select({ status: schema.bookings.status })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, 71));
      return booking.status;
    }
    async function ordinaryCommand() {
      const [saved] = await fixture.db
        .select()
        .from(schema.ordinaryBookingRefunds);
      return saved;
    }
    // Posted refund deltas; a refund settled by the chargeback posts none.
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
      ).filter(row => ["refund", "partial_refund"].includes(row.type));
    }
    // A cancellation refund saved, queued, before any dispute.
    async function reserveQueued(amount: number) {
      return reserveOrdinaryRefundCancellation(fixture.db as never, {
        bookingId: 71,
        actor: admin,
        userId: 9,
        tenantId: 3,
        request: {
          payment_intent: intent,
          amount,
          reason: "requested_by_customer" as const,
          metadata: {
            bookingId: "71",
            refundOperationId: `booking-71-refund-${amount}`,
          },
        },
        baseRefundedAmount: 0,
      });
    }
    // Provider refunds with their own ids, retrievable by id. A request on
    // the failing collection meets a transport error instead.
    function distinctRefunds(status = "pending", failing?: string) {
      provider.create = vi.fn(async (request: any) => {
        if (request.payment_intent === failing) throw outage();
        provider.refund = {
          id: `re_${request.payment_intent}`,
          object: "refund",
          status,
          amount: request.amount,
          currency: "sar",
          payment_intent: request.payment_intent,
          charge: `ch_${request.payment_intent}`,
          metadata: request.metadata,
        };
        provider.byId[provider.refund.id] = provider.refund;
        return provider.refund;
      });
    }
    const sentTo = (paymentIntentId: string) =>
      provider.create.mock.calls.filter(
        ([request]: [{ payment_intent: string }]) =>
          request.payment_intent === paymentIntentId
      ).length;

    // Two payers, each with an applied receipt of 10000.
    async function splitFunding() {
      await fixture.db
        .update(schema.bookings)
        .set({ stripePaymentIntentId: null })
        .where(eq(schema.bookings.id, 71));
      await fixture.db
        .delete(schema.paymentReceipts)
        .where(eq(schema.paymentReceipts.paymentIntentId, intent));
      for (const [index, payer] of ["a", "b"].entries()) {
        await fixture.db.insert(schema.paymentSplits).values({
          id: 501 + index,
          bookingId: 71,
          payerEmail: `payer-${payer}@example.test`,
          payerName: `Payer ${payer}`,
          amount: 10000,
          percentage: "50.00",
          status: "paid",
          stripePaymentIntentId: `${intent}_${payer}`,
          paymentToken: `native-s08-share-${payer}`,
          expiresAt: new Date("2030-06-09T00:00:00Z"),
        });
        await fixture.db.insert(schema.paymentReceipts).values({
          paymentIntentId: `${intent}_${payer}`,
          bookingId: 71,
          targetId: 501 + index,
          userId: 9,
          kind: "split_payment",
          amount: 10000,
          refundedAmount: 0,
          currency: "SAR",
          settlementStatus: "applied",
        });
      }
    }
    // A split cancellation reserved before any dispute: one share per payer.
    async function reserveSplitCancellation() {
      const available = await getSplitRefundCancellation(71, customer);
      await reserveSplitRefundCancellation(
        {
          bookingId: 71,
          quoteHash: available.quote!.quoteHash,
          reason: "requested_by_customer",
        },
        customer
      );
      return available;
    }
    const splitItems = () =>
      fixture.db
        .select({
          paymentIntentId: schema.bookingRefundItems.paymentIntentId,
          status: schema.bookingRefundItems.status,
          errorCode: schema.bookingRefundItems.errorCode,
          refundId: schema.bookingRefundItems.refundId,
          refundAmount: schema.bookingRefundItems.refundAmount,
          createdAt: schema.bookingRefundItems.createdAt,
        })
        .from(schema.bookingRefundItems)
        .orderBy(schema.bookingRefundItems.splitId);
    async function planStatus() {
      const [plan] = await fixture.db.select().from(schema.bookingRefundPlans);
      return plan.status;
    }
    async function queueOrderRefund(row: {
      id: string;
      modificationId: number;
      amount: number;
      createdAt: Date;
      paymentIntentId?: string;
    }) {
      await fixture.db.insert(schema.orderServiceRefunds).values({
        bookingId: 71,
        paymentIntentId: intent,
        baseRefundedAmount: 0,
        status: "queued",
        nextAttemptAt: now,
        ...row,
      });
    }
    // Two saved order refunds on the funding collection, 5000 then 10000,
    // both due.
    async function twoOrderRefunds() {
      await queueOrderRefund({
        id: largeId,
        modificationId: 9001,
        amount: 5000,
        createdAt: new Date(now.getTime() - 120_000),
      });
      await queueOrderRefund({
        id: smallId,
        modificationId: 9002,
        amount: 10000,
        createdAt: new Date(now.getTime() - 60_000),
      });
    }
    const orderRows = () =>
      fixture.db
        .select({
          id: schema.orderServiceRefunds.id,
          amount: schema.orderServiceRefunds.amount,
          status: schema.orderServiceRefunds.status,
          errorCode: schema.orderServiceRefunds.errorCode,
          refundId: schema.orderServiceRefunds.refundId,
        })
        .from(schema.orderServiceRefunds)
        .orderBy(schema.orderServiceRefunds.createdAt);
    const orderStates = async () =>
      (await orderRows()).map(row => [row.status, row.errorCode]);
    const jobs = () =>
      fixture.db
        .select({ status: schema.flightCancellationJobs.status })
        .from(schema.flightCancellationJobs);

    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_dispute_coupons");
    }, 60000);
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      await fixture.reset();
      await fixture.seed();
      sequence = 0;
      provider.db = fixture.db;
      provider.refund = null;
      provider.byId = {};
      provider.create = vi.fn(async (request: any) => {
        provider.refund = {
          id: "re_native_s08",
          object: "refund",
          status: "pending",
          amount: request.amount,
          currency: "sar",
          payment_intent: request.payment_intent,
          charge: "ch_native_s08",
          metadata: request.metadata,
        };
        return provider.refund;
      });
      await fixture.db.insert(schema.users).values({
        id: 20,
        openId: "native-s08-operator",
        tenantId: 3,
        role: "ops",
      });
      await fixture.db
        .update(schema.bookings)
        .set({
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
          stripePaymentIntentId: intent,
          createdAt: new Date("2030-05-01T00:00:00Z"),
        })
        .where(eq(schema.bookings.id, 71));
      await fixture.db
        .update(schema.flights)
        .set({ economyAvailable: 6 })
        .where(eq(schema.flights.id, 41));
      await fixture.db.insert(schema.paymentReceipts).values({
        paymentIntentId: intent,
        bookingId: 71,
        targetId: 71,
        userId: 9,
        kind: "booking",
        amount: 20000,
        refundedAmount: 0,
        currency: "SAR",
        settlementStatus: "applied",
      });
      await fixture.db.insert(schema.payments).values({
        tenantId: 3,
        bookingId: 71,
        amount: 20000,
        currency: "SAR",
        method: "card",
        provider: "stripe",
        status: "completed",
        stripePaymentIntentId: intent,
      });
      for (const [i, passengerId] of [81, 82].entries()) {
        await fixture.db
          .update(schema.passengers)
          .set({ ticketNumber: ticket(passengerId) })
          .where(eq(schema.passengers.id, passengerId));
        await fixture.db.insert(schema.ticketCoupons).values({
          bookingId: 71,
          passengerId,
          flightId: 41,
          ticketNumber: ticket(passengerId),
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

    describe("ordinary cancellation refund", () => {
      it("a lost amount equal to the refund settles it with no provider call", async () => {
        await reserveQueued(5000);
        await withdraw({ amount: 5000 });
        await close("lost", { amount: 5000 });
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        expect(await ordinaryCommand()).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
          amount: 0,
        });
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("a contradictory won close after the settlement reaches no provider and reopens no coupon of the cancelled booking", async () => {
        await reserveQueued(5000);
        await withdraw();
        await close("lost");
        later(61);
        await processPendingOrdinaryRefunds();
        expect(await ordinaryCommand()).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
        });
        await close("won");
        later(200);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 0,
          failed: 0,
        });
        expect(await bookingStatus()).toBe("cancelled");
        expect(
          (await coupons()).some(c => c.status === "O" || c.status === "C")
        ).toBe(false);
        expect(provider.create).not.toHaveBeenCalled();
        expect(await refundLedger()).toEqual([]);
        expect(await getRefundStats()).toMatchObject({
          totalRefunds: 0,
          pendingRefunds: 0,
          reviewRequiredRefunds: 0,
        });
      });

      it("a lost close then a won close before the worker runs sends the full refund once under its own key", async () => {
        await reserveQueued(5000);
        await withdraw();
        await close("lost");
        await close("won");
        later(61);
        await processPendingOrdinaryRefunds();
        later(200);
        await processPendingOrdinaryRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(provider.create).toHaveBeenCalledWith(
          expect.objectContaining({ payment_intent: intent, amount: 5000 }),
          { idempotencyKey: "booking-71-refund-5000" }
        );
      });

      it("new refunds of the lost collection are refused after the lost close", async () => {
        await withdraw();
        await close("lost");
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        await expect(
          createRefund({ bookingId: 71, userId: 9 }, admin)
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(provider.create).not.toHaveBeenCalled();
        expect(await ordinaryCommand()).toBeUndefined();
      });

      it("a remainder whose send failed is retried under the same remainder key and is never covered again", async () => {
        await reserveQueued(15000);
        await withdraw({ amount: 5000 });
        await close("lost", { amount: 5000 });
        const ok = provider.create;
        provider.create = vi.fn(async () => {
          throw outage();
        });
        later(61);
        await processPendingOrdinaryRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await ordinaryCommand()).toMatchObject({
          amount: 10000,
          operationId: "booking-71-refund-15000:chargeback-remainder",
        });
        provider.create = ok;
        later(200);
        await processPendingOrdinaryRefunds();
        later(400);
        await processPendingOrdinaryRefunds();
        expect(ok).toHaveBeenCalledTimes(1);
        expect(ok).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 10000 }),
          { idempotencyKey: "booking-71-refund-15000:chargeback-remainder" }
        );
        expect(await ordinaryCommand()).toMatchObject({
          amount: 10000,
          status: "pending",
        });
      });

      it("a command already sent with an unknown outcome goes to review after the lost close and is never sent again", async () => {
        const sent = provider.create;
        provider.create = vi.fn(async () => {
          throw outage();
        });
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
        ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
        provider.create = sent;
        await withdraw();
        await close("lost");
        later(61);
        await processPendingOrdinaryRefunds();
        expect(await ordinaryCommand()).toMatchObject({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          refundId: null,
        });
        expect(sent).not.toHaveBeenCalled();
      });
    });

    describe("allocation of the lost amount", () => {
      it.each([
        {
          L: 3000,
          first: ["review_required", "chargeback_partial_cover"],
          second: ["succeeded", null],
          calls: 1,
        },
        {
          L: 4999,
          first: ["review_required", "chargeback_partial_cover"],
          second: ["succeeded", null],
          calls: 1,
        },
        {
          L: 5000,
          first: ["succeeded", "settled_by_chargeback"],
          second: ["succeeded", null],
          calls: 1,
        },
        {
          L: 8000,
          first: ["succeeded", "settled_by_chargeback"],
          second: ["review_required", "chargeback_partial_cover"],
          calls: 0,
        },
        {
          L: 15000,
          first: ["succeeded", "settled_by_chargeback"],
          second: ["succeeded", "settled_by_chargeback"],
          calls: 0,
        },
      ])(
        "two held order refunds share L=$L in creation order; replays and later runs change nothing",
        async ({ L, first, second, calls }) => {
          await twoOrderRefunds();
          await withdraw({ amount: L });
          await processPendingOrderRefunds();
          expect(await orderStates()).toEqual([
            ["queued", "dispute_funds_withdrawn"],
            ["queued", "dispute_funds_withdrawn"],
          ]);
          const lost = await close("lost", { amount: L });
          distinctRefunds("succeeded");
          later(61);
          await processPendingOrderRefunds();
          const rows = await orderRows();
          expect(rows.map(r => [r.status, r.errorCode])).toEqual([
            first,
            second,
          ]);
          expect(provider.create).toHaveBeenCalledTimes(calls);
          if (calls)
            expect(provider.create).toHaveBeenCalledWith(
              expect.objectContaining({
                payment_intent: intent,
                amount: 10000,
              }),
              { idempotencyKey: `order-refund:${smallId}` }
            );
          const ledger = await refundLedger();
          expect(ledger.length).toBe(calls);
          await close("lost", { amount: L }, lost);
          later(300);
          await processPendingOrderRefunds();
          expect(await orderRows()).toEqual(rows);
          expect(provider.create).toHaveBeenCalledTimes(calls);
          expect(await refundLedger()).toEqual(ledger);
          expect(await getRefundStats()).toMatchObject({
            totalRefunds: calls,
            totalRefundedAmount: calls * 10000,
          });
        }
      );

      it.each([
        { L: 5000, second: ["succeeded", null], calls: 1 },
        {
          L: 12000,
          second: ["review_required", "chargeback_partial_cover"],
          calls: 0,
        },
        { L: 20000, second: ["succeeded", "settled_by_chargeback"], calls: 0 },
      ])(
        "an order refund saved after an earlier one was settled gets only what the settled refund left of L=$L",
        async ({ L, second, calls }) => {
          await queueOrderRefund({
            id: smallId,
            modificationId: 9001,
            amount: 5000,
            createdAt: new Date(now.getTime() - 120_000),
          });
          await withdraw({ amount: L });
          await close("lost", { amount: L });
          distinctRefunds("succeeded");
          later(1);
          await processPendingOrderRefunds();
          expect(await orderStates()).toEqual([
            ["succeeded", "settled_by_chargeback"],
          ]);
          await queueOrderRefund({
            id: largeId,
            modificationId: 9002,
            amount: 10000,
            createdAt: new Date(now.getTime() - 60_000),
          });
          later(5);
          await processPendingOrderRefunds();
          expect(await orderStates()).toEqual([
            ["succeeded", "settled_by_chargeback"],
            second,
          ]);
          expect(provider.create).toHaveBeenCalledTimes(calls);
          if (calls)
            expect(provider.create).toHaveBeenCalledWith(
              expect.objectContaining({ amount: 10000 }),
              { idempotencyKey: `order-refund:${largeId}` }
            );
        }
      );

      it("a partly covered order refund in review keeps its share of L, so a later refund is sent in full", async () => {
        await queueOrderRefund({
          id: smallId,
          modificationId: 9001,
          amount: 5000,
          createdAt: new Date(now.getTime() - 120_000),
        });
        await withdraw({ amount: 3000 });
        await close("lost", { amount: 3000 });
        distinctRefunds("succeeded");
        later(1);
        await processPendingOrderRefunds();
        expect(await orderStates()).toEqual([
          ["review_required", "chargeback_partial_cover"],
        ]);
        await queueOrderRefund({
          id: largeId,
          modificationId: 9002,
          amount: 10000,
          createdAt: new Date(now.getTime() - 60_000),
        });
        later(5);
        await processPendingOrderRefunds();
        expect(await orderStates()).toEqual([
          ["review_required", "chargeback_partial_cover"],
          ["succeeded", null],
        ]);
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(provider.create).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 10000 }),
          { idempotencyKey: `order-refund:${largeId}` }
        );
      });

      it("an order refund already sent takes no share of L and is never sent again, while a later unsent refund is settled", async () => {
        await queueOrderRefund({
          id: largeId,
          modificationId: 9001,
          amount: 5000,
          createdAt: new Date(now.getTime() - 120_000),
        });
        provider.create = vi.fn(async () => {
          throw outage();
        });
        await processPendingOrderRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        // The send failed in transport: requested, retried a minute later.
        expect(await orderStates()).toEqual([
          ["requesting", "transport_or_reconciliation_error"],
        ]);
        await queueOrderRefund({
          id: smallId,
          modificationId: 9002,
          amount: 5000,
          createdAt: new Date(now.getTime() - 60_000),
        });
        await withdraw({ amount: 5000 });
        await close("lost", { amount: 5000 });
        distinctRefunds("succeeded");
        // Only the unsent refund is due: it is covered in full by L.
        later(0.5);
        await processPendingOrderRefunds();
        expect(await orderStates()).toEqual([
          ["requesting", "transport_or_reconciliation_error"],
          ["succeeded", "settled_by_chargeback"],
        ]);
        // The sent refund is reconciled from provider history, not re-sent.
        later(2);
        await processPendingOrderRefunds();
        expect(await orderRows()).toMatchObject([
          {
            id: largeId,
            status: "review_required",
            errorCode: "unknown_provider_outcome",
            refundId: null,
          },
          { id: smallId, status: "succeeded" },
        ]);
        expect(provider.create).not.toHaveBeenCalled();
        expect(await refundLedger()).toEqual([]);
      });

      it("L is the sum of every lost dispute on the collection, and a lost dispute later won returns nothing", async () => {
        await reserveQueued(9000);
        await withdraw({ amount: 3000 });
        await close("lost", { amount: 3000 });
        const second = { id: "dp_native_s08_2", charge: "ch_native_s08_2" };
        await withdraw({ ...second, amount: 4000 });
        await close("lost", { ...second, amount: 4000 });
        const won = { id: "dp_native_s08_3", charge: "ch_native_s08_3" };
        await withdraw({ ...won, amount: 5000 });
        await close("won", { ...won, amount: 5000 });
        await close("lost", { ...won, amount: 5000 });
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        const key = "booking-71-refund-9000:chargeback-remainder";
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(provider.create).toHaveBeenCalledWith(
          expect.objectContaining({
            payment_intent: intent,
            amount: 2000,
            metadata: expect.objectContaining({
              refundOperationId: key,
              chargebackSettledAmount: "7000",
            }),
          }),
          { idempotencyKey: key }
        );
        expect(await ordinaryCommand()).toMatchObject({
          amount: 2000,
          operationId: key,
          status: "pending",
        });
      });
    });

    describe("split payer shares", () => {
      it("a payer's lost dispute smaller than its share sends that share to review, and the other payer is refunded", async () => {
        await splitFunding();
        await reserveSplitCancellation();
        await withdraw({ ...payerA, amount: 1000 });
        await processPendingSplitRefunds();
        const lost = await close("lost", { ...payerA, amount: 1000 });
        distinctRefunds("succeeded");
        later(61);
        await processPendingSplitRefunds();
        const [a, b] = await splitItems();
        expect(a).toMatchObject({
          status: "review_required",
          errorCode: "chargeback_partial_cover",
          refundId: null,
        });
        expect(b).toMatchObject({
          status: "succeeded",
          refundId: `re_${intent}_b`,
        });
        expect(provider.create).toHaveBeenCalledTimes(1);
        await close("lost", { ...payerA, amount: 1000 }, lost);
        later(300);
        await processPendingSplitRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await refundLedger()).toEqual([
          expect.objectContaining({ paymentIntentId: `${intent}_b` }),
        ]);
      });

      it("a lost close before its withdrawal holds the payer's share while the other payer is refunded, then settles it", async () => {
        await splitFunding();
        await reserveSplitCancellation();
        await close("lost", payerA);
        distinctRefunds("succeeded");
        later(61);
        await processPendingSplitRefunds();
        let [a, b] = await splitItems();
        expect(a).toMatchObject({
          status: "queued",
          errorCode: "dispute_funds_withdrawn",
          refundId: null,
        });
        expect(b).toMatchObject({ status: "succeeded" });
        expect(provider.create).toHaveBeenCalledTimes(1);
        await withdraw(payerA);
        later(200);
        await processPendingSplitRefunds();
        [a, b] = await splitItems();
        expect(a).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
          refundId: null,
        });
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await planStatus()).toBe("completed");
      });

      it("a payer's lost dispute settles nothing while another payer's dispute still has funds withdrawn", async () => {
        await splitFunding();
        await reserveSplitCancellation();
        await withdraw(payerA);
        await close("lost", payerA);
        await withdraw(payerB);
        distinctRefunds("succeeded");
        later(61);
        await processPendingSplitRefunds();
        expect(
          (await splitItems()).map(item => [item.status, item.errorCode])
        ).toEqual([
          ["queued", "dispute_funds_withdrawn"],
          ["queued", "dispute_funds_withdrawn"],
        ]);
        expect(provider.create).not.toHaveBeenCalled();
        await close("won", payerB);
        later(200);
        await processPendingSplitRefunds();
        const [a, b] = await splitItems();
        expect(a).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
          refundId: null,
        });
        expect(b).toMatchObject({
          status: "succeeded",
          refundId: `re_${intent}_b`,
        });
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await planStatus()).toBe("completed");
      });

      it("a share already sent with an unknown outcome goes to review after the payer's lost close and is never sent again", async () => {
        await splitFunding();
        await reserveSplitCancellation();
        distinctRefunds("succeeded", payerA.payment_intent);
        await processPendingSplitRefunds();
        expect(sentTo(payerA.payment_intent)).toBe(1);
        expect(sentTo(payerB.payment_intent)).toBe(1);
        expect((await splitItems())[0]).toMatchObject({
          status: "requesting",
          errorCode: "provider_unavailable",
          refundId: null,
        });
        await withdraw(payerA);
        await close("lost", payerA);
        later(61);
        await processPendingSplitRefunds();
        const [a, b] = await splitItems();
        expect(a).toMatchObject({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          refundId: null,
        });
        expect(b).toMatchObject({
          status: "succeeded",
          refundId: `re_${intent}_b`,
        });
        later(200);
        await processPendingSplitRefunds();
        expect(sentTo(payerA.payment_intent)).toBe(1);
        expect(provider.create).toHaveBeenCalledTimes(2);
      });

      it("a settled share keeps its part of L, so a later order refund on that payer's collection is only partly covered", async () => {
        await splitFunding();
        await reserveSplitCancellation();
        await withdraw({ ...payerA, amount: 6000 });
        await close("lost", { ...payerA, amount: 6000 });
        distinctRefunds("succeeded");
        later(61);
        await processPendingSplitRefunds();
        const [a] = await splitItems();
        expect(a).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
          refundAmount: 2500,
        });
        expect(provider.create).toHaveBeenCalledTimes(1);
        // 6000 - 2500 leaves 3500 for a 5000 refund saved later.
        await queueOrderRefund({
          id: largeId,
          modificationId: 9001,
          amount: 5000,
          paymentIntentId: payerA.payment_intent,
          createdAt: new Date(a.createdAt.getTime() + 60_000),
        });
        later(62);
        await processPendingOrderRefunds();
        expect(await orderStates()).toEqual([
          ["review_required", "chargeback_partial_cover"],
        ]);
        expect(provider.create).toHaveBeenCalledTimes(1);
      });

      it("a new split cancellation is refused after one payer's lost dispute", async () => {
        await splitFunding();
        const available = await getSplitRefundCancellation(71, customer);
        await withdraw(payerA);
        await close("lost", payerA);
        const preview = await getSplitRefundCancellation(71, customer);
        expect(preview.quote).toBeNull();
        await expect(
          reserveSplitRefundCancellation(
            {
              bookingId: 71,
              quoteHash: available.quote!.quoteHash,
              reason: "requested_by_customer",
            },
            customer
          )
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(provider.create).not.toHaveBeenCalled();
      });
    });

    describe("flight-cancellation order refunds", () => {
      it.each([
        {
          L: 20000,
          status: "succeeded",
          code: "settled_by_chargeback",
          job: "completed",
        },
        {
          L: 5000,
          status: "review_required",
          code: "chargeback_partial_cover",
          job: "review_required",
        },
      ])(
        "a flight cancellation requested after the lost close of L=$L closes its refund as $status with no provider call",
        async ({ L, status, code, job }) => {
          await withdraw({ amount: L });
          await close("lost", { amount: L });
          await requestFlightCancellation(flightCancellation);
          await processFlightCancellations();
          later(61);
          await processFlightCancellations();
          later(200);
          await processFlightCancellations();
          expect(
            (await orderRows()).map(r => [r.amount, r.status, r.errorCode])
          ).toEqual([[20000, status, code]]);
          expect(provider.create).not.toHaveBeenCalled();
          expect(await jobs()).toEqual([{ status: job }]);
          expect(await refundLedger()).toEqual([]);
        }
      );

      it("a lost close before its withdrawal holds the order refund, then settles it", async () => {
        await close("lost");
        await requestFlightCancellation(flightCancellation);
        await processFlightCancellations();
        later(61);
        await processFlightCancellations();
        expect(await orderStates()).toEqual([
          ["queued", "dispute_funds_withdrawn"],
        ]);
        expect(provider.create).not.toHaveBeenCalled();
        await withdraw();
        later(200);
        await processFlightCancellations();
        expect(await orderStates()).toEqual([
          ["succeeded", "settled_by_chargeback"],
        ]);
        expect(await jobs()).toEqual([{ status: "completed" }]);
        expect(provider.create).not.toHaveBeenCalled();
      });
    });

    describe("fail closed", () => {
      it("a corrupt withdrawal amount fails closed instead of sending the refund in full", async () => {
        await reserveQueued(5000);
        const withdrawal = await withdraw();
        await close("lost");
        await fixture.db
          .update(schema.financialLedger)
          .set({ amount: "0.00" })
          .where(eq(schema.financialLedger.stripeEventId, withdrawal));
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 1,
        });
        await expect(processOrdinaryRefundCancellation(71)).rejects.toThrow(
          /dispute evidence requires reconciliation/
        );
        expect(await ordinaryCommand()).toMatchObject({
          status: "queued",
          amount: 5000,
          requestedAt: null,
        });
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("a saved refund that is not awaiting the dispute outcome fails closed instead of being sent in full", async () => {
        await reserveQueued(5000);
        await withdraw();
        await close("lost");
        // Inconsistent state: reviewed as unknown, yet never requested.
        await fixture.db.update(schema.ordinaryBookingRefunds).set({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
        });
        const before = await ordinaryCommand();
        later(61);
        await expect(processOrdinaryRefundCancellation(71)).rejects.toThrow(
          /not awaiting the dispute outcome/
        );
        expect(await ordinaryCommand()).toEqual(before);
        expect(provider.create).not.toHaveBeenCalled();
      });
    });

    describe("coupons", () => {
      it("a suspended coupon row refuses an exchange quote even without dispute evidence", async () => {
        await fixture.db
          .update(schema.ticketCoupons)
          .set({ status: "S", suspendedFromStatus: "O" })
          .where(eq(schema.ticketCoupons.passengerId, 81));
        await expect(
          quotePaidOrderService(
            {
              bookingId: 71,
              idempotencyKey: "native-s08-exchange-suspended-row",
              offerIds: ["00000000-0000-4000-8000-0000000000aa"],
            },
            9,
            3
          )
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(
            /Ticket coupons are suspended while a payment dispute has withdrawn/
          ),
        });
      });

      it("a document first issued for a checked-in passenger while funds are withdrawn keeps C as the prior status, and a won close restores it", async () => {
        await checkInPassengers({
          bookingId: 71,
          flightId: 41,
          assignments: [{ passengerId: 82, seatNumber: "12B" }],
          owner,
        });
        await fixture.db
          .delete(schema.ticketCoupons)
          .where(eq(schema.ticketCoupons.passengerId, 82));
        await withdraw();
        const document = await readTicketDocument(71, 82, 9);
        expect(document.legs.map(leg => leg.localCoupon)).toEqual([
          { number: 1, status: "S" },
        ]);
        expect(await coupons()).toEqual([
          { passengerId: 81, status: "S", suspendedFromStatus: "O" },
          { passengerId: 82, status: "S", suspendedFromStatus: "C" },
        ]);
        await close("won");
        expect(await coupons()).toEqual([
          { passengerId: 81, status: "O", suspendedFromStatus: null },
          { passengerId: 82, status: "C", suspendedFromStatus: null },
        ]);
      });
    });

    // Documented limits of S-08, pinned so a change to them is deliberate.
    describe("known limits", () => {
      it("a withdrawal committed between the refund's commit and its provider call is still refunded once", async () => {
        const original = provider.create;
        provider.create = vi.fn(async (...args: unknown[]) => {
          await withdraw();
          return original(...args);
        });
        await createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin);
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await ordinaryCommand()).toMatchObject({
          amount: 5000,
          refundId: "re_native_s08",
        });
      });

      it("getFlightCancellationStatus counts a booking settled by the chargeback as refunded", async () => {
        await withdraw();
        await close("lost");
        await requestFlightCancellation(flightCancellation);
        await processFlightCancellations();
        later(61);
        await processFlightCancellations();
        expect(await getFlightCancellationStatus(41)).toMatchObject({
          completedBookings: 1,
          refundedBookings: 1,
        });
        expect(provider.create).not.toHaveBeenCalled();
      });
    });
  }
);
