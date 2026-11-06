import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
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
      create: vi.fn(() => {
        throw new Error("Native finalization does not create external refunds");
      }),
      retrieve: async () => boundary.refund,
      list: () => ({
        async *[Symbol.asyncIterator]() {
          if (boundary.refund) yield boundary.refund;
        },
      }),
    },
  },
}));
import { checkInPassengers } from "../services/departure-control.service";
import {
  changeDcsFlightState,
  getDcsDesk,
  transitionDcsPassenger,
} from "../services/dcs-operations.service";
import { finalizeDesk } from "../services/dcs-station.service";
import { generateFlightManifest } from "../services/dcs.service";
import { settleVerifiedRefund } from "../services/payment-settlement.service";
import {
  processOrdinaryRefundCancellation,
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
const supervisor = { userId: 20, tenantId: 3, role: "airline_admin" };
const fullRefund = {
  paymentIntentId: "pi_finalization_native",
  chargeId: "ch_finalization_native",
  eventId: "evt_finalization_native",
  amount: 20000,
  amountRefunded: 20000,
  currency: "sar",
};
const cancellation = {
  bookingId: 71,
  actor: { id: 9, role: "user" },
  userId: 9,
  tenantId: 3,
  baseRefundedAmount: 0,
  request: {
    payment_intent: "pi_finalization_native",
    amount: 10000,
    reason: "requested_by_customer" as const,
    metadata: {
      bookingId: "71",
      refundOperationId: "booking-71-finalization-native",
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
function holdFirstBoardedRead(connection: PoolConnection) {
  const entered = deferred();
  const release = deferred();
  const query = connection.query.bind(connection);
  let held = false;
  const spy = vi.spyOn(connection, "query").mockImplementation((async (
    ...args: Parameters<typeof connection.query>
  ) => {
    const input = args[0];
    const statement = typeof input === "string" ? input : input.sql;
    if (!held && /from `dcs_passenger_states`/i.test(statement)) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return query(...args);
  }) as typeof connection.query);
  return {
    entered: entered.promise,
    release: release.resolve,
    restore: () => spy.mockRestore(),
  };
}

/** Real SQL, migrated constraints, and observable InnoDB waits. Refund objects
 * are controlled authenticated-result fixtures, not live provider evidence. */
nativeDescribe.sequential(
  "DCS finalization cash authority on native MySQL",
  () => {
    let fixture: PaidBookingNativeFixture;
    let sequence = 0;
    const command = () => ({
      idempotencyKey: `native-finalization-${++sequence}`,
      reason: "Reviewed native local departure readiness",
    });
    const input = (action: "close" | "record_out") => ({
      flightId: 41,
      action,
      ...command(),
      ...(action === "record_out" ? { offBlocksAt: now.toISOString() } : {}),
    });
    const capture = <T>(promise: Promise<T>) =>
      promise.then(
        value => ({ value, error: null }),
        error => ({ value: null, error })
      );
    const refund = () =>
      fixture.db.transaction(tx => settleVerifiedRefund(tx, fullRefund));
    async function snapshot() {
      return {
        flights: await fixture.db.select().from(schema.flights),
        bookings: await fixture.db.select().from(schema.bookings),
        seats: await fixture.db.select().from(schema.seatInventory),
        coupons: await fixture.db.select().from(schema.ticketCoupons),
        attendance: await fixture.db.select().from(schema.dcsPassengerStates),
        receipts: await fixture.db.select().from(schema.paymentReceipts),
        ledger: await fixture.db.select().from(schema.financialLedger),
        events: await fixture.db.select().from(schema.dcsOperationEvents),
        commands: await fixture.db.select().from(schema.idempotencyRequests),
      };
    }
    async function legacyCancellation(
      status: "pending" | "succeeded" = "pending"
    ) {
      boundary.refund = {
        ...cancellation.request,
        id: "re_finalization_native",
        object: "refund",
        status,
        currency: "sar",
        charge: "ch_finalization_native",
      };
      await reserveOrdinaryRefundCancellation(fixture.db, {
        ...cancellation,
        existingRefund: boundary.refund,
      });
      await processOrdinaryRefundCancellation(71, boundary.refund);
    }
    async function waitForFlightWaiter() {
      const deadline = performance.now() + 8000;
      while (performance.now() < deadline) {
        const [rows] = await fixture.admin.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='flights' AND l.INDEX_NAME='PRIMARY'",
          [fixture.databaseName]
        );
        if (Number(rows[0]?.waiting) > 0) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Expected an actual native flight PRIMARY row waiter");
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
        openId: "native-finalization-supervisor",
        tenantId: 3,
        role: "airline_admin",
      });
      await fixture.db
        .update(schema.bookings)
        .set({
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
          stripePaymentIntentId: fullRefund.paymentIntentId,
        })
        .where(eq(schema.bookings.id, 71));
      await fixture.db
        .update(schema.flights)
        .set({ economyAvailable: 6 })
        .where(eq(schema.flights.id, 41));
      await fixture.db.insert(schema.paymentReceipts).values({
        paymentIntentId: fullRefund.paymentIntentId,
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
      await checkInPassengers({
        bookingId: 71,
        flightId: 41,
        assignments: [{ passengerId: 81, seatNumber: "12A" }],
        owner: { userId: 9, tenantId: 3 },
      });
      await transitionDcsPassenger(
        { ...key, action: "board", ...command() },
        supervisor
      );
      await changeDcsFlightState(
        { flightId: 41, action: "close", ...command() },
        supervisor
      );
    }, 40000);
    afterEach(() => vi.useRealTimers());
    afterAll(async () => {
      await fixture?.close();
    });

    it("holds closure after late full refund but preserves readable physical boarding and manifest", async () => {
      await refund();
      const before = await snapshot();
      expect(before.receipts[0]).toMatchObject({
        refundedAmount: 20000,
        settlementStatus: "review_required",
        settlementError: DepartureReleaseError.boardedReason,
      });
      expect(
        (await getDcsDesk(41, supervisor)).passengers.find(
          p => p.passengerId === 81
        )?.attendanceState
      ).toBe("boarded");
      expect(
        (await generateFlightManifest(41)).manifest.passengers.list.map(
          p => p.id
        )
      ).toContain(81);
      await expect(
        finalizeDesk(input("close"), supervisor)
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringMatching(/reconciliation/i),
      });
      expect(await snapshot()).toEqual(before);
    });

    it.each(["pending", "succeeded"] as const)(
      "holds legacy boarded ordinary %s cancellation before closure",
      async status => {
        await legacyCancellation(status);
        const before = await snapshot();
        await expect(
          finalizeDesk(input("close"), supervisor)
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await snapshot()).toEqual(before);
        expect(before.receipts[0].refundedAmount).toBe(
          status === "pending" ? 0 : 10000
        );
      }
    );

    it("retains historical close replay and recovery, but denies fresh OUT after later refund", async () => {
      const close = input("close");
      const committed = await finalizeDesk(close, supervisor);
      await refund();
      const before = await snapshot();
      expect(before.receipts[0].settlementError).toBe(
        DepartureReleaseError.reason
      );
      expect(await finalizeDesk(close, supervisor)).toEqual(committed);
      expect(await snapshot()).toEqual(before);
      await expect(
        finalizeDesk(input("record_out"), supervisor)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await snapshot()).toEqual(before);
      await finalizeDesk(
        { flightId: 41, action: "reopen", ...command() },
        supervisor
      );
      for (const action of ["deplane", "offload"] as const)
        await expect(
          transitionDcsPassenger({ ...key, action, ...command() }, supervisor)
        ).resolves.toMatchObject({
          state: action === "deplane" ? "checked_in" : "offloaded",
        });
      expect((await snapshot()).receipts[0]).toMatchObject({
        refundedAmount: 20000,
        settlementStatus: "review_required",
      });
    });

    it.each(["failed", "canceled"] as const)(
      "permits close and OUT after verified %s with unchanged original cash",
      async status => {
        await legacyCancellation();
        boundary.refund.status = status;
        await processOrdinaryRefundCancellation(71, boundary.refund);
        await expect(
          finalizeDesk(input("close"), supervisor)
        ).resolves.toMatchObject({ flightId: 41 });
        await expect(
          finalizeDesk(input("record_out"), supervisor)
        ).resolves.toMatchObject({ flightId: 41 });
        const after = await snapshot();
        expect(after.receipts[0]).toMatchObject({
          refundedAmount: 0,
          settlementStatus: "applied",
        });
        expect(after.ledger).toEqual([]);
        expect(
          after.flights.find(f => f.id === 41)?.stationOffBlocksAt
        ).toEqual(now);
      }
    );

    it("waits for a real refund winner and reads its committed quarantine after the flight lock", async () => {
      const before = await snapshot();
      const settled = deferred();
      const release = deferred();
      const writer = fixture.db.transaction(async tx => {
        await settleVerifiedRefund(tx, fullRefund);
        settled.resolve();
        await release.promise;
      });
      await Promise.race([settled.promise, writer]);
      const closing = capture(finalizeDesk(input("close"), supervisor));
      try {
        await waitForFlightWaiter();
      } finally {
        release.resolve();
        await writer;
      }
      expect((await closing).error).toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringMatching(/reconciliation/i),
      });
      const after = await snapshot();
      expect(after.receipts[0]).toMatchObject({
        refundedAmount: 20000,
        settlementError: DepartureReleaseError.boardedReason,
      });
      expect(after.flights.find(f => f.id === 41)?.dcsClosedAt).toBeNull();
      expect(after.events).toEqual(before.events);
      expect(after.commands).toEqual(before.commands);
    }, 15000);

    it("does not reverse receipt locks when closure wins, then denies OUT after the waiting refund commits", async () => {
      const connection = await fixture.pool.getConnection();
      boundary.db = drizzle(connection, { schema, mode: "default" });
      const barrier = holdFirstBoardedRead(connection);
      const closing = capture(finalizeDesk(input("close"), supervisor));
      let returning: ReturnType<typeof capture> | undefined;
      try {
        await Promise.race([
          barrier.entered,
          closing.then(result => {
            if (result.error) throw result.error;
            throw new Error("Closure escaped the financial-read barrier");
          }),
        ]);
        // The writer owns booking/receipt locks before it waits on this flight.
        // A new receipt lock in the close guard would form the opposite cycle.
        returning = capture(refund());
        await waitForFlightWaiter();
      } finally {
        barrier.release();
        await closing;
        await returning;
        barrier.restore();
        boundary.db = fixture.db;
        connection.release();
      }
      expect((await closing).error).toBeNull();
      expect((await returning)!.error).toBeNull();
      const after = await snapshot();
      expect(after.flights.find(f => f.id === 41)?.dcsClosedAt).toEqual(now);
      expect(after.receipts[0]).toMatchObject({
        refundedAmount: 20000,
        settlementStatus: "review_required",
        settlementError: DepartureReleaseError.reason,
      });
      await expect(
        finalizeDesk(input("record_out"), supervisor)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await snapshot()).toEqual(after);
    }, 20000);
  }
);
