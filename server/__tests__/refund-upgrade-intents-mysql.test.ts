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
  }
);
