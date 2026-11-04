import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { airports, bookings, flights, passengers } from "../../drizzle/schema";
import { authorityRelationalFixture } from "../__tests__/helpers/authority-relational-fixture";
import { retainedPurgeSources } from "../__tests__/fixtures/booking-purge.fixture";
import { getTableName } from "drizzle-orm";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  getDeletedBookings,
  getDeletedBookingsCount,
  purgeDeletedBookings,
  restoreBooking,
  softDeleteBooking,
} from "./soft-delete.service";

let fixture: ReturnType<typeof authorityRelationalFixture>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-07-01T00:00:00.000Z"));
  fixture = authorityRelationalFixture([
    bookings,
    passengers,
    flights,
    airports,
    ...retainedPurgeSources.map(source => source.table),
  ]);
  state.db = fixture.db;
  fixture.insert(bookings, {
    id: 1,
    userId: 7,
    flightId: 1,
    status: "cancelled",
    deletedAt: "2030-01-01 00:00:00",
  });
  fixture.insert(bookings, {
    id: 2,
    userId: 8,
    flightId: 1,
    status: "cancelled",
    deletedAt: null,
  });
  fixture.insert(passengers, { id: 10, bookingId: 1, firstName: "Owned" });
  fixture.insert(passengers, { id: 20, bookingId: 2, firstName: "Retained" });
});
afterEach(() => {
  state.db = null;
  fixture.close();
  vi.useRealTimers();
});

