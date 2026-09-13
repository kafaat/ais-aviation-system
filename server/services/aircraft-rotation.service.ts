import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  airlines,
  flights,
  aviationEvidence,
  aircraftRotations,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  verifyAviationSource,
  requireCurrentAviationSource,
  persistAviationEvidence,
  type EvidenceEnvelope,
} from "./aviation-evidence.service";
import type { SettlementTx } from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";
import { calculateRequestHash } from "./idempotency-v2.service";
import { assertTenantOperational } from "./tenant.service";
export const maintenanceSchema = z
  .object({
    airlineId: z.number().int().positive(),
    tailNumber: z.string().regex(/^[A-Z0-9-]{2,20}$/),
    aircraftType: z.string().min(1).max(50),
    status: z.enum(["released", "grounded"]),
    validUntil: z.iso.datetime(),
    reference: z.string().min(1).max(200),
    minimumTurnaroundMinutes: z.number().int().positive().max(720),
  })
  .strict();
export async function ingestMaintenance(
  e: EvidenceEnvelope,
  signature: string
) {
  const p = maintenanceSchema.parse(e.payload),
    source = verifyAviationSource(e, signature, "maintenance");
  if (
    e.kind !== "maintenance" ||
    e.flightId !== null ||
    !source.airlineIds?.includes(p.airlineId) ||
    Date.parse(p.validUntil) <= Date.parse(e.observedAt)
  )
    throw new Error("Invalid operator maintenance envelope");
  const db = await getDb();
  if (!db) throw new Error("Maintenance storage unavailable");
  return db.transaction(async tx => {
    const [a] = await tx
      .select()
      .from(airlines)
      .where(eq(airlines.id, p.airlineId))
      .for("update");
    if (!a) throw new Error("Operator unavailable");
    return persistAviationEvidence(tx, e, source);
  });
}
export async function readMaintenance(
  tx: SettlementTx,
  airlineId: number,
  tailNumber: string,
  tenantId: number | null
) {
  const rows = await tx
    .select()
    .from(aviationEvidence)
    .where(
      and(
        eq(aviationEvidence.kind, "maintenance"),
        sql`${aviationEvidence.tenantId} <=> ${tenantId}`,
        sql`JSON_EXTRACT(${aviationEvidence.payload},'$.airlineId') = ${airlineId}`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${aviationEvidence.payload},'$.tailNumber')) = ${tailNumber}`
      )
    )
    .orderBy(desc(aviationEvidence.observedAt), desc(aviationEvidence.id))
    .limit(201);
  if (rows.length > 200) throw new Error("Narrow maintenance history");
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.sourceId)) latest.set(r.sourceId, r);
  if (latest.size !== 1)
    throw new Error(
      "Exactly one authoritative tail maintenance source is required"
    );
  const row = [...latest.values()][0];
  requireCurrentAviationSource(
    row.sourceId,
    "maintenance",
    tenantId,
    airlineId
  );
  return {
    evidenceId: row.id,
    sourceId: row.sourceId,
    observedAt: row.observedAt,
    payload: maintenanceSchema.parse(row.payload),
  };
}
export function validateRotation(
  legs: Array<{
    id: number;
    originId: number;
    destinationId: number;
    departureTime: Date;
    arrivalTime: Date;
  }>,
  minimumTurnaroundMinutes: number
) {
  const sorted = [...legs].sort(
    (a, b) => a.departureTime.getTime() - b.departureTime.getTime()
  );
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i],
      prev = sorted[i - 1];
    if (
      !Number.isFinite(f.departureTime.getTime()) ||
      !Number.isFinite(f.arrivalTime.getTime()) ||
      f.arrivalTime <= f.departureTime
    )
      throw new Error("Invalid rotation schedule");
    if (
      prev &&
      (prev.destinationId !== f.originId ||
        f.departureTime.getTime() - prev.arrivalTime.getTime() <
          minimumTurnaroundMinutes * 60000)
    )
      throw new Error("Aircraft continuity or turnaround conflict");
  }
}
export async function assignAircraftRotation(
  flightId: number,
  tailNumber: string,
  actorId: number,
  tenantId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Rotation storage unavailable");
  const [hint] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!hint) throw new Error("Flight unavailable");
  return db.transaction(async tx => {
    // Operator lock serializes both maintenance and tail assignments, including first use of a tail.
    await tx
      .select()
      .from(airlines)
      .where(eq(airlines.id, hint.airlineId))
      .for("update");
    const rotations = await tx
      .select()
      .from(aircraftRotations)
      .where(
        and(
          eq(aircraftRotations.airlineId, hint.airlineId),
          eq(aircraftRotations.tailNumber, tailNumber)
        )
      )
      .limit(1001);
    if (rotations.length > 1000)
      throw new Error("Archive the completed rotation history");
    const ids = [
      ...new Set([flightId, ...rotations.map(r => r.flightId)]),
    ].sort((a, b) => a - b);
    const planned = await tx
      .select()
      .from(flights)
      .where(inArray(flights.id, ids))
      .orderBy(flights.id)
      .for("update");
    const flight = planned.find(f => f.id === flightId);
    if (
      !flight ||
      flight.airlineId !== hint.airlineId ||
      (tenantId !== null && flight.tenantId !== tenantId) ||
      flight.departureTime <= new Date() ||
      !["scheduled", "delayed"].includes(flight.status)
    )
      throw new Error("Scoped future flight required");
    await assertTenantOperational(tx, flight.tenantId);
    const release = await readMaintenance(
      tx,
      flight.airlineId,
      tailNumber,
      flight.tenantId
    );
    if (
      release.payload.status !== "released" ||
      release.payload.aircraftType !== flight.aircraftType ||
      Date.parse(release.payload.validUntil) < flight.arrivalTime.getTime()
    )
      throw new Error(
        "Maintenance release does not cover this aircraft and flight"
      );
    const active = planned.filter(
      f =>
        f.status !== "cancelled" &&
        f.arrivalTime.getTime() > Date.now() - 86400000
    );
    if (
      active.some(
        f =>
          f.tenantId !== flight.tenantId ||
          f.aircraftType !== flight.aircraftType
      )
    )
      throw new Error("Tail crosses operator scope or aircraft type");
    validateRotation(active, release.payload.minimumTurnaroundMinutes);
    const scheduleDigest = calculateRequestHash({
      flightId,
      tailNumber,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      originId: flight.originId,
      destinationId: flight.destinationId,
    });
    const data = {
      flightId,
      airlineId: flight.airlineId,
      tenantId: flight.tenantId,
      tailNumber,
      maintenanceEvidenceId: release.evidenceId,
      scheduleDigest,
      assignedBy: actorId,
    };
    await tx
      .insert(aircraftRotations)
      .values(data)
      .onDuplicateKeyUpdate({ set: data });
    const receiptId = await recordEvent(tx, {
      aggregateType: "flight",
      aggregateId: flightId,
      tenantId: flight.tenantId,
      eventType: "aircraft.rotation_planned",
      payload: { ...data, acceptance: "planning_only_dispatch_required" },
    });
    return {
      flightId,
      tailNumber,
      maintenanceEvidenceId: release.evidenceId,
      receiptId,
      acceptance: "planning_only_dispatch_required" as const,
    };
  });
}
