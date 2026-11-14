import { asc, eq, sql } from "drizzle-orm";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../drizzle/schema";
import { closePool } from "../db";
import { inventoryTransactionConfig } from "../services/inventory-capacity.service";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

/**
 * F10: the expired-hold sweeper (releaseExpiredLocks) must not hold range
 * locks on bookings. createBooking runs at READ COMMITTED, locks the flight
 * FOR UPDATE and then INSERTs into bookings. A sweeper transaction that scans
 * bookings under REPEATABLE READ keeps next-key locks on every scanned row and
 * the supremum, then waits for the same flight: the booking insert waits for
 * the sweeper's gap lock and InnoDB has to break the cycle, while inserts for
 * every other flight wait as long as the sweeper transaction stays open.
 *
 * Each case keeps one sweeper transaction open deterministically: another
 * transaction holds the flight row, and the cases act only after the sweeper
 * is observed waiting on InnoDB for it.
 */
const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

type LockModule = typeof import("../services/inventory-lock.service");

nativeDescribe.sequential(
  "expired hold sweeper lock order on native MySQL",
  () => {
    let fixture: PaidBookingNativeFixture;
    let locks: LockModule;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const expired = () => new Date(Date.now() - 86_400_000);
    const future = () => new Date(Date.now() + 86_400_000);

    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_confirmation");
      // The application's lazy pool must open against the disposable schema.
      process.env.DATABASE_URL = fixture.databaseUrl;
      locks = await import("../services/inventory-lock.service");
    }, 60000);

    afterAll(async () => {
      await closePool().catch(() => undefined);
      process.env.DATABASE_URL = originalDatabaseUrl;
      await fixture?.close();
    });

    beforeEach(async () => {
      await fixture.reset();
      await fixture.seed();
      // Pending booking 71 (flight 41) carries an expired checkout hold.
      await fixture.db.insert(schema.inventoryLocks).values({
        id: 501,
        flightId: 41,
        numberOfSeats: 2,
        cabinClass: "economy",
        userId: 9,
        sessionId: "sweeper-lock-order",
        status: "active",
        expiresAt: expired(),
      });
      await fixture.db
        .update(schema.bookings)
        .set({ inventoryLockId: 501 })
        .where(eq(schema.bookings.id, 71));
      await fixture.db.insert(schema.bookingSegments).values({
        bookingId: 71,
        segmentOrder: 1,
        flightId: 41,
        inventoryLockId: 501,
        departureDate: new Date("2030-06-10T12:00:00Z"),
      });
    });

    function newBooking(id: number, flightId: number) {
      return {
        id,
        tenantId: 3,
        userId: 9,
        flightId,
        bookingReference: `SW${id}`.padEnd(6, "0"),
        pnr: `PS${id}`.padEnd(6, "0"),
        totalAmount: 10000,
        cabinClass: "economy" as const,
        numberOfPassengers: 1,
        status: "pending" as const,
        paymentStatus: "pending" as const,
      };
    }

    /** Record locks currently held or requested on bookings in this schema. */
    async function bookingRecordLocks() {
      const [rows] = await fixture.admin.query<mysql.RowDataPacket[]>(
        "SELECT LOCK_MODE AS mode, LOCK_DATA AS data FROM performance_schema.data_locks WHERE OBJECT_SCHEMA=? AND OBJECT_NAME='bookings' AND LOCK_TYPE='RECORD' ORDER BY LOCK_DATA, LOCK_MODE",
        [fixture.databaseName]
      );
      return rows.map(row => `${row.mode} ${row.data}`);
    }

    async function holdStatus(id: number) {
      const [row] = await fixture.db
        .select({ status: schema.inventoryLocks.status })
        .from(schema.inventoryLocks)
        .where(eq(schema.inventoryLocks.id, id));
      return row?.status;
    }

    it("lets createBooking's flight-then-insert order finish while a sweeper waits on that flight", async () => {
      let flightLocked: () => void = () => undefined;
      const locked = new Promise<void>(resolve => {
        flightLocked = resolve;
      });
      let sweeperLocks: string[] = [];
      // createBooking's order and isolation: flight FOR UPDATE, then INSERT.
      const booking = fixture.db.transaction(async tx => {
        await tx.execute(sql`SET SESSION innodb_lock_wait_timeout = 5`);
        await tx
          .select({ id: schema.flights.id })
          .from(schema.flights)
          .where(eq(schema.flights.id, 41))
          .for("update");
        flightLocked();
        // Insert only once the sweeper's transaction waits for this flight.
        await fixture.waitForBlockedTransactions(1);
        sweeperLocks = await bookingRecordLocks();
        await tx.insert(schema.bookings).values(newBooking(72, 41));
        return "inserted" as const;
      }, inventoryTransactionConfig);
      await Promise.race([locked, booking]);
      const sweep = locks.releaseExpiredLocks();

      const [inserted, swept] = await Promise.allSettled([booking, sweep]);
      expect({ inserted, swept, sweeperLocks }).toEqual({
        inserted: { status: "fulfilled", value: "inserted" },
        swept: { status: "fulfilled", value: 1 },
        // Only the linked booking's record; no gap or supremum lock.
        sweeperLocks: ["X,REC_NOT_GAP 71"],
      });
      expect(await holdStatus(501)).toBe("expired");
      const [created] = await fixture.db
        .select({ id: schema.bookings.id })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, 72));
      expect(created).toEqual({ id: 72 });
    });

    it("does not block booking inserts for another flight while a sweeper transaction is open", async () => {
      let flightLocked: () => void = () => undefined;
      const locked = new Promise<void>(resolve => {
        flightLocked = resolve;
      });
      let finish: () => void = () => undefined;
      const finished = new Promise<void>(resolve => {
        finish = resolve;
      });
      // Keeps the sweeper's transaction open between its bookings read and
      // its flight lock, as any writer of flight 41 would.
      const holder = fixture.db.transaction(async tx => {
        await tx
          .select({ id: schema.flights.id })
          .from(schema.flights)
          .where(eq(schema.flights.id, 41))
          .for("update");
        flightLocked();
        await finished;
      }, inventoryTransactionConfig);
      await Promise.race([locked, holder]);
      const sweep = locks.releaseExpiredLocks();
      try {
        await fixture.waitForBlockedTransactions(1);
      } catch (error) {
        finish();
        await Promise.allSettled([holder, sweep]);
        throw error;
      }

      const otherFlight = await Promise.allSettled([
        fixture.db.transaction(async tx => {
          await tx.execute(sql`SET SESSION innodb_lock_wait_timeout = 2`);
          await tx.insert(schema.bookings).values(newBooking(73, 42));
          return "inserted" as const;
        }, inventoryTransactionConfig),
      ]);
      finish();
      const [, swept] = await Promise.allSettled([holder, sweep]);
      expect({ otherFlight: otherFlight[0], swept }).toEqual({
        otherFlight: { status: "fulfilled", value: "inserted" },
        swept: { status: "fulfilled", value: 1 },
      });
      expect(await holdStatus(501)).toBe("expired");
    });

    it("releases exactly the expired holds, seats and passenger seats it released before", async () => {
      // 502: flight 42 hold linked to booking 73 only through its second
      // segment. 503: booking 73's unexpired primary hold. 504: paid booking.
      // 505: already converted. 506: expired with no booking.
      await fixture.db.insert(schema.inventoryLocks).values(
        [
          { id: 502, flightId: 42, status: "active" as const, at: expired() },
          { id: 503, flightId: 41, status: "active" as const, at: future() },
          { id: 504, flightId: 41, status: "active" as const, at: expired() },
          {
            id: 505,
            flightId: 41,
            status: "converted" as const,
            at: expired(),
          },
          { id: 506, flightId: 42, status: "active" as const, at: expired() },
        ].map(hold => ({
          id: hold.id,
          flightId: hold.flightId,
          numberOfSeats: 1,
          cabinClass: "economy" as const,
          userId: 9,
          sessionId: `sweeper-${hold.id}`,
          status: hold.status,
          expiresAt: hold.at,
        }))
      );
      await fixture.db.insert(schema.bookings).values([
        { ...newBooking(73, 41), inventoryLockId: 503 },
        {
          ...newBooking(74, 41),
          inventoryLockId: 504,
          status: "confirmed" as const,
          paymentStatus: "paid" as const,
          seatsReserved: true,
        },
        { ...newBooking(75, 42), inventoryLockId: 505 },
        newBooking(76, 42),
      ]);
      await fixture.db.insert(schema.bookingSegments).values(
        [
          {
            bookingId: 73,
            segmentOrder: 1,
            flightId: 41,
            inventoryLockId: 503,
          },
          {
            bookingId: 73,
            segmentOrder: 2,
            flightId: 42,
            inventoryLockId: 502,
          },
          {
            bookingId: 74,
            segmentOrder: 1,
            flightId: 41,
            inventoryLockId: 504,
          },
        ].map(segment => ({
          ...segment,
          departureDate: new Date("2030-06-10T12:00:00Z"),
        }))
      );
      await fixture.db
        .update(schema.passengers)
        .set({ seatNumber: "1A" })
        .where(eq(schema.passengers.id, 81));
      await fixture.db
        .update(schema.passengers)
        .set({ seatNumber: "1B" })
        .where(eq(schema.passengers.id, 82));
      await fixture.db.insert(schema.passengers).values(
        [
          { id: 83, bookingId: 73, seatNumber: "2A" },
          { id: 84, bookingId: 74, seatNumber: "3A" },
          { id: 85, bookingId: 75, seatNumber: "4A" },
          { id: 86, bookingId: 76, seatNumber: "5A" },
        ].map(passenger => ({
          ...passenger,
          tenantId: 3,
          firstName: `P${passenger.id}`,
          lastName: "Sweeper",
          type: "adult" as const,
        }))
      );
      const seats: Array<
        [number, number, string, "held" | "occupied", number, number]
      > = [
        [601, 41, "1A", "held", 71, 81],
        [602, 41, "1B", "occupied", 71, 82],
        [603, 41, "2A", "held", 73, 83],
        [604, 42, "2A", "held", 73, 83],
        [605, 41, "3A", "occupied", 74, 84],
        [606, 42, "4A", "held", 75, 85],
        [607, 42, "5A", "held", 76, 86],
      ];
      await fixture.db.insert(schema.seatInventory).values(
        seats.map(
          ([id, flightId, seatNumber, status, bookingId, passengerId]) => ({
            id,
            flightId,
            seatMapId: 1,
            seatNumber,
            row: Number.parseInt(seatNumber, 10),
            column: seatNumber.slice(-1),
            cabinClass: "economy" as const,
            seatType: "window" as const,
            status,
            bookingId,
            passengerId,
            assignedAt: new Date(),
          })
        )
      );
      const bookingsBefore = await fixture.db
        .select()
        .from(schema.bookings)
        .orderBy(asc(schema.bookings.id));

      expect(await locks.releaseExpiredLocks()).toBe(4);

      const holds = await fixture.db
        .select({
          id: schema.inventoryLocks.id,
          status: schema.inventoryLocks.status,
          releasedAt: schema.inventoryLocks.releasedAt,
        })
        .from(schema.inventoryLocks)
        .orderBy(asc(schema.inventoryLocks.id));
      expect(
        holds.map(hold => [hold.id, hold.status, hold.releasedAt !== null])
      ).toEqual([
        [501, "expired", true],
        [502, "expired", true],
        [503, "active", false],
        [504, "expired", true],
        [505, "converted", false],
        [506, "expired", true],
      ]);
      const seatsAfter = await fixture.db
        .select({
          id: schema.seatInventory.id,
          status: schema.seatInventory.status,
          bookingId: schema.seatInventory.bookingId,
          passengerId: schema.seatInventory.passengerId,
          assigned: schema.seatInventory.assignedAt,
        })
        .from(schema.seatInventory)
        .orderBy(asc(schema.seatInventory.id));
      expect(
        seatsAfter.map(seat => [
          seat.id,
          seat.status,
          seat.bookingId,
          seat.passengerId,
          seat.assigned !== null,
        ])
      ).toEqual([
        // Booking 71 through its own hold 501.
        [601, "available", null, null, false],
        [602, "available", null, null, false],
        // Booking 73's flight 41 seat belongs to its unexpired hold 503.
        [603, "held", 73, 83, true],
        // Booking 73's flight 42 seat, linked to 502 only by its segment.
        [604, "available", null, null, false],
        // Paid booking, converted hold and unrelated booking keep their seats.
        [605, "occupied", 74, 84, true],
        [606, "held", 75, 85, true],
        [607, "held", 76, 86, true],
      ]);
      const passengersAfter = await fixture.db
        .select({
          id: schema.passengers.id,
          seatNumber: schema.passengers.seatNumber,
        })
        .from(schema.passengers)
        .orderBy(asc(schema.passengers.id));
      expect(passengersAfter).toEqual([
        { id: 81, seatNumber: null },
        { id: 82, seatNumber: null },
        // Booking 73's primary flight is 41, not the swept hold's flight 42.
        { id: 83, seatNumber: "2A" },
        { id: 84, seatNumber: "3A" },
        { id: 85, seatNumber: "4A" },
        { id: 86, seatNumber: "5A" },
      ]);
      expect(
        await fixture.db
          .select()
          .from(schema.bookings)
          .orderBy(asc(schema.bookings.id))
      ).toEqual(bookingsBefore);
      expect(await locks.releaseExpiredLocks()).toBe(0);
    });
  }
);
