/**
 * IATA Resolution 753 baggage tracking.
 *
 * Licence plates follow IATA Resolution 740 (Passenger Services Conference
 * Resolutions Manual, "Form of Interline Baggage Tag"): a 10-digit numeric
 * licence plate made of one leading digit, the 3-digit airline numeric
 * (accounting) code and a 6-digit serial. Leading digit 0 is the normal
 * interline-compatible tag; 1–9 are reserved for fallback tags issued when the
 * primary tagging system is unavailable. The same licence plate keys the
 * Type B BSM/BPM messages (IATA RP 1745) another workstream generates.
 *
 * Resolution 753 (in force June 2018) requires tracking at four core points:
 * acceptance, loading, transfer and arrival/delivery. Security screening is an
 * optional extra point. Every row records who observed it and how, and
 * `origin` states whether AIS captured the point itself or imported it from a
 * verified handler source, so a counter entry is never shown as a scan.
 */
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  airlines,
  airports,
  baggageItems,
  baggageTracking,
  bagTagSequences,
  bagTrackingEvents,
  bookings,
  bookingSegments,
  flights,
  passengers,
  type BagTrackingEvent,
  type BaggageItem,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

export const TRACKING_POINTS = [
  "acceptance",
  "security",
  "loading",
  "transfer",
  "arrival",
] as const;
export type TrackingPoint = (typeof TRACKING_POINTS)[number];
/** The four mandatory Resolution 753 points. */
export const RESOLUTION_753_CORE_POINTS = [
  "acceptance",
  "loading",
  "transfer",
  "arrival",
] as const satisfies readonly TrackingPoint[];
export type ScanMethod = BagTrackingEvent["scanMethod"];
export type TrackingOrigin = BagTrackingEvent["origin"];
export type TrackingActorType = BagTrackingEvent["actorType"];

/** Same bag, same point, same station within this window is one observation. */
export const DUPLICATE_SCAN_WINDOW_MINUTES = 15;
/** Default lateness after scheduled arrival before a bag counts as mishandled. */
export const DEFAULT_MISHANDLING_HOURS = 4;
/** Published benchmarks for the KPI card (SITA Baggage IT Insights). */
export const MISHANDLING_BENCHMARKS = {
  sita2025GlobalPerThousand: 4.9,
  sita2024MiddleEastAfricaPerThousand: 6.02,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Licence plates (IATA Resolution 740)
// ────────────────────────────────────────────────────────────────────────────

export const LICENSE_PLATE_PATTERN = /^[0-9]{10}$/;
const AIRLINE_NUMERIC_CODE = /^[0-9]{3}$/;
const MAX_SERIAL = 999999;
const STATION_CODE = /^[A-Z]{3}$/;

export function formatLicensePlate(
  numericCode: string,
  serial: number,
  leadingDigit = 0
): string {
  if (!AIRLINE_NUMERIC_CODE.test(numericCode))
    throw new Error("Airline numeric code must be three digits");
  if (
    !Number.isInteger(serial) ||
    serial < 1 ||
    serial > MAX_SERIAL ||
    !Number.isInteger(leadingDigit) ||
    leadingDigit < 0 ||
    leadingDigit > 9
  )
    throw new Error("Licence-plate serial or leading digit out of range");
  return `${leadingDigit}${numericCode}${String(serial).padStart(6, "0")}`;
}

export function parseLicensePlate(plate: string) {
  if (!LICENSE_PLATE_PATTERN.test(plate)) return null;
  const leadingDigit = Number(plate[0]);
  return {
    leadingDigit,
    interline: leadingDigit === 0,
    airlineNumericCode: plate.slice(1, 4),
    serial: Number(plate.slice(4)),
  };
}

export class LicensePlateUnavailable extends TRPCError {
  constructor(message: string) {
    super({ code: "PRECONDITION_FAILED", message });
  }
}

/**
 * Allocate the next licence plate for an airline inside the caller's
 * transaction. The per-airline counter row is locked (SELECT ... FOR UPDATE)
 * so concurrent acceptances receive distinct, increasing serials; the
 * conditional update is a second guard for engines without row locks.
 */
export async function allocateLicensePlate(
  tx: SettlementTx,
  airlineId: number,
  options: { fallback?: boolean } = {}
): Promise<{ licensePlate: string; serial: number; numericCode: string }> {
  const [airline] = await tx
    .select()
    .from(airlines)
    .where(eq(airlines.id, airlineId))
    .limit(1);
  if (!airline)
    throw new TRPCError({ code: "NOT_FOUND", message: "Airline not found" });
  if (!airline.numericCode || !AIRLINE_NUMERIC_CODE.test(airline.numericCode))
    throw new LicensePlateUnavailable(
      "Airline numeric (accounting) code is not configured for licence-plate allocation"
    );
  const locked = () =>
    tx
      .select()
      .from(bagTagSequences)
      .where(eq(bagTagSequences.airlineId, airlineId))
      .limit(1)
      .for("update");
  let [row] = await locked();
  if (!row) {
    await tx
      .insert(bagTagSequences)
      .values({ airlineId, numericCode: airline.numericCode, nextSequence: 1 })
      .onDuplicateKeyUpdate({ set: { numericCode: airline.numericCode } });
    [row] = await locked();
  }
  if (!row) throw new Error("Licence-plate counter unavailable");
  const serial = row.nextSequence;
  if (serial > MAX_SERIAL)
    throw new LicensePlateUnavailable(
      "Licence-plate serial range exhausted for this airline; operator review required"
    );
  const [result] = await tx
    .update(bagTagSequences)
    .set({ nextSequence: serial + 1, numericCode: airline.numericCode })
    .where(
      and(
        eq(bagTagSequences.id, row.id),
        eq(bagTagSequences.nextSequence, serial)
      )
    );
  if (result.affectedRows !== 1)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Licence-plate counter changed concurrently",
    });
  return {
    licensePlate: formatLicensePlate(
      airline.numericCode,
      serial,
      options.fallback ? 1 : 0
    ),
    serial,
    numericCode: airline.numericCode,
  };
}

