import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  airlines,
  airports,
  flights,
  airportGates,
  gateAssignments,
  bookings,
  notifications,
  outbox,
} from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import {
  allocateGate,
  changeGateStatus,
  releaseFlightGate,
} from "../../server/services/gate-allocation.service";
import { transitionFlight } from "../../server/services/flight-state.service";
import { consumeLocalEvent } from "../../server/services/event-inbox.service";

export async function verifyR2Gates(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const id = seed + 6000;
  const at = new Date(Math.floor((Date.now() + 72 * 3600_000) / 1000) * 1000);
  const actor = { userId: seed, tenantId: null, platformAdmin: true };
  await db.insert(airports).values(
    [0, 1].map(i => ({
      id: id + i,
      code: `R${i}G`,
      name: "R2 test airport",
      city: "Fixture",
      country: "Fixture",
    }))
  );
  await db.insert(airlines).values({ id, code: "R2", name: "R2 fixture" });
  await db.insert(flights).values(
    [0, 1, 2, 3].map(i => ({
      id: id + i,
      flightNumber: `R2G${i}`,
      airlineId: id,
      originId: id,
      destinationId: id + 1,
      departureTime: new Date(at.getTime() + (i === 2 ? 4 : 0) * 3600_000),
      arrivalTime: new Date(at.getTime() + (i === 2 ? 6 : 2) * 3600_000),
      aircraftType: "A320",
      status: "scheduled" as const,
      economySeats: 10,
      businessSeats: 0,
      economyAvailable: 10,
      businessAvailable: 0,
      economyPrice: 10000,
      businessPrice: 0,
    }))
  );
  await db.insert(airportGates).values(
    [0, 1, 2].map(i => ({
      id: id + i,
      airportId: i === 1 ? id + 1 : id,
      gateNumber: `R2-${i}`,
      type: "both" as const,
      compatibleAircraftTypes: ["A320"],
      compatibilityEvidence: "local fixture, not operator approval",
    }))
  );
  let winner = id;
  const assign = (flightId: number, gateId = id) =>
    db.transaction(tx => allocateGate(tx, { flightId, gateId, actor }));
  await check(
    "R2 gates: concurrent competing flights allocate exactly once",
    async () => {
      const results = await Promise.allSettled([assign(id), assign(id + 1)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected").length, 1);
      const accepted = results.find(r => r.status === "fulfilled");
      assert(accepted?.status === "fulfilled");
      winner = accepted.value.flightId;
      const rejected = results.find(r => r.status === "rejected");
      assert(
        rejected?.status === "rejected" &&
          /overlapping/.test(String(rejected.reason))
      );
    }
  );
  await check(
    "R2 gates: touching windows coexist and release preserves the other reservation",
    async () => {
      await assign(id + 2);
      await db.transaction(tx => releaseFlightGate(tx, winner, actor));
      const [gate] = await db
        .select()
        .from(airportGates)
        .where(eq(airportGates.id, id));
      assert.equal(gate?.status, "occupied");
      await assert.rejects(
        db.transaction(tx => changeGateStatus(tx, id, "maintenance")),
        /Release active/
      );
      await db.transaction(tx => releaseFlightGate(tx, id + 2, actor));
    }
  );
  await check(
    "R2 gates: wrong airport and transaction failure leave no partial reservation",
    async () => {
      await assert.rejects(assign(id + 3, id + 1), /departure airport/);
      await assert.rejects(
        db.transaction(async tx => {
          await allocateGate(tx, { flightId: id + 3, gateId: id, actor });
          throw new Error("R2 failure after allocation and outbox");
        }),
        /R2 failure/
      );
      assert.equal(
        (
          await db
            .select()
            .from(gateAssignments)
            .where(eq(gateAssignments.flightId, id + 3))
        ).length,
        0
      );
      const [gate] = await db
        .select()
        .from(airportGates)
        .where(eq(airportGates.id, id));
      assert.equal(gate?.status, "available");
    }
  );
  await check(
    "R2 gates: canonical schedule change invalidates the old reservation",
    async () => {
      await assign(id + 3);
      await db.transaction(tx =>
        transitionFlight(tx, {
          flightId: id + 3,
          status: "delayed",
          newDepartureTime: new Date(at.getTime() + 30 * 60_000),
        })
      );
      const [assignment] = await db
        .select()
        .from(gateAssignments)
        .where(eq(gateAssignments.flightId, id + 3));
      assert.equal(assignment?.status, "cancelled");
      const [gate] = await db
        .select()
        .from(airportGates)
        .where(eq(airportGates.id, id));
      assert.equal(gate?.status, "available");
    }
  );
  await check(
    "R2 gates: durable gate-change notification is delivered exactly once",
    async () => {
      await db.insert(bookings).values({
        userId: seed,
        flightId: id + 3,
        bookingReference: "R2GATE",
        pnr: "R2GATE",
        status: "confirmed",
        paymentStatus: "paid",
        totalAmount: 10000,
        cabinClass: "economy",
        numberOfPassengers: 1,
      });
      await assign(id + 3);
      await db.transaction(tx =>
        allocateGate(tx, {
          flightId: id + 3,
          gateId: id + 2,
          actor,
          replace: true,
        })
      );
      const [changed] = await db
        .select()
        .from(outbox)
        .where(
          and(
            eq(outbox.aggregateId, String(id + 3)),
            eq(outbox.eventType, "gate.changed")
          )
        );
      assert(changed);
      await consumeLocalEvent(changed);
      await consumeLocalEvent(changed);
      const messages = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, seed));
      assert.equal(
        messages.filter(
          n => n.data && JSON.parse(n.data).eventId === changed.eventId
        ).length,
        1
      );
    }
  );
}
