import { DatabaseSync } from "node:sqlite";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import { settleVerifiedRefund } from "../services/payment-settlement.service";
import { unresolvedCounterBaggageFlightCondition } from "../services/baggage-sector-scope";
import { reconcileBaggageCloseout } from "../services/baggage-custody.service";

function seed() {
  return {
    bookings: [
      {
        id: 7,
        userId: 1,
        tenantId: 3,
        flightId: 31,
        status: "confirmed",
        paymentStatus: "paid",
        deletedAt: null,
        checkedIn: true,
        seatsReserved: true,
        cabinClass: "economy",
        numberOfPassengers: 1,
      },
    ],
    passengers: [{ id: 11, bookingId: 7, tenantId: 3, seatNumber: "1A" }],
    flights: [{ id: 31, tenantId: 3, economyAvailable: 9 }],
    booking_segments: [
      {
        id: 21,
        bookingId: 7,
        flightId: 31,
        status: "confirmed",
        seatsReserved: true,
        segmentOrder: 1,
        fareClassId: null,
      },
    ],
    seat_inventory: [
      {
        id: 51,
        bookingId: 7,
        passengerId: 11,
        flightId: 31,
        status: "checked_in",
        checkedInAt: new Date(),
      },
    ],
    baggage_items: [
      {
        id: 71,
        bookingId: 7,
        passengerId: 11,
        flightId: 31,
        segmentId: 21,
        tagNumber: "0123000071",
        weight: "10.00",
        status: "checked_in",
      },
    ],
    baggage_custody_events: [],
    payment_receipts: [
      {
        paymentIntentId: "pi_ticket",
        kind: "booking",
        bookingId: 7,
        targetId: 7,
        userId: 1,
        amount: 5000,
        currency: "SAR",
        refundedAmount: 0,
        settlementStatus: "applied",
      },
    ],
  };
}

// Execute the production SQL predicate over relational rows. This is a query
// semantics test, not a substitute for MySQL transaction isolation acceptance.
function unresolved(data: Record<string, any[]>, flightId = 31) {
  const database = new DatabaseSync(":memory:");
  const tables: Record<string, string[]> = {
    bookings: [
      "id",
      "userId",
      "tenantId",
      "flightId",
      "status",
      "paymentStatus",
      "deletedAt",
    ],
    passengers: ["id", "bookingId", "tenantId"],
    flights: ["id", "tenantId"],
    booking_segments: [
      "id",
      "bookingId",
      "flightId",
      "status",
      "seatsReserved",
    ],
    baggage_items: [
      "id",
      "bookingId",
      "passengerId",
      "flightId",
      "segmentId",
      "tagNumber",
      "status",
    ],
  };
  try {
    for (const [table, columns] of Object.entries(tables)) {
      database.exec(`CREATE TABLE ${table} (${columns.join(", ")})`);
      const insert = database.prepare(
        `INSERT INTO ${table} VALUES (${columns.map(() => "?").join(",")})`
      );
      for (const row of data[table] ?? [])
        insert.run(
          ...columns.map(column => {
            const value = row[column];
            return value == null
              ? null
              : typeof value === "boolean"
                ? Number(value)
                : value;
          })
        );
    }
    const condition = unresolvedCounterBaggageFlightCondition(flightId);
    if (!condition) throw new Error("Missing reconciliation predicate");
    const query = new MySqlDialect().sqlToQuery(condition);
    return database
      .prepare(
        `SELECT id AS baggageId, tagNumber FROM baggage_items WHERE ${query.sql} ORDER BY id`
      )
      .all(...(query.params as Array<string | number | null>));
  } finally {
    database.close();
  }
}