/** Allocation that degrades to `null` only when the airline has no numeric code. */
export async function tryAllocateLicensePlate(
  tx: SettlementTx,
  airlineId: number
): Promise<string | null> {
  try {
    return (await allocateLicensePlate(tx, airlineId)).licensePlate;
  } catch (error) {
    if (error instanceof LicensePlateUnavailable) return null;
    throw error;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tracking events (Resolution 753)
// ────────────────────────────────────────────────────────────────────────────

export interface RecordTrackingInput {
  baggageId: number;
  flightId: number;
  trackingPoint: TrackingPoint;
  /** IATA three-letter station code where the point was observed. */
  stationCode: string;
  airportId?: number | null;
  /** UTC observation time reported by the device or source. */
  observedAt: Date;
  /** Device or message source identifier. */
  sourceId: string;
  deviceId?: string | null;
  actorType: TrackingActorType;
  actorId?: string | null;
  scanMethod: ScanMethod;
  origin: TrackingOrigin;
  evidenceId?: number | null;
  containerId?: string | null;
}

const LEGACY_STATUS: Record<TrackingPoint, BaggageItem["status"]> = {
  acceptance: "checked_in",
  security: "security_screening",
  loading: "loading",
  transfer: "in_transit",
  arrival: "arrived",
};

export function isPhysicalScanProof(
  origin: TrackingOrigin,
  scanMethod: ScanMethod
) {
  // Only a scanner read reported by a verified handler source proves the bag
  // was physically present. A BSM is a message about a bag, not a scan of it,
  // and anything AIS captured itself is a system entry.
  return origin === "handler" && scanMethod === "scanner";
}

/**
 * Idempotently record a tracking point and project it onto the legacy
 * passenger-facing status/timeline. Returns the existing event when the same
 * bag/point/station was observed within DUPLICATE_SCAN_WINDOW_MINUTES.
 */
export async function recordBagTrackingEvent(
  tx: SettlementTx,
  input: RecordTrackingInput
): Promise<{ eventId: number; duplicate: boolean }> {
  const stationCode = input.stationCode.toUpperCase();
  if (!STATION_CODE.test(stationCode))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Station must be an IATA three-letter code",
    });
  if (Number.isNaN(input.observedAt.getTime()))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Observation time is invalid",
    });
  const [bag] = await tx
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.id, input.baggageId))
    .limit(1);
  if (!bag)
    throw new TRPCError({ code: "NOT_FOUND", message: "Bag not found" });
  const window = DUPLICATE_SCAN_WINDOW_MINUTES * 60000;
  const [existing] = await tx
    .select()
    .from(bagTrackingEvents)
    .where(
      and(
        eq(bagTrackingEvents.baggageId, input.baggageId),
        eq(bagTrackingEvents.trackingPoint, input.trackingPoint),
        eq(bagTrackingEvents.stationCode, stationCode),
        gte(
          bagTrackingEvents.observedAt,
          new Date(input.observedAt.getTime() - window)
        ),
        lte(
          bagTrackingEvents.observedAt,
          new Date(input.observedAt.getTime() + window)
        )
      )
    )
    .limit(1);
  if (existing) return { eventId: existing.id, duplicate: true };
  const [created] = await tx.insert(bagTrackingEvents).values({
    baggageId: input.baggageId,
    licensePlate: bag.licensePlate,
    flightId: input.flightId,
    trackingPoint: input.trackingPoint,
    stationCode,
    airportId: input.airportId ?? null,
    observedAt: input.observedAt,
    sourceId: input.sourceId,
    deviceId: input.deviceId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    scanMethod: input.scanMethod,
    origin: input.origin,
    physicalScanVerified: isPhysicalScanProof(input.origin, input.scanMethod),
    evidenceId: input.evidenceId ?? null,
    containerId: input.containerId ?? null,
  });
  const status = LEGACY_STATUS[input.trackingPoint];
  await tx
    .update(baggageItems)
    .set({ status, lastLocation: stationCode, updatedAt: new Date() })
    .where(eq(baggageItems.id, bag.id));
  await tx.insert(baggageTracking).values({
    baggageId: bag.id,
    location: stationCode,
    status,
    scannedAt: input.observedAt,
    notes:
      input.origin === "handler"
        ? `Handler ${input.scanMethod} evidence ${input.evidenceId ?? ""}`.trim()
        : `System ${input.scanMethod} entry (${input.trackingPoint})`,
  });
  return { eventId: created.insertId, duplicate: false };
}

