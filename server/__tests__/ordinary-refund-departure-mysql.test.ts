import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import type { RowDataPacket } from "mysql2";
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

const boundary = vi.hoisted(() => ({ db: null as any, refund: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../stripe", () => ({
  stripe: {
    refunds: {
      create: async (request: any) => {
        boundary.refund = {
          id: "re_native_departure_hold",
          object: "refund",
          status: "pending",
          amount: request.amount,
          currency: "sar",
          payment_intent: request.payment_intent,
          charge: "ch_native_departure_hold",
          metadata: request.metadata,
        };
        return boundary.refund;
      },
      retrieve: async () => boundary.refund,
      list: () => ({
        async *[Symbol.asyncIterator]() {
          if (boundary.refund) yield boundary.refund;
        },
      }),
    },
  },
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import {
  checkInPassengers,
  checkInPassengersTx,
} from "../services/departure-control.service";
import { transitionDcsPassenger } from "../services/dcs-operations.service";
import {
  issueBoardingPass,
  verifyActiveBoardingPass,
} from "../services/boarding-pass.service";
import {
  processOrdinaryRefundCancellation,
  recordVerifiedOrdinaryRefund,
  reserveOrdinaryRefundCancellation,
} from "../services/ordinary-refund.service";
import { DepartureReleaseError } from "../services/booking-settlement.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
const now = new Date("2030-06-10T06:00:00Z");
const key = { bookingId: 71, passengerId: 81, flightId: 41 };
const owner = { userId: 9, tenantId: 3, role: "user" };
const operator = { userId: 20, tenantId: 3, role: "ops" };
const admission = {
  bookingId: key.bookingId,
  flightId: key.flightId,
  assignments: [{ passengerId: key.passengerId, seatNumber: "12A" }],
  owner,
};
const request = {
  bookingId: 71,
  actor: { id: 9, role: "user" },
  userId: 9,
  tenantId: 3,
  baseRefundedAmount: 0,
  request: {
    payment_intent: "pi_native_departure_hold",
    amount: 10000,
    reason: "requested_by_customer" as const,
    metadata: {
      bookingId: "71",
      refundOperationId: "booking-71-cancel-pi_native_departure_hold",
    },
  },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Real migrated MySQL tables and application transactions. Only provider
 * responses are controlled; no external provider acceptance is claimed. */
nativeDescribe.sequential(
  "ordinary refunds serialize departure admission on native MySQL",
  () => {
    let fixture: PaidBookingNativeFixture;
    let sequence = 0;
    const command = () => ({
      idempotencyKey: `native-refund-departure-${++sequence}`,
      reason: "Native cancellation admission regression",
    });
    const board = () =>
      transitionDcsPassenger(
        { ...key, action: "board", ...command() },
        operator
      );
    const checkIn = () => checkInPassengers(admission);
    const capture = <T>(promise: Promise<T>) =>
      promise.then(
        value => ({ value, error: null }),
        error => ({ value: null, error })
      );

    // Observe an actual InnoDB wait on this booking, not elapsed timing. Date is
    // fixed for departure eligibility, so this deadline uses a monotonic clock.
    async function waitForBookingWaiter() {
      const deadline = performance.now() + 8000;
      while (performance.now() < deadline) {
        const [rows] = await fixture.admin.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='bookings' AND l.INDEX_NAME='PRIMARY'",
          [fixture.databaseName]
        );
        if (Number(rows[0]?.waiting) > 0) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Expected an actual native booking-row waiter");
    }

    async function pending() {
      await reserveOrdinaryRefundCancellation(fixture.db, request);
      expect((await processOrdinaryRefundCancellation(71)).status).toBe(
        "pending"
      );
    }
    async function snapshot() {
      return {
        booking: await fixture.db.select().from(schema.bookings),
        seats: await fixture.db.select().from(schema.seatInventory),
        coupons: await fixture.db.select().from(schema.ticketCoupons),
        attendance: await fixture.db.select().from(schema.dcsPassengerStates),
        receipt: await fixture.db.select().from(schema.paymentReceipts),
        ledger: await fixture.db.select().from(schema.financialLedger),
      };
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
      boundary.db = fixture.db;
      boundary.refund = null;
      await fixture.db.insert(schema.users).values({
        id: 20,
        openId: "native-departure-operator",
        tenantId: 3,
        role: "ops",
      });
      await fixture.db
        .update(schema.bookings)
        .set({
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
          stripePaymentIntentId: request.request.payment_intent,
        })
        .where(eq(schema.bookings.id, 71));
      await fixture.db
        .update(schema.flights)
        .set({ economyAvailable: 6 })
        .where(eq(schema.flights.id, 41));
      await fixture.db.insert(schema.paymentReceipts).values({
        paymentIntentId: request.request.payment_intent,
        bookingId: 71,
        targetId: 71,
        userId: 9,
        kind: "booking",
        amount: 20000,
        refundedAmount: 0,
        currency: "SAR",
        settlementStatus: "applied",
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

    it("waits behind a real cancellation reservation and rejects check-in after its commit", async () => {
      const reserved = deferred();
      const release = deferred();
      const writer = fixture.db.transaction(async tx => {
        await reserveOrdinaryRefundCancellation(tx, request);
        reserved.resolve();
        await release.promise;
      });
      await Promise.race([reserved.promise, writer]);
      const contender = capture(checkIn());
      try {
        await waitForBookingWaiter();
      } finally {
        release.resolve();
        await writer;
      }
      expect((await contender).error).toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      const state = await snapshot();
      expect(state.booking[0]).toMatchObject({
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        checkedIn: false,
      });
      expect(state.seats.every(seat => seat.status === "available")).toBe(true);
      expect(state.coupons.every(coupon => coupon.status === "O")).toBe(true);
      expect(state.attendance).toEqual([]);
      expect(state.ledger).toEqual([]);
      expect(state.receipt[0].refundedAmount).toBe(0);
      expect(
        await fixture.db.select().from(schema.ordinaryBookingRefunds)
      ).toHaveLength(1);
    }, 15000);

    it("waits behind actual boarding and refuses a new refund after boarding commits first", async () => {
      await checkIn();
      const boarded = deferred();
      const release = deferred();
      const writer = fixture.db.transaction(async tx => {
        // Run the real DCS command in an owned outer transaction so its actual
        // booking/flight/attendance locks remain held until the race barrier.
        boundary.db = tx;
        try {
          await expect(board()).resolves.toMatchObject({ state: "boarded" });
        } finally {
          boundary.db = fixture.db;
        }
        boarded.resolve();
        await release.promise;
      });
      await Promise.race([boarded.promise, writer]);
      const contender = capture(
        reserveOrdinaryRefundCancellation(fixture.db, request)
      );
      try {
        await waitForBookingWaiter();
      } finally {
        release.resolve();
        await writer;
      }
      expect((await contender).error).toMatchObject({
        code: "PRECONDITION_FAILED",
        message: DepartureReleaseError.boardedReason,
      });
      const state = await snapshot();
      expect(state.booking[0]).toMatchObject({
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
      });
      expect(state.attendance).toMatchObject([
        { passengerId: 81, state: "boarded" },
      ]);
      expect(state.seats.find(seat => seat.passengerId === 81)?.status).toBe(
        "checked_in"
      );
      expect(
        state.coupons.find(coupon => coupon.passengerId === 81)?.status
      ).toBe("C");
      expect(state.receipt[0].refundedAmount).toBe(0);
      expect(state.ledger).toEqual([]);
      expect(
        await fixture.db.select().from(schema.ordinaryBookingRefunds)
      ).toEqual([]);
      expect(boundary.refund).toBeNull();
    }, 15000);

    it("uses current boarded attendance after a prior REPEATABLE READ snapshot", async () => {
      await checkIn();
      const read = deferred();
      const boarded = deferred();
      const contender = capture(
        fixture.db.transaction(
          async tx => {
            expect(
              await tx.select().from(schema.dcsPassengerStates)
            ).toMatchObject([{ passengerId: 81, state: "checked_in" }]);
            read.resolve();
            await boarded.promise;
            return reserveOrdinaryRefundCancellation(tx, request);
          },
          { isolationLevel: "repeatable read" }
        )
      );
      await read.promise;
      try {
        await board();
      } finally {
        boarded.resolve();
      }
      expect((await contender).error).toMatchObject({
        code: "PRECONDITION_FAILED",
        message: DepartureReleaseError.boardedReason,
      });
      expect(
        await fixture.db.select().from(schema.ordinaryBookingRefunds)
      ).toEqual([]);
      expect((await snapshot()).attendance).toMatchObject([
        { passengerId: 81, state: "boarded" },
      ]);
      expect(boundary.refund).toBeNull();
    }, 15000);

    it("records a late authenticated refund while retaining boarded carriage and deplane/offload recovery", async () => {
      await checkIn();
      await board();
      const before = await snapshot();
      const refund = {
        ...request.request,
        id: "re_native_late_boarded",
        object: "refund" as const,
        status: "succeeded" as const,
        currency: "sar",
        charge: "ch_native_late_boarded",
      } as any;
      await reserveOrdinaryRefundCancellation(fixture.db, {
        ...request,
        existingRefund: refund,
      });
      await processOrdinaryRefundCancellation(71, refund);
      const after = await snapshot();
      for (const field of [
        "booking",
        "seats",
        "coupons",
        "attendance",
      ] as const)
        expect(after[field]).toEqual(before[field]);
      expect(after.receipt[0]).toMatchObject({
        refundedAmount: 10000,
        settlementStatus: "review_required",
        settlementError: DepartureReleaseError.boardedReason,
      });
      expect(after.ledger).toMatchObject([
        { type: "partial_refund", amount: "100.00" },
      ]);
      expect(
        await fixture.db.select().from(schema.ordinaryBookingRefunds)
      ).toMatchObject([
        {
          status: "review_required",
          errorCode: "cancellation_reconciliation_required",
          completedAt: null,
        },
      ]);
      for (const action of ["deplane", "offload"] as const)
        await expect(
          transitionDcsPassenger({ ...key, action, ...command() }, operator)
        ).resolves.toMatchObject({
          state: action === "deplane" ? "checked_in" : "offloaded",
        });
      const recovered = await snapshot();
      expect(recovered.attendance).toMatchObject([
        { passengerId: 81, state: "offloaded" },
      ]);
      expect(
        recovered.coupons.find(coupon => coupon.passengerId === 81)?.status
      ).toBe("O");
      expect(recovered.booking[0]).toMatchObject({
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
      });
      expect(recovered.receipt[0]).toMatchObject({
        refundedAmount: 10000,
        settlementStatus: "review_required",
      });
      expect(recovered.ledger).toHaveLength(1);
      expect(boundary.refund).toBeNull();
    });

    it("blocks boarding and old pass use during pending cash while retaining offload", async () => {
      await checkIn();
      const pass = await issueBoardingPass(key, owner);
      expect(await verifyActiveBoardingPass(pass.token)).toMatchObject({
        valid: true,
      });
      await pending();
      const before = await snapshot();
      await expect(board()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(await verifyActiveBoardingPass(pass.token)).toMatchObject({
        valid: false,
      });
      await expect(issueBoardingPass(key, owner)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(await snapshot()).toEqual(before);
      await expect(
        transitionDcsPassenger(
          { ...key, action: "offload", ...command() },
          operator
        )
      ).resolves.toMatchObject({ state: "offloaded" });
      const after = await snapshot();
      expect(after.receipt[0].refundedAmount).toBe(0);
      expect(after.ledger).toEqual([]);
      expect(
        await fixture.db.select().from(schema.ordinaryBookingRefunds)
      ).toMatchObject([{ status: "pending" }]);
    });

    it("waits behind verified completion and cannot board the canceled carriage", async () => {
      await checkIn();
      await pending();
      const completed = deferred();
      const release = deferred();
      const writer = fixture.db.transaction(async tx => {
        await recordVerifiedOrdinaryRefund(
          tx,
          { ...boundary.refund, status: "succeeded" },
          "evt_native_departure_completion"
        );
        completed.resolve();
        await release.promise;
      });
      await Promise.race([completed.promise, writer]);
      const contender = capture(board());
      try {
        await waitForBookingWaiter();
      } finally {
        release.resolve();
        await writer;
      }
      expect((await contender).error).toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      const state = await snapshot();
      expect(state.booking[0]).toMatchObject({
        status: "cancelled",
        paymentStatus: "paid",
        seatsReserved: false,
      });
      expect(state.receipt[0].refundedAmount).toBe(10000);
      expect(
        state.attendance.every(passenger => passenger.state !== "boarded")
      ).toBe(true);
      expect(state.coupons.every(coupon => coupon.status === "V")).toBe(true);
    }, 15000);

    it.each(["failed", "canceled"] as const)(
      "restores admission only after native verified %s with unchanged clean cash",
      async status => {
        await pending();
        boundary.refund.status = status;
        await processOrdinaryRefundCancellation(71);
        expect(
          await fixture.db.select().from(schema.ordinaryBookingRefunds)
        ).toMatchObject([
          { status: "failed", providerStatus: status, completedAt: null },
        ]);
        await checkIn();
        await expect(board()).resolves.toMatchObject({ state: "boarded" });
        const state = await snapshot();
        expect(state.receipt[0]).toMatchObject({
          refundedAmount: 0,
          settlementStatus: "applied",
        });
        expect(state.ledger).toEqual([]);
      }
    );

    it("keeps failed commands held when receipt cash evidence has changed", async () => {
      await pending();
      boundary.refund.status = "failed";
      await processOrdinaryRefundCancellation(71);
      await fixture.db
        .update(schema.paymentReceipts)
        .set({ refundedAmount: 10000 })
        .where(
          eq(
            schema.paymentReceipts.paymentIntentId,
            request.request.payment_intent
          )
        );
      const before = await snapshot();
      await expect(checkIn()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(await snapshot()).toEqual(before);
    });

    it("uses current command evidence even after a prior REPEATABLE READ snapshot", async () => {
      const read = deferred();
      const reserved = deferred();
      const contender = capture(
        fixture.db.transaction(
          async tx => {
            expect(
              await tx.select().from(schema.ordinaryBookingRefunds)
            ).toEqual([]);
            read.resolve();
            await reserved.promise;
            return checkInPassengersTx(tx, admission);
          },
          { isolationLevel: "repeatable read" }
        )
      );
      await read.promise;
      try {
        await pending();
      } finally {
        reserved.resolve();
      }
      expect((await contender).error).toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(
        (await snapshot()).seats.every(seat => seat.status === "available")
      ).toBe(true);
    }, 15000);
  }
);
