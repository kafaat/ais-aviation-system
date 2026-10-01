import { requireValue } from "./required-value";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { flights, aviationEvidence } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  persistAviationEvidence,
  verifyAviationSource,
  type EvidenceEnvelope,
} from "./aviation-evidence.service";
const amount = z.number().int().nonnegative().max(2147483647);
export const flightCostSchema = z
  .object({
    version: z.string().min(1).max(50),
    reference: z.string().min(1).max(200),
    currency: z.literal("SAR"),
    periodClosed: z.literal(true),
    routeDistanceKm: z.number().positive().max(25000),
    costs: z
      .object({
        fuel: amount,
        crew: amount,
        maintenance: amount,
        airport: amount,
        navigation: amount,
        insurance: amount,
        overhead: amount,
      })
      .strict(),
    recognizedRevenueMinor: amount.nullable(),
  })
  .strict();
export function costTotal(payload: z.infer<typeof flightCostSchema>) {
  const total = Object.values(payload.costs).reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total)) throw new Error("Invalid cost total");
  return total;
}
/** Seat configuration of the flight row as AIS held it when the closed cost
 * evidence was ingested. It is recorded beside the signed payload, never
 * inside it, so the source's digest and replays are untouched. It states what
 * the system knew at ingest; it does not prove the configuration the flight
 * actually operated with, which would need its own evidence. */
export const flightCapacitySnapshotSchema = z
  .object({
    kind: z.literal("flight_capacity_at_ingest"),
    source: z.literal("flights.row_at_ingest"),
    economySeats: z.number().int().nonnegative(),
    businessSeats: z.number().int().nonnegative(),
    flightStatus: z.string().min(1).max(30),
  })
  .strict();
export type FlightCapacitySnapshot = z.infer<
  typeof flightCapacitySnapshotSchema
>;
export type CapacityBasis = "ingest_snapshot" | "missing_ingest_snapshot";
export async function ingestFlightCost(e: EvidenceEnvelope, signature: string) {
  const payload = flightCostSchema.parse(e.payload),
    source = verifyAviationSource(e, signature, "flight_cost");
  costTotal(payload);
  if (e.kind !== "flight_cost" || !e.flightId)
    throw new Error("Flight cost evidence required");
  const db = await getDb();
  if (!db) throw new Error("Cost storage unavailable");
  return db.transaction(async tx => {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, requireValue(e.flightId)))
      .for("update");
    if (
      !flight ||
      flight.tenantId !== source.tenantId ||
      !source.airlineIds?.includes(flight.airlineId) ||
      flight.status !== "completed" ||
      flight.arrivalTime.getTime() > Date.parse(e.observedAt)
    )
      throw new Error(
        "Closed cost evidence must match a completed operator flight"
      );
    const snapshot: FlightCapacitySnapshot = {
      kind: "flight_capacity_at_ingest",
      source: "flights.row_at_ingest",
      economySeats: flight.economySeats,
      businessSeats: flight.businessSeats,
      flightStatus: flight.status,
    };
    return persistAviationEvidence(tx, e, source, {
      payload: snapshot,
      at: new Date(),
    });
  });
}
/** Full closed-flight snapshots replace earlier snapshots from the same source, never sum replays. */
export async function readFlightCosts(
  flightIds: number[],
  tenantId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Cost storage unavailable");
  if (flightIds.length > 1000) throw new Error("Narrow the flight cost window");
  const rows = flightIds.length
    ? await db
        .select()
        .from(aviationEvidence)
        .where(
          and(
            eq(aviationEvidence.kind, "flight_cost"),
            inArray(aviationEvidence.flightId, flightIds)
          )
        )
        .orderBy(desc(aviationEvidence.observedAt), desc(aviationEvidence.id))
        .limit(10001)
    : [];
  if (rows.length > 10000) throw new Error("Narrow the cost evidence window");
  const result = new Map<
    number,
    {
      evidenceId: number;
      sourceId: string;
      observedAt: Date;
      payload: z.infer<typeof flightCostSchema>;
      /** Null for evidence ingested before capacity snapshots existed. */
      capacity: (FlightCapacitySnapshot & { capturedAt: Date }) | null;
    }
  >();
  for (const id of flightIds) {
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows.filter(
      r =>
        r.flightId === id && (tenantId === undefined || r.tenantId === tenantId)
    ))
      if (!latest.has(row.sourceId)) latest.set(row.sourceId, row);
    if (latest.size !== 1) continue;
    const row = [...latest.values()][0];
    const parsedSnapshot = row.ingestSnapshot
      ? flightCapacitySnapshotSchema.safeParse(row.ingestSnapshot)
      : null;
    result.set(id, {
      evidenceId: row.id,
      sourceId: row.sourceId,
      observedAt: row.observedAt,
      payload: flightCostSchema.parse(row.payload),
      capacity:
        parsedSnapshot?.success && row.ingestSnapshotAt
          ? { ...parsedSnapshot.data, capturedAt: row.ingestSnapshotAt }
          : null,
    });
  }
  return result;
}
export async function getFlightEconomics(
  flightId: number,
  tenantId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Cost storage unavailable");
  const [f] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!f || (tenantId !== null && f.tenantId !== tenantId))
    throw new Error("Scoped flight unavailable");
  const cost = (await readFlightCosts([flightId], f.tenantId)).get(flightId);
  const total = cost ? costTotal(cost.payload) : null,
    revenue = cost?.payload.recognizedRevenueMinor ?? null;
  // ASK comes only from the capacity recorded at ingest. Reading the live
  // flight row here would let a later seat reconfiguration silently rewrite a
  // closed period's CASK and RASK; evidence without a snapshot reports the gap
  // instead of being backfilled with today's configuration.
  const capacity = cost?.capacity ?? null;
  const ask = capacity
    ? (capacity.economySeats + capacity.businessSeats) *
      requireValue(cost).payload.routeDistanceKm
    : null;
  const capacityBasis: CapacityBasis | null = cost
    ? capacity
      ? "ingest_snapshot"
      : "missing_ingest_snapshot"
    : null;
  return {
    flightId,
    sourceId: cost?.sourceId ?? null,
    evidenceId: cost?.evidenceId ?? null,
    observedAt: cost?.observedAt ?? null,
    currency: "SAR" as const,
    totalCostMinor: total,
    recognizedRevenueMinor: revenue,
    operatingResultMinor:
      total !== null && revenue !== null ? revenue - total : null,
    availableSeatKm: ask,
    caskMinor: ask && total !== null ? total / ask : null,
    raskMinor: ask && revenue !== null ? revenue / ask : null,
    capacityBasis,
    capacity: capacity
      ? {
          economySeats: capacity.economySeats,
          businessSeats: capacity.businessSeats,
          capturedAt: capacity.capturedAt,
        }
      : null,
    costs: cost?.payload.costs ?? null,
  };
}