// ────────────────────────────────────────────────────────────────────────────
// Derived status
// ────────────────────────────────────────────────────────────────────────────

export type DerivedBagStatus =
  | "not_tracked"
  | "accepted"
  | "screened"
  | "loaded"
  | "in_transfer"
  | "arrived";

const POINT_STATUS: Record<TrackingPoint, DerivedBagStatus> = {
  acceptance: "accepted",
  security: "screened",
  loading: "loaded",
  transfer: "in_transfer",
  arrival: "arrived",
};
const POINT_RANK: Record<TrackingPoint, number> = {
  acceptance: 0,
  security: 1,
  loading: 2,
  arrival: 3,
  transfer: 4,
};

export function deriveBagTrackingStatus(
  events: ReadonlyArray<
    Pick<
      BagTrackingEvent,
      "trackingPoint" | "observedAt" | "physicalScanVerified"
    >
  >
) {
  const ordered = [...events].sort(
    (a, b) =>
      a.observedAt.getTime() - b.observedAt.getTime() ||
      POINT_RANK[a.trackingPoint] - POINT_RANK[b.trackingPoint]
  );
  const last = ordered.at(-1);
  const observedPoints = Object.fromEntries(
    TRACKING_POINTS.map(point => [
      point,
      ordered.some(e => e.trackingPoint === point),
    ])
  ) as Record<TrackingPoint, boolean>;
  return {
    status: last ? POINT_STATUS[last.trackingPoint] : ("not_tracked" as const),
    lastPoint: last?.trackingPoint ?? null,
    lastObservedAt: last?.observedAt ?? null,
    observedPoints,
    corePointsObserved: RESOLUTION_753_CORE_POINTS.filter(
      p => observedPoints[p]
    ).length,
    physicalScanPoints: ordered.filter(e => e.physicalScanVerified).length,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Reads shared with the Type B (BSM/BPM) workstream
// ────────────────────────────────────────────────────────────────────────────

export interface BagTagRecord {
  baggageId: number;
  /** 10-digit Resolution 740 plate, or null for a legacy tag. */
  licensePlate: string | null;
  tagNumber: string;
  bookingId: number;
  pnr: string;
  passengerId: number;
  passengerSurname: string;
  passengerGivenName: string;
  weightKg: string;
  /** Itinerary flights in travel order (cancelled legs removed). */
  flightIds: number[];
  legacyStatus: BaggageItem["status"];
  derived: ReturnType<typeof deriveBagTrackingStatus>;
}
export type BagTrackingEventRecord = BagTrackingEvent;
export interface FlightBaggageSnapshot {
  flightId: number;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  departureTime: Date;
  arrivalTime: Date;
  bags: BagTagRecord[];
  events: BagTrackingEventRecord[];
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("Baggage storage unavailable");
  return db;
}

async function orderedItinerary(db: SettlementTx, bookingIds: number[]) {
  const legs = bookingIds.length
    ? await db
        .select()
        .from(bookingSegments)
        .where(inArray(bookingSegments.bookingId, bookingIds))
        .orderBy(asc(bookingSegments.segmentOrder))
    : [];
  return (booking: { id: number; flightId: number }) => {
    const own = legs.filter(l => l.bookingId === booking.id);
    return own.length
      ? own.filter(l => l.status !== "cancelled").map(l => l.flightId)
      : [booking.flightId];
  };
}

async function flightMemberBookings(db: SettlementTx, flightId: number) {
  const primary = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.flightId, flightId), isNull(bookings.deletedAt)));
  const segments = await db
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.flightId, flightId));
  const extraIds = segments
    .filter(s => s.status !== "cancelled")
    .map(s => s.bookingId)
    .filter(id => !primary.some(b => b.id === id));
  const extra = extraIds.length
    ? await db
        .select()
        .from(bookings)
        .where(and(inArray(bookings.id, extraIds), isNull(bookings.deletedAt)))
    : [];
  const itinerary = await orderedItinerary(db, [
    ...primary.map(b => b.id),
    ...extra.map(b => b.id),
  ]);
  return [...primary, ...extra].filter(
    b =>
      ["confirmed", "completed"].includes(b.status) &&
      itinerary(b).includes(flightId)
  );
}