describe("booking deletion authority over executing relational SQL", () => {
  it.each(
    retainedPurgeSources.map(source => ({
      ...source,
      name: getTableName(source.table),
    }))
  )(
    "retains existing $name evidence while deleting a genuinely unreferenced eligible booking",
    async ({ table, bookingColumn }) => {
      fixture.insert(table, { [bookingColumn]: 1 });
      const retained = fixture.rows(table);
      fixture.sqlite.exec(
        "UPDATE bookings SET deletedAt = '2030-01-01 00:00:00.000' WHERE id = 2"
      );
      expect(await purgeDeletedBookings()).toEqual({ purgedCount: 1 });
      expect(fixture.rows(bookings).map(row => row.id)).toEqual([1]);
      expect(fixture.rows(passengers).map(row => row.id)).toEqual([10]);
      expect(fixture.rows(table)).toEqual(retained);
    }
  );

  it.each(
    retainedPurgeSources
      .filter(source => source.passengerColumn)
      .map(source => ({ ...source, name: getTableName(source.table) }))
  )(
    "retains a passenger referenced by $name even when the document names another booking",
    async ({ table, bookingColumn }) => {
      fixture.insert(table, { [bookingColumn]: 2, passengerId: 10 });
      expect(await purgeDeletedBookings()).toEqual({ purgedCount: 0 });
      expect(fixture.rows(bookings)).toHaveLength(2);
      expect(fixture.rows(passengers)).toHaveLength(2);
    }
  );

  it.each([
    ["paymentStatus", "paid"],
    ["paymentStatus", "refunded"],
    ["stripePaymentIntentId", "pi_synthetic_legacy"],
    ["stripeCheckoutSessionId", "cs_synthetic_legacy"],
  ])(
    "retains legacy booking evidence in %s without requiring a newer receipt table row",
    async (column, value) => {
      fixture.sqlite
        .prepare(`UPDATE bookings SET \`${column}\` = ? WHERE id = 1`)
        .run(value);
      expect(await purgeDeletedBookings()).toEqual({ purgedCount: 0 });
      expect(fixture.rows(passengers)).toHaveLength(2);
    }
  );

  it("retains a legacy passenger ticket number without inventing a coupon receipt", async () => {
    fixture.sqlite
      .prepare("UPDATE passengers SET ticketNumber = ? WHERE id = 10")
      .run("0010000000001");
    expect(await purgeDeletedBookings()).toEqual({ purgedCount: 0 });
    expect(fixture.rows(bookings)).toHaveLength(2);
    expect(fixture.rows(passengers)).toHaveLength(2);
  });

  it("rolls back passenger deletion when the booking is protected by a retained financial reference", async () => {
    fixture.sqlite.exec(
      "CREATE TABLE retained_receipt (bookingId INTEGER REFERENCES bookings(id) ON DELETE RESTRICT); INSERT INTO retained_receipt VALUES (1)"
    );
    await expect(purgeDeletedBookings()).rejects.toThrow();
    expect(fixture.rows(bookings).map(row => row.id)).toEqual([1, 2]);
    expect(fixture.rows(passengers).map(row => row.id)).toEqual([10, 20]);
    expect(
      fixture.sqlite.prepare("SELECT * FROM retained_receipt").all()
    ).toEqual([{ bookingId: 1 }]);
  });

  it("deletes only the selected locked batch even if another booking becomes eligible during the operation", async () => {
    // This trigger models an eligibility change between the two SQL deletes.
    // It is an exact-batch proof, not a simulation of MySQL row locking.
    fixture.sqlite.exec(
      "CREATE TRIGGER newly_eligible AFTER DELETE ON passengers WHEN OLD.id = 10 BEGIN UPDATE bookings SET deletedAt = '2030-01-01 00:00:00.000' WHERE id = 2; END"
    );
    expect(await purgeDeletedBookings()).toEqual({ purgedCount: 1 });
    expect(fixture.rows(bookings).map(row => row.id)).toEqual([2]);
    expect(fixture.rows(passengers).map(row => row.id)).toEqual([20]);
    const selection = fixture.queries.find(query =>
      /from `bookings`/.test(query.sql)
    );
    expect(selection).toMatchObject({ inTransaction: true });
    expect(selection?.sql).toMatch(/for update$/i);
  });

  it("retains recent, restored and exact-cutoff bookings", async () => {
    fixture.sqlite.exec(
      "UPDATE bookings SET deletedAt = '2030-04-02 00:00:00.000' WHERE id = 1"
    );
    expect(await purgeDeletedBookings(90)).toEqual({ purgedCount: 0 });
    expect(fixture.rows(passengers)).toHaveLength(2);
    fixture.sqlite.exec(
      "UPDATE bookings SET deletedAt = '2030-04-01 23:59:59.999' WHERE id = 1"
    );
    expect(await purgeDeletedBookings(90)).toEqual({ purgedCount: 1 });
    expect(fixture.rows(bookings).map(row => row.id)).toEqual([2]);
  });

  it.each([0, -1, 29, 30.5, 366, NaN, Infinity])(
    "rejects invalid retention %s before reading or deleting records",
    async retention => {
      await expect(purgeDeletedBookings(retention)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(fixture.queries).toHaveLength(0);
      expect(fixture.rows(bookings)).toHaveLength(2);
      expect(fixture.rows(passengers)).toHaveLength(2);
    }
  );

  it("checks ownership and cancellation while holding the booking lock", async () => {
    await expect(softDeleteBooking(2, 7, false)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    fixture.sqlite.exec(
      "UPDATE bookings SET status = 'confirmed' WHERE id = 2"
    );
    await expect(softDeleteBooking(2, 8, false)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(fixture.rows(bookings)[1].deletedAt).toBeNull();
    fixture.sqlite.exec(
      "UPDATE bookings SET status = 'cancelled' WHERE id = 2"
    );
    expect(await softDeleteBooking(2, 8, false)).toEqual({
      success: true,
      bookingId: 2,
    });
    expect(fixture.rows(bookings)[1].deletedAt).toBe("2030-07-01 00:00:00.000");
    expect(
      fixture.queries
        .filter(query => query.sql.startsWith("select"))
        .every(query => query.inTransaction && /for update$/i.test(query.sql))
    ).toBe(true);
  });

  it("keeps the administrative override and holds a booking lock for restoration", async () => {
    fixture.sqlite.exec(
      "UPDATE bookings SET status = 'confirmed' WHERE id = 2"
    );
    expect(await softDeleteBooking(2, 7, true)).toEqual({
      success: true,
      bookingId: 2,
    });
    expect(await restoreBooking(2)).toEqual({ success: true, bookingId: 2 });
    expect(fixture.rows(bookings)[1].deletedAt).toBeNull();
    await expect(restoreBooking(2)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(restoreBooking(404)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(softDeleteBooking(404, 7, true)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      fixture.queries
        .filter(query => query.sql.startsWith("select"))
        .every(query => query.inTransaction && /for update$/i.test(query.sql))
    ).toBe(true);
  });

  it("lists only deleted bookings and counts them without passenger join duplication", async () => {
    fixture.insert(airports, { id: 1, code: "AAA" });
    fixture.insert(airports, { id: 2, code: "BBB" });
    fixture.insert(flights, {
      id: 1,
      originId: 1,
      destinationId: 2,
      flightNumber: "SYN001",
      departureTime: "2030-01-02 00:00:00",
    });
    fixture.insert(passengers, { id: 11, bookingId: 1, firstName: "Another" });
    expect(await getDeletedBookingsCount()).toBe(1);
    const rows = await getDeletedBookings({ limit: 1, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, origin: "AAA", destination: "BBB" });
    expect(await getDeletedBookings({ offset: 1 })).toEqual([]);
  });

  it("refuses every operation without database availability", async () => {
    state.db = null;
    for (const operation of [
      () => softDeleteBooking(1, 7, true),
      () => restoreBooking(1),
      () => getDeletedBookings(),
      () => getDeletedBookingsCount(),
      () => purgeDeletedBookings(),
    ])
      await expect(operation()).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
  });
});
