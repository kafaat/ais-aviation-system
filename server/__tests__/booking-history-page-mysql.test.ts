import { strict as assert } from "node:assert";
import { afterAll, beforeAll, describe, it } from "vitest";
import { getBookingsByUserId, closePool } from "../db";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";
const suite =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
suite("owned booking history keyset across date and amount ties", () => {
  let fixture: PaidBookingNativeFixture;
  const previous = process.env.DATABASE_URL;
  beforeAll(async () => {
    fixture = await createPaidBookingNativeFixture("ais_confirmation");
    process.env.DATABASE_URL = fixture.databaseUrl;
  }, 60000);
  afterAll(async () => {
    try {
      await closePool();
    } finally {
      process.env.DATABASE_URL = previous;
      await fixture?.close();
    }
  });
  it("covers all sort directions, filters, and direct booking scope", async () => {
    const p = fixture.pool;

    await p.query(
      "insert into airports(id,code,name,city,country) values(1,'RUH','r','r','SA'),(2,'JED','j','j','SA')"
    );
    await p.query(
      "insert into flights(id,flightNumber,airlineId,originId,destinationId,departureTime,arrivalTime,economySeats,businessSeats,economyPrice,businessPrice,economyAvailable,businessAvailable) values(1,'AIS1',1,1,2,'2027-01-01','2027-01-02',100,10,100,200,90,9)"
    );
    for (let i = 1; i <= 9; i++)
      await p.query(
        "insert into bookings(id,userId,tenantId,flightId,bookingReference,pnr,totalAmount,cabinClass,status) values(?,?,?,?,?,?,?,'economy',?)",
        [
          i,
          i === 8 ? 999 : 11,
          i === 9 ? 999 : 5,
          1,
          "B" + i,
          "P" + i,
          Math.floor(i / 3),
          i === 7 ? "cancelled" : "confirmed",
        ]
      );
    for (const sort of [
      "dateDesc",
      "dateAsc",
      "priceDesc",
      "priceAsc",
    ] as const) {
      let cursor: { id: number; value: number } | null = null;
      const ids: number[] = [];
      for (let k = 0; k < 8; k++) {
        const rows = await getBookingsByUserId(11, 5, {
          sort,
          limit: 2,
          status: "confirmed",
          cursor,
        });
        const items = rows.slice(0, 2);
        ids.push(...items.map(i => i.id));
        if (rows.length <= 2) break;
        const last = items.at(-1)!;
        cursor = {
          id: last.id,
          value: sort.startsWith("price")
            ? last.totalAmount
            : last.flight.departureTime.getTime(),
        };
      }
      assert.deepEqual(
        ids,
        sort.endsWith("Asc") ? [1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1]
      );
    }
    for (const id of [8, 9])
      assert.equal(
        (
          await getBookingsByUserId(11, 5, {
            sort: "dateAsc",
            limit: 1,
            bookingId: id,
          })
        ).length,
        0
      );
    assert.equal(
      (
        await getBookingsByUserId(11, 5, {
          sort: "dateAsc",
          limit: 1,
          bookingId: 3,
        })
      )[0]?.id,
      3
    );
    assert.equal(
      (
        await getBookingsByUserId(11, 5, {
          sort: "dateAsc",
          limit: 2,
          beforeDate: new Date("2027-01-01T00:00:00Z"),
        })
      ).length,
      0
    );
    assert.equal(
      (
        await getBookingsByUserId(11, 5, {
          sort: "dateAsc",
          limit: 2,
          afterDate: new Date("2027-01-01T00:00:00Z"),
        })
      ).length,
      3
    );
  });
});