async function bagRecords(
  db: SettlementTx,
  items: BaggageItem[],
  eventsByBag: Map<number, BagTrackingEvent[]>
): Promise<BagTagRecord[]> {
  if (!items.length) return [];
  const bookingIds = [...new Set(items.map(i => i.bookingId))];
  const bookingRows = await db
    .select()
    .from(bookings)
    .where(inArray(bookings.id, bookingIds));
  const passengerRows = await db
    .select()
    .from(passengers)
    .where(inArray(passengers.id, [...new Set(items.map(i => i.passengerId))]));
  const itinerary = await orderedItinerary(db, bookingIds);
  return items.flatMap(item => {
    const booking = bookingRows.find(b => b.id === item.bookingId);
    const passenger = passengerRows.find(p => p.id === item.passengerId);
    if (!booking || !passenger) return [];
    return [
      {
        baggageId: item.id,
        licensePlate: item.licensePlate,
        tagNumber: item.tagNumber,
        bookingId: booking.id,
        pnr: booking.pnr,
        passengerId: passenger.id,
        passengerSurname: passenger.lastName,
        passengerGivenName: passenger.firstName,
        weightKg: item.weight,
        flightIds: itinerary(booking),
        legacyStatus: item.status,
        derived: deriveBagTrackingStatus(eventsByBag.get(item.id) ?? []),
      },
    ];
  });
}

