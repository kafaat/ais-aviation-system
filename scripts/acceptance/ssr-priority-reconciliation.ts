import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import {
  calculatePriorityScore,
  rankPassengers,
} from "../../server/services/passenger-priority.service";

/** Called only by the guarded empty *_test database integration runner. */
export async function verifySsrPriorityReconciliation(
  db: SettlementTx,
  seed: number,
  record: (
    key: string,
    description: string,
    run: () => Promise<unknown>
  ) => Promise<void>
) {
  const departures = [72, 78].map(
    hours => new Date(Date.now() + hours * 3600000)
  );
  const flightIds = await db
    .insert(s.flights)
    .values(
      departures.map((departureTime, index) => ({
        tenantId: seed,
        airlineId: seed,
        flightNumber: `ZY${981 + index}`,
        originId: seed + index,
        destinationId: seed + 1 - index,
        departureTime,
        arrivalTime: new Date(departureTime.getTime() + 3600000),
        economySeats: 10,
        economyAvailable: 8,
        businessSeats: 0,
        businessAvailable: 0,
        economyPrice: 10000,
        businessPrice: 20000,
      }))
    )
    .$returningId();
  const [outbound, onward] = flightIds;
  assert(outbound && onward);
  const [booking] = await db
    .insert(s.bookings)
    .values({
      tenantId: seed,
      userId: seed,
      flightId: outbound.id,
      bookingReference: "SRPR01",
      pnr: "SRPR01",
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
      cabinClass: "economy",
      numberOfPassengers: 2,
      totalAmount: 40000,
    })
    .$returningId();
  assert(booking);
  const segments = await db
    .insert(s.bookingSegments)
    .values(
      flightIds.map((flight, index) => ({
        bookingId: booking.id,
        flightId: flight.id,
        segmentOrder: index + 1,
        departureDate: departures[index],
        segmentAmount: 20000,
        status: "confirmed" as const,
        seatsReserved: true,
      }))
    )
    .$returningId();
  assert(segments[0] && segments[1]);
  const people = await db
    .insert(s.passengers)
    .values(
      ["Ordinary", "Assistance"].map(firstName => ({
        bookingId: booking.id,
        tenantId: seed,
        firstName,
        lastName: "Synthetic",
        dateOfBirth: new Date("2000-01-01T00:00:00Z"),
        nationality: "SA",
      }))
    )
    .$returningId();
  const [ordinaryPassenger, assistancePassenger] = people;
  assert(ordinaryPassenger && assistancePassenger);
  const directScore = (flightId: number) =>
    calculatePriorityScore(assistancePassenger.id, booking.id, {
      db,
      flightId,
    });
  const ranking = (flightId: number) => rankPassengers(flightId, { db });
  const readRequests = () =>
    db
      .select()
      .from(s.specialServices)
      .where(eq(s.specialServices.bookingId, booking.id))
      .orderBy(s.specialServices.id);
  const services = [
    { serviceType: "wheelchair", serviceCode: "WCHR" },
    { serviceType: "medical_assistance", serviceCode: "MEDA" },
    { serviceType: "unaccompanied_minor", serviceCode: "UMNR" },
  ] as const;

  await record(
    "SSR-PRIORITY-01",
    "Active unscoped assistance blocks direct scoring and complete flight ranking",
    async () => {
      for (const service of services) {
        for (const status of ["pending", "confirmed"] as const) {
          const [request] = await db
            .insert(s.specialServices)
            .values({
              bookingId: booking.id,
              passengerId: assistancePassenger.id,
              flightId: null,
              bookingSegmentId: null,
              ...service,
              status,
            })
            .$returningId();
          assert(request);
          const before = await readRequests();
          for (const flight of flightIds) {
            const expected = {
              code: "PRECONDITION_FAILED",
              message: /no verified flight sector/,
            };
            await assert.rejects(directScore(flight.id), expected);
            await assert.rejects(ranking(flight.id), expected);
          }
          assert.deepEqual(
            await readRequests(),
            before,
            "Scoring must retain unresolved assistance without inventing a sector"
          );
          await db
            .update(s.specialServices)
            .set({ status: status === "pending" ? "cancelled" : "rejected" })
            .where(eq(s.specialServices.id, request.id));
        }
      }
      return {
        activeServiceStatusCombinations: 6,
        currentAndOnwardScoringRejected: true,
        incompleteFlightRankingRejected: true,
        historicalScopePreserved: true,
      };
    }
  );

  await record(
    "SSR-PRIORITY-02",
    "Inactive unscoped assistance remains readable without blocking ranking",
    async () => {
      const before = await readRequests();
      assert.equal(before.length, 6);
      assert(before.every(row => row.flightId === null));
      assert(before.every(row => row.bookingSegmentId === null));
      assert(
        before.every(row => ["cancelled", "rejected"].includes(row.status))
      );
      for (const flight of flightIds) {
        assert.equal((await directScore(flight.id)).specialNeedsScore, 0);
        const scores = await ranking(flight.id);
        assert.equal(scores.length, 2);
        assert.deepEqual(
          scores.map(score => score.passengerId).sort((a, b) => a - b),
          people.map(person => person.id).sort((a, b) => a - b)
        );
        assert(scores.every(score => score.specialNeedsScore === 0));
      }
      assert.deepEqual(await readRequests(), before);
      return {
        cancelledAndRejectedLegacyRequestsRetained: 6,
        completeRankingsAvailableForBothSectors: true,
        inactiveAssistanceScore: 0,
      };
    }
  );

  await record(
    "SSR-PRIORITY-03",
    "Confirmed assistance contributes only to its explicit flight sector",
    async () => {
      await db.insert(s.specialServices).values({
        bookingId: booking.id,
        passengerId: assistancePassenger.id,
        flightId: onward.id,
        bookingSegmentId: segments[1].id,
        serviceType: "medical_assistance",
        serviceCode: "MEDA",
        status: "confirmed",
      });
      const before = await readRequests();
      for (const flight of flightIds) {
        const expected = flight.id === onward.id ? 100 : 0;
        assert.equal(
          (await directScore(flight.id)).specialNeedsScore,
          expected
        );
        const scores = await ranking(flight.id);
        assert.equal(scores.length, 2);
        assert.equal(
          scores.find(score => score.passengerId === assistancePassenger.id)
            ?.specialNeedsScore,
          expected
        );
        assert.equal(
          scores.find(score => score.passengerId === ordinaryPassenger.id)
            ?.specialNeedsScore,
          0
        );
      }
      assert.deepEqual(await readRequests(), before);
      // A known flight is valid scope even without a stored booking segment.
      await db.insert(s.specialServices).values({
        bookingId: booking.id,
        passengerId: assistancePassenger.id,
        flightId: outbound.id,
        bookingSegmentId: null,
        serviceType: "wheelchair",
        serviceCode: "WCHR",
        status: "confirmed",
      });
      assert.equal((await directScore(outbound.id)).specialNeedsScore, 100);
      assert.equal((await ranking(outbound.id)).length, 2);
      return {
        otherSectorAssistanceExcluded: true,
        scopedSectorAssistanceScore: 100,
        ordinaryPassengerAssistanceScore: 0,
        knownFlightWithoutStoredSegmentAccepted: true,
      };
    }
  );
}
