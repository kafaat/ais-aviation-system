/**
 * Concurrent oversell of a booking class against a real MySQL-compatible
 * server (ADR 0002). Two transactions race for the last authorized seat of a
 * class; `SELECT ... FOR UPDATE` on the flight row and the RBD rows must
 * serialize them so exactly one commits. Skipped when DATABASE_URL is not
 * reachable, like the other integration suites.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db";
import {
  fareClasses,
  flightFareClassInventory,
  flights,
  inventoryLocks,
} from "../../../drizzle/schema";
import {
  InventoryUnavailableError,
  reserveSeats,
} from "../../services/booking-settlement.service";
import {
  BookingClassUnavailableError,
  holdBookingClass,
  listBookingClasses,
} from "../../services/rbd-inventory.service";
import { isDatabaseAvailable } from "../test-db-helper";

const dbAvailable = await isDatabaseAvailable();
const AIRLINE_ID = 999911;
const ORIGIN_ID = 999912;
const DEST_ID = 999913;

let db: NonNullable<ReturnType<typeof getDb>>;
let flightId: number;
let fullFareId: number;
let discountId: number;

beforeAll(async () => {
  if (!dbAvailable) return;
  db = getDb()!;
  await db.execute(
    sql`INSERT IGNORE INTO airlines (id, code, name, active) VALUES (${AIRLINE_ID}, 'RB9', 'RBD Airline', 1)`
  );
  await db.execute(
    sql`INSERT IGNORE INTO airports (id, code, name, city, country) VALUES (${ORIGIN_ID}, 'RB1', 'RBD Origin', 'City1', 'Saudi Arabia')`
  );
  await db.execute(
    sql`INSERT IGNORE INTO airports (id, code, name, city, country) VALUES (${DEST_ID}, 'RB2', 'RBD Dest', 'City2', 'Saudi Arabia')`
  );
  const [flight] = await db.insert(flights).values({
    flightNumber: `RB${nanoid(4)}`,
    airlineId: AIRLINE_ID,
    originId: ORIGIN_ID,
    destinationId: DEST_ID,
    departureTime: new Date(Date.now() + 86_400_000),
    arrivalTime: new Date(Date.now() + 90_000_000),
    economyPrice: 50000,
    businessPrice: 100000,
    economySeats: 100,
    businessSeats: 20,
    economyAvailable: 100,
    businessAvailable: 20,
    status: "scheduled",
  });
  flightId = Number(flight.insertId);
  const [full] = await db.insert(fareClasses).values({
    airlineId: AIRLINE_ID,
    code: "Y",
    name: "RBD test full fare",
    cabinClass: "economy",
    priority: 100,
    basePriceMultiplier: "1.000",
  });
  fullFareId = Number(full.insertId);
  const [discount] = await db.insert(fareClasses).values({
    airlineId: AIRLINE_ID,
    code: "Q",
    name: "RBD test deep discount",
    cabinClass: "economy",
    priority: 10,
    basePriceMultiplier: "0.500",
  });
  discountId = Number(discount.insertId);
  await db.insert(flightFareClassInventory).values([
    {
      flightId,
      fareClassId: fullFareId,
      cabinClass: "economy",
      authorizedSeats: 100,
      nested: true,
    },
    {
      flightId,
      fareClassId: discountId,
      cabinClass: "economy",
      authorizedSeats: 1,
      nested: true,
    },
  ]);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(inventoryLocks).where(eq(inventoryLocks.flightId, flightId));
  await db
    .delete(flightFareClassInventory)
    .where(eq(flightFareClassInventory.flightId, flightId));
  await db.delete(fareClasses).where(eq(fareClasses.airlineId, AIRLINE_ID));
  await db.delete(flights).where(eq(flights.id, flightId));
  await db.execute(sql`DELETE FROM airlines WHERE id = ${AIRLINE_ID}`);
  await db.execute(
    sql`DELETE FROM airports WHERE id IN (${ORIGIN_ID}, ${DEST_ID})`
  );
});

const soldOf = async (fareClassId: number) =>
  (
    await db
      .select({ sold: flightFareClassInventory.sold })
      .from(flightFareClassInventory)
      .where(
        and(
          eq(flightFareClassInventory.flightId, flightId),
          eq(flightFareClassInventory.fareClassId, fareClassId)
        )
      )
  )[0].sold;

describe.skipIf(!dbAvailable)("RBD oversell under concurrency", () => {
  it("lets exactly one of two racing settlements sell the last Q seat", async () => {
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        db.transaction(tx =>
          reserveSeats(tx, flightId, "economy", 1, null, discountId)
        )
      )
    );
    expect(results.map(r => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejected = results.find(r => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    expect(rejected?.reason).toBeInstanceOf(InventoryUnavailableError);
    expect(await soldOf(discountId)).toBe(1);
    const [row] = await db
      .select({ economyAvailable: flights.economyAvailable })
      .from(flights)
      .where(eq(flights.id, flightId));
    // The losing transaction rolled back its cabin decrement too.
    expect(row.economyAvailable).toBe(99);
    // Y is nested over Q: the one Q sale also consumed one Y seat (100 -> 99),
    // and Q itself is sold out and no longer listed.
    const classes = (
      await listBookingClasses(db, [
        {
          id: flightId,
          economyAvailable: 99,
          businessAvailable: 20,
          economyPrice: 50000,
          businessPrice: 100000,
        },
      ])
    ).get(flightId)!;
    expect(classes.map(c => [c.code, c.available])).toEqual([["Y", 99]]);
  });

  it("lets exactly one of two racing holds claim the last Y seat", async () => {
    await db
      .update(flightFareClassInventory)
      .set({ authorizedSeats: 2 })
      .where(
        and(
          eq(flightFareClassInventory.flightId, flightId),
          eq(flightFareClassInventory.fareClassId, fullFareId)
        )
      );
    const results = await Promise.allSettled(
      ["hold-a", "hold-b"].map(sessionId =>
        db.transaction(async tx => {
          await tx
            .select({ id: flights.id })
            .from(flights)
            .where(eq(flights.id, flightId))
            .for("update");
          const [lock] = await tx.insert(inventoryLocks).values({
            flightId,
            numberOfSeats: 1,
            cabinClass: "economy",
            sessionId,
            status: "active",
            expiresAt: new Date(Date.now() + 600_000),
          });
          await holdBookingClass(tx, {
            flightId,
            cabinClass: "economy",
            fareClassId: fullFareId,
            seats: 1,
            lockId: Number(lock.insertId),
          });
        })
      )
    );
    expect(results.map(r => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejected = results.find(r => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    expect(rejected?.reason).toBeInstanceOf(BookingClassUnavailableError);
    const held = await db
      .select()
      .from(inventoryLocks)
      .where(eq(inventoryLocks.flightId, flightId));
    // The rejected hold's INSERT rolled back with its transaction.
    expect(held).toHaveLength(1);
    expect(held[0].fareClassId).toBe(fullFareId);
  });
});