function groupEvents(events: BagTrackingEvent[]) {
  const byBag = new Map<number, BagTrackingEvent[]>();
  for (const e of events)
    byBag.set(e.baggageId, [...(byBag.get(e.baggageId) ?? []), e]);
  return byBag;
}

/**
 * Stable read for BSM/BPM generation: every bag routed over a flight, with its
 * licence plate, passenger name, PNR and all tracking events for that flight.
 */
export async function readBagTrackingForFlight(
  flightId: number
): Promise<FlightBaggageSnapshot> {
  const db = requireDb();
  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  const stations = await db
    .select()
    .from(airports)
    .where(inArray(airports.id, [flight.originId, flight.destinationId]));
  const members = await flightMemberBookings(db, flightId);
  const items = members.length
    ? await db
        .select()
        .from(baggageItems)
        .where(
          inArray(
            baggageItems.bookingId,
            members.map(b => b.id)
          )
        )
    : [];
  const events = items.length
    ? await db
        .select()
        .from(bagTrackingEvents)
        .where(
          inArray(
            bagTrackingEvents.baggageId,
            items.map(i => i.id)
          )
        )
        .orderBy(asc(bagTrackingEvents.observedAt))
    : [];
  return {
    flightId,
    flightNumber: flight.flightNumber,
    originCode: stations.find(a => a.id === flight.originId)?.code ?? "",
    destinationCode:
      stations.find(a => a.id === flight.destinationId)?.code ?? "",
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    bags: await bagRecords(db, items, groupEvents(events)),
    events,
  };
}

export async function findBagByIdentifier(identifier: string) {
  const db = requireDb();
  const value = identifier.trim().toUpperCase();
  const [byPlate] = LICENSE_PLATE_PATTERN.test(value)
    ? await db
        .select()
        .from(baggageItems)
        .where(eq(baggageItems.licensePlate, value))
        .limit(1)
    : [];
  if (byPlate) return byPlate;
  const [byTag] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.tagNumber, value))
    .limit(1);
  return byTag ?? null;
}

/** Stable read for a single bag by licence plate (or legacy tag). */
export async function readBagTrackingByIdentifier(identifier: string): Promise<{
  bag: BagTagRecord;
  events: BagTrackingEventRecord[];
} | null> {
  const db = requireDb();
  const item = await findBagByIdentifier(identifier);
  if (!item) return null;
  const events = await db
    .select()
    .from(bagTrackingEvents)
    .where(eq(bagTrackingEvents.baggageId, item.id))
    .orderBy(asc(bagTrackingEvents.observedAt));
  const [bag] = await bagRecords(db, [item], groupEvents(events));
  return bag ? { bag, events } : null;
}

