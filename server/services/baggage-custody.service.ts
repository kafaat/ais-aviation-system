import { z } from "zod";
import { and, asc, desc, eq, inArray, or, isNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  baggageItems,
  baggageCustodyEvents,
  baggageTracking,
  bookings,
  bookingSegments,
  flights,
  aviationEvidence,
} from "../../drizzle/schema";
import {
  evidenceDigest,
  verifyAviationSource,
  persistAviationEvidence,
  type EvidenceEnvelope,
} from "./aviation-evidence.service";
import { assertTenantOperational } from "./tenant.service";
const scanSchema = z
  .object({
    tagNumber: z.string().min(1).max(20),
    stage: z.enum(["acceptance", "loading", "transfer", "arrival"]),
    airportId: z.number().int().positive(),
    deviceId: z.string().min(1).max(100),
    previousEvidenceId: z.number().int().positive().nullable(),
  })
  .strict();
type Scan = z.infer<typeof scanSchema>;
export class BaggageCustodyConflict extends Error {}
type Custody = typeof baggageCustodyEvents.$inferSelect;

export type BaggageCloseoutRow = {
  baggageId: number;
  tagNumber: string;
  entryStage: "acceptance" | "transfer";
};

export function reconcileBaggageCloseout(
  flightId: number,
  expected: BaggageCloseoutRow[],
  events: Array<{ baggageId: number; flightId: number; stage: string }>
) {
  const expectedIds = new Set(expected.map(bag => bag.baggageId));
  const unexpected = new Set<number>();
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.flightId !== flightId) continue;
    if (!expectedIds.has(event.baggageId)) unexpected.add(event.baggageId);
    const key = `${event.baggageId}:${event.stage}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const missingEntry = expected
    .filter(row => !counts.has(`${row.baggageId}:${row.entryStage}`))
    .map(row => row.tagNumber);
  const missingLoading = expected
    .filter(row => !counts.has(`${row.baggageId}:loading`))
    .map(row => row.tagNumber);
  const duplicates = expected.flatMap(row =>
    [row.entryStage, "loading"].flatMap(stage => {
      const count = counts.get(`${row.baggageId}:${stage}`) ?? 0;
      return count > 1 ? [{ tagNumber: row.tagNumber, stage, count }] : [];
    })
  );
  return {
    flightId,
    expectedBags: expected.length,
    unexpectedBags: unexpected.size,
    acceptedOrTransferred: expected.length - missingEntry.length,
    loadedBags: expected.length - missingLoading.length,
    readyToClose:
      expected.length > 0 &&
      missingEntry.length === 0 &&
      missingLoading.length === 0 &&
      duplicates.length === 0 &&
      unexpected.size === 0,
    missingEntry,
    missingLoading,
    duplicates,
    acceptanceState: "operator_station_acceptance_required" as const,
  };
}

function custodyFlightIds(
  legs: Array<{ flightId: number; status: string }>,
  legacyFlightId: number
) {
  return legs.length
    ? legs.filter(leg => leg.status !== "cancelled").map(leg => leg.flightId)
    : [legacyFlightId];
}

export function validateCustodyTransition(
  input: Scan,
  flight: { id: number; originId: number; destinationId: number },
  previous: Custody | undefined,
  orderedFlights: number[],
  observedAt: Date
) {
  const index = orderedFlights.indexOf(flight.id);
  if (index < 0) throw new Error("Bag is not routed on this flight");
  if (
    previous &&
    (input.previousEvidenceId !== previous.evidenceId ||
      observedAt <= previous.observedAt)
  )
    throw new Error("Custody predecessor or observation order mismatch");
  if (!previous) {
    if (
      input.stage !== "acceptance" ||
      index !== 0 ||
      input.previousEvidenceId !== null ||
      input.airportId !== flight.originId
    )
      throw new Error(
        "Initial custody requires acceptance at the journey origin"
      );
    return;
  }
  const same = previous.flightId === flight.id;
  if (
    input.stage === "loading" &&
    same &&
    ["acceptance", "transfer"].includes(previous.stage) &&
    input.airportId === flight.originId
  )
    return;
  if (
    input.stage === "arrival" &&
    same &&
    previous.stage === "loading" &&
    input.airportId === flight.destinationId
  )
    return;
  if (
    input.stage === "transfer" &&
    previous.stage === "arrival" &&
    index > 0 &&
    orderedFlights[index - 1] === previous.flightId &&
    previous.airportId === flight.originId &&
    input.airportId === flight.originId
  )
    return;
  throw new Error("Invalid custody handover for this journey leg");
}
export async function ingestBaggageCustody(
  e: EvidenceEnvelope,
  signature: string
) {
  const scan = scanSchema.parse(e.payload);
  if (e.kind !== "baggage_custody" || e.flightId === null)
    throw new Error("Baggage event requires a flight instance");
  const source = verifyAviationSource(e, signature, "baggage");
  if (
    !source.deviceIds?.includes(scan.deviceId) ||
    !source.airportIds?.includes(scan.airportId)
  )
    throw new Error("Source device or airport is not authorized");
  const db = await getDb();
  if (!db) throw new Error("Baggage storage unavailable");
  const [hint] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.tagNumber, scan.tagNumber))
    .limit(1);
  if (!hint) throw new Error("Baggage tag not found");
  return db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, hint.bookingId))
      .for("update");
    const [bag] = await tx
      .select()
      .from(baggageItems)
      .where(eq(baggageItems.id, hint.id))
      .for("update");
    if (!booking || !bag || booking.tenantId !== source.tenantId)
      throw new Error("Source cannot handle this booking");
    await assertTenantOperational(tx, booking.tenantId);
    const [replay] = await tx
      .select()
      .from(aviationEvidence)
      .where(
        and(
          eq(aviationEvidence.sourceId, e.sourceId),
          eq(aviationEvidence.sourceEventId, e.eventId)
        )
      )
      .limit(1);
    if (replay) {
      if (
        replay.tenantId !== source.tenantId ||
        replay.digest !== evidenceDigest(e)
      )
        throw new Error("Source event identity was reused");
      return { evidenceId: replay.id, duplicate: true };
    }
    if (
      !["confirmed", "completed"].includes(booking.status) ||
      booking.paymentStatus !== "paid"
    )
      throw new Error("Bag journey is not active");
    const legs = await tx
      .select()
      .from(bookingSegments)
      .where(eq(bookingSegments.bookingId, booking.id))
      .orderBy(asc(bookingSegments.segmentOrder));
    const ordered = custodyFlightIds(legs, booking.flightId);
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, e.flightId as number))
      .limit(1);
    if (!flight || flight.tenantId !== source.tenantId)
      throw new Error("Flight instance unavailable");
    if (
      Math.abs(Date.parse(e.observedAt) - flight.departureTime.getTime()) >
      7 * 86400000
    )
      throw new Error("Scan timestamp is outside this journey window");
    const [previous] = await tx
      .select()
      .from(baggageCustodyEvents)
      .where(eq(baggageCustodyEvents.baggageId, bag.id))
      .orderBy(
        desc(baggageCustodyEvents.observedAt),
        desc(baggageCustodyEvents.id)
      )
      .limit(1);
    validateCustodyTransition(
      scan,
      flight,
      previous,
      ordered,
      new Date(e.observedAt)
    );
    const receipt = await persistAviationEvidence(tx, e, source);
    await tx.insert(baggageCustodyEvents).values({
      baggageId: bag.id,
      flightId: flight.id,
      stage: scan.stage,
      evidenceId: receipt.evidenceId,
      previousEvidenceId: scan.previousEvidenceId,
      airportId: scan.airportId,
      deviceId: scan.deviceId,
      sourceId: source.sourceId,
      observedAt: new Date(e.observedAt),
    });
    const status =
      scan.stage === "acceptance"
        ? "checked_in"
        : scan.stage === "arrival"
          ? "arrived"
          : "loading";
    const location = `Airport ${scan.airportId}`;
    await tx
      .update(baggageItems)
      .set({ status, lastLocation: location, updatedAt: new Date() })
      .where(eq(baggageItems.id, bag.id));
    await tx.insert(baggageTracking).values({
      baggageId: bag.id,
      location,
      status,
      scannedAt: new Date(e.observedAt),
      notes: `Verified custody evidence ${receipt.evidenceId}`,
    });
    return receipt;
  });
}
export async function getBaggageCustody(
  tagNumber: string,
  actor: { id: number; role: string; tenantId: number | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Baggage storage unavailable");
  const [bag] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.tagNumber, tagNumber))
    .limit(1);
  if (!bag)
    throw new TRPCError({ code: "NOT_FOUND", message: "Bag not found" });
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bag.bookingId))
    .limit(1);
  if (
    !booking ||
    (actor.role !== "admin" && booking.userId !== actor.id) ||
    (actor.tenantId !== null && actor.tenantId !== booking.tenantId)
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "Bag not found" });
  const legs = await db
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(asc(bookingSegments.segmentOrder));
  const ordered = custodyFlightIds(legs, booking.flightId);
  const events = await db
    .select()
    .from(baggageCustodyEvents)
    .where(eq(baggageCustodyEvents.baggageId, bag.id))
    .orderBy(asc(baggageCustodyEvents.observedAt))
    .limit(101);
  if (events.length > 100)
    throw new Error("Baggage journey requires reconciliation");
  const required = ordered.flatMap((flightId, i) =>
    ([i === 0 ? "acceptance" : "transfer", "loading", "arrival"] as const).map(
      stage => ({
        flightId,
        stage,
        observed: events.some(
          e => e.flightId === flightId && e.stage === stage
        ),
      })
    )
  );
  return {
    tagNumber,
    complete: required.length > 0 && required.every(p => p.observed),
    verifiedPoints: required.filter(p => p.observed).length,
    requiredPoints: required.length,
    required,
    events,
  };
}

/** Departure inventory evidence. This report does not close a real station. */
export async function getFlightBaggageCloseout(
  flightId: number,
  tenantId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Baggage storage unavailable");
  return db.transaction(
    async tx => {
      const [flight] = await tx
        .select({ id: flights.id, tenantId: flights.tenantId })
        .from(flights)
        .where(and(eq(flights.id, flightId), eq(flights.tenantId, tenantId)))
        .limit(1);
      if (!flight)
        throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
      const expectedRows = await tx
        .selectDistinct({
          baggageId: baggageItems.id,
          tagNumber: baggageItems.tagNumber,
          // The first active sector can have order > 1 when earlier legs were cancelled.
          hasPreviousLeg: sql<number>`exists (select 1 from booking_segments as prior
        where prior.bookingId = ${bookings.id} and prior.status <> 'cancelled'
          and prior.segmentOrder < ${bookingSegments.segmentOrder})`,
        })
        .from(baggageItems)
        .innerJoin(bookings, eq(bookings.id, baggageItems.bookingId))
        .leftJoin(
          bookingSegments,
          and(
            eq(bookingSegments.bookingId, bookings.id),
            eq(bookingSegments.flightId, flightId)
          )
        )
        .where(
          and(
            eq(bookings.tenantId, tenantId),
            inArray(bookings.status, ["confirmed", "completed"]),
            eq(bookings.paymentStatus, "paid"),
            or(
              and(
                eq(bookingSegments.flightId, flightId),
                ne(bookingSegments.status, "cancelled")
              ),
              and(
                eq(bookings.flightId, flightId),
                isNull(bookingSegments.id),
                sql`not exists (select 1 from booking_segments as leg where leg.bookingId = ${bookings.id})`
              )
            )
          )
        );
      const expected = expectedRows.map(row => ({
        baggageId: row.baggageId,
        tagNumber: row.tagNumber,
        entryStage: !Number(row.hasPreviousLeg)
          ? ("acceptance" as const)
          : ("transfer" as const),
      }));
      const events = await tx
        .select({
          baggageId: baggageCustodyEvents.baggageId,
          flightId: baggageCustodyEvents.flightId,
          stage: baggageCustodyEvents.stage,
        })
        .from(baggageCustodyEvents)
        .where(eq(baggageCustodyEvents.flightId, flightId));
      return reconcileBaggageCloseout(flightId, expected, events);
    },
    { isolationLevel: "repeatable read" }
  );
}
/** Called under the booking lock before changing an accepted bag's itinerary. */
export async function assertBaggageNotInCustody(
  tx: import("./booking-settlement.service").SettlementTx,
  bookingId: number
) {
  const bags = await tx
    .select({ id: baggageItems.id })
    .from(baggageItems)
    .where(eq(baggageItems.bookingId, bookingId));
  if (!bags.length) return;
  const [custody] = await tx
    .select({ id: baggageCustodyEvents.id })
    .from(baggageCustodyEvents)
    .where(
      inArray(
        baggageCustodyEvents.baggageId,
        bags.map(b => b.id)
      )
    )
    .limit(1);
  if (custody)
    throw new BaggageCustodyConflict(
      "Accepted baggage needs a verified rerouting workflow before itinerary exchange"
    );
}
