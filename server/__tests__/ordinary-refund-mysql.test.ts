import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
import { forensicFindings } from "../../scripts/ci/forensic-data-audit";
import {
  apiProcessWebhookSecret,
  startApiProcessFixture,
} from "./helpers/api-process-fixture";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

const provider = vi.hoisted(() => ({
  db: null as any,
  refund: null as any,
  create: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => provider.db }));
vi.mock("../stripe", () => ({
  stripe: {
    refunds: {
      create: provider.create,
      retrieve: async () => provider.refund,
      list: () => ({
        async *[Symbol.asyncIterator]() {
          if (provider.refund) yield provider.refund;
        },
      }),
    },
  },
}));
vi.mock("../services/email.service", () => ({
  sendRefundConfirmation: vi.fn(),
}));
vi.mock("../services/notification.service", () => ({
  notifyRefundProcessed: vi.fn(),
}));
vi.mock("../services/metrics.service", () => ({ trackRefundIssued: vi.fn() }));
import {
  createRefund,
  getCancellationQuote,
} from "../services/refunds.service";
import {
  assertZeroCancellationAllowed,
  cancelBookingWithoutRefund,
  getZeroCancellationReceipt,
} from "../services/zero-refund-cancellation.service";
import { processPendingOrdinaryRefunds } from "../services/ordinary-refund.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
const sdk = new Stripe("sk_test_native_refund_signature_only");

/** Native row locks, unique command identity and actual signed HTTP delivery.
 * The create response is synthetic; no live provider connection is made. */