/** Per-leg required points with the observed event for the admin timeline. */
export function requiredPointsTimeline(
  flightIds: number[],
  events: ReadonlyArray<BagTrackingEvent>
) {
  return flightIds.map((flightId, index) => ({
    flightId,
    points: (
      [
        index === 0 ? "acceptance" : "transfer",
        "security",
        "loading",
        "arrival",
      ] as const
    ).map(point => ({
      point,
      required: point !== "security",
      event:
        events.find(
          e => e.flightId === flightId && e.trackingPoint === point
        ) ?? null,
    })),
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Public tracker (licence plate + surname or booking reference)
// ────────────────────────────────────────────────────────────────────────────

export async function trackByLicensePlate(input: {
  licensePlate: string;
  surname?: string;
  bookingReference?: string;
}) {
  const plate = input.licensePlate.trim();
  if (!LICENSE_PLATE_PATTERN.test(plate)) return null;
  const surname = input.surname?.trim().toUpperCase();
  const reference = input.bookingReference?.trim().toUpperCase();
  if (!surname && !reference) return null;
  const record = await readBagTrackingByIdentifier(plate);
  if (!record) return null;
  const db = requireDb();
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, record.bag.bookingId))
    .limit(1);
  const matches =
    (surname && record.bag.passengerSurname.toUpperCase() === surname) ||
    (reference &&
      booking &&
      [
        booking.bookingReference?.toUpperCase(),
        booking.pnr.toUpperCase(),
      ].includes(reference));
  if (!matches) return null;
  // Allow-list only: no identifiers of people, bookings, devices or sources.
  return {
    licensePlate: plate,
    status: record.bag.derived.status,
    lastStationCode: record.events.at(-1)?.stationCode ?? null,
    lastObservedAt: record.bag.derived.lastObservedAt,
    points: record.events.map(e => ({
      trackingPoint: e.trackingPoint,
      stationCode: e.stationCode,
      observedAt: e.observedAt,
      physicalScanVerified: e.physicalScanVerified,
    })),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Flight close-out reconciliation
// ────────────────────────────────────────────────────────────────────────────

export interface CloseOutBag {
  baggageId: number;
  licensePlate: string | null;
  tagNumber: string;
  passengerId: number;
  passengerSurname: string;
  pnr: string;
  /** Acceptance/transfer evidence on this flight, or a legacy untracked registration. */
  accepted: boolean;
  trackedOnFlight: boolean;
  loaded: boolean;
  containerId: string | null;
}
export interface CloseOutPassenger {
  passengerId: number;
  surname: string;
  givenName: string;
  pnr: string;
  checkedIn: boolean;
}
export type BoardingEvidence =
  | { source: "none" }
  | { source: "provided"; passengerIds: number[] };

/** Pure reconciliation used by the DCS endpoint and by tests. */
export function reconcileCloseOut(
  bags: CloseOutBag[],
  people: CloseOutPassenger[],
  boarding: BoardingEvidence
) {
  const boarded =
    boarding.source === "provided" ? new Set(boarding.passengerIds) : null;
  return {
    boardingEvidence: boarding.source,
    acceptedNotLoaded: bags.filter(b => b.accepted && !b.loaded),
    // Security rule: no bag flies without its passenger. Only computable when a
    // per-passenger boarding record exists; otherwise null, never "all clear".
    loadedForNotBoarded: boarded
      ? bags.filter(b => b.loaded && !boarded.has(b.passengerId))
      : null,
    boardedWithoutLoadedBags: boarded
      ? people.filter(
          p =>
            boarded.has(p.passengerId) &&
            bags.some(
              b => b.passengerId === p.passengerId && b.accepted && !b.loaded
            )
        )
      : null,
    totals: {
      bags: bags.length,
      accepted: bags.filter(b => b.accepted).length,
      loaded: bags.filter(b => b.loaded).length,
      passengers: people.length,
      boarded: boarded
        ? people.filter(p => boarded.has(p.passengerId)).length
        : null,
    },
  };
}

export async function getFlightBaggageCloseOut(
  flightId: number,
  options: { boardedPassengerIds?: number[] } = {}
) {
  const snapshot = await readBagTrackingForFlight(flightId);
  const db = requireDb();
  const members = await flightMemberBookings(db, flightId);
  const people = members.length
    ? await db
        .select()
        .from(passengers)
        .where(
          inArray(
            passengers.bookingId,
            members.map(b => b.id)
          )
        )
    : [];
  const checkedIn = new Set(
    (
      await db
        .select()
        .from(bookings)
        .where(
          and(eq(bookings.flightId, flightId), eq(bookings.checkedIn, true))
        )
    ).map(b => b.id)
  );
  const bags: CloseOutBag[] = snapshot.bags.map(bag => {
    const onFlight = snapshot.events.filter(
      e => e.baggageId === bag.baggageId && e.flightId === flightId
    );
    const anyEvents = snapshot.events.some(e => e.baggageId === bag.baggageId);
    const loading = onFlight.find(e => e.trackingPoint === "loading");
    return {
      baggageId: bag.baggageId,
      licensePlate: bag.licensePlate,
      tagNumber: bag.tagNumber,
      passengerId: bag.passengerId,
      passengerSurname: bag.passengerSurname,
      pnr: bag.pnr,
      accepted:
        onFlight.some(e =>
          ["acceptance", "transfer"].includes(e.trackingPoint)
        ) ||
        (!anyEvents && bag.flightIds[0] === flightId),
      trackedOnFlight: onFlight.length > 0,
      loaded: Boolean(loading),
      containerId: loading?.containerId ?? null,
    };
  });
  const reconciliation = reconcileCloseOut(
    bags,
    people.map(p => ({
      passengerId: p.id,
      surname: p.lastName,
      givenName: p.firstName,
      pnr: members.find(b => b.id === p.bookingId)?.pnr ?? "",
      checkedIn: checkedIn.has(p.bookingId),
    })),
    options.boardedPassengerIds
      ? { source: "provided", passengerIds: options.boardedPassengerIds }
      : { source: "none" }
  );
  return {
    flight: {
      id: snapshot.flightId,
      flightNumber: snapshot.flightNumber,
      originCode: snapshot.originCode,
      destinationCode: snapshot.destinationCode,
      departureTime: snapshot.departureTime,
    },
    generatedAt: new Date(),
    ...reconciliation,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// KPI: mishandled-bag proxy per 1,000 passengers
// ────────────────────────────────────────────────────────────────────────────

export async function getMishandledBaggageKpi(input: {
  from: Date;
  to: Date;
  hoursAfterArrival?: number;
  now?: Date;
}) {
  const hours = input.hoursAfterArrival ?? DEFAULT_MISHANDLING_HOURS;
  const now = input.now ?? new Date();
  const db = requireDb();
  const candidates = await db
    .select()
    .from(flights)
    .where(
      and(
        gte(flights.arrivalTime, input.from),
        lte(flights.arrivalTime, input.to)
      )
    );
  const due = candidates.filter(
    f =>
      f.status !== "cancelled" &&
      f.arrivalTime.getTime() + hours * 3600000 <= now.getTime()
  );
  let passengerCount = 0;
  let bagsTracked = 0;
  let bagsWithoutArrival = 0;
  const flightsOut = [];
  for (const flight of due) {
    const snapshot = await readBagTrackingForFlight(flight.id);
    const members = await flightMemberBookings(db, flight.id);
    const people = members.length
      ? await db
          .select()
          .from(passengers)
          .where(
            inArray(
              passengers.bookingId,
              members.map(b => b.id)
            )
          )
      : [];
    const deadline = flight.arrivalTime.getTime() + hours * 3600000;
    let missing = 0;
    let tracked = 0;
    for (const bag of snapshot.bags) {
      const onFlight = snapshot.events.filter(
        e => e.baggageId === bag.baggageId && e.flightId === flight.id
      );
      if (!onFlight.length) continue;
      tracked++;
      if (
        !onFlight.some(
          e =>
            e.trackingPoint === "arrival" && e.observedAt.getTime() <= deadline
        )
      )
        missing++;
    }
    passengerCount += people.length;
    bagsTracked += tracked;
    bagsWithoutArrival += missing;
    flightsOut.push({
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      arrivalTime: flight.arrivalTime,
      passengers: people.length,
      bagsTracked: tracked,
      bagsWithoutArrival: missing,
    });
  }
  return {
    window: { from: input.from, to: input.to, hoursAfterArrival: hours },
    flights: flightsOut,
    passengers: passengerCount,
    bagsTracked,
    bagsWithoutArrival,
    perThousandPassengers:
      passengerCount > 0
        ? Math.round((bagsWithoutArrival / passengerCount) * 1000 * 100) / 100
        : null,
    benchmarks: MISHANDLING_BENCHMARKS,
    method:
      "Proxy: tracked bags with no arrival event within the window after scheduled arrival, over manifest passengers of flights whose window has elapsed. Not a WorldTracer PIR count.",
  };
}
