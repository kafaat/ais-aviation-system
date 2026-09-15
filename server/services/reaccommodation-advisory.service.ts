/** Advisory reaccommodation (R2-11).
 *
 * Assembles the real inputs for `planReaccommodation` and returns its result.
 * Read-only by construction: this module holds no insert, update or delete,
 * and calls nothing that writes. The advisory is a recommendation an operator
 * or the existing IROPS authority may act on; it books nothing, holds no
 * seat and changes no booking.
 *
 * It complements `passenger-priority.service.ts` rather than replacing it.
 * That service ranks passengers, which answers "who first". Ranking is not an
 * assignment: with several alternatives of differing capacity and arrival
 * time, walking the ranked list and taking the best free seat is measurably
 * worse than the optimum, and the boundary suite demonstrates a case where it
 * costs 19%.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { bookings, flights } from "../../drizzle/schema";
import {
  MAX_PASSENGERS,
  planReaccommodation,
  type Cabin,
  type ReaccommodationOption,
  type ReaccommodationPassenger,
  type ReaccommodationPlan,
} from "../../shared/reaccommodation";
import { getDb } from "../db";
import { rankPassengers } from "./passenger-priority.service";
import { availableSeatsExpression } from "./inventory-capacity.service";
import type { SettlementTx } from "./booking-settlement.service";

/** How far ahead an alternative may depart and still count as protection. A
 * flight three days later is not a reaccommodation; it is a different trip. */
const PROTECTION_WINDOW_HOURS = 48;
/** Bounded so one advisory cannot pull an unbounded candidate set. */
const MAX_OPTIONS = 20;

function requireDb() {
  const db = getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}

/** The priority scores are 0-based totals of the rule scores, with no declared
 * upper bound, while the objective's weight expects a 0-100 scale. Scaling by
 * the maximum observed in this request keeps the relative ordering exactly and
 * makes the weights comparable; scaling by an assumed maximum would distort
 * whichever request happened to exceed it. */
function normaliseScores(
  scores: { passengerId: number; bookingId: number; totalScore: number }[]
): Map<number, number> {
  const highest = Math.max(...scores.map(score => score.totalScore), 0);
  return new Map(
    scores.map(score => [
      score.passengerId,
      highest > 0 ? (score.totalScore / highest) * 100 : 0,
    ])
  );
}

export interface AdvisoryInputs {
  plan: ReaccommodationPlan;
  /** Stated so a reader can see what the advisory was allowed to consider. */
  consideredOptions: number;
  candidateFlightIds: number[];
  consideredPassengers: number;
  /** More eligible flights exist beyond the declared option scope. */
  optionsTruncated: boolean;
  window: { fromISO: string; toISO: string };
}

export async function buildReaccommodationAdvisory(
  disruptedFlightId: number,
  now: Date = new Date()
): Promise<AdvisoryInputs> {
  const db = requireDb();
  // The first SELECT establishes the repeatable-read snapshot. Drizzle's
  // combined "with consistent snapshot read only" syntax lacks MySQL's comma;
  // no explicit snapshot modifier is needed when every read uses this tx.
  return await db.transaction(tx => readAdvisory(tx, disruptedFlightId, now), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

async function readAdvisory(
  db: SettlementTx,
  disruptedFlightId: number,
  now: Date
): Promise<AdvisoryInputs> {
  const [flight] = await db
    .select({
      id: flights.id,
      originId: flights.originId,
      destinationId: flights.destinationId,
      arrivalTime: flights.arrivalTime,
    })
    .from(flights)
    .where(eq(flights.id, disruptedFlightId))
    .limit(1);
  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });

  const scores = await rankPassengers(disruptedFlightId, {
    db,
    maxPassengers: MAX_PASSENGERS,
  });
  const normalised = normaliseScores(scores);

  // Cabin comes from the booking, which is where the class was sold.
  const bookingIds = [...new Set(scores.map(score => score.bookingId))];
  const bookingRows = bookingIds.length
    ? await db
        .select({ id: bookings.id, cabinClass: bookings.cabinClass })
        .from(bookings)
        .where(
          and(
            inArray(bookings.id, bookingIds),
            ne(bookings.status, "cancelled")
          )
        )
    : [];
  const cabinOf = new Map(
    bookingRows.map(row => [
      row.id,
      (row.cabinClass === "business" ? "business" : "economy") as Cabin,
    ])
  );

  const disruptedPassengers: ReaccommodationPassenger[] = scores
    .filter(score => cabinOf.has(score.bookingId))
    .map(score => ({
      passengerId: score.passengerId,
      bookingId: score.bookingId,
      priorityScore: normalised.get(score.passengerId) ?? 0,
      cabin: cabinOf.get(score.bookingId) as Cabin,
    }));

  const windowEnd = new Date(
    now.getTime() + PROTECTION_WINDOW_HOURS * 3600_000
  );
  const economyAvailable = availableSeatsExpression(
    flights.id,
    flights.economyAvailable,
    "economy",
    now
  );
  const businessAvailable = availableSeatsExpression(
    flights.id,
    flights.businessAvailable,
    "business",
    now
  );
  const businessAccepted = disruptedPassengers.some(
    p => p.cabin === "business"
  );
  const candidates = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      arrivalTime: flights.arrivalTime,
      economyAvailable,
      businessAvailable,
    })
    .from(flights)
    .where(
      and(
        eq(flights.originId, flight.originId),
        eq(flights.destinationId, flight.destinationId),
        ne(flights.id, flight.id),
        eq(flights.status, "scheduled"),
        or(
          gt(economyAvailable, 0),
          businessAccepted ? gt(businessAvailable, 0) : undefined
        ),
        gt(flights.departureTime, now),
        sql`${flights.departureTime} <= ${windowEnd}`
      )
    )
    .orderBy(flights.arrivalTime, flights.id)
    .limit(MAX_OPTIONS + 1);

  const options: ReaccommodationOption[] = candidates
    .slice(0, MAX_OPTIONS)
    .map(candidate => ({
      flightId: candidate.id,
      flightNumber: candidate.flightNumber,
      arrivalTime: candidate.arrivalTime.toISOString(),
      seats: {
        // One consistent snapshot, net of unexpired canonical and legacy
        // holds. Inventory must still be revalidated when actually rebooking.
        economy: candidate.economyAvailable,
        business: candidate.businessAvailable,
      },
    }));

  const plan = planReaccommodation({
    disruptedFlightId,
    originalArrival: flight.arrivalTime.toISOString(),
    passengers: disruptedPassengers,
    options,
  });

  return {
    plan,
    consideredOptions: options.length,
    candidateFlightIds: options.map(option => option.flightId),
    consideredPassengers: disruptedPassengers.length,
    optionsTruncated: candidates.length > MAX_OPTIONS,
    window: { fromISO: now.toISOString(), toISO: windowEnd.toISOString() },
  };
}
