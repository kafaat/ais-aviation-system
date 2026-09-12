import { requireValue } from "./required-value";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { flights, airports, aviationEvidence } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  verifyAviationSource,
  persistAviationEvidence,
  type EvidenceEnvelope,
} from "./aviation-evidence.service";
import {
  carbonEvidenceSchema,
  carbonFromEvidence,
  travelRuleSchema,
  travelProfileSchema,
} from "./travel-evidence-policy";
import { calculateRequestHash } from "./idempotency-v2.service";
async function flightAndEvidence(
  flightId: number,
  kind: "carbon" | "travel_rules"
) {
  const db = await getDb();
  if (!db) throw new Error("Travel evidence storage unavailable");
  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight) throw new Error("Flight unavailable");
  const rows = await db
    .select()
    .from(aviationEvidence)
    .where(
      and(
        eq(aviationEvidence.flightId, flightId),
        eq(aviationEvidence.kind, kind)
      )
    )
    .orderBy(desc(aviationEvidence.observedAt), desc(aviationEvidence.id))
    .limit(201);
  if (rows.length > 200) throw new Error("Narrow travel evidence history");
  return { db, flight, rows: rows.filter(r => r.tenantId === flight.tenantId) };
}
export async function ingestTravelEvidence(
  e: EvidenceEnvelope,
  signature: string
) {
  if ((e.kind !== "carbon" && e.kind !== "travel_rules") || !e.flightId)
    throw new Error("Flight travel evidence required");
  const payload =
      e.kind === "carbon"
        ? carbonEvidenceSchema.parse(e.payload)
        : travelRuleSchema.parse(e.payload),
    source = verifyAviationSource(e, signature, e.kind);
  const db = await getDb();
  if (!db) throw new Error("Travel evidence storage unavailable");
  return db.transaction(async tx => {
    const [f] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, requireValue(e.flightId)))
      .for("update");
    if (
      !f ||
      f.tenantId !== source.tenantId ||
      !source.airlineIds?.includes(f.airlineId) ||
      f.destinationId !== payload.destinationId ||
      f.departureTime.getTime() !== Date.parse(payload.departureTime) ||
      Date.parse(payload.validUntil) <= Date.parse(e.observedAt)
    )
      throw new Error("Travel evidence does not match this operator schedule");
    if (e.kind === "carbon") {
      const c = carbonEvidenceSchema.parse(payload);
      if (
        c.originId !== f.originId ||
        (c.basis === "measured" && f.status !== "completed")
      )
        throw new Error("Carbon inputs do not match observed flight");
    }
    return persistAviationEvidence(tx, e, source);
  });
}
export async function sourcedCarbon(flightId: number) {
  const { flight, rows } = await flightAndEvidence(flightId, "carbon");
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.sourceId)) latest.set(r.sourceId, r);
  const row = latest.size === 1 ? [...latest.values()][0] : null,
    p = row ? carbonEvidenceSchema.parse(row.payload) : null;
  const fresh =
    p &&
    Date.parse(p.validUntil) > Date.now() &&
    p.originId === flight.originId &&
    p.destinationId === flight.destinationId &&
    Date.parse(p.departureTime) === flight.departureTime.getTime();
  const quote =
    fresh && p?.offsetQuote && Date.parse(p.offsetQuote.validUntil) > Date.now()
      ? p.offsetQuote
      : null;
  return {
    distanceKm: fresh ? p.distanceKm : null,
    co2Economy: fresh ? carbonFromEvidence(p).co2Economy : null,
    co2Business: fresh ? carbonFromEvidence(p).co2Business : null,
    treesEquivalent: null,
    offsetCostSAR: quote?.economyAmountMinor ?? null,
    offsetBusinessCostSAR: quote?.businessAmountMinor ?? null,
    offsetQuoteId: quote?.id ?? null,
    offsetReference: quote?.reference ?? null,
    method: fresh ? p.method : null,
    methodVersion: fresh ? p.version : null,
    reference: fresh ? p.reference : null,
    basis: fresh ? p.basis : ("unavailable" as const),
    sourceId: row?.sourceId ?? null,
    evidenceId: row?.id ?? null,
    observedAt: row?.observedAt ?? null,
    validUntil: p ? new Date(p.validUntil) : null,
  };
}
export async function sourcedTravelRequirements(
  flightId: number,
  raw?: z.infer<typeof travelProfileSchema>
) {
  const { db, flight, rows } = await flightAndEvidence(
      flightId,
      "travel_rules"
    ),
    profile = raw ? travelProfileSchema.parse(raw) : null;
  const [destination] = await db
    .select({
      code: airports.code,
      city: airports.city,
      country: airports.country,
    })
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);
  if (!destination) throw new Error("Destination data unavailable");
  const latest = new Map<
    string,
    {
      row: (typeof rows)[number];
      payload: z.infer<typeof travelRuleSchema>;
    }
  >();
  if (profile)
    for (const row of rows) {
      const p = travelRuleSchema.parse(row.payload);
      if (
        calculateRequestHash(p.profile) === calculateRequestHash(profile) &&
        !latest.has(row.sourceId)
      )
        latest.set(row.sourceId, { row, payload: p });
    }
  const evidence = latest.size === 1 ? [...latest.values()][0] : null,
    p = evidence?.payload;
  const fresh =
    p &&
    Date.parse(p.validUntil) > Date.now() &&
    p.destinationId === flight.destinationId &&
    Date.parse(p.departureTime) === flight.departureTime.getTime();
  return {
    destination,
    requirements: {
      visaRequired: fresh ? p.visaRequired : null,
      visaOnArrival: fresh ? p.visaOnArrival : null,
      passportValidityMonths: null,
      passportValidUntil: fresh ? p.passportValidUntil : null,
      covidTestRequired: fresh ? p.covidTestRequired : null,
      notes: fresh
        ? p.notes
        : [
            "يلزم مصدر ساري يطابق الجنسية والإقامة ونوع الوثيقة والغرض والعبور ومدة الزيارة.",
          ],
    },
    status: fresh ? ("sourced_requirements" as const) : ("unknown" as const),
    sourceId: evidence?.row.sourceId ?? null,
    evidenceId: evidence?.row.id ?? null,
    reference: fresh ? p.reference : null,
    version: fresh ? p.version : null,
    observedAt: evidence?.row.observedAt ?? null,
    validUntil: p ? new Date(p.validUntil) : null,
  };
}