describe("unresolved physical baggage registrations", () => {
  it("leaves valid exact-sector registrations and completed-sector history unchanged", () => {
    const data = seed();
    expect(unresolved(data)).toEqual([]);
    data.bookings[0].status = "completed";
    data.booking_segments[0].status = "completed";
    data.booking_segments[0].seatsReserved = false;
    expect(unresolved(data)).toEqual([]);
  });

  it.each(["refunded", "pending"])(
    "keeps %s bookings visible as unresolved without custody evidence",
    paymentStatus => {
      const data = seed();
      data.bookings[0].paymentStatus = paymentStatus;
      expect(unresolved(data)).toEqual([
        { baggageId: 71, tagNumber: "0123000071" },
      ]);
      expect(data.baggage_custody_events).toEqual([]);
    }
  );

  it("detects cancelled, deleted, missing and cross-tenant booking scope", () => {
    for (const change of [
      (data: ReturnType<typeof seed>) => {
        data.bookings[0].status = "cancelled";
      },
      (data: ReturnType<typeof seed>) => {
        Object.assign(data.bookings[0], { deletedAt: "2026-11-03" });
      },
      (data: ReturnType<typeof seed>) => {
        data.bookings = [];
      },
      (data: ReturnType<typeof seed>) => {
        data.bookings[0].tenantId = 4;
      },
    ]) {
      const data = seed();
      change(data);
      expect(unresolved(data)).toHaveLength(1);
    }
  });

  it("detects missing or mismatched passengers and inactive, missing or unreserved sectors", () => {
    for (const change of [
      (data: ReturnType<typeof seed>) => {
        data.passengers = [];
      },
      (data: ReturnType<typeof seed>) => {
        data.passengers[0].bookingId = 8;
      },
      (data: ReturnType<typeof seed>) => {
        data.passengers[0].tenantId = 4;
      },
      (data: ReturnType<typeof seed>) => {
        data.booking_segments = [];
      },
      (data: ReturnType<typeof seed>) => {
        data.booking_segments[0].status = "cancelled";
      },
      (data: ReturnType<typeof seed>) => {
        data.booking_segments[0].flightId = 32;
      },
      (data: ReturnType<typeof seed>) => {
        data.booking_segments[0].seatsReserved = false;
      },
    ]) {
      const data = seed();
      change(data);
      expect(unresolved(data)).toHaveLength(1);
    }
  });

  it("does not expand a flight's review to another flight or unscoped legacy bags", () => {
    const data = seed();
    data.bookings[0].paymentStatus = "refunded";
    data.baggage_items[0].flightId = 32;
    expect(unresolved(data)).toEqual([]);
    Object.assign(data.baggage_items[0], { flightId: null, segmentId: null });
    expect(unresolved(data)).toEqual([]);
  });

  it("isolates an invalid passenger's receipt from another valid passenger on the same flight", () => {
    const data = seed();
    data.passengers.push({ ...data.passengers[0], id: 12 });
    data.baggage_items.push({
      ...data.baggage_items[0],
      id: 72,
      passengerId: 12,
      tagNumber: "0123000072",
    });
    data.passengers[0].bookingId = 8;
    expect(unresolved(data)).toEqual([
      { baggageId: 71, tagNumber: "0123000071" },
    ]);
  });

  it("does not treat a mutable claimed label as verified physical return", () => {
    const data = seed();
    data.bookings[0].paymentStatus = "refunded";
    data.baggage_items[0].status = "claimed";
    expect(unresolved(data)).toHaveLength(1);
  });

  it("retains a physical bag after an actual verified full refund and blocks closeout", async () => {
    const fixture = transactionMemory(seed());
    await fixture.db.transaction((tx: any) =>
      settleVerifiedRefund(tx, {
        paymentIntentId: "pi_ticket",
        chargeId: "ch_ticket",
        amount: 5000,
        amountRefunded: 5000,
        currency: "SAR",
        eventId: "evt_ticket_refunded",
      })
    );
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "cancelled",
      paymentStatus: "refunded",
      seatsReserved: false,
      checkedIn: false,
    });
    expect(fixture.rows("booking_segments")[0].status).toBe("cancelled");
    expect(fixture.rows("baggage_items")).toHaveLength(1);
    expect(fixture.rows("baggage_custody_events")).toHaveLength(0);
    const data = Object.fromEntries(
      Object.keys(seed()).map(table => [table, fixture.rows(table)])
    );
    const rows = unresolved(data) as Array<{
      baggageId: number;
      tagNumber: string;
    }>;
    expect(rows).toEqual([{ baggageId: 71, tagNumber: "0123000071" }]);
    expect(reconcileBaggageCloseout(31, [], [], rows)).toMatchObject({
      unexpectedBags: 1,
      readyToClose: false,
      unresolvedRegistrations: ["0123000071"],
    });
  });
});
