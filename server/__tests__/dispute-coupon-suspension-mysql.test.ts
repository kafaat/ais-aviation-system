import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
 * S-08, owner decision 6 option B (issue #327). A dispute whose funds are
 * withdrawn suspends the booking's issued open coupons; a lost close voids
 * them; a won close or reinstated funds restore the prior status. These cases
 * drive the verified Stripe event path, refunds, cancellation, IROPS
 * execution, exchange quotes, check-in and boarding on migrated native MySQL
 * tables. Provider responses and recovery feasibility evidence are synthetic.
 *
 * "fix:" cases fail on the code before S-08. "control:" cases pass on both
 * and show that the refusal or transition is caused by the dispute. Refund
 * commands saved before the dispute, flight-cancellation and settlement-review
 * refunds, and disputes on a duplicate collection held for review are covered
 * after the first review of S-08.
 */
const provider = vi.hoisted(() => ({
  db: null as any,
  refund: null as any,
  create: null as any,
  checkout: null as any,
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
    checkout: {
      sessions: {
        create: (...args: unknown[]) => provider.checkout(...args),
      },
    },
  },
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
// Operational tail/crew evidence has its own acceptance; IROPS here is about
// which bookings the approved plan may move.
vi.mock("../services/recovery-feasibility.service", () => ({
  readRecoveryFeasibility: async (_tx: unknown, flight: { id: number }) => ({
    flightId: flight.id,
    synthetic: "native-s08-feasibility",
  }),
}));
import { processStripeEvent } from "../webhooks/stripe";
import {
  createRefund,
  getCancellationQuote,
} from "../services/refunds.service";
import {
  getSplitRefundCancellation,
  processPendingSplitRefunds,
  reserveSplitRefundCancellation,
} from "../services/split-refund.service";
import { cancelBookingWithoutRefund } from "../services/zero-refund-cancellation.service";
import {
  approveRecovery,
  executeRecovery,
  proposeRecovery,
} from "../services/irops-recovery.service";
import {
  quotePaidOrderService,
  servicingQuoteVersion,
} from "../services/order-servicing.service";
import { exchangeLocalCoupons } from "../services/ticket-coupons.service";
import { checkInPassengers } from "../services/departure-control.service";
import { transitionDcsPassenger } from "../services/dcs-operations.service";
import {
  issueBoardingPass,
  verifyActiveBoardingPass,
} from "../services/boarding-pass.service";
import { undoCheckIn } from "../services/seat-map.service";
import { readTicketDocument } from "../services/ticket-documents.service";
import {
  processOrdinaryRefundCancellation,
  processPendingOrdinaryRefunds,
  reserveOrdinaryRefundCancellation,
} from "../services/ordinary-refund.service";
import { processPendingOrderRefunds } from "../services/order-refunds.service";
import { getRefundStats } from "../services/refunds-stats.service";
import {
  processFlightCancellations,
  requestFlightCancellation,
} from "../services/flight-cancellation.service";
import { requestSettlementReviewRefund } from "../services/settlement-review.service";
import { createOrderServiceCheckout } from "../services/order-service-checkout.service";
import { calculateRequestHash } from "../services/idempotency-v2.service";
import { withdrawnDisputeIds } from "../services/payment-dispute.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

// Six hours before flight 41: check-in and boarding are open.
const now = new Date("2030-06-10T06:00:00Z");
const intent = "pi_native_s08";
const key = { bookingId: 71, passengerId: 81, flightId: 41 };
const owner = { userId: 9, tenantId: 3, role: "user" };
const operator = { userId: 20, tenantId: 3, role: "ops" };
const customer = { id: 9, role: "user", tenantId: 3 };
const ticket = (passengerId: number) => `06500000000${passengerId}`;
const suspendedMessage = /suspended while payment dispute dp_native_s08/;
const refused = {
  code: "PRECONDITION_FAILED",
  message: expect.stringMatching(
    /Payment dispute dp_native_s08 has withdrawn this booking's funds/
  ),
};
const admin = { id: 20, role: "admin" };
const later = (minutes: number) =>
  vi.setSystemTime(new Date(now.getTime() + minutes * 60_000));
// A second collection for the same booking, held for review as a duplicate.
const duplicate = {
  id: "dp_native_s08_dup",
  payment_intent: "pi_native_s08_dup",
  charge: "ch_native_s08_dup",
};

nativeDescribe.sequential(
  "S-08 dispute coupon suspension on native MySQL",
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

    async function coupons(bookingId = 71) {
      return fixture.db
        .select({
          passengerId: schema.ticketCoupons.passengerId,
          flightId: schema.ticketCoupons.flightId,
          couponNumber: schema.ticketCoupons.couponNumber,
          status: schema.ticketCoupons.status,
          suspendedFromStatus: schema.ticketCoupons.suspendedFromStatus,
        })
        .from(schema.ticketCoupons)
        .where(eq(schema.ticketCoupons.bookingId, bookingId))
        .orderBy(schema.ticketCoupons.id);
    }
    async function commercialState() {
      return {
        bookings: await fixture.db.select().from(schema.bookings),
        flights: await fixture.db.select().from(schema.flights),
        receipts: await fixture.db.select().from(schema.paymentReceipts),
        payments: await fixture.db.select().from(schema.payments),
        seats: await fixture.db.select().from(schema.seatInventory),
        segments: await fixture.db.select().from(schema.bookingSegments),
      };
    }
    async function disputedEvents() {
      return fixture.db
        .select({ payload: schema.outbox.payload })
        .from(schema.outbox)
        .where(eq(schema.outbox.eventType, "payment.disputed"))
        .orderBy(schema.outbox.id);
    }
    const command = () => ({
      idempotencyKey: `native-s08-${++sequence}`,
      reason: "Native S-08 departure command",
    });
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
    const adminRequest = (amount: number) => ({
      payment_intent: intent,
      amount,
      reason: "requested_by_customer" as const,
      metadata: {
        bookingId: "71",
        refundOperationId: `booking-71-refund-${amount}`,
      },
    });
    // A cancellation refund saved, queued, before any dispute.
    async function reserveQueued(amount: number) {
      return reserveOrdinaryRefundCancellation(fixture.db as never, {
        bookingId: 71,
        actor: admin,
        userId: 9,
        tenantId: 3,
        request: adminRequest(amount),
        baseRefundedAmount: 0,
      });
    }
    // Provider refunds with their own ids, retrievable by id.
    function distinctRefunds(status = "pending") {
      provider.create = vi.fn(async (request: any) => {
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
    const payerA = {
      id: "dp_native_s08_a",
      payment_intent: `${intent}_a`,
      amount: 10000,
    };
    async function duplicateCollection() {
      await fixture.db.insert(schema.paymentReceipts).values({
        paymentIntentId: duplicate.payment_intent,
        bookingId: 71,
        targetId: 71,
        userId: 9,
        kind: "booking",
        amount: 20000,
        refundedAmount: 0,
        currency: "SAR",
        settlementStatus: "review_required",
        settlementError: "Booking already funded by another payment",
      });
    }
    async function nonrefundableFare() {
      await fixture.db.insert(schema.fareClasses).values({
        id: 31,
        airlineId: 3,
        code: "N",
        name: "Nonrefundable native fare",
        cabinClass: "economy",
        refundable: false,
        createdAt: new Date("2025-01-01T00:00:00Z"),
        updatedAt: new Date("2025-01-01T00:00:00Z"),
      });
      await fixture.db
        .update(schema.bookings)
        .set({ fareClassId: 31 })
        .where(eq(schema.bookings.id, 71));
      await fixture.db.insert(schema.flightFareClassInventory).values({
        flightId: 41,
        fareClassId: 31,
        capacity: 8,
        availableSeats: 6,
      });
    }

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
      provider.checkout = vi.fn(async () => ({
        id: "cs_native_s08",
        url: "https://checkout.example.test/s08",
      }));
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

    describe("dispute events", () => {
      it("fix: funds_withdrawn suspends only O and C coupons and leaves booking, payment and inventory unchanged", async () => {
        await fixture.db
          .update(schema.ticketCoupons)
          .set({ status: "C" })
          .where(eq(schema.ticketCoupons.passengerId, 82));
        // Every other status on the same booking must stay as it is.
        await fixture.db.insert(schema.ticketCoupons).values(
          (["F", "R", "E", "V", "unverified"] as const).map(
            (status, index) => ({
              bookingId: 71,
              passengerId: 81,
              flightId: 42,
              ticketNumber: ticket(81),
              couponNumber: index + 2,
              status,
            })
          )
        );
        const before = await commercialState();
        await deliver("charge.dispute.created");
        await withdraw();

        expect(await coupons()).toEqual([
          {
            passengerId: 81,
            flightId: 41,
            couponNumber: 1,
            status: "S",
            suspendedFromStatus: "O",
          },
          {
            passengerId: 82,
            flightId: 41,
            couponNumber: 1,
            status: "S",
            suspendedFromStatus: "C",
          },
          ...(["F", "R", "E", "V", "unverified"] as const).map(
            (status, index) => ({
              passengerId: 81,
              flightId: 42,
              couponNumber: index + 2,
              status,
              suspendedFromStatus: null,
            })
          ),
        ]);
        expect(await commercialState()).toEqual(before);
        const events = await disputedEvents();
        expect(events).toHaveLength(2);
        expect(events[0].payload).not.toHaveProperty("localCouponTransitions");
        expect(events[1].payload).toMatchObject({
          amount: -20000,
          disputeId: "dp_native_s08",
          localCouponTransitions: [
            { passengerId: 81, previousStatus: "O", status: "S" },
            { passengerId: 82, previousStatus: "C", status: "S" },
          ],
        });
      });

      it("control: dispute lifecycle events without a funds movement leave coupons open", async () => {
        await deliver("charge.dispute.created");
        await deliver("charge.dispute.updated", { status: "under_review" });
        expect((await coupons()).map(c => c.status)).toEqual(["O", "O"]);
      });

      it("fix: a lost close voids the suspended coupons and nothing else", async () => {
        await fixture.db.insert(schema.ticketCoupons).values({
          bookingId: 71,
          passengerId: 82,
          flightId: 42,
          ticketNumber: ticket(82),
          couponNumber: 2,
          status: "F",
        });
        await withdraw();
        const before = await commercialState();
        await deliver("charge.dispute.closed", { status: "lost" });
        expect(await coupons()).toMatchObject([
          { passengerId: 81, status: "V", suspendedFromStatus: null },
          { passengerId: 82, flightId: 41, status: "V" },
          { passengerId: 82, flightId: 42, status: "F" },
        ]);
        expect(await commercialState()).toEqual(before);
        expect((await disputedEvents())[1].payload).toMatchObject({
          localCouponTransitions: [
            { previousStatus: "S", status: "V" },
            { previousStatus: "S", status: "V" },
          ],
        });
      });

      it.each([
        ["a won close", "charge.dispute.closed", { status: "won" }],
        [
          "reinstated funds",
          "charge.dispute.funds_reinstated",
          { status: "under_review" },
        ],
      ])(
        "fix: %s restores each coupon's prior status",
        async (_name, type, overrides) => {
          await fixture.db
            .update(schema.ticketCoupons)
            .set({ status: "C" })
            .where(eq(schema.ticketCoupons.passengerId, 82));
          await withdraw();
          expect((await coupons()).map(c => c.suspendedFromStatus)).toEqual([
            "O",
            "C",
          ]);
          await deliver(type, overrides);
          expect(await coupons()).toEqual([
            {
              passengerId: 81,
              flightId: 41,
              couponNumber: 1,
              status: "O",
              suspendedFromStatus: null,
            },
            {
              passengerId: 82,
              flightId: 41,
              couponNumber: 1,
              status: "C",
              suspendedFromStatus: null,
            },
          ]);
          expect((await disputedEvents())[1].payload).toMatchObject({
            localCouponTransitions: [
              { previousStatus: "S", status: "O" },
              { previousStatus: "S", status: "C" },
            ],
          });
        }
      );

      it("fix: split payments restore only when no other dispute on the booking still has funds withdrawn", async () => {
        await fixture.db.insert(schema.paymentReceipts).values(
          ["a", "b"].map((payer, index) => ({
            paymentIntentId: `${intent}_${payer}`,
            bookingId: 71,
            targetId: 501 + index,
            userId: 9,
            kind: "split_payment" as const,
            amount: 10000,
            refundedAmount: 0,
            currency: "SAR",
            settlementStatus: "applied" as const,
          }))
        );
        const payer = (name: string) => ({
          id: `dp_native_s08_${name}`,
          payment_intent: `${intent}_${name}`,
          charge: `ch_native_s08_${name}`,
          amount: 10000,
        });
        await withdraw(payer("a"));
        await withdraw(payer("b"));
        expect((await coupons()).map(c => c.status)).toEqual(["S", "S"]);
        await deliver("charge.dispute.funds_reinstated", payer("a"));
        expect((await coupons()).map(c => c.status)).toEqual(["S", "S"]);
        await deliver("charge.dispute.closed", {
          ...payer("b"),
          status: "won",
        });
        expect(await coupons()).toMatchObject([
          { status: "O", suspendedFromStatus: null },
          { status: "O", suspendedFromStatus: null },
        ]);
      });

      it("fix: replayed events are idempotent and a replayed withdrawal never re-suspends restored coupons", async () => {
        const withdrawn = await withdraw();
        await withdraw({}, withdrawn);
        expect((await coupons()).map(c => c.status)).toEqual(["S", "S"]);
        const reinstated = await deliver("charge.dispute.funds_reinstated");
        await withdraw({}, withdrawn);
        await deliver("charge.dispute.funds_reinstated", {}, reinstated);
        expect(await coupons()).toMatchObject([
          { status: "O", suspendedFromStatus: null },
          { status: "O", suspendedFromStatus: null },
        ]);
        const ledger = await fixture.db
          .select()
          .from(schema.financialLedger)
          .where(eq(schema.financialLedger.bookingId, 71));
        expect(ledger.map(row => row.stripeEventId)).toEqual([
          withdrawn,
          reinstated,
        ]);
        expect(await disputedEvents()).toHaveLength(2);
        expect(
          await fixture.db
            .select()
            .from(schema.paymentHistory)
            .where(eq(schema.paymentHistory.bookingId, 71))
        ).toHaveLength(2);
      });

      it("fix: a lost close delivered before its withdrawal voids, and the late withdrawal changes nothing", async () => {
        await deliver("charge.dispute.closed", { status: "lost" });
        expect((await coupons()).map(c => c.status)).toEqual(["V", "V"]);
        await withdraw();
        expect(await coupons()).toMatchObject([
          { status: "V", suspendedFromStatus: null },
          { status: "V", suspendedFromStatus: null },
        ]);
        expect((await disputedEvents())[1].payload).not.toHaveProperty(
          "localCouponTransitions"
        );
      });

      it("fix: a ticket document first read while funds are withdrawn issues suspended coupons", async () => {
        await fixture.db
          .delete(schema.ticketCoupons)
          .where(eq(schema.ticketCoupons.passengerId, 82));
        await withdraw();
        const document = await readTicketDocument(71, 82, 9);
        expect(document.legs.map(leg => leg.localCoupon)).toEqual([
          { number: 1, status: "S" },
        ]);
        await deliver("charge.dispute.closed", { status: "won" });
        expect(await coupons()).toMatchObject([
          { passengerId: 81, status: "O", suspendedFromStatus: null },
          { passengerId: 82, status: "O", suspendedFromStatus: null },
        ]);
      });

      it("fix: a ticket document first read after a lost dispute issues void coupons", async () => {
        await fixture.db
          .delete(schema.ticketCoupons)
          .where(eq(schema.ticketCoupons.passengerId, 82));
        await withdraw();
        await deliver("charge.dispute.closed", { status: "lost" });
        const document = await readTicketDocument(71, 82, 9);
        expect(document.legs.map(leg => leg.localCoupon)).toEqual([
          { number: 1, status: "V" },
        ]);
        expect(await coupons()).toMatchObject([
          { passengerId: 81, status: "V", suspendedFromStatus: null },
          { passengerId: 82, status: "V", suspendedFromStatus: null },
        ]);
      });

      it("fix: a won close without a reinstated event lets another payer's reinstatement restore split coupons", async () => {
        await fixture.db.insert(schema.paymentReceipts).values(
          ["a", "b"].map((payer, index) => ({
            paymentIntentId: `${intent}_${payer}`,
            bookingId: 71,
            targetId: 501 + index,
            userId: 9,
            kind: "split_payment" as const,
            amount: 10000,
            refundedAmount: 0,
            currency: "SAR",
            settlementStatus: "applied" as const,
          }))
        );
        const payer = (name: string) => ({
          id: `dp_native_s08_${name}`,
          payment_intent: `${intent}_${name}`,
          charge: `ch_native_s08_${name}`,
          amount: 10000,
        });
        await withdraw(payer("a"));
        await withdraw(payer("b"));
        await deliver("charge.dispute.closed", {
          ...payer("a"),
          status: "won",
        });
        expect((await coupons()).map(c => c.status)).toEqual(["S", "S"]);
        await deliver("charge.dispute.funds_reinstated", payer("b"));
        expect(await coupons()).toMatchObject([
          { status: "O", suspendedFromStatus: null },
          { status: "O", suspendedFromStatus: null },
        ]);
      });
    });

    describe("dispute precedence and funding (fix round 2)", () => {
      it("fix (A13): a won close outranks a contradictory later lost close; coupons stay restored and travel stays open", async () => {
        await withdraw();
        await deliver("charge.dispute.closed", { status: "won" });
        expect((await coupons()).map(c => c.status)).toEqual(["O", "O"]);
        await deliver("charge.dispute.closed", { status: "lost" });
        expect((await coupons()).map(c => c.status)).toEqual(["O", "O"]);
        await checkInPassengers({
          bookingId: 71,
          flightId: 41,
          assignments: [{ passengerId: 81, seatNumber: "12A" }],
          owner,
        });
        expect((await coupons()).map(c => c.status)).toEqual(["C", "O"]);
      });

      it("fix (A06): the booking's own collection held for refund review still funds the travel, so its dispute suspends the coupons", async () => {
        await fixture.db
          .update(schema.paymentReceipts)
          .set({
            settlementStatus: "review_required",
            settlementError:
              "Cancellation refund requires review: provider_refund_conflict",
          })
          .where(eq(schema.paymentReceipts.paymentIntentId, intent));
        await withdraw();
        expect((await coupons()).map(c => c.status)).toEqual(["S", "S"]);
        await expect(
          checkInPassengers({
            bookingId: 71,
            flightId: 41,
            assignments: [{ passengerId: 81, seatNumber: "12A" }],
            owner,
          })
        ).rejects.toMatchObject({ message: suspendedMessage });
      });
    });

    describe("dispute on a duplicate collection held for review", () => {
      it("fix: withdrawn and lost funds on the duplicate leave the coupons, check-in and lazy issue alone", async () => {
        await duplicateCollection();
        await fixture.db
          .delete(schema.ticketCoupons)
          .where(eq(schema.ticketCoupons.passengerId, 82));
        await withdraw(duplicate);
        expect(await coupons()).toMatchObject([
          { passengerId: 81, status: "O", suspendedFromStatus: null },
        ]);
        await deliver("charge.dispute.closed", {
          ...duplicate,
          status: "lost",
        });
        expect(await coupons()).toMatchObject([
          { passengerId: 81, status: "O", suspendedFromStatus: null },
        ]);
        for (const { payload } of await disputedEvents())
          expect(payload).not.toHaveProperty("localCouponTransitions");
        const document = await readTicketDocument(71, 82, 9);
        expect(document.legs.map(leg => leg.localCoupon)).toEqual([
          { number: 1, status: "O" },
        ]);
        await checkInPassengers({
          bookingId: 71,
          flightId: 41,
          assignments: [{ passengerId: 81, seatNumber: "12A" }],
          owner,
        });
        expect((await coupons()).map(c => [c.passengerId, c.status])).toEqual([
          [81, "C"],
          [82, "O"],
        ]);
      });

      it("fix: the duplicate's own dispute refuses only the refund of that duplicate", async () => {
        await duplicateCollection();
        await withdraw(duplicate);
        await expect(
          requestSettlementReviewRefund(duplicate.payment_intent, 20)
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(
            /Payment dispute dp_native_s08_dup has withdrawn/
          ),
        });
        expect(provider.create).not.toHaveBeenCalled();
        // The booking's funding collection is not held by the duplicate's dispute.
        await expect(
          fixture.db.transaction(async tx => {
            await tx
              .select()
              .from(schema.bookings)
              .where(eq(schema.bookings.id, 71))
              .for("update");
            return {
              funding: await withdrawnDisputeIds(tx, 71, [intent]),
              duplicate: await withdrawnDisputeIds(tx, 71, [
                duplicate.payment_intent,
              ]),
            };
          })
        ).resolves.toEqual({ funding: [], duplicate: ["dp_native_s08_dup"] });
        await deliver("charge.dispute.funds_reinstated", duplicate);
        await expect(
          requestSettlementReviewRefund(duplicate.payment_intent, 20)
        ).resolves.toMatchObject({ state: "awaiting_webhook" });
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(provider.create).toHaveBeenCalledWith(
          expect.objectContaining({ payment_intent: duplicate.payment_intent }),
          { idempotencyKey: `ais-review-refund:${duplicate.payment_intent}` }
        );
      });

      it("fix: a dispute on the funding collection also refuses the duplicate's settlement-review refund", async () => {
        await duplicateCollection();
        await withdraw();
        await expect(
          requestSettlementReviewRefund(duplicate.payment_intent, 20)
        ).rejects.toMatchObject(refused);
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("fix: once the funding dispute is lost it no longer holds the duplicate's refund, while the funding collection itself stays refused", async () => {
        await duplicateCollection();
        await withdraw();
        await deliver("charge.dispute.closed", { status: "lost" });
        await expect(
          fixture.db.transaction(async tx => {
            await tx
              .select()
              .from(schema.bookings)
              .where(eq(schema.bookings.id, 71))
              .for("update");
            return {
              funding: await withdrawnDisputeIds(tx, 71, [intent]),
              duplicate: await withdrawnDisputeIds(tx, 71, [
                duplicate.payment_intent,
              ]),
            };
          })
        ).resolves.toEqual({ funding: ["dp_native_s08"], duplicate: [] });
        expect(provider.create).not.toHaveBeenCalled();
        await expect(
          requestSettlementReviewRefund(duplicate.payment_intent, 20)
        ).resolves.toMatchObject({ state: "awaiting_webhook" });
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(provider.create).toHaveBeenCalledWith(
          expect.objectContaining({ payment_intent: duplicate.payment_intent }),
          { idempotencyKey: `ais-review-refund:${duplicate.payment_intent}` }
        );
      });
    });

    describe("refunds and cancellation", () => {
      it("fix: ordinary and admin refunds are refused while dispute funds are withdrawn, including after a lost close", async () => {
        await withdraw();
        await expect(
          createRefund({ bookingId: 71, userId: 9 }, customer)
        ).rejects.toMatchObject(refused);
        await expect(
          createRefund(
            { bookingId: 71, userId: 9, amount: 5000 },
            { id: 20, role: "admin" }
          )
        ).rejects.toMatchObject(refused);
        await deliver("charge.dispute.closed", { status: "lost" });
        await expect(
          createRefund({ bookingId: 71, userId: 9 }, customer)
        ).rejects.toMatchObject(refused);
        expect(provider.create).not.toHaveBeenCalled();
        expect(
          await fixture.db.select().from(schema.ordinaryBookingRefunds)
        ).toEqual([]);
        expect((await commercialState()).receipts[0].refundedAmount).toBe(0);
      });

      it("control: the refund command reaches the provider once the funds are reinstated", async () => {
        await withdraw();
        await deliver("charge.dispute.funds_reinstated");
        await expect(
          createRefund({ bookingId: 71, userId: 9 }, customer)
        ).resolves.toMatchObject({ refundId: "re_native_s08" });
        expect(provider.create).toHaveBeenCalledTimes(1);
      });

      it("control: a won close without a reinstated event releases the refund command", async () => {
        await withdraw();
        await deliver("charge.dispute.closed", { status: "won" });
        await expect(
          createRefund({ bookingId: 71, userId: 9 }, customer)
        ).resolves.toMatchObject({ refundId: "re_native_s08" });
        expect(provider.create).toHaveBeenCalledTimes(1);
      });

      it("fix: a lost close delivered before its withdrawal refuses refunds", async () => {
        await deliver("charge.dispute.closed", { status: "lost" });
        await expect(
          createRefund({ bookingId: 71, userId: 9 }, customer)
        ).rejects.toMatchObject(refused);
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
        ).rejects.toMatchObject(refused);
        expect(provider.create).not.toHaveBeenCalled();
      });

      it.each([
        {
          after: "reinstated funds",
          type: "charge.dispute.funds_reinstated",
          overrides: {},
          calls: 1,
        },
        {
          after: "a won close",
          type: "charge.dispute.closed",
          overrides: { status: "won" },
          calls: 1,
        },
        {
          after: "a lost close",
          type: "charge.dispute.closed",
          overrides: { status: "lost" },
          calls: 0,
        },
      ])(
        "fix: a cancellation refund saved before the dispute is held while the funds are withdrawn; after $after it reaches the provider $calls time(s)",
        async ({ type, overrides, calls }) => {
          const sent = provider.create;
          provider.create = vi.fn(async () => {
            throw new Error("Synthetic provider outage");
          });
          await expect(
            createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
          ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
          expect(await ordinaryCommand()).toMatchObject({
            amount: 5000,
            status: "requesting",
            errorCode: "provider_unavailable",
            refundId: null,
          });
          provider.create = sent;
          await withdraw();
          later(2);
          // The worker retry and a repeated command both stop before the provider.
          await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
            scanned: 1,
            failed: 1,
          });
          await expect(
            createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
          ).rejects.toMatchObject(refused);
          expect(provider.create).not.toHaveBeenCalled();
          expect(await ordinaryCommand()).toMatchObject({
            status: "requesting",
            errorCode: "dispute_funds_withdrawn",
            refundId: null,
          });
          await deliver(type, overrides);
          later(180);
          await processPendingOrdinaryRefunds();
          expect(provider.create).toHaveBeenCalledTimes(calls);
          if (calls) {
            const saved = await ordinaryCommand();
            expect(provider.create).toHaveBeenCalledWith(
              expect.objectContaining({ payment_intent: intent, amount: 5000 }),
              { idempotencyKey: saved.operationId }
            );
            expect(saved).toMatchObject({
              status: "pending",
              refundId: "re_native_s08",
            });
          } else {
            // Fix round 2: the command may already have reached the provider,
            // so the chargeback does not settle it and it is never reissued;
            // with no provider refund in history it goes to review.
            expect(await ordinaryCommand()).toMatchObject({
              status: "review_required",
              errorCode: "unknown_provider_outcome",
              refundId: null,
            });
            await expect(
              createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
            ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
            expect(provider.create).not.toHaveBeenCalled();
          }
        }
      );

      it.each([
        {
          after: "reinstated funds",
          type: "charge.dispute.funds_reinstated",
          overrides: {},
          calls: 1,
        },
        {
          after: "a lost close",
          type: "charge.dispute.closed",
          overrides: { status: "lost" },
          calls: 0,
        },
      ])(
        "fix: a flight cancellation proceeds while dispute funds are withdrawn and holds its refund; after $after the refund reaches the provider $calls time(s)",
        async ({ type, overrides, calls }) => {
          await withdraw();
          await requestFlightCancellation({
            flightId: 41,
            reason: "Native S-08 flight cancellation",
            actorId: 20,
            tenantId: 3,
          });
          await processFlightCancellations();
          expect(provider.create).not.toHaveBeenCalled();
          const [booking] = (await commercialState()).bookings;
          expect(booking).toMatchObject({ status: "cancelled" });
          expect((await coupons()).map(c => c.status)).toEqual(["V", "V"]);
          const held = () =>
            fixture.db
              .select({
                status: schema.orderServiceRefunds.status,
                amount: schema.orderServiceRefunds.amount,
                errorCode: schema.orderServiceRefunds.errorCode,
                requestedAt: schema.orderServiceRefunds.requestedAt,
                refundId: schema.orderServiceRefunds.refundId,
              })
              .from(schema.orderServiceRefunds);
          expect(await held()).toEqual([
            {
              status: "queued",
              amount: 20000,
              errorCode: "dispute_funds_withdrawn",
              requestedAt: null,
              refundId: null,
            },
          ]);
          const jobs = () =>
            fixture.db
              .select({ status: schema.flightCancellationJobs.status })
              .from(schema.flightCancellationJobs);
          expect(await jobs()).toEqual([{ status: "planned" }]);
          await deliver(type, overrides);
          later(180);
          await processFlightCancellations();
          expect(provider.create).toHaveBeenCalledTimes(calls);
          if (calls) {
            expect(provider.create).toHaveBeenCalledWith(
              expect.objectContaining({
                payment_intent: intent,
                amount: 20000,
              }),
              expect.anything()
            );
            expect(await held()).toMatchObject([
              { status: "pending", refundId: "re_native_s08" },
            ]);
          } else {
            // Fix round 2: the bank returned the whole refund, so it is closed
            // with no provider call and the cancellation job completes.
            expect(await held()).toEqual([
              {
                status: "succeeded",
                amount: 20000,
                errorCode: "settled_by_chargeback",
                requestedAt: null,
                refundId: null,
              },
            ]);
            expect(await jobs()).toEqual([{ status: "completed" }]);
            expect((await commercialState()).receipts[0].refundedAmount).toBe(
              0
            );
            expect(await refundLedger()).toEqual([]);
          }
        }
      );

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

      it("fix: a split cancellation with refunds is refused while one payer's dispute holds funds", async () => {
        await splitFunding();
        const available = await getSplitRefundCancellation(71, customer);
        expect(available.quote?.refundAmount).toBeGreaterThan(0);
        await withdraw({
          id: "dp_native_s08_a",
          payment_intent: `${intent}_a`,
          amount: 10000,
        });
        const preview = await getSplitRefundCancellation(71, customer);
        expect(preview).toMatchObject({
          quote: null,
          reason: expect.stringMatching(
            /Payment dispute dp_native_s08_a has withdrawn/
          ),
        });
        await expect(
          reserveSplitRefundCancellation(
            {
              bookingId: 71,
              quoteHash: available.quote!.quoteHash,
              reason: "requested_by_customer",
            },
            customer
          )
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(/dp_native_s08_a/),
        });
        expect(
          await fixture.db.select().from(schema.bookingRefundPlans)
        ).toEqual([]);
        expect((await coupons()).map(c => c.status)).toEqual(["S", "S"]);
      });

      it("fix: payer refunds reserved before the dispute are held while one payer's dispute holds funds", async () => {
        await splitFunding();
        const available = await getSplitRefundCancellation(71, customer);
        await reserveSplitRefundCancellation(
          {
            bookingId: 71,
            quoteHash: available.quote!.quoteHash,
            reason: "requested_by_customer",
          },
          customer
        );
        await withdraw({
          id: "dp_native_s08_a",
          payment_intent: `${intent}_a`,
          amount: 10000,
        });
        await processPendingSplitRefunds();
        expect(provider.create).not.toHaveBeenCalled();
        const items = () =>
          fixture.db
            .select({
              status: schema.bookingRefundItems.status,
              errorCode: schema.bookingRefundItems.errorCode,
              requestedAt: schema.bookingRefundItems.requestedAt,
            })
            .from(schema.bookingRefundItems)
            .orderBy(schema.bookingRefundItems.splitId);
        expect(await items()).toEqual(
          [1, 2].map(() => ({
            status: "queued",
            errorCode: "dispute_funds_withdrawn",
            requestedAt: null,
          }))
        );
        await deliver("charge.dispute.funds_reinstated", {
          id: "dp_native_s08_a",
          payment_intent: `${intent}_a`,
          amount: 10000,
        });
        later(180);
        await processPendingSplitRefunds();
        expect(provider.create).toHaveBeenCalledTimes(2);
      });

      it("fix: a split cancellation without refunds stays available while one payer's dispute holds funds", async () => {
        await splitFunding();
        await nonrefundableFare();
        await withdraw({
          id: "dp_native_s08_a",
          payment_intent: `${intent}_a`,
          amount: 10000,
        });
        const preview = await getSplitRefundCancellation(71, customer);
        expect(preview.quote?.refundAmount).toBe(0);
        await expect(
          reserveSplitRefundCancellation(
            {
              bookingId: 71,
              quoteHash: preview.quote!.quoteHash,
              reason: "requested_by_customer",
              confirmNoRefund: true,
            },
            customer
          )
        ).resolves.toMatchObject({ plan: { status: "completed" } });
        expect((await commercialState()).bookings[0]).toMatchObject({
          status: "cancelled",
        });
        expect((await coupons()).map(c => c.status)).toEqual(["V", "V"]);
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("fix: a cancellation that issues no refund turns suspended coupons into V", async () => {
        await nonrefundableFare();
        await withdraw();
        expect((await coupons()).map(c => c.status)).toEqual(["S", "S"]);
        const quote = await getCancellationQuote(71);
        expect(quote.refundAmount).toBe(0);
        await cancelBookingWithoutRefund(
          {
            bookingId: 71,
            quoteHash: quote.quoteHash,
            confirmNoRefund: true,
            reason: "requested_by_customer",
          },
          customer
        );
        expect(await coupons()).toMatchObject([
          { status: "V", suspendedFromStatus: null },
          { status: "V", suspendedFromStatus: null },
        ]);
        expect((await commercialState()).bookings[0]).toMatchObject({
          status: "cancelled",
          paymentStatus: "paid",
        });
        const [cancelled] = await fixture.db
          .select({ payload: schema.outbox.payload })
          .from(schema.outbox)
          .where(eq(schema.outbox.eventType, "booking.cancelled"));
        expect(cancelled.payload).toMatchObject({
          localCouponTransitions: [
            { previousStatus: "S", status: "V" },
            { previousStatus: "S", status: "V" },
          ],
        });
        expect(provider.create).not.toHaveBeenCalled();
      });

      // Fix round 2: a lost dispute means the bank has already returned the
      // money. Each "fix:" case below fails on d507461.
      it("fix: a lost dispute settles a held cancellation refund it fully covers with no provider call and completes the cancellation; replays change nothing", async () => {
        await reserveQueued(5000);
        await withdraw();
        await expect(
          processOrdinaryRefundCancellation(71)
        ).rejects.toMatchObject(refused);
        const lost = await deliver("charge.dispute.closed", { status: "lost" });
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        const closed = await ordinaryCommand();
        expect(closed).toMatchObject({
          status: "succeeded",
          amount: 0,
          providerStatus: "settled_by_chargeback",
          errorCode: "settled_by_chargeback",
          refundId: null,
          requestedAt: null,
          completedAt: expect.any(Date),
        });
        // The saved request keeps the amount the customer was owed.
        expect(JSON.parse(closed.requestPayload)).toMatchObject({
          amount: 5000,
        });
        const state = await commercialState();
        expect(state.bookings[0]).toMatchObject({ status: "cancelled" });
        expect(state.receipts[0].refundedAmount).toBe(0);
        expect(await refundLedger()).toEqual([]);
        expect(await getRefundStats()).toMatchObject({
          totalRefunds: 0,
          totalRefundedAmount: 0,
          pendingRefunds: 0,
          pendingRefundAmount: 0,
          reviewRequiredRefunds: 0,
        });
        // A replayed lost event, a second worker run and a repeated command
        // close nothing twice and reach no provider.
        await deliver("charge.dispute.closed", { status: "lost" }, lost);
        later(200);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 0,
          failed: 0,
        });
        await expect(
          processOrdinaryRefundCancellation(71)
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await ordinaryCommand()).toEqual(closed);
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("fix: a lost close delivered before its withdrawal keeps the saved refund waiting for the withdrawn amount, then settles it", async () => {
        await reserveQueued(5000);
        await deliver("charge.dispute.closed", { status: "lost" });
        await expect(
          processOrdinaryRefundCancellation(71)
        ).rejects.toMatchObject(refused);
        expect(await ordinaryCommand()).toMatchObject({
          status: "queued",
          errorCode: "dispute_funds_withdrawn",
          requestedAt: null,
        });
        await withdraw();
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        expect(await ordinaryCommand()).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
        });
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("fix: a lost dispute smaller than the held refund sends only the remainder under its own key, and settlement records only the amount sent", async () => {
        await reserveQueued(15000);
        await withdraw({ amount: 5000 });
        await expect(
          processOrdinaryRefundCancellation(71)
        ).rejects.toMatchObject(refused);
        const lost = await deliver("charge.dispute.closed", {
          status: "lost",
          amount: 5000,
        });
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        const key = "booking-71-refund-15000:chargeback-remainder";
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(provider.create).toHaveBeenCalledWith(
          expect.objectContaining({
            payment_intent: intent,
            amount: 10000,
            metadata: expect.objectContaining({
              refundOperationId: key,
              chargebackSettledAmount: "5000",
            }),
          }),
          { idempotencyKey: key }
        );
        expect(await ordinaryCommand()).toMatchObject({
          amount: 10000,
          operationId: key,
          status: "pending",
          refundId: "re_native_s08",
        });
        // Replays and repeated worker runs send no second remainder.
        await deliver(
          "charge.dispute.closed",
          { status: "lost", amount: 5000 },
          lost
        );
        later(63);
        await processPendingOrdinaryRefunds();
        later(65);
        await processPendingOrdinaryRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        provider.refund = { ...provider.refund, status: "succeeded" };
        later(67);
        await processPendingOrdinaryRefunds();
        expect(await ordinaryCommand()).toMatchObject({
          status: "succeeded",
          completedAt: expect.any(Date),
        });
        const state = await commercialState();
        expect(state.bookings[0]).toMatchObject({ status: "cancelled" });
        expect(state.receipts[0].refundedAmount).toBe(10000);
        expect(await refundLedger()).toEqual([
          { type: "partial_refund", amount: "100.00", paymentIntentId: intent },
        ]);
        expect(await getRefundStats()).toMatchObject({
          totalRefunds: 1,
          totalRefundedAmount: 10000,
        });
        expect(provider.create).toHaveBeenCalledTimes(1);
      });

      it("fix: after one payer's lost dispute, that payer's share is settled by the chargeback and the other payer is refunded", async () => {
        await splitFunding();
        const available = await getSplitRefundCancellation(71, customer);
        await reserveSplitRefundCancellation(
          {
            bookingId: 71,
            quoteHash: available.quote!.quoteHash,
            reason: "requested_by_customer",
          },
          customer
        );
        await withdraw(payerA);
        await processPendingSplitRefunds();
        const lost = await deliver("charge.dispute.closed", {
          ...payerA,
          status: "lost",
        });
        distinctRefunds("succeeded");
        later(61);
        await processPendingSplitRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(provider.create).toHaveBeenCalledWith(
          expect.objectContaining({ payment_intent: `${intent}_b` }),
          expect.anything()
        );
        const items = () =>
          fixture.db
            .select({
              paymentIntentId: schema.bookingRefundItems.paymentIntentId,
              status: schema.bookingRefundItems.status,
              errorCode: schema.bookingRefundItems.errorCode,
              refundId: schema.bookingRefundItems.refundId,
              refundAmount: schema.bookingRefundItems.refundAmount,
            })
            .from(schema.bookingRefundItems)
            .orderBy(schema.bookingRefundItems.splitId);
        const [a, b] = await items();
        expect(a).toMatchObject({
          status: "succeeded",
          errorCode: "settled_by_chargeback",
          refundId: null,
        });
        expect(b).toMatchObject({
          status: "succeeded",
          refundId: `re_${intent}_b`,
        });
        const [plan] = await fixture.db
          .select()
          .from(schema.bookingRefundPlans);
        expect(plan.status).toBe("completed");
        const receipts = (await commercialState()).receipts.sort((x, y) =>
          x.paymentIntentId.localeCompare(y.paymentIntentId)
        );
        expect(receipts.map(r => r.refundedAmount)).toEqual([
          0,
          b.refundAmount,
        ]);
        expect(await refundLedger()).toEqual([
          expect.objectContaining({ paymentIntentId: `${intent}_b` }),
        ]);
        await deliver(
          "charge.dispute.closed",
          { ...payerA, status: "lost" },
          lost
        );
        later(200);
        await processPendingSplitRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(await items()).toEqual([a, b]);
      });

      it("fix: a split flight cancellation completes after one payer's lost dispute: that payer's refund is settled and the other payer's is sent", async () => {
        await splitFunding();
        await withdraw(payerA);
        await requestFlightCancellation({
          flightId: 41,
          reason: "Native S-08 flight cancellation",
          actorId: 20,
          tenantId: 3,
        });
        await processFlightCancellations();
        expect(provider.create).not.toHaveBeenCalled();
        const lost = await deliver("charge.dispute.closed", {
          ...payerA,
          status: "lost",
        });
        distinctRefunds("succeeded");
        later(61);
        await processFlightCancellations();
        const rows = () =>
          fixture.db
            .select({
              paymentIntentId: schema.orderServiceRefunds.paymentIntentId,
              status: schema.orderServiceRefunds.status,
              errorCode: schema.orderServiceRefunds.errorCode,
              refundId: schema.orderServiceRefunds.refundId,
            })
            .from(schema.orderServiceRefunds)
            .orderBy(schema.orderServiceRefunds.paymentIntentId);
        expect(await rows()).toEqual([
          {
            paymentIntentId: `${intent}_a`,
            status: "succeeded",
            errorCode: "settled_by_chargeback",
            refundId: null,
          },
          {
            paymentIntentId: `${intent}_b`,
            status: "succeeded",
            errorCode: null,
            refundId: `re_${intent}_b`,
          },
        ]);
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(
          await fixture.db
            .select({ status: schema.flightCancellationJobs.status })
            .from(schema.flightCancellationJobs)
        ).toEqual([{ status: "completed" }]);
        await deliver(
          "charge.dispute.closed",
          { ...payerA, status: "lost" },
          lost
        );
        later(200);
        await processFlightCancellations();
        expect(provider.create).toHaveBeenCalledTimes(1);
      });

      it("pin: a command already sent to the provider and held through a won dispute goes to review with no provider call", async () => {
        const sent = provider.create;
        provider.create = vi.fn(async () => {
          throw new Error("Synthetic provider outage");
        });
        await expect(
          createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin)
        ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
        provider.create = sent;
        await withdraw();
        later(2);
        await processPendingOrdinaryRefunds();
        later(60 * 24 * 30);
        await deliver("charge.dispute.closed", { status: "won" });
        later(60 * 24 * 30 + 120);
        await processPendingOrdinaryRefunds();
        expect(await ordinaryCommand()).toMatchObject({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
          refundId: null,
        });
        expect(sent).not.toHaveBeenCalled();
      });

      // Weakenings that no earlier test caught (second verification of S-08).
      it("fix (A15): corrupt dispute evidence fails closed for new and saved refunds", async () => {
        await reserveQueued(5000);
        await fixture.db.insert(schema.financialLedger).values({
          bookingId: 71,
          userId: 9,
          type: "adjustment",
          amount: "-200.00",
          currency: "SAR",
          stripeEventId: "evt_native_s08_corrupt",
          stripePaymentIntentId: intent,
          description: "Provider dispute funds_withdrawn",
          metadata: "{not json",
        });
        await expect(processOrdinaryRefundCancellation(71)).rejects.toThrow(
          /dispute evidence requires reconciliation/
        );
        await fixture.db.delete(schema.ordinaryBookingRefunds);
        await expect(
          createRefund({ bookingId: 71, userId: 9 }, customer)
        ).rejects.toThrow();
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("fix (F06): a verified full refund closes suspended coupons as refunded", async () => {
        await createRefund({ bookingId: 71, userId: 9, amount: 20000 }, admin);
        await withdraw();
        expect((await coupons()).map(c => c.status)).toEqual(["S", "S"]);
        await processOrdinaryRefundCancellation(71, {
          ...provider.refund,
          status: "succeeded",
        });
        expect(await coupons()).toMatchObject([
          { status: "R", suspendedFromStatus: null },
          { status: "R", suspendedFromStatus: null },
        ]);
      });

      it("fix (B05): an ordinary refund that already exists at the provider still reconciles while the funds are withdrawn", async () => {
        await createRefund({ bookingId: 71, userId: 9, amount: 5000 }, admin);
        await withdraw();
        provider.refund = { ...provider.refund, status: "succeeded" };
        later(2);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 0,
        });
        expect(await ordinaryCommand()).toMatchObject({
          status: "succeeded",
          refundId: "re_native_s08",
        });
        expect(provider.create).toHaveBeenCalledTimes(1);
      });

      it("fix (C04): split payer refunds that already exist at the provider still reconcile while one payer's funds are withdrawn", async () => {
        await splitFunding();
        distinctRefunds();
        const available = await getSplitRefundCancellation(71, customer);
        await reserveSplitRefundCancellation(
          {
            bookingId: 71,
            quoteHash: available.quote!.quoteHash,
            reason: "requested_by_customer",
          },
          customer
        );
        await processPendingSplitRefunds();
        expect(provider.create).toHaveBeenCalledTimes(2);
        await withdraw(payerA);
        for (const refund of Object.values(provider.byId))
          refund.status = "succeeded";
        later(6);
        await processPendingSplitRefunds();
        expect(
          (
            await fixture.db
              .select({ status: schema.bookingRefundItems.status })
              .from(schema.bookingRefundItems)
          ).map(i => i.status)
        ).toEqual(["succeeded", "succeeded"]);
        expect(provider.create).toHaveBeenCalledTimes(2);
      });

      it("fix (D02): an order refund that already exists at the provider still reconciles while the funds are withdrawn", async () => {
        await requestFlightCancellation({
          flightId: 41,
          reason: "Native S-08 flight cancellation",
          actorId: 20,
          tenantId: 3,
        });
        await processFlightCancellations();
        expect(provider.create).toHaveBeenCalledTimes(1);
        await withdraw();
        provider.refund = { ...provider.refund, status: "succeeded" };
        later(2);
        await processFlightCancellations();
        expect(
          await fixture.db
            .select({
              status: schema.orderServiceRefunds.status,
              refundId: schema.orderServiceRefunds.refundId,
            })
            .from(schema.orderServiceRefunds)
        ).toEqual([{ status: "succeeded", refundId: "re_native_s08" }]);
        expect(provider.create).toHaveBeenCalledTimes(1);
      });

      it("fix (B03): a held ordinary refund is retried hourly, not on every run", async () => {
        await reserveQueued(5000);
        await withdraw();
        later(2);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 1,
        });
        expect((await ordinaryCommand()).nextAttemptAt).toEqual(
          new Date(now.getTime() + 62 * 60_000)
        );
        later(61);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 0,
          failed: 0,
        });
        later(62);
        await expect(processPendingOrdinaryRefunds()).resolves.toEqual({
          scanned: 1,
          failed: 1,
        });
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("fix (C05): held split payer refunds are retried hourly, not on every run", async () => {
        await splitFunding();
        const available = await getSplitRefundCancellation(71, customer);
        await reserveSplitRefundCancellation(
          {
            bookingId: 71,
            quoteHash: available.quote!.quoteHash,
            reason: "requested_by_customer",
          },
          customer
        );
        await withdraw(payerA);
        later(2);
        await expect(processPendingSplitRefunds()).resolves.toEqual({
          scanned: 2,
        });
        const due = await fixture.db
          .select({ nextAttemptAt: schema.bookingRefundItems.nextAttemptAt })
          .from(schema.bookingRefundItems);
        expect(due.map(i => i.nextAttemptAt)).toEqual(
          [1, 2].map(() => new Date(now.getTime() + 62 * 60_000))
        );
        later(61);
        await expect(processPendingSplitRefunds()).resolves.toEqual({
          scanned: 0,
        });
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("fix (D03): a held order refund is retried hourly, not on every run", async () => {
        await withdraw();
        await requestFlightCancellation({
          flightId: 41,
          reason: "Native S-08 flight cancellation",
          actorId: 20,
          tenantId: 3,
        });
        await processFlightCancellations();
        const [held] = await fixture.db
          .select({ nextAttemptAt: schema.orderServiceRefunds.nextAttemptAt })
          .from(schema.orderServiceRefunds);
        expect(held.nextAttemptAt).toEqual(
          new Date(now.getTime() + 60 * 60_000)
        );
        later(59);
        await expect(processPendingOrderRefunds()).resolves.toEqual({
          scanned: 0,
        });
        expect(provider.create).not.toHaveBeenCalled();
      });

      it("fix (D04): an order refund stays held by its own collection's dispute after that collection stops funding the travel", async () => {
        await splitFunding();
        await withdraw(payerA);
        await requestFlightCancellation({
          flightId: 41,
          reason: "Native S-08 flight cancellation",
          actorId: 20,
          tenantId: 3,
        });
        await processFlightCancellations();
        // Payer A's collection goes to refund review: it no longer funds the
        // travel, but its own withdrawn dispute still holds its refund.
        await fixture.db
          .update(schema.paymentReceipts)
          .set({
            settlementStatus: "review_required",
            settlementError: "Cancellation refund requires review: synthetic",
          })
          .where(eq(schema.paymentReceipts.paymentIntentId, `${intent}_a`));
        distinctRefunds();
        later(61);
        await processPendingOrderRefunds();
        expect(provider.create).toHaveBeenCalledTimes(1);
        expect(provider.create).toHaveBeenCalledWith(
          expect.objectContaining({ payment_intent: `${intent}_b` }),
          expect.anything()
        );
        const [a] = await fixture.db
          .select({
            status: schema.orderServiceRefunds.status,
            errorCode: schema.orderServiceRefunds.errorCode,
          })
          .from(schema.orderServiceRefunds)
          .where(eq(schema.orderServiceRefunds.paymentIntentId, `${intent}_a`));
        expect(a).toEqual({
          status: "queued",
          errorCode: "dispute_funds_withdrawn",
        });
      });
    });

    describe("servicing", () => {
      async function disruption() {
        // A second booking on the same flight is recovered normally.
        await fixture.db.insert(schema.bookings).values({
          id: 72,
          tenantId: 3,
          userId: 9,
          flightId: 41,
          bookingReference: "NM0072",
          pnr: "PN0072",
          totalAmount: 10000,
          cabinClass: "economy",
          numberOfPassengers: 1,
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
        });
        await fixture.db.insert(schema.passengers).values({
          id: 83,
          bookingId: 72,
          tenantId: 3,
          firstName: "Gamma",
          lastName: "Native",
          type: "adult",
          ticketNumber: ticket(83),
        });
        await fixture.db.insert(schema.ticketCoupons).values({
          bookingId: 72,
          passengerId: 83,
          flightId: 41,
          ticketNumber: ticket(83),
          couponNumber: 1,
          status: "O",
        });
        const [event] = await fixture.db
          .insert(schema.flightDisruptions)
          .values({
            flightId: 41,
            type: "delay",
            reason: "Native S-08 disruption",
            severity: "moderate",
            status: "active",
          })
          .$returningId();
        await fixture.db.insert(schema.iropsActions).values(
          [71, 72].map(bookingId => ({
            eventId: event.id,
            requestKey: `native-s08-rebook-${bookingId}`,
            actionType: "rebook" as const,
            status: "pending" as const,
            details: { bookingId },
          }))
        );
        const proposal = await proposeRecovery(
          {
            eventId: event.id,
            bookingIds: [71, 72],
            candidateFlightIds: [42],
          },
          3
        );
        expect(proposal.choices).toEqual([
          { bookingId: 71, key: "42:economy" },
          { bookingId: 72, key: "42:economy" },
        ]);
        await approveRecovery(proposal.id, proposal.digest, 20, 3);
        return proposal;
      }

      it("fix: IROPS execution skips and reports a booking with suspended coupons and recovers the rest of the plan", async () => {
        const proposal = await disruption();
        await withdraw();
        const result = await executeRecovery(
          proposal.id,
          proposal.digest,
          20,
          3
        );
        expect(result.skippedBookings).toEqual([
          {
            bookingId: 71,
            reason: "coupons_suspended",
            disputeIds: ["dp_native_s08"],
          },
        ]);
        const bookings = await fixture.db
          .select()
          .from(schema.bookings)
          .orderBy(schema.bookings.id);
        expect(bookings.map(b => [b.id, b.flightId])).toEqual([
          [71, 41],
          [72, 42],
        ]);
        expect(await coupons(71)).toMatchObject([
          { flightId: 41, status: "S" },
          { flightId: 41, status: "S" },
        ]);
        expect(await coupons(72)).toMatchObject([
          { flightId: 41, status: "E" },
        ]);
        const actions = await fixture.db
          .select()
          .from(schema.iropsActions)
          .orderBy(schema.iropsActions.id);
        expect(actions.map(a => a.status)).toEqual(["pending", "completed"]);
        const flights = await fixture.db
          .select()
          .from(schema.flights)
          .orderBy(schema.flights.id);
        expect(flights.map(f => f.economyAvailable)).toEqual([7, 7]);
        const [receipt] = await fixture.db
          .select({ payload: schema.outbox.payload })
          .from(schema.outbox)
          .where(eq(schema.outbox.eventType, "irops.recovery_executed"));
        expect(receipt.payload).toMatchObject({
          skippedBookings: [
            {
              bookingId: 71,
              reason: "coupons_suspended",
              disputeIds: ["dp_native_s08"],
            },
          ],
        });
        // The executed plan replays its receipt.
        await expect(
          executeRecovery(proposal.id, proposal.digest, 20, 3)
        ).resolves.toEqual({ receiptId: result.receiptId });
      });

      it("fix: IROPS execution reports a booking whose coupons a lost dispute voided as void, not suspended", async () => {
        const proposal = await disruption();
        await withdraw();
        await deliver("charge.dispute.closed", { status: "lost" });
        const result = await executeRecovery(
          proposal.id,
          proposal.digest,
          20,
          3
        );
        expect(result.skippedBookings).toEqual([
          {
            bookingId: 71,
            reason: "coupons_void",
            disputeIds: ["dp_native_s08"],
          },
        ]);
        expect(await coupons(71)).toMatchObject([
          { flightId: 41, status: "V" },
          { flightId: 41, status: "V" },
        ]);
      });

      it("control: without a dispute the same plan moves both bookings", async () => {
        const proposal = await disruption();
        await executeRecovery(proposal.id, proposal.digest, 20, 3);
        const bookings = await fixture.db
          .select()
          .from(schema.bookings)
          .orderBy(schema.bookings.id);
        expect(bookings.map(b => b.flightId)).toEqual([42, 42]);
        const [receipt] = await fixture.db
          .select({ payload: schema.outbox.payload })
          .from(schema.outbox)
          .where(eq(schema.outbox.eventType, "irops.recovery_executed"));
        expect(receipt.payload).not.toHaveProperty("skippedBookings");
      });

      it("fix: voluntary exchange and sector-adding exchange quotes are refused while coupons are suspended", async () => {
        const exchange = (offers: number) =>
          quotePaidOrderService(
            {
              bookingId: 71,
              idempotencyKey: `native-s08-exchange-${randomUUID()}`,
              offerIds: Array.from({ length: offers }, () => randomUUID()),
            },
            9,
            3
          );
        const control = await exchange(1).catch(error => error);
        expect(String(control.message)).not.toMatch(/payment dispute/);
        await withdraw();
        for (const offers of [1, 2])
          await expect(exchange(offers)).rejects.toMatchObject({
            code: "PRECONDITION_FAILED",
            message: expect.stringMatching(suspendedMessage),
          });
        // The coupon exchange itself refuses, for any caller that skips the quote.
        await expect(
          fixture.db.transaction(async tx => {
            await tx
              .select()
              .from(schema.bookings)
              .where(eq(schema.bookings.id, 71))
              .for("update");
            return exchangeLocalCoupons(tx, 71, [41], [41, 42]);
          })
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(suspendedMessage),
        });
        expect((await coupons()).map(c => c.status)).toEqual(["S", "S"]);
        expect(
          await fixture.db.select().from(schema.bookingModifications)
        ).toEqual([]);
      });

      it("fix: exchange checkout is refused before the provider when the funds are withdrawn after the quote", async () => {
        // A saved exchange quote to flight 42, as quotePaidOrderService stores it.
        const plan = {
          version: 1,
          fingerprint: calculateRequestHash({
            flightId: 41,
            cabinClass: "economy",
            totalAmount: 20000,
            checkedIn: false,
            status: "confirmed",
            legs: [
              {
                flightId: 41,
                amount: 20000,
                reserved: true,
                status: "confirmed",
              },
            ],
          }),
          expiresAt: "2030-06-10T06:10:00.000Z",
          segments: [
            {
              flightId: 42,
              cabinClass: "economy",
              amount: 24000,
              holdId: null,
              departureTime: "2030-06-11T12:00:00.000Z",
              arrivalTime: "2030-06-11T14:00:00.000Z",
              offerId: null,
              ndc: {},
            },
          ],
          ancillaries: [],
        };
        const change = {
          id: 61,
          bookingId: 71,
          userId: 9,
          modificationType: "change_flight" as const,
          originalFlightId: 41,
          newFlightId: 42,
          originalAmount: 20000,
          newAmount: 24000,
          priceDifference: 4000,
          modificationFee: 0,
          totalCost: 4000,
          status: "pending" as const,
          servicingPayload: plan,
        };
        await fixture.db.insert(schema.bookingModifications).values(change);
        const consent = {
          quoteVersion: servicingQuoteVersion(change),
          totalCost: 4000,
          currency: "SAR" as const,
        };
        const checkout = () =>
          createOrderServiceCheckout(61, 9, "https://example.test", 3, consent);
        await withdraw();
        await expect(checkout()).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(suspendedMessage),
        });
        expect(provider.checkout).not.toHaveBeenCalled();
        const [refused] = await fixture.db
          .select()
          .from(schema.bookingModifications);
        expect(refused).toMatchObject({
          status: "pending",
          checkoutRequestId: null,
        });
        // Once the funds are reinstated the same quote reaches checkout.
        await deliver("charge.dispute.funds_reinstated");
        await expect(checkout()).resolves.toMatchObject({
          sessionId: "cs_native_s08",
        });
        expect(provider.checkout).toHaveBeenCalledTimes(1);
      });
    });

    describe("departure", () => {
      const admission = {
        bookingId: 71,
        flightId: 41,
        assignments: [{ passengerId: 81, seatNumber: "12A" }],
        owner,
      };

      it("control: check-in and boarding pass issue succeed without a dispute", async () => {
        await checkInPassengers(admission);
        await expect(issueBoardingPass(key, owner)).resolves.toMatchObject({
          payload: { passengerId: 81, seatNumber: "12A" },
        });
        expect((await coupons())[0].status).toBe("C");
      });

      it("fix: check-in is refused for a suspended coupon", async () => {
        await withdraw();
        const before = await commercialState();
        await expect(checkInPassengers(admission)).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(suspendedMessage),
        });
        expect(await commercialState()).toEqual(before);
        expect(await coupons()).toMatchObject([
          { status: "S", suspendedFromStatus: "O" },
          { status: "S", suspendedFromStatus: "O" },
        ]);
      });

      it("fix: boarding pass issue, pass verification and desk boarding are refused for a suspended coupon", async () => {
        await checkInPassengers(admission);
        const pass = await issueBoardingPass(key, owner);
        await withdraw();
        expect(await coupons()).toMatchObject([
          { passengerId: 81, status: "S", suspendedFromStatus: "C" },
          { passengerId: 82, status: "S", suspendedFromStatus: "O" },
        ]);
        await expect(issueBoardingPass(key, owner)).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(suspendedMessage),
        });
        expect(await verifyActiveBoardingPass(pass.token)).toMatchObject({
          valid: false,
        });
        await expect(
          transitionDcsPassenger(
            { ...key, action: "board", ...command() },
            operator
          )
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        // Re-confirming the earlier check-in is refused too.
        await expect(checkInPassengers(admission)).rejects.toMatchObject({
          message: expect.stringMatching(suspendedMessage),
        });
        const attendance = await fixture.db
          .select()
          .from(schema.dcsPassengerStates)
          .where(
            and(
              eq(schema.dcsPassengerStates.bookingId, 71),
              eq(schema.dcsPassengerStates.passengerId, 81)
            )
          );
        expect(attendance.map(a => a.state)).toEqual(["checked_in"]);
      });

      it.each(["offload", "undo"] as const)(
        "fix: %s while suspended moves the stored prior status from C to O",
        async action => {
          await checkInPassengers(admission);
          await withdraw();
          if (action === "offload")
            await transitionDcsPassenger(
              { ...key, action: "offload", ...command() },
              operator
            );
          else await undoCheckIn(41, 71, 81, operator);
          expect((await coupons())[0]).toMatchObject({
            status: "S",
            suspendedFromStatus: "O",
          });
          await deliver("charge.dispute.closed", { status: "won" });
          expect((await coupons())[0]).toMatchObject({
            status: "O",
            suspendedFromStatus: null,
          });
        }
      );

      it("fix: a passenger without a coupon row is refused at check-in while dispute funds are withdrawn", async () => {
        await fixture.db
          .delete(schema.ticketCoupons)
          .where(eq(schema.ticketCoupons.passengerId, 81));
        await withdraw();
        await expect(checkInPassengers(admission)).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(suspendedMessage),
        });
        await deliver("charge.dispute.funds_reinstated");
        await expect(checkInPassengers(admission)).resolves.toBeDefined();
      });

      it("fix: a coupon void for another reason is refused at check-in without blaming a dispute", async () => {
        await fixture.db
          .update(schema.ticketCoupons)
          .set({ status: "V" })
          .where(eq(schema.ticketCoupons.passengerId, 81));
        const voided = {
          code: "PRECONDITION_FAILED",
          message: "Ticket coupon is void; check-in requires servicing review",
        };
        await expect(checkInPassengers(admission)).rejects.toMatchObject(
          voided
        );
        // Still the coupon's own void while another coupon is suspended.
        await withdraw();
        expect((await coupons()).map(c => c.status)).toEqual(["V", "S"]);
        await expect(checkInPassengers(admission)).rejects.toMatchObject(
          voided
        );
      });

      it("fix: a lost close keeps check-in refused for the void coupon", async () => {
        await withdraw();
        await deliver("charge.dispute.closed", { status: "lost" });
        await expect(checkInPassengers(admission)).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(
            /voided after payment dispute dp_native_s08 was lost/
          ),
        });
      });
    });

    describe("locking", () => {
      it("fix: the refund guard sees a withdrawal committed while it waited for the booking lock", async () => {
        let processed!: () => void;
        let release!: () => void;
        const ready = new Promise<void>(resolve => (processed = resolve));
        const gate = new Promise<void>(resolve => (release = resolve));
        const webhook = fixture.db.transaction(async tx => {
          await processStripeEvent(
            tx as never,
            {
              id: "evt_native_s08_race",
              type: "charge.dispute.funds_withdrawn",
              data: {
                object: {
                  id: "dp_native_s08",
                  object: "dispute",
                  charge: "ch_native_s08",
                  payment_intent: intent,
                  amount: 20000,
                  currency: "sar",
                  status: "under_review",
                  reason: "fraudulent",
                },
              },
            } as never
          );
          processed();
          await gate;
        });
        await ready;
        const guard = fixture.db.transaction(async tx => {
          // A consistent read fixes this transaction's snapshot before the
          // withdrawal commits; only a current read can see it afterwards.
          await tx
            .select({ id: schema.financialLedger.id })
            .from(schema.financialLedger);
          await tx
            .select()
            .from(schema.bookings)
            .where(eq(schema.bookings.id, 71))
            .for("update");
          return withdrawnDisputeIds(tx, 71, [intent]);
        });
        await fixture.waitForBlockedTransactions(1);
        release();
        await webhook;
        await expect(guard).resolves.toEqual(["dp_native_s08"]);
      });

      it("fix (E03): a settlement-review refund waits for the booking lock and sees a withdrawal committed meanwhile", async () => {
        await duplicateCollection();
        let locked!: () => void;
        let release!: () => void;
        const ready = new Promise<void>(resolve => (locked = resolve));
        const gate = new Promise<void>(resolve => (release = resolve));
        // The webhook takes the booking lock first and records the dispute
        // afterwards, as recordVerifiedDispute does.
        const webhook = fixture.db.transaction(async tx => {
          await tx
            .select()
            .from(schema.bookings)
            .where(eq(schema.bookings.id, 71))
            .for("update");
          locked();
          await gate;
          await processStripeEvent(
            tx as never,
            {
              id: "evt_native_s08_review_race",
              type: "charge.dispute.funds_withdrawn",
              data: {
                object: {
                  ...duplicate,
                  object: "dispute",
                  amount: 20000,
                  currency: "sar",
                  status: "under_review",
                  reason: "fraudulent",
                },
              },
            } as never
          );
        });
        await ready;
        const review = requestSettlementReviewRefund(
          duplicate.payment_intent,
          20
        );
        const settled = review.then(
          () => "resolved",
          () => "rejected"
        );
        await Promise.race([
          fixture.waitForBlockedTransactions(1).catch(() => "not blocked"),
          settled,
        ]);
        release();
        await webhook;
        await expect(review).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(
            /Payment dispute dp_native_s08_dup has withdrawn/
          ),
        });
        expect(provider.create).not.toHaveBeenCalled();
      });
    });
  }
);
