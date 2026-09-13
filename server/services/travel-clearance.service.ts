import { requireValue } from "./required-value";
import { apisData } from "../../drizzle/operations-schema";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  bookings,
  bookingSegments,
  passengers,
  flights,
  airports,
  aviationEvidence,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { calculateRequestHash } from "./idempotency-v2.service";
import {
  verifyAviationSource,
  persistAviationEvidence,
  type EvidenceEnvelope,
} from "./aviation-evidence.service";
import type { SettlementTx } from "./booking-settlement.service";
export const clearanceSchema = z
  .object({
    bookingId: z.number().int().positive(),
    passengerId: z.number().int().positive(),
    documentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    itineraryDigest: z.string().regex(/^[a-f0-9]{64}$/),
    verdict: z.enum(["cleared", "review_required", "denied"]),
    validUntil: z.iso.datetime(),
    providerTransactionId: z.string().min(1).max(100),
    reference: z.string().min(1).max(200),
  })
  .strict();
export async function documentContext(
  tx: SettlementTx,
  bookingId: number,
  passengerId: number
) {
  const [b] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!b) throw new Error("Booking unavailable");
  const legs = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, bookingId))
    .orderBy(asc(bookingSegments.segmentOrder));
  const ids = legs.length
    ? legs
        .filter(l => l.status === "confirmed" || l.status === "pending")
        .map(l => l.flightId)
    : [b.flightId];
  const fs = await tx
    .select()
    .from(flights)
    .where(inArray(flights.id, ids))
    .orderBy(flights.id)
    .for("update");
  if (fs.length !== ids.length) throw new Error("Itinerary is incomplete");
  const [p] = await tx
    .select()
    .from(passengers)
    .where(
      and(eq(passengers.id, passengerId), eq(passengers.bookingId, bookingId))
    )
    .limit(1)
    .for("update");
  if (!p) throw new Error("Passenger booking unavailable");
  const ordered = ids.map(id => requireValue(fs.find(f => f.id === id)));
  const airportRows = await tx
    .select()
    .from(airports)
    .where(
      inArray(airports.id, [
        ...new Set(fs.flatMap(f => [f.originId, f.destinationId])),
      ])
    );
  if (
    airportRows.length !==
      new Set(fs.flatMap(f => [f.originId, f.destinationId])).size ||
    airportRows.some(a => !a.country.trim())
  )
    throw new Error("Airport country evidence unavailable");
  const international =
    new Set(airportRows.map(a => a.country.trim().toUpperCase())).size > 1;
  const [apis] = await tx
    .select()
    .from(apisData)
    .where(eq(apisData.passengerId, passengerId))
    .limit(1)
    .for("update");
  const documentDigest = calculateRequestHash({
    apis: apis
      ? {
          documentType: apis.documentType,
          documentNumber: apis.documentNumber,
          issuingCountry: apis.issuingCountry,
          nationality: apis.nationality,
          dateOfBirth: apis.dateOfBirth,
          gender: apis.gender,
          expiryDate: apis.expiryDate,
          givenNames: apis.givenNames,
          surname: apis.surname,
          residenceCountry: apis.residenceCountry,
          residenceAddress: apis.residenceAddress,
          destinationAddress: apis.destinationAddress,
          redressNumber: apis.redressNumber,
          knownTravelerNumber: apis.knownTravelerNumber,
        }
      : null,
    passengerId: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: p.dateOfBirth,
    nationality: p.nationality,
    passportNumber: p.passportNumber,
    passportExpiry: p.passportExpiry,
  });
  const itineraryDigest = calculateRequestHash(
    ordered.map(f => ({
      id: f.id,
      originId: f.originId,
      destinationId: f.destinationId,
      departureTime: f.departureTime,
      arrivalTime: f.arrivalTime,
    }))
  );
  return {
    booking: b,
    passenger: p,
    legs: ordered,
    international,
    documentDigest,
    itineraryDigest,
  };
}
export async function ingestTravelClearance(
  e: EvidenceEnvelope,
  signature: string
) {
  const p = clearanceSchema.parse(e.payload),
    source = verifyAviationSource(e, signature, "travel_clearance");
  if (e.kind !== "travel_clearance" || !e.flightId)
    throw new Error("Flight document clearance required");
  const db = await getDb();
  if (!db) throw new Error("Document evidence storage unavailable");
  return db.transaction(async tx => {
    await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, p.bookingId))
      .for("update");
    const c = await documentContext(tx, p.bookingId, p.passengerId);
    if (
      c.booking.tenantId !== source.tenantId ||
      c.booking.flightId !== e.flightId ||
      !c.legs.every(f => source.airlineIds?.includes(f.airlineId)) ||
      p.documentDigest !== c.documentDigest ||
      p.itineraryDigest !== c.itineraryDigest ||
      Date.parse(p.validUntil) <= Date.parse(e.observedAt)
    )
      throw new Error(
        "Clearance does not match current documents and itinerary"
      );
    return persistAviationEvidence(tx, e, source);
  });
}
export async function assertTravelClearance(
  tx: SettlementTx,
  bookingId: number,
  passengerId: number
) {
  const c = await documentContext(tx, bookingId, passengerId);
  if (!c.international) return { required: false, evidenceId: null };
  const rows = await tx
    .select()
    .from(aviationEvidence)
    .where(
      and(
        eq(aviationEvidence.kind, "travel_clearance"),
        eq(aviationEvidence.flightId, c.booking.flightId)
      )
    )
    .orderBy(desc(aviationEvidence.observedAt), desc(aviationEvidence.id))
    .limit(1001);
  if (rows.length > 1000) throw new Error("Document evidence window exceeded");
  const latest = new Map<
    string,
    {
      id: number;
      p: z.infer<typeof clearanceSchema>;
    }
  >();
  for (const r of rows) {
    const p = clearanceSchema.parse(r.payload);
    if (
      r.tenantId === c.booking.tenantId &&
      p.bookingId === bookingId &&
      p.passengerId === passengerId &&
      !latest.has(r.sourceId)
    )
      latest.set(r.sourceId, { id: r.id, p });
  }
  const e = latest.size === 1 ? [...latest.values()][0] : null;
  if (
    !e ||
    e.p.verdict !== "cleared" ||
    e.p.documentDigest !== c.documentDigest ||
    e.p.itineraryDigest !== c.itineraryDigest ||
    Date.parse(e.p.validUntil) <
      Math.max(Date.now(), ...c.legs.map(f => f.departureTime.getTime()))
  )
    throw new Error(
      "International check-in requires current operator document clearance for this passenger and itinerary"
    );
  return { required: true, evidenceId: e.id };
}
export async function getClearanceContext(
  bookingId: number,
  passengerId: number,
  tenantId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Document storage unavailable");
  return db.transaction(async tx => {
    await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");
    const c = await documentContext(tx, bookingId, passengerId);
    if (tenantId !== null && c.booking.tenantId !== tenantId)
      throw new Error("Booking outside tenant");
    return {
      bookingId,
      passengerId,
      flightId: c.booking.flightId,
      documentDigest: c.documentDigest,
      itineraryDigest: c.itineraryDigest,
      international: c.international,
    };
  });
}
