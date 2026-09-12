import { and, eq, gte, lte, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { aviationEvidence, flights } from "../../drizzle/schema";
import {
  evidenceEnvelope,
  verifyAviationSource,
  persistAviationEvidence,
  type EvidenceEnvelope,
} from "./aviation-evidence.service";
import { assertTenantOperational } from "./tenant.service";

const operationalKind = z.enum([
  "departure_estimate",
  "departure_actual",
  "arrival_actual",
  "tobt",
  "tsat",
]);
const timePayload = z.object({ time: z.iso.datetime() }).strict();
export async function ingestOperationalEvent(
  envelope: EvidenceEnvelope,
  signature: string
) {
  const e = evidenceEnvelope.parse(envelope);
  operationalKind.parse(e.kind);
  timePayload.parse(e.payload);
  const source = verifyAviationSource(e, signature, "operations");
  if (e.flightId === null) throw new Error("A flight instance ID is required");
  const db = await getDb();
  if (!db) throw new Error("Operations storage unavailable");
  return db.transaction(async tx => {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, e.flightId as number))
      .for("update");
    if (!flight || flight.tenantId !== source.tenantId)
      throw new Error("Source cannot write this flight instance");
    await assertTenantOperational(tx, flight.tenantId);
    const time = Date.parse(timePayload.parse(e.payload).time);
    if (
      Math.abs(time - flight.departureTime.getTime()) > 7 * 86400000 ||
      (e.kind.endsWith("actual") && time > Date.parse(e.observedAt) + 60000)
    )
      throw new Error(
        "Operational timestamp is inconsistent with this flight instance"
      );
    return persistAviationEvidence(tx, e, source);
  });
}
export function departureEvidence(
  rows: Array<typeof aviationEvidence.$inferSelect>,
  scheduled: Date,
  now = new Date()
) {
  const eligible = rows.filter(
    e =>
      ["departure_actual", "departure_estimate"].includes(e.kind) &&
      e.observedAt <= now
  );
  const newest = (kind: string) =>
    eligible
      .filter(e => e.kind === kind)
      .sort(
        (a, b) => b.observedAt.getTime() - a.observedAt.getTime() || b.id - a.id
      )[0];
  const event = newest("departure_actual") ?? newest("departure_estimate");
  if (!event)
    return {
      delayMinutes: null,
      basis: "unavailable" as const,
      sourceId: null,
      evidenceId: null,
      observedAt: null,
      fresh: false,
    };
  const observed = event.kind === "departure_actual";
  const fresh =
    observed || now.getTime() - event.observedAt.getTime() <= 15 * 60000;
  const delay = Math.max(
    0,
    Math.round(
      (Date.parse(timePayload.parse(event.payload).time) -
        scheduled.getTime()) /
        60000
    )
  );
  return {
    delayMinutes: fresh ? delay : null,
    basis: observed ? ("observed" as const) : ("partner_estimate" as const),
    sourceId: event.sourceId,
    evidenceId: event.id,
    observedAt: event.observedAt,
    fresh,
  };
}
export async function getOperationalDeparture(
  flightId: number,
  tenantId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Operations storage unavailable");
  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight || (tenantId != null && flight.tenantId !== tenantId))
    throw new Error("Flight not found");
  const events = await db
    .select()
    .from(aviationEvidence)
    .where(
      and(
        eq(aviationEvidence.flightId, flightId),
        inArray(aviationEvidence.kind, [
          "departure_actual",
          "departure_estimate",
        ])
      )
    )
    .orderBy(desc(aviationEvidence.observedAt))
    .limit(1001);
  if (events.length > 1000)
    throw new Error("Operational event window exceeds projection limit");
  return {
    flightId,
    flightNumber: flight.flightNumber,
    scheduledDeparture: flight.departureTime,
    ...departureEvidence(events, flight.departureTime),
  };
}
export async function getObservedOperations(from: Date, to: Date) {
  const db = await getDb();
  if (!db) throw new Error("Operations storage unavailable");
  const rows = await db
    .select({
      flightId: flights.id,
      scheduled: flights.departureTime,
      evidence: aviationEvidence,
    })
    .from(aviationEvidence)
    .innerJoin(flights, eq(flights.id, aviationEvidence.flightId))
    .where(
      and(
        eq(aviationEvidence.kind, "departure_actual"),
        gte(flights.departureTime, from),
        lte(flights.departureTime, to)
      )
    )
    .orderBy(desc(aviationEvidence.observedAt), desc(aviationEvidence.id))
    .limit(10001);
  if (rows.length > 10000)
    throw new Error("Observation window exceeds projection limit");
  const seen = new Set<number>();
  const delays: number[] = [];
  for (const row of rows) {
    if (seen.has(row.flightId)) continue;
    seen.add(row.flightId);
    const projection = departureEvidence([row.evidence], row.scheduled);
    if (projection.delayMinutes !== null) delays.push(projection.delayMinutes);
  }
  return {
    sampleCount: delays.length,
    otp: delays.length
      ? (100 * delays.filter(d => d <= 15).length) / delays.length
      : null,
    averageDelay: delays.length
      ? delays.reduce((a, b) => a + b, 0) / delays.length
      : null,
  };
}