nativeDescribe.sequential(
  "ordinary cancellation refunds through native MySQL and signed webhooks",
  () => {
    let fixture: PaidBookingNativeFixture;
    let api: Awaited<ReturnType<typeof startApiProcessFixture>> | undefined;
    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_api_process");
    }, 60000);
    beforeEach(async () => {
      await fixture.reset();
      await fixture.seed();
      provider.db = fixture.db;
      provider.refund = null;
      provider.create
        .mockReset()
        .mockImplementation(async (request: Stripe.RefundCreateParams) => {
          provider.refund = {
            id: "re_native_cancellation",
            object: "refund",
            status: "pending",
            amount: request.amount,
            currency: "sar",
            payment_intent: request.payment_intent,
            charge: "ch_native_cancellation",
            metadata: request.metadata,
          };
          return provider.refund;
        });
      await fixture.db
        .update(schema.bookings)
        .set({
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
          stripePaymentIntentId: "pi_native_cancellation",
        })
        .where(eq(schema.bookings.id, 71));
      await fixture.db
        .update(schema.flights)
        .set({ economyAvailable: 6 })
        .where(eq(schema.flights.id, 41));
      await fixture.db.insert(schema.paymentReceipts).values({
        paymentIntentId: "pi_native_cancellation",
        bookingId: 71,
        targetId: 71,
        userId: 9,
        kind: "booking",
        amount: 20000,
        refundedAmount: 0,
        currency: "SAR",
        settlementStatus: "applied",
      });
      await fixture.db.insert(schema.ticketCoupons).values(
        [81, 82].map((passengerId, i) => ({
          bookingId: 71,
          passengerId,
          flightId: 41,
          ticketNumber: `00000000000${81 + i}`,
          couponNumber: 1,
          status: "O" as const,
        }))
      );
      await fixture.db.insert(schema.seatInventory).values(
        [81, 82].map((passengerId, i) => ({
          flightId: 41,
          seatMapId: 1,
          seatNumber: `12${i ? "B" : "A"}`,
          row: 12,
          column: i ? "B" : "A",
          cabinClass: "economy" as const,
          seatType: "window" as const,
          status: "checked_in" as const,
          bookingId: 71,
          passengerId,
          checkInNonce: `native-refund-${i}`,
          boardingPassIssued: true,
        }))
      );
      api = await startApiProcessFixture(fixture.databaseUrl);
    }, 40000);
    afterEach(async () => {
      await api?.close();
      api = undefined;
    }, 25000);
    afterAll(async () => {
      await fixture?.close();
    });

    async function deliver(
      type: string,
      object: object,
      id = `evt_refund_${randomUUID()}`
    ) {
      const body = JSON.stringify({
        id,
        object: "event",
        type,
        livemode: false,
        data: { object },
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
      expect(response.status, await response.text()).toBe(200);
    }
    const pending = () =>
      createRefund(
        { bookingId: 71, userId: 9, amount: 10000 },
        { id: 9, role: "admin" }
      );
    const charge = () =>
      deliver("charge.refunded", {
        id: "ch_native_cancellation",
        payment_intent: "pi_native_cancellation",
        amount: 20000,
        amount_refunded: 10000,
        currency: "sar",
      });

    it("commits the pending command before handoff and completes delayed partial success once despite reordered and duplicate events", async () => {
      expect(await pending()).toMatchObject({
        amount: 10000,
        status: "pending",
      });
      expect(
        await fixture.db.select().from(schema.ordinaryBookingRefunds)
      ).toMatchObject([{ bookingId: 71, amount: 10000, status: "pending" }]);
      await charge();
      expect(
        (await fixture.financialSnapshot()).receipts[0].refundedAmount
      ).toBe(0);
      const succeeded = { ...provider.refund, status: "succeeded" };
      const eventId = `evt_refund_success_${randomUUID()}`;
      await deliver("refund.updated", succeeded, eventId);
      await deliver("refund.updated", succeeded, eventId);
      await deliver("refund.updated", provider.refund);
      await charge();
      const state = await fixture.financialSnapshot();
      expect(state.bookings).toMatchObject([
        { status: "cancelled", paymentStatus: "paid", seatsReserved: false },
      ]);
      expect(state.flights.find(row => row.id === 41)?.economyAvailable).toBe(
        8
      );
      expect(state.receipts).toMatchObject([
        { refundedAmount: 10000, settlementStatus: "applied" },
      ]);
      expect(state.ledger).toHaveLength(1);
      expect(
        await fixture.db.select().from(schema.ticketCoupons)
      ).toMatchObject([{ status: "V" }, { status: "V" }]);
      expect(
        await fixture.db.select().from(schema.seatInventory)
      ).toMatchObject([
        {
          bookingId: null,
          passengerId: null,
          checkInNonce: null,
          status: "available",
          boardingPassIssued: false,
        },
        {
          bookingId: null,
          passengerId: null,
          checkInNonce: null,
          status: "available",
          boardingPassIssued: false,
        },
      ]);
      expect(
        await fixture.db.select().from(schema.bookingStatusHistory)
      ).toHaveLength(1);
      expect(
        (await fixture.db.select().from(schema.ordinaryBookingRefunds))[0]
          .completedAt
      ).toBeInstanceOf(Date);
      expect(provider.create).toHaveBeenCalledTimes(1);
    }, 60000);

    it("retains failed refunds as terminal evidence without releasing carriage", async () => {
      await pending();
      await deliver("refund.failed", { ...provider.refund, status: "failed" });
      await deliver("refund.updated", provider.refund);
      await charge();
      const state = await fixture.financialSnapshot();
      expect(state.bookings).toMatchObject([
        { status: "confirmed", seatsReserved: true },
      ]);
      expect(state.receipts[0].refundedAmount).toBe(0);
      expect(state.flights.find(row => row.id === 41)?.economyAvailable).toBe(
        6
      );
      expect(
        await fixture.db.select().from(schema.ordinaryBookingRefunds)
      ).toMatchObject([
        {
          status: "failed",
          providerStatus: "failed",
          errorCode: "provider_refund_failed",
        },
      ]);
    }, 60000);

    it("rejects zero cancellation when an onward sector has final DCS closure without changing money or capacity", async () => {
      await fixture.db.insert(schema.bookingSegments).values({
        bookingId: 71,
        segmentOrder: 2,
        flightId: 42,
        departureDate: new Date("2030-06-11T12:00:00Z"),
        status: "confirmed",
        seatsReserved: true,
      });
      await fixture.db
        .update(schema.flights)
        .set({ dcsClosedAt: new Date(), economyAvailable: 6 })
        .where(eq(schema.flights.id, 42));
      await fixture.db
        .update(schema.seatInventory)
        .set({
          status: "occupied",
          checkInNonce: null,
          boardingPassIssued: false,
        })
        .where(eq(schema.seatInventory.bookingId, 71));
      const before = await fixture.financialSnapshot();
      const [booking] = await fixture.db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, 71));
      await expect(
        fixture.db.transaction(tx => assertZeroCancellationAllowed(tx, booking))
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message:
          "Final DCS closure requires departure reconciliation before booking resources can be released",
      });
      expect(await fixture.financialSnapshot()).toEqual(before);
      expect(provider.create).not.toHaveBeenCalled();
    }, 60000);

    it("commits concurrent explicit zero-refund cancellations once and preserves later real cash evidence", async () => {
      // A synthetic fare-only invoice: no tax, surcharge or ancillary policy is
      // overwritten or presumed refundable/nonrefundable by this acceptance.
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
      await fixture.db.insert(schema.bookingFareComponents).values({
        bookingId: 71,
        tenantId: 3,
        flightId: 41,
        componentType: "base_fare",
        amount: 20000,
        currency: "SAR",
        source: "retail_offer",
        policyVersion: "native-fare-only-v1",
      });
      await fixture.db
        .update(schema.seatInventory)
        .set({
          status: "occupied",
          checkInNonce: null,
          boardingPassIssued: false,
        })
        .where(eq(schema.seatInventory.bookingId, 71));
      const quote = await getCancellationQuote(71);
      expect(quote).toMatchObject({
        refundAmount: 0,
        cancellationFee: 20000,
        policyReason: "nonrefundable_fare",
      });
      const input = {
        bookingId: 71,
        quoteHash: quote.quoteHash,
        confirmNoRefund: true as const,
        reason: "requested_by_customer",
      };
      const actor = { id: 9, role: "user", tenantId: 3 };
      const receipts = await Promise.all([
        cancelBookingWithoutRefund(input, actor),
        cancelBookingWithoutRefund(input, actor),
      ]);
      expect(receipts[1]).toEqual(receipts[0]);
      expect(await getZeroCancellationReceipt(71, actor)).toEqual(receipts[0]);
      expect(await processPendingOrdinaryRefunds()).toEqual({
        scanned: 0,
        failed: 0,
      });
      expect(provider.create).not.toHaveBeenCalled();
      let state = await fixture.financialSnapshot();
      expect(state.bookings).toMatchObject([
        { status: "cancelled", paymentStatus: "paid", seatsReserved: false },
      ]);
      expect(state.receipts).toMatchObject([
        { amount: 20000, refundedAmount: 0 },
      ]);
      expect(state.ledger).toHaveLength(0);
      expect(state.flights.find(f => f.id === 41)?.economyAvailable).toBe(8);
      expect(
        await fixture.db.select().from(schema.ticketCoupons)
      ).toMatchObject([{ status: "V" }, { status: "V" }]);
      expect(
        await fixture.db.select().from(schema.ordinaryBookingRefunds)
      ).toMatchObject([
        {
          amount: 0,
          status: "succeeded",
          providerStatus: "not_required",
          refundId: null,
        },
      ]);
      expect(
        await fixture.db.select().from(schema.bookingStatusHistory)
      ).toHaveLength(1);
      await charge();
      state = await fixture.financialSnapshot();
      expect(state.receipts[0].refundedAmount).toBe(10000);
      expect(state.ledger).toHaveLength(1);
      expect(state.flights.find(f => f.id === 41)?.economyAvailable).toBe(8);
    }, 60000);

    it("detects overdue, quarantined and falsely completed cancellation records without changing them", async () => {
      await pending();
      const readFinding = async (id: string) => {
        const query = forensicFindings.find(finding => finding.id === id)!.sql;
        const [rows] = await fixture.db.execute(sql.raw(query));
        return rows;
      };
      expect(await readFinding("ordinary_refund_worker_overdue")).toEqual([]);
      await fixture.db
        .update(schema.ordinaryBookingRefunds)
        .set({
          nextAttemptAt: new Date(Date.now() - 30 * 60_000),
        })
        .where(eq(schema.ordinaryBookingRefunds.bookingId, 71));
      expect(await readFinding("ordinary_refund_worker_overdue")).toEqual([
        { recordId: 71 },
      ]);
      await fixture.db
        .update(schema.ordinaryBookingRefunds)
        .set({
          status: "review_required",
          errorCode: "unknown_provider_outcome",
        })
        .where(eq(schema.ordinaryBookingRefunds.bookingId, 71));
      expect(await readFinding("ordinary_refund_under_review")).toEqual([
        { recordId: 71 },
      ]);
      expect(await readFinding("ordinary_refund_worker_overdue")).toEqual([]);
      await fixture.db
        .update(schema.ordinaryBookingRefunds)
        .set({
          status: "succeeded",
          completedAt: new Date(),
        })
        .where(eq(schema.ordinaryBookingRefunds.bookingId, 71));
      const before = await fixture.financialSnapshot();
      expect(await readFinding("ordinary_refund_completion_mismatch")).toEqual([
        { recordId: 71 },
      ]);
      expect(await fixture.financialSnapshot()).toEqual(before);
      await fixture.db
        .update(schema.bookings)
        .set({ status: "cancelled" })
        .where(eq(schema.bookings.id, 71));
      await fixture.db
        .update(schema.paymentReceipts)
        .set({ refundedAmount: 10000 })
        .where(
          eq(schema.paymentReceipts.paymentIntentId, "pi_native_cancellation")
        );
      expect(await readFinding("ordinary_refund_completion_mismatch")).toEqual(
        []
      );
      for (const changed of [
        { bookingId: null },
        { kind: "wallet_topup" as const },
        { userId: 10 },
        { amount: 20001 },
        { currency: "USD" },
      ]) {
        await fixture.db
          .update(schema.paymentReceipts)
          .set({
            bookingId: 71,
            kind: "booking",
            userId: 9,
            amount: 20000,
            currency: "SAR",
            ...changed,
          })
          .where(
            eq(schema.paymentReceipts.paymentIntentId, "pi_native_cancellation")
          );
        expect(
          await readFinding("ordinary_refund_completion_mismatch")
        ).toEqual([{ recordId: 71 }]);
      }
    }, 60000);
  }
);
