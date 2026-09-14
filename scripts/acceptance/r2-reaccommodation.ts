import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import {
  airlines,
  airports,
  bookings,
  bookingSegments,
  flights,
  inventoryLocks,
  seatHolds,
  passengers as passengerRows,
} from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import { buildReaccommodationAdvisory } from "../../server/services/reaccommodation-advisory.service";
import { rankPassengers } from "../../server/services/passenger-priority.service";

/** R2-11 acceptance against real MySQL.
 *
 * Two claims that matter more than the arithmetic, which the unit suite
 * already proves optimal against exhaustive search:
 *
 *  1. The advisory reads real bookings, passengers and recorded availability,
 *     and only offers seats that exist.
 *  2. It writes nothing. Every row count and every seat counter is identical
 *     before and after, which is what makes it safe to run on live data.
 */
export async function verifyR2Reaccommodation(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const id = seed + 11000;
  const departure = new Date(
    Math.floor((Date.now() + 6 * 3600_000) / 1000) * 1000
  );
  const arrival = new Date(departure.getTime() + 2 * 3600_000);

  await db.insert(airports).values([
    {
      id,
      code: "R2P",
      name: "R2 reaccommodation origin",
      city: "Fixture",
      country: "Fixture",
    },
    {
      id: id + 1,
      code: "R2Q",
      name: "R2 reaccommodation destination",
      city: "Fixture",
      country: "Fixture",
    },
  ]);
  await db
    .insert(airlines)
    .values({ id, code: "RP", name: "R2 reaccommodation fixture" });

  const flight = (
    offset: number,
    economyAvailable: number,
    businessAvailable: number,
    hoursLater: number
  ) => ({
    id: id + offset,
    flightNumber: `R2P${offset}`,
    airlineId: id,
    originId: id,
    destinationId: id + 1,
    departureTime: new Date(departure.getTime() + hoursLater * 3600_000),
    arrivalTime: new Date(arrival.getTime() + hoursLater * 3600_000),
    aircraftType: "A320",
    status: "scheduled" as const,
    economySeats: 20,
    businessSeats: 4,
    economyAvailable,
    businessAvailable,
    economyPrice: 10000,
    businessPrice: 30000,
  });

  // The disrupted flight, plus one early flight with a single economy seat and
  // one later flight with room in both cabins.
  await db
    .insert(flights)
    .values([flight(0, 0, 0, 0), flight(1, 1, 0, 1), flight(2, 3, 2, 5)]);

  const booking = (
    offset: number,
    status: "confirmed" | "cancelled",
    cabinClass: "economy" | "business"
  ) => ({
    id: id + offset,
    userId: seed,
    flightId: id,
    // Both columns are six characters wide.
    bookingReference: `R2P${offset}${String(seed % 100).padStart(2, "0")}`,
    pnr: `R2Q${offset}${String(seed % 100).padStart(2, "0")}`,
    status,
    cabinClass,
    totalAmount: cabinClass === "business" ? 30000 : 10000,
  });
  // A cancelled booking is not a disrupted passenger and must not appear.
  await db
    .insert(bookings)
    .values([
      booking(0, "confirmed", "business"),
      booking(1, "confirmed", "economy"),
      booking(2, "cancelled", "economy"),
    ]);
  await db.insert(passengerRows).values([
    { id, bookingId: id, firstName: "R2", lastName: "Business" },
    { id: id + 1, bookingId: id + 1, firstName: "R2", lastName: "Economy" },
    { id: id + 2, bookingId: id + 2, firstName: "R2", lastName: "Cancelled" },
  ]);

  await check(
    "R2 reaccommodation: the advisory seats real passengers on real availability",
    async () => {
      const advisory = await buildReaccommodationAdvisory(id);
      assert.equal(advisory.plan.advisory, true);
      assert.equal(advisory.plan.disruptedFlightId, id);
      // Both alternatives are inside the protection window and have seats.
      assert.equal(advisory.consideredOptions, 2);
      // The cancelled booking's passenger is not disrupted and is absent.
      assert.equal(advisory.consideredPassengers, 2);
      const seated = advisory.plan.assignments.map(entry => entry.passengerId);
      assert.deepEqual(seated.sort(), [id, id + 1]);

      for (const entry of advisory.plan.assignments) {
        assert.notEqual(entry.flightId, null);
        assert.notEqual(entry.flightId, id);
        // Every offered seat must be one the inventory authority recorded.
        const [option] = await db
          .select({
            economyAvailable: flights.economyAvailable,
            businessAvailable: flights.businessAvailable,
          })
          .from(flights)
          .where(eq(flights.id, entry.flightId as number));
        const available =
          entry.cabin === "business"
            ? option.businessAvailable
            : option.economyAvailable;
        assert(available > 0, "advisory offered a seat that does not exist");
      }
      assert.deepEqual(advisory.plan.unassigned, []);
    }
  );

  await check(
    "R2 reaccommodation: the advisory never upgrades and never holds a seat",
    async () => {
      const before = await db
        .select({
          economyAvailable: flights.economyAvailable,
          businessAvailable: flights.businessAvailable,
        })
        .from(flights)
        .where(eq(flights.id, id + 1));
      const counts = async () => {
        const [row] = await db
          .select({
            bookings: sql<number>`(select count(*) from bookings)`,
            passengers: sql<number>`(select count(*) from passengers)`,
            outbox: sql<number>`(select count(*) from outbox)`,
          })
          .from(flights)
          .limit(1);
        return row;
      };
      const countsBefore = await counts();

      const advisory = await buildReaccommodationAdvisory(id);
      // The economy passenger takes the single early economy seat; the
      // business passenger is never moved up into a cabin nobody sold them,
      // and is never put in the early flight's non-existent business seat.
      const business = advisory.plan.assignments.find(
        entry => entry.passengerId === id
      );
      assert.notEqual(business?.cabin, null);
      if (business?.flightId === id + 1)
        assert.equal(business.cabin, "economy");

      const after = await db
        .select({
          economyAvailable: flights.economyAvailable,
          businessAvailable: flights.businessAvailable,
        })
        .from(flights)
        .where(eq(flights.id, id + 1));
      // Nothing was reserved: an advisory that consumed inventory would be
      // acting with an authority it does not have.
      assert.deepEqual(after, before);
      assert.deepEqual(await counts(), countsBefore);
    }
  );

  await check(
    "R2 reaccommodation: a flight with no alternative yields an honest empty plan",
    async () => {
      // Point the two alternatives outside the protection window.
      await db
        .update(flights)
        .set({
          departureTime: new Date(departure.getTime() + 96 * 3600_000),
          arrivalTime: new Date(arrival.getTime() + 96 * 3600_000),
        })
        .where(eq(flights.id, id + 1));
      await db
        .update(flights)
        .set({
          departureTime: new Date(departure.getTime() + 120 * 3600_000),
          arrivalTime: new Date(arrival.getTime() + 120 * 3600_000),
        })
        .where(eq(flights.id, id + 2));

      const advisory = await buildReaccommodationAdvisory(id);
      assert.equal(advisory.consideredOptions, 0);
      // Everyone is named as unassigned rather than quietly omitted.
      assert.equal(advisory.plan.assignments.length, 2);
      assert.deepEqual(advisory.plan.unassigned.sort(), [id, id + 1]);
      for (const entry of advisory.plan.assignments) {
        assert.equal(entry.flightId, null);
        assert.match(entry.reason, /No acceptable seat/);
      }
    }
  );

  await check(
    "R2 reaccommodation: active holds reduce capacity without mutating expired or linked holds",
    async () => {
      await db.insert(flights).values(flight(10, 5, 0, 1));
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      const future = new Date(now.getTime() + 3600_000);
      await db.insert(inventoryLocks).values([
        {
          id,
          flightId: id + 10,
          cabinClass: "economy",
          numberOfSeats: 2,
          sessionId: "r2-hold",
          expiresAt: future,
        },
        {
          id: id + 1,
          flightId: id + 10,
          cabinClass: "economy",
          numberOfSeats: 20,
          sessionId: "r2-expired",
          expiresAt: now,
        },
      ]);
      await db.insert(seatHolds).values([
        {
          id,
          flightId: id + 10,
          cabinClass: "economy",
          seats: 2,
          sessionId: "r2-linked",
          expiresAt: future,
          inventoryLockId: id,
        },
        {
          id: id + 1,
          flightId: id + 10,
          cabinClass: "economy",
          seats: 2,
          sessionId: "r2-legacy",
          expiresAt: future,
        },
        {
          id: id + 2,
          flightId: id + 10,
          cabinClass: "economy",
          seats: 20,
          sessionId: "r2-expired",
          expiresAt: now,
        },
      ]);
      const snapshot = async () => ({
        flights: await db.select().from(flights),
        bookings: await db.select().from(bookings),
        segments: await db.select().from(bookingSegments),
        locks: await db.select().from(inventoryLocks),
        holds: await db.select().from(seatHolds),
      });
      const before = await snapshot();
      const advisory = await buildReaccommodationAdvisory(id, now);
      // 5 recorded - 2 canonical - 2 legacy = 1; linked alias is not counted twice.
      assert.equal(
        advisory.plan.assignments.filter(row => row.flightId === id + 10)
          .length,
        1
      );
      assert.equal(advisory.plan.unassigned.length, 1);
      assert.deepEqual(await snapshot(), before);
    }
  );

  await check(
    "R2 reaccommodation: held and sold-out flights cannot crowd out later available options",
    async () => {
      await db
        .update(flights)
        .set({ economyAvailable: 0 })
        .where(eq(flights.id, id + 10));
      await db
        .insert(flights)
        .values(
          Array.from({ length: 21 }, (_, index) =>
            flight(20 + index, index === 20 ? 2 : index % 2, 0, 2 + index / 100)
          )
        );
      await db.insert(inventoryLocks).values(
        Array.from({ length: 10 }, (_, index) => ({
          flightId: id + 21 + index * 2,
          cabinClass: "economy" as const,
          numberOfSeats: 1,
          sessionId: `r2-full-${index}`,
          expiresAt: new Date(Date.now() + 3600_000),
        }))
      );
      const advisory = await buildReaccommodationAdvisory(id);
      assert.equal(advisory.consideredOptions, 1);
      assert.equal(advisory.optionsTruncated, false);
      assert.deepEqual(advisory.plan.unassigned, []);
      assert(advisory.plan.assignments.every(row => row.flightId === id + 40));
    }
  );

  await check(
    "R2 reaccommodation: current segments include later-leg passengers and exclude moved or cancelled legs",
    async () => {
      await db
        .insert(bookings)
        .values([
          { ...booking(3, "confirmed", "economy"), flightId: id + 2 },
          booking(4, "confirmed", "economy"),
          booking(5, "confirmed", "economy"),
        ]);
      await db.insert(passengerRows).values(
        [3, 4, 5].map(offset => ({
          id: id + offset,
          bookingId: id + offset,
          firstName: "R2",
          lastName: `Segment${offset}`,
        }))
      );
      await db.insert(bookingSegments).values([
        {
          bookingId: id + 3,
          flightId: id + 2,
          segmentOrder: 1,
          status: "completed",
          departureDate: departure,
        },
        {
          bookingId: id + 3,
          flightId: id,
          segmentOrder: 2,
          status: "confirmed",
          departureDate: departure,
        },
        {
          bookingId: id + 4,
          flightId: id + 2,
          segmentOrder: 1,
          status: "confirmed",
          departureDate: departure,
        },
        {
          bookingId: id + 5,
          flightId: id,
          segmentOrder: 1,
          status: "cancelled",
          departureDate: departure,
        },
      ]);
      const ranked = await rankPassengers(id);
      assert.deepEqual(ranked.map(row => row.passengerId).sort(), [
        id,
        id + 1,
        id + 3,
      ]);
      assert(ranked.every(row => row.flightId === id));
      const advisory = await buildReaccommodationAdvisory(id);
      assert.deepEqual(
        advisory.plan.assignments.map(row => row.passengerId).sort(),
        [id, id + 1, id + 3]
      );
    }
  );

  await check(
    "R2 reaccommodation: exceeding the manifest bound fails explicitly without dropping passengers",
    async () => {
      await db.insert(passengerRows).values(
        Array.from({ length: 148 }, (_, index) => ({
          id: id + 100 + index,
          bookingId: id,
          firstName: "R2",
          lastName: `Bound${index}`,
        }))
      );
      try {
        await assert.rejects(
          buildReaccommodationAdvisory(id),
          /at most 150 passengers; flight has 151/
        );
      } finally {
        await db
          .delete(passengerRows)
          .where(sql`${passengerRows.id} between ${id + 100} and ${id + 247}`);
      }
    }
  );

  await check(
    "R2 reaccommodation: option limit is disclosed and orders candidates by arrival cost",
    async () => {
      await db
        .insert(flights)
        .values(
          Array.from({ length: 21 }, (_, index) =>
            flight(60 + index, 1, 0, 3 + index / 100)
          )
        );
      const advisory = await buildReaccommodationAdvisory(id);
      assert.equal(advisory.consideredOptions, 20);
      assert.equal(advisory.optionsTruncated, true);
      assert.equal(advisory.consideredPassengers, 3);
      assert.equal(
        advisory.plan.assignments.filter(row => row.flightId === id + 40)
          .length,
        2
      );
    }
  );
}
