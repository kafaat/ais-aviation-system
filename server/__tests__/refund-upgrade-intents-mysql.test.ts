import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
import { forensicFindings } from "../../scripts/ci/forensic-data-audit";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

/**
 * Decision 7 (issue #327, option A, 14 November 2026): an order-servicing
 * upgrade collected its difference on a second payment intent, recorded as a
 * `modification` receipt. A cancellation refund then draws on both intents,
 * the upgrade first, each up to what that intent still holds, one part per
 * intent with its own key, status and retry. Booking total 26000: the
 * original intent collected 20000 and the upgrade intent 6000. These cases
 * drive createRefund, the refund worker and the verified Stripe event path on
 * migrated native MySQL tables; provider responses are synthetic.
 *
 * "fix" cases fail on the base (ad9016c); "control" cases pass there too.
 */
const provider = vi.hoisted(() => ({
  db: null as any,
  refunds: [] as any[],
  failing: new Set<string>(),
  status: "succeeded",
  create: null as any,
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
      retrieve: async (id: string) =>
        provider.refunds.find(refund => refund.id === id) ?? null,
      list: (params: { payment_intent?: string }) => ({
        async *[Symbol.asyncIterator]() {
          for (const refund of provider.refunds)
            if (refund.payment_intent === params.payment_intent) yield refund;
        },
      }),
    },
  },
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { processStripeEvent } from "../webhooks/stripe";
import {
  createRefund,
  getCancellationQuote,
} from "../services/refunds.service";
import {
  processPendingOrdinaryRefunds,
  reserveOrdinaryRefundAcrossIntents,
} from "../services/ordinary-refund.service";
import { getRefundStats } from "../services/refunds-stats.service";
import { consumeLocalEvent } from "../services/event-inbox.service";
import { ordinaryRefundRequiresReconciliation } from "../services/departure-financial-authority.service";
import { settleVerifiedRefund } from "../services/payment-settlement.service";
import { refundsRouter } from "../routers/refunds";
import type { TrpcContext } from "../_core/context";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

// Three weeks before flight 41: the full refund tier applies.
const now = new Date("2030-05-20T06:00:00Z");
const original = "pi_x7_original";
const upgrade = "pi_x7_upgrade";
const customer = { id: 9, role: "user", tenantId: 3 };
const admin = { id: 20, role: "admin" };
const later = (minutes: number) =>
  vi.setSystemTime(new Date(now.getTime() + minutes * 60_000));
const outage = () => new Error("Synthetic provider outage");

nativeDescribe.sequential(
  "decision 7: cancellation refund across the original and upgrade intents on native MySQL",
  () => {
    let fixture: PaidBookingNativeFixture;
    let sequence = 0;

    const sentTo = (paymentIntentId: string) =>
      provider.create.mock.calls.filter(
        ([request]: [{ payment_intent: string }]) =>
          request.payment_intent === paymentIntentId
      );
    async function parts() {
      return fixture.db
        .select()
        .from(schema.ordinaryBookingRefundParts)
        .orderBy(schema.ordinaryBookingRefundParts.sequence);
    }
    async function command() {
      const [saved] = await fixture.db
        .select()
        .from(schema.ordinaryBookingRefunds);
      return saved;
    }
    async function booking() {
      const [row] = await fixture.db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, 71));
      return row;
    }
    async function receipts() {
      const rows = await fixture.db.select().from(schema.paymentReceipts);
      return Object.fromEntries(
        rows.map(row => [row.paymentIntentId, row.refundedAmount])
      );
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
      ).filter(row => ["refund", "partial_refund"].includes(row.type));
    }
    async function cancellations() {
      return (
        await fixture.db
          .select()
          .from(schema.bookingStatusHistory)
          .where(eq(schema.bookingStatusHistory.bookingId, 71))
      ).filter(row => row.newStatus === "cancelled");
    }
    async function completedEvents() {
      return fixture.db
        .select()
        .from(schema.outbox)
        .where(
          eq(schema.outbox.eventType, "booking.ordinary_refund_completed")
        );
    }
    async function coupons() {
      return (
        await fixture.db
          .select({ status: schema.ticketCoupons.status })
          .from(schema.ticketCoupons)
          .where(eq(schema.ticketCoupons.bookingId, 71))
      ).map(row => row.status);
    }
    async function readFinding(id: string) {
      const query = forensicFindings.find(finding => finding.id === id)!.sql;
      const [rows] = await fixture.db.execute(sql.raw(query));
      return rows;
    }
    async function deliverRefund(refund: any, id = `evt_x7_${++sequence}`) {
      await fixture.db.transaction(tx =>
        processStripeEvent(
          tx as never,
          { id, type: "refund.updated", data: { object: refund } } as never
        )
      );
    }
    async function deliverDispute(
      type: string,
      overrides: Record<string, unknown>
    ) {
      const object = {
        id: `dp_x7_${overrides.payment_intent}`,
        object: "dispute",
        charge: `ch_${overrides.payment_intent}`,
        amount: 6000,
        currency: "sar",
        status: "needs_response",
        reason: "fraudulent",
        ...overrides,
      };
      await fixture.db.transaction(tx =>
        processStripeEvent(
          tx as never,
          { id: `evt_x7_${++sequence}`, type, data: { object } } as never
        )
      );
    }
    const withdraw = (paymentIntentId: string, amount: number) =>
      deliverDispute("charge.dispute.funds_withdrawn", {
        payment_intent: paymentIntentId,
        amount,
        status: "under_review",
      });
    const close = (
      paymentIntentId: string,
      amount: number,
      status: "lost" | "won"
    ) =>
      deliverDispute("charge.dispute.closed", {
        payment_intent: paymentIntentId,
        amount,
        status,
      });
    async function fullTierCancellation() {
      const quote = await getCancellationQuote(71);
      expect(quote.refundAmount).toBe(26000);
      return createRefund(
        { bookingId: 71, userId: 9, quoteHash: quote.quoteHash },
        customer
      );
    }
    // A cancellation saved, queued, before any dispute: the whole invoice.
    async function reserveQueued(amount = 26000) {
      return reserveOrdinaryRefundAcrossIntents(fixture.db as never, {
        bookingId: 71,
        actor: admin,
        userId: 9,
        tenantId: 3,
        request: {
          payment_intent: original,
          amount,
          reason: "requested_by_customer" as const,
          metadata: {
            bookingId: "71",
            refundOperationId: `booking-71-refund-${amount}`,
          },
        },
        baseRefundedAmount: 0,
        upgradeBases: new Map([[upgrade, 0]]),
      });
    }
    // The reserve command called directly with one input changed, as a
    // request read before a concurrent change would carry it.
    async function reserveWith(
      changes: Partial<
        Parameters<typeof reserveOrdinaryRefundAcrossIntents>[1]
      >,
      amount = 26000
    ) {
      return reserveOrdinaryRefundAcrossIntents(fixture.db as never, {
        bookingId: 71,
        actor: admin,
        userId: 9,
        tenantId: 3,
        request: {
          payment_intent: original,
          amount,
          reason: "requested_by_customer" as const,
          metadata: {
            bookingId: "71",
            refundOperationId: `booking-71-refund-${amount}`,
          },
        },
        baseRefundedAmount: 0,
        upgradeBases: new Map([[upgrade, 0]]),
        ...changes,
      });
    }
    // A later downgrade lowered the invoice to `total` and refunded the
    // difference on both intents, as recorded by order servicing.
    async function downgradeTo(
      total: number,
      onOriginal: number,
      onUpgrade: number
    ) {
      await fixture.db
        .update(schema.bookings)
        .set({ totalAmount: total })
        .where(eq(schema.bookings.id, 71));
      for (const [paymentIntentId, amount] of [
        [original, onOriginal],
        [upgrade, onUpgrade],
      ] as const) {
        if (!amount) continue;
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: amount })
          .where(eq(schema.paymentReceipts.paymentIntentId, paymentIntentId));
        provider.refunds.push({
          id: `re_x7_downgrade_${paymentIntentId}`,
          object: "refund",
          status: "succeeded",
          amount,
          currency: "sar",
          payment_intent: paymentIntentId,
          charge: `ch_${paymentIntentId}`,
          metadata: { orderServiceRefundId: `osr_${paymentIntentId}` },
        });
      }
    }
    async function receiptSettlement(paymentIntentId: string) {
      const [row] = await fixture.db
        .select({
          status: schema.paymentReceipts.settlementStatus,
          error: schema.paymentReceipts.settlementError,
        })
        .from(schema.paymentReceipts)
        .where(eq(schema.paymentReceipts.paymentIntentId, paymentIntentId));
      return row;
    }
    // The provider's charge aggregate for one intent.
    const chargeRefunded = (
      paymentIntentId: string,
      amount: number,
      refunded: number
    ) =>
      fixture.db.transaction(tx =>
        processStripeEvent(
          tx as never,
          {
            id: `evt_x7_${++sequence}`,
            type: "charge.refunded",
            data: {
              object: {
                id: `ch_${paymentIntentId}`,
                object: "charge",
                payment_intent: paymentIntentId,
                amount,
                amount_refunded: refunded,
                currency: "sar",
              },
            },
          } as never
        )
      );
    const refusedBy = (refused: string) => {
      const send = provider.create.getMockImplementation();
      provider.create.mockImplementation(async (request: any, options: any) => {
        if (request.payment_intent !== refused) return send(request, options);
        const refund = {
          id: `re_x7_refused_${refused}`,
          object: "refund",
          status: "failed",
          amount: request.amount,
          currency: "sar",
          payment_intent: request.payment_intent,
          charge: `ch_${request.payment_intent}`,
          metadata: request.metadata,
        };
        provider.refunds.push(refund);
        return refund;
      });
    };

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
      provider.failing = new Set();
      provider.status = "succeeded";
      provider.email = vi.fn(async () => true);
      provider.create = vi.fn(
        async (request: any, options?: { idempotencyKey?: string }) => {
          if (provider.failing.has(request.payment_intent)) throw outage();
          const replay = provider.refunds.find(
            refund => refund.idempotencyKey === options?.idempotencyKey
          );
          if (replay) return replay;
          const refund = {
            id: `re_${request.payment_intent}_${provider.refunds.length + 1}`,
            object: "refund",
            status: provider.status,
            amount: request.amount,
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
        openId: "native-x7-operator",
        tenantId: 3,
        role: "ops",
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
          targetId: 501,
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

    describe("full-tier cancellation", () => {
      it("fix: refunds both intents, each up to what it holds, and cancels once", async () => {
        const result = await fullTierCancellation();
        expect(result).toMatchObject({
          success: true,
          amount: 26000,
          status: "succeeded",
          cumulativeRefundedAmount: 26000,
          remainingRefundableAmount: 0,
        });
        expect(
          provider.create.mock.calls.map(([request, options]: [any, any]) => [
            request.payment_intent,
            request.amount,
            options.idempotencyKey,
          ])
        ).toEqual([
          [upgrade, 6000, `booking-71-cancel-${original}:${upgrade}`],
          [original, 20000, `booking-71-cancel-${original}:${original}`],
        ]);
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.amount, p.status])
        ).toEqual([
          [upgrade, 6000, "succeeded"],
          [original, 20000, "succeeded"],
        ]);
        expect(await command()).toMatchObject({
          amount: 26000,
          status: "succeeded",
          refundId: null,
        });
        expect((await command()).completedAt).not.toBeNull();
        expect(await receipts()).toEqual({
          [original]: 20000,
          [upgrade]: 6000,
        });
        expect(await refundLedger()).toEqual([
          { type: "refund", amount: "60.00", paymentIntentId: upgrade },
          { type: "refund", amount: "200.00", paymentIntentId: original },
        ]);
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "refunded",
        });
        expect(await coupons()).toEqual(["R", "R"]);
        expect(await cancellations()).toHaveLength(1);
        const events = await completedEvents();
        expect(events).toHaveLength(1);
        expect(events[0].payload).toMatchObject({
          amount: 26000,
          refundId: provider.refunds[1].id,
        });
        expect(await getRefundStats()).toMatchObject({
          totalRefundedAmount: 26000,
          pendingRefunds: 0,
          pendingRefundAmount: 0,
          reviewRequiredRefunds: 0,
        });
        expect(
          await readFinding("ordinary_refund_completion_mismatch")
        ).toEqual([]);
        expect(await readFinding("ordinary_refund_under_review")).toEqual([]);
      }, 60000);

      it("fix: an earlier upgrade already refunded by a downgrade adds no part", async () => {
        const earlier = "pi_x7_upgrade_earlier";
        await fixture.db.insert(schema.paymentReceipts).values({
          paymentIntentId: earlier,
          bookingId: 71,
          targetId: 500,
          userId: 9,
          kind: "modification",
          amount: 3000,
          refundedAmount: 3000,
          currency: "SAR",
          settlementStatus: "applied",
          createdAt: new Date("2030-05-03T00:00:00Z"),
        });
        provider.refunds.push({
          id: "re_x7_downgrade",
          object: "refund",
          status: "succeeded",
          amount: 3000,
          currency: "sar",
          payment_intent: earlier,
          charge: `ch_${earlier}`,
          metadata: {},
        });
        await fullTierCancellation();
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.amount, p.sequence])
        ).toEqual([
          [upgrade, 6000, 1],
          [original, 20000, 2],
        ]);
        expect(sentTo(earlier)).toHaveLength(0);
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "refunded",
        });
      }, 60000);

      it("fix: the completion event is accepted by the inbox once", async () => {
        await fullTierCancellation();
        const [event] = await completedEvents();
        const inbox = {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          tenantId: event.tenantId,
          payload: event.payload,
        };
        await consumeLocalEvent(inbox as never);
        const notices = (
          await fixture.db.select().from(schema.notifications)
        ).filter(n => n.title === "Refund Processed");
        expect(notices.map(n => n.message)).toEqual([
          "Refund of 260.00 SAR processed for NM0071",
        ]);
        expect(provider.email).toHaveBeenCalledTimes(1);
        expect(provider.email.mock.calls[0][0]).toMatchObject({
          refundAmount: 26000,
          idempotencyKey: `ordinary-refund:${provider.refunds[1].id}`,
        });
        await consumeLocalEvent(inbox as never);
        expect(
          (await fixture.db.select().from(schema.notifications)).filter(
            n => n.title === "Refund Processed"
          )
        ).toHaveLength(1);
      }, 60000);

      it("fix: the completion mismatch audit checks every part's receipt", async () => {
        await fullTierCancellation();
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: 5999 })
          .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
        expect(
          await readFinding("ordinary_refund_completion_mismatch")
        ).toEqual([{ recordId: 71 }]);
      }, 60000);
    });

    describe("partial cancellation", () => {
      it("fix: a refund smaller than the upgrade draws on the upgrade intent alone", async () => {
        const result = await createRefund(
          { bookingId: 71, userId: 9, amount: 5000 },
          admin
        );
        expect(result).toMatchObject({ amount: 5000, status: "succeeded" });
        expect(
          provider.create.mock.calls.map(([r]: [any]) => [
            r.payment_intent,
            r.amount,
          ])
        ).toEqual([[upgrade, 5000]]);
        expect((await parts()).map(p => [p.paymentIntentId, p.amount])).toEqual(
          [[upgrade, 5000]]
        );
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 5000 });
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "paid",
        });
        expect(await coupons()).toEqual(["V", "V"]);
        expect(await cancellations()).toHaveLength(1);
        expect(await refundLedger()).toEqual([
          { type: "partial_refund", amount: "50.00", paymentIntentId: upgrade },
        ]);
      }, 60000);

      it("fix: a refund larger than the upgrade takes the upgrade first, then the original", async () => {
        await createRefund({ bookingId: 71, userId: 9, amount: 8000 }, admin);
        expect(
          provider.create.mock.calls.map(([r]: [any]) => [
            r.payment_intent,
            r.amount,
          ])
        ).toEqual([
          [upgrade, 6000],
          [original, 2000],
        ]);
        expect(await receipts()).toEqual({ [original]: 2000, [upgrade]: 6000 });
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "paid",
        });
      }, 60000);

      it("fix: the admin override is capped by what the two intents still hold", async () => {
        // An earlier provider refund of 1000 on the upgrade intent.
        provider.refunds.push({
          id: "re_x7_earlier",
          object: "refund",
          status: "succeeded",
          amount: 1000,
          currency: "sar",
          payment_intent: upgrade,
          charge: `ch_${upgrade}`,
          metadata: {},
        });
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: 1000 })
          .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 26000 }, admin)
        ).rejects.toThrow(
          "Refund amount exceeds the remaining refundable balance of 25000 cents"
        );
        await createRefund({ bookingId: 71, userId: 9, amount: 25000 }, admin);
        expect(
          (await parts()).map(p => [
            p.paymentIntentId,
            p.amount,
            p.baseRefundedAmount,
          ])
        ).toEqual([
          [upgrade, 5000, 1000],
          [original, 20000, 0],
        ]);
        expect(await receipts()).toEqual({
          [original]: 20000,
          [upgrade]: 6000,
        });
      }, 60000);

      it("control: the admin override stays capped by the booking total", async () => {
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 26001 }, admin)
        ).rejects.toThrow(
          "Refund amount must be positive integer cents within the booking total"
        );
        expect(provider.create).not.toHaveBeenCalled();
        expect(await booking()).toMatchObject({ status: "confirmed" });
      }, 60000);
    });

    describe("replay", () => {
      it("fix: replaying the request, the worker and the webhooks refunds nothing twice", async () => {
        await fullTierCancellation();
        const ledger = await refundLedger();
        await createRefund({ bookingId: 71, userId: 9 }, customer);
        later(5);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 0,
          failed: 0,
        });
        for (const refund of provider.refunds) {
          await deliverRefund(refund);
          await deliverRefund(refund);
        }
        expect(provider.create).toHaveBeenCalledTimes(2);
        expect(await refundLedger()).toEqual(ledger);
        expect(await receipts()).toEqual({
          [original]: 20000,
          [upgrade]: 6000,
        });
        expect(await cancellations()).toHaveLength(1);
        expect(await completedEvents()).toHaveLength(1);
      }, 60000);

      it("fix: a webhook for the second intent is attributed to its part", async () => {
        provider.status = "pending";
        const result = await fullTierCancellation();
        expect(result).toMatchObject({ status: "pending" });
        expect((await parts()).map(p => p.status)).toEqual([
          "pending",
          "pending",
        ]);
        expect(await command()).toMatchObject({ status: "pending" });
        const [upgradeRefund, originalRefund] = provider.refunds;
        await deliverRefund({ ...upgradeRefund, status: "succeeded" });
        expect((await parts()).map(p => [p.status, p.refundId])).toEqual([
          ["succeeded", upgradeRefund.id],
          ["pending", originalRefund.id],
        ]);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
        // The cancellation completes only when every part has succeeded.
        expect(await booking()).toMatchObject({ status: "confirmed" });
        expect(await command()).toMatchObject({ completedAt: null });
        await deliverRefund({ ...originalRefund, status: "succeeded" });
        expect(await receipts()).toEqual({
          [original]: 20000,
          [upgrade]: 6000,
        });
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "refunded",
        });
        expect(await command()).toMatchObject({ status: "succeeded" });
        expect(await cancellations()).toHaveLength(1);
        // A charge.refunded aggregate for the second intent adds nothing.
        await fixture.db.transaction(tx =>
          processStripeEvent(
            tx as never,
            {
              id: "evt_x7_charge_upgrade",
              type: "charge.refunded",
              data: {
                object: {
                  id: `ch_${upgrade}`,
                  object: "charge",
                  payment_intent: upgrade,
                  amount: 6000,
                  amount_refunded: 6000,
                  currency: "sar",
                },
              },
            } as never
          )
        );
        expect(await refundLedger()).toHaveLength(2);
        expect(provider.create).toHaveBeenCalledTimes(2);
      }, 60000);
    });

    describe("one part failing at the provider", () => {
      it("fix: the operation stays retryable and the retry sends only the failed part", async () => {
        provider.failing.add(original);
        await expect(fullTierCancellation()).rejects.toThrow();
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.status, p.errorCode])
        ).toEqual([
          [upgrade, "succeeded", null],
          [original, "requesting", "provider_unavailable"],
        ]);
        expect(await command()).toMatchObject({
          status: "requesting",
          errorCode: "provider_unavailable",
          completedAt: null,
        });
        expect(await booking()).toMatchObject({ status: "confirmed" });
        provider.failing.clear();
        later(2);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        expect(sentTo(upgrade)).toHaveLength(1);
        expect(sentTo(original)).toHaveLength(2);
        expect(sentTo(original)[1][1]).toEqual({
          idempotencyKey: `booking-71-cancel-${original}:${original}`,
        });
        expect(await receipts()).toEqual({
          [original]: 20000,
          [upgrade]: 6000,
        });
        expect(await booking()).toMatchObject({ status: "cancelled" });
        expect(await cancellations()).toHaveLength(1);
      }, 60000);

      it("fix: a failed upgrade part keeps the booking until its retry succeeds", async () => {
        provider.failing.add(upgrade);
        await expect(fullTierCancellation()).rejects.toThrow();
        expect((await parts()).map(p => p.status)).toEqual([
          "requesting",
          "succeeded",
        ]);
        // The original receipt is fully refunded, yet the cancellation waits.
        expect(await receipts()).toEqual({ [original]: 20000, [upgrade]: 0 });
        expect(await booking()).toMatchObject({
          status: "confirmed",
          paymentStatus: "paid",
        });
        expect(await getRefundStats()).toMatchObject({
          totalRefundedAmount: 20000,
          pendingRefunds: 1,
          pendingRefundAmount: 6000,
        });
        provider.failing.clear();
        // Replaying the request retries only the failed part.
        await createRefund({ bookingId: 71, userId: 9 }, customer);
        expect(sentTo(upgrade)).toHaveLength(2);
        expect(sentTo(original)).toHaveLength(1);
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "refunded",
        });
      }, 60000);
    });

    describe("a part refused by the provider", () => {
      it("fix: fails the command, keeps the booking and leaves departure under reconciliation", async () => {
        provider.create.mockImplementationOnce(async (request: any) => {
          const refund = {
            id: "re_x7_refused",
            object: "refund",
            status: "failed",
            amount: request.amount,
            currency: "sar",
            payment_intent: request.payment_intent,
            charge: `ch_${request.payment_intent}`,
            metadata: request.metadata,
          };
          provider.refunds.push(refund);
          return refund;
        });
        await fullTierCancellation().catch(() => undefined);
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.status, p.errorCode])
        ).toEqual([
          [upgrade, "failed", "provider_refund_failed"],
          [original, "succeeded", null],
        ]);
        const saved = await command();
        expect(saved).toMatchObject({
          status: "failed",
          errorCode: "provider_refund_failed",
          refundId: null,
          completedAt: null,
        });
        expect(await booking()).toMatchObject({ status: "confirmed" });
        const [receipt] = await fixture.db
          .select()
          .from(schema.paymentReceipts)
          .where(eq(schema.paymentReceipts.paymentIntentId, original));
        expect(
          ordinaryRefundRequiresReconciliation(await booking(), saved, receipt)
        ).toBe(true);
        expect(await getRefundStats()).toMatchObject({
          reviewRequiredRefunds: 1,
          reviewRequiredAmount: 6000,
          pendingRefunds: 0,
        });
        // No retry: a refused part is never sent again.
        later(5);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 0,
          failed: 0,
        });
        await expect(
          createRefund({ bookingId: 71, userId: 9 }, customer)
        ).rejects.toThrow("Cancellation refund requires reconciliation");
        expect(provider.create).toHaveBeenCalledTimes(2);
      }, 60000);
    });

    describe("S-08 per part", () => {
      for (const disputed of [upgrade, original])
        it(`fix: a withdrawn dispute on ${disputed} holds every part with no provider call`, async () => {
          await reserveQueued();
          await withdraw(disputed, disputed === upgrade ? 6000 : 20000);
          await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
            scanned: 1,
            failed: 1,
          });
          expect(provider.create).not.toHaveBeenCalled();
          expect(
            (await parts()).map(p => [p.status, p.errorCode, p.requestedAt])
          ).toEqual([
            ["queued", "dispute_funds_withdrawn", null],
            ["queued", "dispute_funds_withdrawn", null],
          ]);
          expect(await command()).toMatchObject({
            status: "queued",
            errorCode: "dispute_funds_withdrawn",
          });
          // A won close releases both parts.
          await close(disputed, disputed === upgrade ? 6000 : 20000, "won");
          later(61);
          await processPendingOrdinaryRefunds();
          expect(sentTo(upgrade)).toHaveLength(1);
          expect(sentTo(original)).toHaveLength(1);
          expect(await booking()).toMatchObject({ status: "cancelled" });
        }, 60000);

      it("fix: a lost dispute on the upgrade settles that part by the chargeback and the original part proceeds", async () => {
        await reserveQueued();
        await withdraw(upgrade, 6000);
        await close(upgrade, 6000, "lost");
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        expect(sentTo(upgrade)).toHaveLength(0);
        expect(sentTo(original)).toHaveLength(1);
        expect(
          (await parts()).map(p => [
            p.paymentIntentId,
            p.status,
            p.errorCode,
            p.refundId,
          ])
        ).toEqual([
          [upgrade, "succeeded", "settled_by_chargeback", null],
          [original, "succeeded", null, provider.refunds[0].id],
        ]);
        expect(await receipts()).toEqual({ [original]: 20000, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([
          { type: "refund", amount: "200.00", paymentIntentId: original },
        ]);
        expect(await booking()).toMatchObject({ status: "cancelled" });
        expect(await cancellations()).toHaveLength(1);
        const [event] = await completedEvents();
        expect(event.payload).toMatchObject({
          amount: 20000,
        });
        expect(
          await readFinding("ordinary_refund_completion_mismatch")
        ).toEqual([]);
      }, 60000);

      it("fix: a lost dispute smaller than the upgrade part sends only the remainder under its own key", async () => {
        await reserveQueued();
        await withdraw(upgrade, 2500);
        await close(upgrade, 2500, "lost");
        later(61);
        await processPendingOrdinaryRefunds();
        expect(
          sentTo(upgrade).map(([r, o]: [any, any]) => [
            r.amount,
            o.idempotencyKey,
            r.metadata.chargebackSettledAmount,
          ])
        ).toEqual([
          [
            3500,
            `booking-71-refund-26000:${upgrade}:chargeback-remainder`,
            "2500",
          ],
        ]);
        expect(sentTo(original).map(([r]: [any]) => r.amount)).toEqual([20000]);
        expect(await receipts()).toEqual({
          [original]: 20000,
          [upgrade]: 3500,
        });
        expect(await booking()).toMatchObject({ status: "cancelled" });
      }, 60000);

      it("fix: a part already sent with an unknown outcome goes to review after a lost dispute and is never re-sent", async () => {
        provider.failing.add(upgrade);
        await reserveQueued();
        await processPendingOrdinaryRefunds();
        expect(sentTo(upgrade)).toHaveLength(1);
        expect((await parts())[0]).toMatchObject({ status: "requesting" });
        provider.failing.clear();
        await withdraw(upgrade, 6000);
        await close(upgrade, 6000, "lost");
        later(61);
        await processPendingOrdinaryRefunds();
        expect(sentTo(upgrade)).toHaveLength(1);
        expect((await parts())[0]).toMatchObject({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
        });
        expect(await command()).toMatchObject({ status: "review_required" });
        expect(await booking()).toMatchObject({ status: "confirmed" });
      }, 60000);
    });

    describe("single-intent bookings", () => {
      it("control: a booking without an upgrade intent refunds the original intent alone", async () => {
        await fixture.db
          .delete(schema.paymentReceipts)
          .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
        await fixture.db
          .update(schema.bookings)
          .set({ totalAmount: 20000 })
          .where(eq(schema.bookings.id, 71));
        const quote = await getCancellationQuote(71);
        await createRefund(
          { bookingId: 71, userId: 9, quoteHash: quote.quoteHash },
          customer
        );
        expect(
          provider.create.mock.calls.map(([r, o]: [any, any]) => [
            r.payment_intent,
            r.amount,
            o.idempotencyKey,
          ])
        ).toEqual([[original, 20000, `booking-71-cancel-${original}`]]);
        expect(await command()).toMatchObject({
          status: "succeeded",
          refundId: provider.refunds[0].id,
          amount: 20000,
        });
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "refunded",
        });
      }, 60000);

      it("control: an upgrade receipt already fully refunded leaves the single-intent path", async () => {
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: 6000 })
          .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
        provider.refunds.push({
          id: "re_x7_downgrade",
          object: "refund",
          status: "succeeded",
          amount: 6000,
          currency: "sar",
          payment_intent: upgrade,
          charge: `ch_${upgrade}`,
          metadata: {},
        });
        await createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin);
        expect(
          provider.create.mock.calls.map(([r]: [any]) => r.payment_intent)
        ).toEqual([original]);
        expect(await command()).toMatchObject({
          paymentIntentId: original,
          amount: 5000,
          refundId: provider.refunds[1].id,
        });
      }, 60000);

      it("control: a withdrawn dispute refuses a new cancellation before any provider call", async () => {
        await withdraw(upgrade, 6000);
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
        ).rejects.toThrow("has withdrawn this booking's funds");
        expect(provider.create).not.toHaveBeenCalled();
      }, 60000);
    });

    // Fix round 1. The downgrade cases fail on 589fce4: it took the
    // multi-intent path only while the invoice exceeded what the original
    // intent collected. The other cases pin checks that no earlier case
    // exercised; each fails when its check is weakened.
    describe("upgrade then downgrade", () => {
      for (const [label, total, onOriginal, onUpgrade] of [
        // 26000 -> 20000: the downgrade refund of 6000 split 4615 / 1385.
        ["equal to", 20000, 4615, 1385],
        // 26000 -> 15000: the downgrade refund of 11000 split 8462 / 2538.
        ["below", 15000, 8462, 2538],
      ] as const)
        it(`fix: a downgrade ${label} the original collection still refunds both intents, each up to what it holds`, async () => {
          await downgradeTo(total, onOriginal, onUpgrade);
          const quote = await getCancellationQuote(71);
          expect(quote.refundAmount).toBe(total);
          const result = await createRefund(
            { bookingId: 71, userId: 9, quoteHash: quote.quoteHash },
            customer
          );
          expect(result).toMatchObject({
            success: true,
            amount: total,
            status: "succeeded",
            remainingRefundableAmount: 0,
          });
          expect(
            provider.create.mock.calls.map(([r, o]: [any, any]) => [
              r.payment_intent,
              r.amount,
              o.idempotencyKey,
            ])
          ).toEqual([
            [
              upgrade,
              6000 - onUpgrade,
              `booking-71-cancel-${original}:${upgrade}`,
            ],
            [
              original,
              20000 - onOriginal,
              `booking-71-cancel-${original}:${original}`,
            ],
          ]);
          expect(
            (await parts()).map(p => [
              p.paymentIntentId,
              p.amount,
              p.baseRefundedAmount,
              p.status,
            ])
          ).toEqual([
            [upgrade, 6000 - onUpgrade, onUpgrade, "succeeded"],
            [original, 20000 - onOriginal, onOriginal, "succeeded"],
          ]);
          expect(await receipts()).toEqual({
            [original]: 20000,
            [upgrade]: 6000,
          });
          expect(await booking()).toMatchObject({
            status: "cancelled",
            paymentStatus: "refunded",
          });
          expect(await coupons()).toEqual(["R", "R"]);
          expect(await cancellations()).toHaveLength(1);
          const events = await completedEvents();
          expect(events.map(e => (e.payload as any).amount)).toEqual([total]);
          expect(
            await readFinding("ordinary_refund_completion_mismatch")
          ).toEqual([]);
        }, 60000);

      it("fix: after a downgrade the admin override stays within the booking total, upgrade intent first", async () => {
        await downgradeTo(15000, 8462, 2538);
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 15001 }, admin)
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("within the booking total"),
        });
        expect(provider.create).not.toHaveBeenCalled();
        // 12000 exceeds the 11538 the original intent still holds.
        await createRefund({ bookingId: 71, userId: 9, amount: 12000 }, admin);
        expect(
          provider.create.mock.calls.map(([r]: [any]) => [
            r.payment_intent,
            r.amount,
          ])
        ).toEqual([
          [upgrade, 3462],
          [original, 8538],
        ]);
        expect(await receipts()).toEqual({
          [original]: 17000,
          [upgrade]: 6000,
        });
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "paid",
        });
      }, 60000);

      // Fix round 2 (D2): this case pinned the refund on the original intent
      // alone, which drained it and marked the booking refunded while the
      // upgrade intent still held 3462. It fails on 9417cd7.
      it("fix: after a downgrade a refund the original intent could cover still draws the upgrade intent first and keeps the booking paid", async () => {
        await downgradeTo(15000, 8462, 2538);
        await createRefund({ bookingId: 71, userId: 9, amount: 11538 }, admin);
        expect(
          provider.create.mock.calls.map(([r, o]: [any, any]) => [
            r.payment_intent,
            r.amount,
            o.idempotencyKey,
          ])
        ).toEqual([
          [upgrade, 3462, `booking-71-refund-11538:${upgrade}`],
          [original, 8076, `booking-71-refund-11538:${original}`],
        ]);
        expect(await command()).toMatchObject({
          paymentIntentId: original,
          amount: 11538,
          status: "succeeded",
          refundId: null,
        });
        expect(await receipts()).toEqual({
          [original]: 16538,
          [upgrade]: 6000,
        });
        // The original intent still holds 3462: not every collection is
        // fully refunded, so the booking stays paid and its coupons void.
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "paid",
        });
        expect(await coupons()).toEqual(["V", "V"]);
      }, 60000);

      it("fix: a partial cancellation keeps the booking paid while the upgrade intent still holds money", async () => {
        // The downgrade refunded the whole original intent.
        await downgradeTo(6000, 20000, 0);
        await createRefund({ bookingId: 71, userId: 9, amount: 1500 }, admin);
        expect((await parts()).map(p => [p.paymentIntentId, p.amount])).toEqual(
          [[upgrade, 1500]]
        );
        expect(await receipts()).toEqual({
          [original]: 20000,
          [upgrade]: 1500,
        });
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "paid",
        });
        expect(await coupons()).toEqual(["V", "V"]);
      }, 60000);
    });

    describe("reserve checks", () => {
      it("fix: a pending refund on the upgrade intent blocks a new cancellation", async () => {
        provider.refunds.push({
          id: "re_x7_pending_upgrade",
          object: "refund",
          status: "pending",
          amount: 100,
          currency: "sar",
          payment_intent: upgrade,
          charge: `ch_${upgrade}`,
          metadata: {},
        });
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
        ).rejects.toThrow("earlier pending refund");
        expect(provider.create).not.toHaveBeenCalled();
        expect(await command()).toBeUndefined();
      }, 60000);

      it("fix: a cancellation refused for a withdrawn dispute is not saved and does not run after the dispute closes", async () => {
        await withdraw(upgrade, 6000);
        await expect(fullTierCancellation()).rejects.toThrow(
          "has withdrawn this booking's funds"
        );
        expect(await command()).toBeUndefined();
        expect(await parts()).toEqual([]);
        await close(upgrade, 6000, "won");
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 0,
          failed: 0,
        });
        expect(provider.create).not.toHaveBeenCalled();
        expect(await booking()).toMatchObject({ status: "confirmed" });
      }, 60000);

      it("fix: a receipt recording more refunded than the provider history refuses the cancellation", async () => {
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: 1000 })
          .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
        await expect(fullTierCancellation()).rejects.toThrow(
          "Refund does not match the booking's collected balance"
        );
        expect(provider.create).not.toHaveBeenCalled();
        expect(await command()).toBeUndefined();
      }, 60000);

      it("fix: a base for an intent that is not an applied upgrade of the booking refuses the reserve", async () => {
        await expect(
          reserveWith({
            upgradeBases: new Map([
              [upgrade, 0],
              ["pi_x7_unknown", 0],
            ]),
          })
        ).rejects.toThrow(
          "Refund does not match the booking's collected balance"
        );
        expect(await command()).toBeUndefined();
      }, 60000);

      it("fix: the reserve re-checks the cancellation quote under the booking lock", async () => {
        const quote = await getCancellationQuote(71);
        await expect(
          reserveWith({ policyQuoteHash: quote.quoteHash }, 25000)
        ).rejects.toThrow("Cancellation quote changed");
        await expect(
          reserveWith({ policyQuoteHash: "stale-quote" })
        ).rejects.toThrow("Cancellation quote changed");
        expect(await command()).toBeUndefined();
        await reserveWith({ policyQuoteHash: quote.quoteHash });
        expect(await command()).toMatchObject({ amount: 26000 });
      }, 60000);

      for (const [status, paymentStatus] of [
        ["cancelled", "paid"],
        ["confirmed", "refunded"],
      ] as const)
        it(`fix: the reserve refuses a booking ${status} and ${paymentStatus}`, async () => {
          await fixture.db
            .update(schema.bookings)
            .set({ status, paymentStatus })
            .where(eq(schema.bookings.id, 71));
          await expect(reserveWith({})).rejects.toThrow(
            "Only a confirmed paid booking can start a cancellation refund"
          );
          expect(await command()).toBeUndefined();
        }, 60000);

      it("fix: a saved multi-intent cancellation refuses a different amount and sends nothing", async () => {
        provider.failing.add(upgrade);
        await expect(fullTierCancellation()).rejects.toThrow();
        expect(provider.create).toHaveBeenCalledTimes(2);
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message:
            "An existing cancellation must be reconciled before changing its amount",
        });
        expect(provider.create).toHaveBeenCalledTimes(2);
      }, 60000);

      it("fix: a modification receipt that is not applied is not drawn on", async () => {
        const unapplied = "pi_x7_upgrade_unapplied";
        await fixture.db.insert(schema.paymentReceipts).values({
          paymentIntentId: unapplied,
          bookingId: 71,
          targetId: 502,
          userId: 9,
          kind: "modification",
          amount: 3000,
          refundedAmount: 0,
          currency: "SAR",
          settlementStatus: "review_refunded",
          createdAt: new Date("2030-05-06T00:00:00Z"),
        });
        await createRefund({ bookingId: 71, userId: 9, amount: 7000 }, admin);
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.amount, p.status])
        ).toEqual([
          [upgrade, 6000, "succeeded"],
          [original, 1000, "succeeded"],
        ]);
        expect(sentTo(unapplied)).toHaveLength(0);
      }, 60000);
    });

    describe("provider outcomes per part", () => {
      it("fix: a part refund of another amount goes to review and flags that intent's receipt", async () => {
        provider.status = "pending";
        await fullTierCancellation();
        const [up] = provider.refunds;
        await deliverRefund({ ...up, status: "succeeded", amount: 5000 });
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.status, p.errorCode])
        ).toEqual([
          [upgrade, "review_required", "provider_refund_conflict"],
          [original, "pending", null],
        ]);
        expect(await command()).toMatchObject({
          status: "review_required",
          errorCode: "provider_refund_conflict",
        });
        expect(await receiptSettlement(upgrade)).toEqual({
          status: "review_required",
          error:
            "Cancellation refund requires review: provider_refund_conflict",
        });
        expect(await receiptSettlement(original)).toEqual({
          status: "applied",
          error: null,
        });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
        expect(await booking()).toMatchObject({ status: "confirmed" });
      }, 60000);

      it("fix: a stale webhook does not reopen a part that succeeded", async () => {
        provider.status = "pending";
        await fullTierCancellation();
        const [up, orig] = provider.refunds;
        await deliverRefund({ ...orig, status: "succeeded" });
        await deliverRefund({ ...orig, status: "pending" });
        expect((await parts()).map(p => [p.paymentIntentId, p.status])).toEqual(
          [
            [upgrade, "pending"],
            [original, "succeeded"],
          ]
        );
        await deliverRefund({ ...up, status: "succeeded" });
        await deliverRefund({ ...up, status: "pending" });
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "refunded",
        });
        expect(await cancellations()).toHaveLength(1);
        expect(await completedEvents()).toHaveLength(1);
        expect(await refundLedger()).toHaveLength(2);
      }, 60000);

      it("fix: a part with no provider record 23 hours after its request goes to review and is never re-sent", async () => {
        provider.failing.add(upgrade);
        await reserveQueued();
        await processPendingOrdinaryRefunds();
        expect(sentTo(upgrade)).toHaveLength(1);
        provider.failing.clear();
        later(23 * 60 + 1);
        await processPendingOrdinaryRefunds();
        expect(sentTo(upgrade)).toHaveLength(1);
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.status, p.errorCode])
        ).toEqual([
          [upgrade, "review_required", "unknown_provider_outcome"],
          [original, "succeeded", null],
        ]);
        expect(await command()).toMatchObject({ status: "review_required" });
        expect(await booking()).toMatchObject({ status: "confirmed" });
      }, 60000);

      it("fix: when the provider refuses the original part, the upgrade part is still sent and the cancellation needs reconciliation", async () => {
        refusedBy(original);
        // Fix round 2 (B3): the response reports the refused part as failed.
        const result = await fullTierCancellation();
        expect(result).toEqual({
          success: true,
          refundId: `re_x7_refused_${original}`,
          amount: 20000,
          status: "failed",
          cumulativeRefundedAmount: 6000,
          remainingRefundableAmount: 20000,
        });
        expect(sentTo(upgrade)).toHaveLength(1);
        expect(sentTo(original)).toHaveLength(1);
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.status, p.errorCode])
        ).toEqual([
          [upgrade, "succeeded", null],
          [original, "failed", "provider_refund_failed"],
        ]);
        const saved = await command();
        expect(saved).toMatchObject({
          status: "failed",
          errorCode: "provider_refund_failed",
          completedAt: null,
        });
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
        expect(await booking()).toMatchObject({ status: "confirmed" });
        const [receipt] = await fixture.db
          .select()
          .from(schema.paymentReceipts)
          .where(eq(schema.paymentReceipts.paymentIntentId, original));
        expect(
          ordinaryRefundRequiresReconciliation(await booking(), saved, receipt)
        ).toBe(true);
        expect(await getRefundStats()).toMatchObject({
          reviewRequiredRefunds: 1,
          reviewRequiredAmount: 20000,
        });
      }, 60000);

      it("fix: a part reversed after completion is flagged by the completion mismatch audit alone", async () => {
        await fullTierCancellation();
        const [up] = provider.refunds;
        await deliverRefund({ ...up, status: "failed" });
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.status, p.errorCode])
        ).toEqual([
          [upgrade, "review_required", "provider_reversed_refund"],
          [original, "succeeded", null],
        ]);
        expect(await command()).toMatchObject({ status: "succeeded" });
        expect(await booking()).toMatchObject({ status: "cancelled" });
        expect(
          await readFinding("ordinary_refund_completion_mismatch")
        ).toEqual([{ recordId: 71 }]);
        expect(await readFinding("ordinary_refund_under_review")).toEqual([]);
      }, 60000);
    });

    describe("charge aggregates", () => {
      it("fix: a charge.refunded aggregate while the parts are pending is not applied", async () => {
        provider.status = "pending";
        await fullTierCancellation();
        await chargeRefunded(original, 20000, 20000);
        await chargeRefunded(upgrade, 6000, 6000);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
        expect(await booking()).toMatchObject({
          status: "confirmed",
          paymentStatus: "paid",
        });
        expect(await coupons()).toEqual(["O", "O"]);
      }, 60000);

      it("fix: a charge.refunded aggregate after completion adds no event or cancellation", async () => {
        await fullTierCancellation();
        await chargeRefunded(original, 20000, 20000);
        await chargeRefunded(upgrade, 6000, 6000);
        expect(await completedEvents()).toHaveLength(1);
        expect(await cancellations()).toHaveLength(1);
        expect(await refundLedger()).toHaveLength(2);
      }, 60000);
    });

    describe("S-08 lost disputes on the original intent", () => {
      it("fix: a lost dispute on the original settles that part by the chargeback after the upgrade part succeeded", async () => {
        await reserveQueued();
        await withdraw(original, 20000);
        await close(original, 20000, "lost");
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        expect(sentTo(original)).toHaveLength(0);
        expect(sentTo(upgrade)).toHaveLength(1);
        expect(
          (await parts()).map(p => [
            p.paymentIntentId,
            p.amount,
            p.status,
            p.errorCode,
          ])
        ).toEqual([
          [upgrade, 6000, "succeeded", null],
          [original, 20000, "succeeded", "settled_by_chargeback"],
        ]);
        expect(await command()).toMatchObject({ status: "succeeded" });
        expect(await booking()).toMatchObject({ status: "cancelled" });
        expect(await cancellations()).toHaveLength(1);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 6000 });
        expect(
          (await completedEvents()).map(e => (e.payload as any).amount)
        ).toEqual([6000]);
        expect(
          await readFinding("ordinary_refund_completion_mismatch")
        ).toEqual([]);
      }, 60000);

      it("fix: lost disputes on both intents settle every part with no provider call", async () => {
        await reserveQueued();
        await withdraw(original, 20000);
        await close(original, 20000, "lost");
        await withdraw(upgrade, 6000);
        await close(upgrade, 6000, "lost");
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        expect(provider.create).not.toHaveBeenCalled();
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.status, p.errorCode])
        ).toEqual([
          [upgrade, "succeeded", "settled_by_chargeback"],
          [original, "succeeded", "settled_by_chargeback"],
        ]);
        expect(await command()).toMatchObject({ status: "succeeded" });
        expect(await booking()).toMatchObject({ status: "cancelled" });
        expect(await cancellations()).toHaveLength(1);
        expect(await completedEvents()).toHaveLength(0);
      }, 60000);
    });

    describe("inbox", () => {
      it("fix: a completion event whose amount differs from the parts sent is refused", async () => {
        await fullTierCancellation();
        const [event] = await completedEvents();
        const inbox = {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          tenantId: event.tenantId,
          payload: event.payload,
        };
        await consumeLocalEvent({
          ...inbox,
          eventId: randomUUID(),
          payload: { ...(event.payload as object), amount: 25999 },
        } as never).catch(() => undefined);
        const notices = async () =>
          (await fixture.db.select().from(schema.notifications)).filter(
            n => n.title === "Refund Processed"
          );
        expect(await notices()).toEqual([]);
        expect(provider.email).not.toHaveBeenCalled();
        await consumeLocalEvent(inbox as never);
        expect((await notices()).map(n => n.message)).toEqual([
          "Refund of 260.00 SAR processed for NM0071",
        ]);
      }, 60000);
    });

    // Fix round 2. The D2 and B3 cases fail on 9417cd7. The other cases pin
    // checks that no earlier case exercised; each fails when its check is
    // weakened (named in brackets).
    describe("fix round 2: the newest collection first after a downgrade", () => {
      const latest = "pi_x7_latest_upgrade";
      // 30 hours before flight 41 departs (10 June 2030, 12:00 UTC): the
      // fee tier, which refunds half the invoice.
      const feeTier = () => vi.setSystemTime(new Date("2030-06-09T06:00:00Z"));
      // A second upgrade, after the first, collected on its own intent. Its
      // id sorts before the first upgrade's, so only its date puts it first.
      async function addLatestUpgrade(amount: number) {
        await fixture.db.insert(schema.paymentReceipts).values({
          paymentIntentId: latest,
          bookingId: 71,
          targetId: 502,
          userId: 9,
          kind: "modification",
          amount,
          refundedAmount: 0,
          currency: "SAR",
          settlementStatus: "applied",
          createdAt: new Date("2030-05-08T00:00:00Z"),
        });
        await fixture.db
          .update(schema.bookings)
          .set({ totalAmount: 26000 + amount })
          .where(eq(schema.bookings.id, 71));
      }

      it("fix (D2): a fee-tier refund after a downgrade takes what the upgrade intent holds first, then the original", async () => {
        await downgradeTo(15000, 8462, 2538);
        feeTier();
        const quote = await getCancellationQuote(71);
        expect(quote.refundAmount).toBe(7500);
        const result = await createRefund(
          { bookingId: 71, userId: 9, quoteHash: quote.quoteHash },
          customer
        );
        expect(result).toMatchObject({
          success: true,
          amount: 7500,
          status: "succeeded",
        });
        expect(
          provider.create.mock.calls.map(([r, o]: [any, any]) => [
            r.payment_intent,
            r.amount,
            o.idempotencyKey,
          ])
        ).toEqual([
          [upgrade, 3462, `booking-71-cancel-${original}:${upgrade}`],
          [original, 4038, `booking-71-cancel-${original}:${original}`],
        ]);
        expect(
          (await parts()).map(p => [
            p.paymentIntentId,
            p.amount,
            p.baseRefundedAmount,
            p.status,
          ])
        ).toEqual([
          [upgrade, 3462, 2538, "succeeded"],
          [original, 4038, 8462, "succeeded"],
        ]);
        expect(await receipts()).toEqual({
          [original]: 12500,
          [upgrade]: 6000,
        });
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "paid",
        });
        expect(await coupons()).toEqual(["V", "V"]);
        expect(await cancellations()).toHaveLength(1);
        expect(
          (await completedEvents()).map(e => (e.payload as any).amount)
        ).toEqual([7500]);
        expect(
          await readFinding("ordinary_refund_completion_mismatch")
        ).toEqual([]);
      }, 60000);

      it("fix (D2, w10): after two upgrades and a downgrade, a fee-tier refund draws the newest upgrade, then the earlier one, then the original", async () => {
        await addLatestUpgrade(4000);
        // 30000 -> 18000: the downgrade refund of 12000 split 8000 / 2400 / 1600.
        await downgradeTo(18000, 8000, 2400);
        await fixture.db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: 1600 })
          .where(eq(schema.paymentReceipts.paymentIntentId, latest));
        provider.refunds.push({
          id: `re_x7_downgrade_${latest}`,
          object: "refund",
          status: "succeeded",
          amount: 1600,
          currency: "sar",
          payment_intent: latest,
          charge: `ch_${latest}`,
          metadata: { orderServiceRefundId: `osr_${latest}` },
        });
        feeTier();
        const quote = await getCancellationQuote(71);
        expect(quote.refundAmount).toBe(9000);
        await createRefund(
          { bookingId: 71, userId: 9, quoteHash: quote.quoteHash },
          customer
        );
        expect(
          provider.create.mock.calls.map(([r]: [any]) => [
            r.payment_intent,
            r.amount,
          ])
        ).toEqual([
          [latest, 2400],
          [upgrade, 3600],
          [original, 3000],
        ]);
        expect(
          (await parts()).map(p => [p.paymentIntentId, p.sequence, p.status])
        ).toEqual([
          [latest, 1, "succeeded"],
          [upgrade, 2, "succeeded"],
          [original, 3, "succeeded"],
        ]);
        expect(await receipts()).toEqual({
          [original]: 11000,
          [upgrade]: 6000,
          [latest]: 4000,
        });
        expect(await booking()).toMatchObject({
          status: "cancelled",
          paymentStatus: "paid",
        });
      }, 60000);

      it("fix (B3): a refused upgrade part is reported as failed by the response and the router audit, not as a pending refund of the whole invoice", async () => {
        refusedBy(upgrade);
        const quote = await getCancellationQuote(71);
        const context = {
          user: customer,
          tenantId: 3,
          authMethod: "bearer",
          req: { ip: "198.51.100.7", headers: {} },
          res: {},
        } as unknown as TrpcContext;
        const result = await refundsRouter
          .createCaller(context)
          .create({ bookingId: 71, quoteHash: quote.quoteHash });
        // As the single-intent command returns a refused provider refund.
        expect(result).toEqual({
          success: true,
          refundId: `re_x7_refused_${upgrade}`,
          amount: 6000,
          status: "failed",
          cumulativeRefundedAmount: 20000,
          remainingRefundableAmount: 6000,
        });
        // B1 kept: the other part is still sent.
        expect(sentTo(upgrade)).toHaveLength(1);
        expect(sentTo(original)).toHaveLength(1);
        expect(await command()).toMatchObject({
          status: "failed",
          errorCode: "provider_refund_failed",
          completedAt: null,
        });
        expect(await booking()).toMatchObject({
          status: "confirmed",
          paymentStatus: "paid",
        });
        const audits = await fixture.db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.eventType, "REFUND_INITIATED"));
        expect(audits.map(a => JSON.parse(a.newValue as string))).toEqual([
          expect.objectContaining({
            bookingId: 71,
            amount: 6000,
            refundId: `re_x7_refused_${upgrade}`,
          }),
        ]);
      }, 60000);

      it("fix (w09): an admin replay of a legacy refund already made on the original intent adopts it and sends nothing to either intent", async () => {
        provider.refunds.push({
          id: "re_x7_legacy",
          object: "refund",
          status: "succeeded",
          amount: 20000,
          currency: "sar",
          payment_intent: original,
          charge: `ch_${original}`,
          metadata: {
            bookingId: "71",
            refundOperationId: "booking-71-refund-20000",
          },
        });
        const result = await createRefund(
          { bookingId: 71, userId: 9, amount: 20000 },
          admin
        );
        expect(result).toMatchObject({
          refundId: "re_x7_legacy",
          amount: 20000,
          status: "succeeded",
        });
        expect(provider.create).not.toHaveBeenCalled();
        expect(await parts()).toEqual([]);
        expect(await command()).toMatchObject({
          paymentIntentId: original,
          amount: 20000,
          refundId: "re_x7_legacy",
        });
        expect(await receipts()).toEqual({ [original]: 20000, [upgrade]: 0 });
      }, 60000);

      for (const [label, change] of [
        ["another currency (w13)", { currency: "USD" }],
        ["another user's name (w14)", { userId: 20 }],
      ] as const)
        it(`fix: an upgrade receipt in ${label} refuses the cancellation before any provider call`, async () => {
          await fixture.db
            .update(schema.paymentReceipts)
            .set(change)
            .where(eq(schema.paymentReceipts.paymentIntentId, upgrade));
          await expect(fullTierCancellation()).rejects.toThrow(
            "Refund does not match the booking's collected balance"
          );
          expect(provider.create).not.toHaveBeenCalled();
          expect(await command()).toBeUndefined();
        }, 60000);

      it("fix (w12): the reserve refuses a base above what a receipt collected", async () => {
        await expect(
          reserveWith({ baseRefundedAmount: 20001 }, 5000)
        ).rejects.toThrow(
          "Refund does not match the booking's collected balance"
        );
        await expect(
          reserveWith({ upgradeBases: new Map([[upgrade, 6001]]) }, 19999)
        ).rejects.toThrow(
          "Refund does not match the booking's collected balance"
        );
        expect(await command()).toBeUndefined();
        expect(await parts()).toEqual([]);
      }, 60000);

      it("fix (w11): the reserve refuses a cancellation whose every part would fall on the original intent", async () => {
        await expect(
          reserveWith({ upgradeBases: new Map([[upgrade, 6000]]) }, 20000)
        ).rejects.toThrow("Cancellation payment changed; refresh the booking");
        expect(await command()).toBeUndefined();
        expect(await parts()).toEqual([]);
      }, 60000);

      it("fix (w19): a refund carrying a part's operation id under another provider refund id goes to review and settles nothing", async () => {
        provider.status = "pending";
        await fullTierCancellation();
        const [up, orig] = provider.refunds;
        await deliverRefund({ ...up, id: "re_x7_other", status: "succeeded" });
        expect(
          (await parts()).map(p => [
            p.paymentIntentId,
            p.status,
            p.errorCode,
            p.refundId,
          ])
        ).toEqual([
          [upgrade, "review_required", "provider_refund_conflict", up.id],
          [original, "pending", null, orig.id],
        ]);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
      }, 60000);

      it("fix (w21): a charge aggregate does not settle a part the lost dispute closed while another part is open", async () => {
        provider.status = "pending";
        await reserveQueued();
        await withdraw(upgrade, 6000);
        await close(upgrade, 6000, "lost");
        later(61);
        await processPendingOrdinaryRefunds();
        expect(
          (await parts()).map(p => [
            p.paymentIntentId,
            p.status,
            p.errorCode,
            p.refundId,
          ])
        ).toEqual([
          [upgrade, "succeeded", "settled_by_chargeback", null],
          [original, "pending", null, provider.refunds[0].id],
        ]);
        // No provider refund of ours settled the upgrade part.
        await chargeRefunded(upgrade, 6000, 6000);
        expect(await receipts()).toEqual({ [original]: 0, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([]);
        expect(await booking()).toMatchObject({ status: "confirmed" });
      }, 60000);

      it("fix (w22): while the cancellation is open, the settlement gate refuses a part's own refund with another cumulative amount", async () => {
        provider.status = "pending";
        await createRefund({ bookingId: 71, userId: 9, amount: 8000 }, admin);
        const [, orig] = provider.refunds;
        await deliverRefund({ ...orig, status: "succeeded" });
        expect(await receipts()).toEqual({ [original]: 2000, [upgrade]: 0 });
        await fixture.db.transaction(tx =>
          settleVerifiedRefund(tx as never, {
            paymentIntentId: original,
            chargeId: `ch_${original}`,
            amount: 20000,
            amountRefunded: 5000,
            currency: "sar",
            eventId: "evt_x7_gate",
            refundId: orig.id,
          })
        );
        expect(await receipts()).toEqual({ [original]: 2000, [upgrade]: 0 });
        expect(await refundLedger()).toEqual([
          {
            type: "partial_refund",
            amount: "20.00",
            paymentIntentId: original,
          },
        ]);
        expect(await booking()).toMatchObject({ status: "confirmed" });
      }, 60000);
    });
  }
);
