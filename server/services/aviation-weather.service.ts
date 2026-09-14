/** Aviation weather ingestion and advisory (R2-10).
 *
 * This service stores station bulletins and classifies them. It is deliberately
 * *not* an operational authority:
 *
 *  - It never changes a flight, a booking, a gate or an inventory row.
 *  - It never manufactures a bulletin. A field with no recorded station, no
 *    stored bulletin, or only an expired one is reported as uncovered, and an
 *    uncovered field is never rendered as a calm one.
 *  - A stored classification is always re-derivable from the bulletin text
 *    kept beside it.
 *
 * The disruption, IROPS and dispatch authorities stay where they are. What
 * this adds is the missing producer for the `weather` operational alert, which
 * until now was a type in the alert union that nothing could ever emit.
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  airportWeatherStations,
  airports,
  flights,
  weatherObservations,
} from "../../drizzle/schema";
import {
  FRESHNESS_MINUTES,
  categoryFromReport,
  concernsFrom,
  deriveFlightCategory,
  icaoCode as icaoCodec,
  measurementsOf,
  type Ceiling,
  type FieldWeather,
  type FlightWeatherAdvisory,
  type WeatherReport,
  type WeatherReportKind,
} from "../../shared/aviation-weather";
import {
  configuredWeatherSource,
  type WeatherSource,
} from "../integrations/aviation-weather";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";

function reject(
  message: string,
  code:
    | "CONFLICT"
    | "BAD_REQUEST"
    | "NOT_FOUND"
    | "PRECONDITION_FAILED" = "CONFLICT"
): never {
  throw new TRPCError({ code, message });
}

export interface StationMappingInput {
  airportId: number;
  icaoCode: string;
  /** Where the operator verified this station belongs to this airport. */
  mappingEvidence: string;
  recordedBy: number;
}

/** Records, or re-points, an airport's weather station.
 *
 * An ICAO identifier already mapped to a different airport is refused rather
 * than moved: two airports sharing one station would silently attribute one
 * field's weather to another. */
export async function recordStationMapping(
  tx: SettlementTx,
  input: StationMappingInput
): Promise<{ airportId: number; icaoCode: string }> {
  const code = icaoCodec.safeParse(input.icaoCode);
  if (!code.success) reject("Invalid ICAO station identifier", "BAD_REQUEST");
  const evidence = input.mappingEvidence.trim();
  if (evidence.length < 5 || evidence.length > 255)
    reject("Station mapping needs recorded evidence", "BAD_REQUEST");

  const [airport] = await tx
    .select({ id: airports.id })
    .from(airports)
    .where(eq(airports.id, input.airportId))
    .limit(1)
    .for("share");
  if (!airport) reject("Airport not found", "NOT_FOUND");

  const [conflict] = await tx
    .select({ airportId: airportWeatherStations.airportId })
    .from(airportWeatherStations)
    .where(eq(airportWeatherStations.icaoCode, code.data))
    .limit(1)
    .for("update");
  if (conflict && conflict.airportId !== input.airportId)
    reject("ICAO station is already mapped to another airport");

  await tx
    .insert(airportWeatherStations)
    .values({
      airportId: input.airportId,
      icaoCode: code.data,
      mappingEvidence: evidence,
      recordedBy: input.recordedBy,
    })
    .onDuplicateKeyUpdate({
      set: {
        icaoCode: code.data,
        mappingEvidence: evidence,
        recordedBy: input.recordedBy,
      },
    });
  return { airportId: input.airportId, icaoCode: code.data };
}

function digestOf(rawText: string): string {
  return createHash("sha256").update(rawText.trim()).digest("hex");
}

/** MySQL `timestamp` keeps whole seconds, so both sides of a duplicate
 * comparison are truncated the same way before they are compared. */
function toSecond(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

function ceilingColumns(report: WeatherReport): {
  ceilingFeet: number | null;
  ceilingIndeterminate: boolean;
} {
  const ceiling = measurementsOf(report).ceiling;
  return {
    ceilingFeet: ceiling.kind === "at" ? ceiling.feet : null,
    ceilingIndeterminate: ceiling.kind === "indeterminate",
  };
}

export interface IngestResult {
  stored: number;
  duplicates: number;
}

/** Stores decoded bulletins. Re-ingesting the same bulletin is a no-op, so a
 * retried or overlapping pull neither duplicates rows nor re-emits events.
 *
 * Identity is the station, the report kind, the issue time and a digest of the
 * bulletin text. The digest alone is not enough: a METAR body carries only a
 * day and a time, so an identical bulletin can recur a month later and that
 * later one is a new observation, not a replay.
 *
 * The duplicate check is an explicit read rather than an upsert's affected-row
 * count, so "already stored" means the same thing here as it does in a test
 * double, and the unique index stays as the backstop for a genuine race.
 *
 * A forecast never receives a category: `categoryFromReport` returns `null`
 * for a TAF because the adapter leaves its measurements empty, and that is
 * asserted here so a future decoder change cannot quietly classify one. */
export async function ingestReports(
  tx: SettlementTx,
  source: Pick<WeatherSource, "mode" | "reference">,
  reports: readonly WeatherReport[]
): Promise<IngestResult> {
  let stored = 0;
  let duplicates = 0;
  for (const report of reports) {
    const category = report.kind === "taf" ? null : categoryFromReport(report);
    if (report.kind === "taf" && category !== null)
      throw new Error("A forecast must not carry an observed flight category");
    const digest = digestOf(report.rawText);
    const issuedAt = toSecond(new Date(report.issuedAt));
    const candidates = await tx
      .select({ issuedAt: weatherObservations.issuedAt })
      .from(weatherObservations)
      .where(
        and(
          eq(weatherObservations.icaoCode, report.icaoCode),
          eq(weatherObservations.kind, report.kind),
          eq(weatherObservations.bodyDigest, digest)
        )
      );
    if (
      candidates.some(
        row => toSecond(row.issuedAt).getTime() === issuedAt.getTime()
      )
    ) {
      duplicates += 1;
      continue;
    }
    await tx.insert(weatherObservations).values({
      icaoCode: report.icaoCode,
      kind: report.kind,
      issuedAt,
      rawText: report.rawText,
      bodyDigest: digest,
      windDirection: report.windDirection,
      windSpeed: report.windSpeed,
      windGust: report.windGust,
      visibilityStatuteMiles:
        report.visibilityStatuteMiles === null
          ? null
          : report.visibilityStatuteMiles.toFixed(2),
      ...ceilingColumns(report),
      temperatureC: report.temperatureC,
      dewpointC: report.dewpointC,
      altimeterHpa:
        report.altimeterHpa === null ? null : report.altimeterHpa.toFixed(2),
      flightCategory: category,
      sourceReference: source.reference,
      sourceMode: source.mode,
    });
    stored += 1;
    // Station weather is not tenant data: the same bulletin describes the
    // field for every airline operating into it.
    await recordEvent(tx, {
      aggregateType: "weather_station",
      aggregateId: report.icaoCode,
      eventType: "weather.observed",
      tenantId: null,
      payload: {
        icaoCode: report.icaoCode,
        kind: report.kind,
        issuedAt: report.issuedAt,
        flightCategory: category,
        sourceMode: source.mode,
      },
    });
  }
  return { stored, duplicates };
}

/** Fetches from the configured source and stores what came back.
 *
 * The network call happens before `runInTransaction` is given the rows: a
 * provider that hangs must not hold a database transaction open. */
export async function pullStationReports(
  source: WeatherSource,
  kind: WeatherReportKind,
  stations: readonly string[],
  store: (reports: WeatherReport[]) => Promise<IngestResult>
): Promise<IngestResult & { fetched: number }> {
  const reports = await source.fetch(kind, stations);
  const result = await store(reports);
  return { ...result, fetched: reports.length };
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function storedCeiling(row: {
  ceilingFeet: number | null;
  ceilingIndeterminate: boolean;
}): Ceiling {
  if (row.ceilingIndeterminate) return { kind: "indeterminate" };
  return row.ceilingFeet === null
    ? { kind: "none" }
    : { kind: "at", feet: row.ceilingFeet };
}

export interface StoredObservation {
  icaoCode: string;
  kind: WeatherReportKind;
  issuedAt: Date;
  rawText: string;
  ceiling: Ceiling;
  visibilityStatuteMiles: number | null;
  windSpeed: number | null;
  windGust: number | null;
  temperatureC: number | null;
  flightCategory: ReturnType<typeof deriveFlightCategory>;
}

export async function latestObservations(
  tx: SettlementTx,
  stations: readonly string[],
  kind: WeatherReportKind = "metar"
): Promise<Map<string, StoredObservation>> {
  const unique = [...new Set(stations)];
  if (!unique.length) return new Map();
  const rows = await tx
    .select()
    .from(weatherObservations)
    .where(
      and(
        inArray(weatherObservations.icaoCode, unique),
        eq(weatherObservations.kind, kind)
      )
    )
    .orderBy(desc(weatherObservations.issuedAt), desc(weatherObservations.id));
  const latest = new Map<string, StoredObservation>();
  for (const row of rows) {
    // Ordered newest first, so the first row seen for a station is its latest.
    if (latest.has(row.icaoCode)) continue;
    latest.set(row.icaoCode, {
      icaoCode: row.icaoCode,
      kind: row.kind,
      issuedAt: row.issuedAt,
      rawText: row.rawText,
      ceiling: storedCeiling(row),
      visibilityStatuteMiles: numberOrNull(row.visibilityStatuteMiles),
      windSpeed: row.windSpeed,
      windGust: row.windGust,
      temperatureC: row.temperatureC,
      flightCategory: row.flightCategory,
    });
  }
  return latest;
}

function fieldWeather(
  role: "origin" | "destination",
  airport: { id: number; code: string },
  station: string | null,
  observation: StoredObservation | undefined,
  now: Date
): FieldWeather {
  const base = {
    airportId: airport.id,
    airportCode: airport.code,
    role,
    icaoCode: station,
    issuedAt: null,
    ageMinutes: null,
    flightCategory: null,
    concerns: [],
    rawText: null,
  } satisfies Omit<FieldWeather, "coverage">;
  if (!station) return { ...base, coverage: "station_unmapped" };
  if (!observation) return { ...base, coverage: "no_observation" };

  const ageMinutes = Math.floor(
    (now.getTime() - observation.issuedAt.getTime()) / 60_000
  );
  const shared = {
    ...base,
    issuedAt: observation.issuedAt.toISOString(),
    ageMinutes,
    rawText: observation.rawText,
  };
  // An expired bulletin keeps its text on screen, because an operator reading
  // "two hours old" is better served than one shown nothing, but it yields no
  // category and no concerns: those would assert conditions nobody observed.
  if (ageMinutes > FRESHNESS_MINUTES[observation.kind])
    return { ...shared, coverage: "stale_observation" };

  const measurements = {
    visibilityStatuteMiles: observation.visibilityStatuteMiles,
    ceiling: observation.ceiling,
    windSpeed: observation.windSpeed,
    windGust: observation.windGust,
    temperatureC: observation.temperatureC,
  };
  return {
    ...shared,
    coverage: "classified",
    // Re-derived from the stored measurements rather than trusted from the
    // stored column, so a changed threshold applies to history too.
    flightCategory: deriveFlightCategory(measurements),
    concerns: concernsFrom(measurements),
  };
}

/** Origin and destination coverage for one flight. Read-only. */
export async function flightWeatherAdvisory(
  tx: SettlementTx,
  flightId: number,
  now: Date = new Date()
): Promise<FlightWeatherAdvisory> {
  const [flight] = await tx
    .select({
      id: flights.id,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight) reject("Flight not found", "NOT_FOUND");

  const endpoints = [
    { role: "origin" as const, airportId: flight.originId },
    { role: "destination" as const, airportId: flight.destinationId },
  ];
  const airportIds = endpoints.map(endpoint => endpoint.airportId);
  // Two plain reads rather than an outer join: the airport and its station are
  // separate facts, and a missing station has to stay distinguishable from a
  // missing airport.
  const airportRows = await tx
    .select({ id: airports.id, code: airports.code })
    .from(airports)
    .where(inArray(airports.id, airportIds));
  const stationRows = await tx
    .select({
      airportId: airportWeatherStations.airportId,
      icaoCode: airportWeatherStations.icaoCode,
    })
    .from(airportWeatherStations)
    .where(inArray(airportWeatherStations.airportId, airportIds));
  const byId = new Map(airportRows.map(row => [row.id, row]));
  const stationOf = new Map(
    stationRows.map(row => [row.airportId, row.icaoCode])
  );
  const stations = stationRows.map(row => row.icaoCode);
  const observations = await latestObservations(tx, stations, "metar");

  const fields = endpoints.map(endpoint => {
    const airport = byId.get(endpoint.airportId);
    // A flight pointing at an absent airport is a data defect, not weather;
    // it is surfaced as an uncovered field rather than throwing here.
    if (!airport)
      return fieldWeather(
        endpoint.role,
        { id: endpoint.airportId, code: "???" },
        null,
        undefined,
        now
      );
    const station = stationOf.get(endpoint.airportId) ?? null;
    return fieldWeather(
      endpoint.role,
      airport,
      station,
      station ? observations.get(station) : undefined,
      now
    );
  });

  return {
    flightId: flight.id,
    evaluatedAt: now.toISOString(),
    fields,
    complete: fields.every(
      field => field.coverage === "classified" && field.flightCategory !== null
    ),
  };
}

/** Advisory severity for the operational alert feed.
 *
 * Only a fresh, classified, restricted field produces an alert. Missing
 * coverage does not: an alert saying "the weather is bad" when the truth is
 * "we have no bulletin" would be a fabricated observation. Uncovered fields
 * are reported through `complete`/`coverage` instead. */
export function weatherAlertsFrom(advisory: FlightWeatherAdvisory): {
  type: "weather";
  severity: "low" | "medium" | "high";
  message: string;
  affectedFlights: number[];
  suggestedAction: string;
}[] {
  const restricted = advisory.fields.filter(
    field =>
      field.coverage === "classified" &&
      field.flightCategory !== null &&
      field.flightCategory !== "VFR"
  );
  return restricted.map(field => ({
    type: "weather" as const,
    severity:
      field.flightCategory === "LIFR"
        ? ("high" as const)
        : field.flightCategory === "IFR"
          ? ("medium" as const)
          : ("low" as const),
    message:
      `${field.airportCode} (${field.icaoCode}) reported ${field.flightCategory} ${
        field.concerns.length ? `— ${field.concerns.join(", ")}` : ""
      }`.trim(),
    affectedFlights: [advisory.flightId],
    suggestedAction:
      "Advisory only: confirm against the operator's dispatch weather source before acting",
  }));
}

// ============================================================================
// Transaction facades — the router calls these; the functions above take a tx
// so tests and the acceptance path can drive them inside one transaction.
// ============================================================================

function requireDb() {
  const db = getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}

export async function mapAirportStation(input: StationMappingInput) {
  const db = requireDb();
  return await db.transaction(tx => recordStationMapping(tx, input));
}

/** Pulls the configured source for the given airports' recorded stations.
 *
 * Airports without a recorded station are returned as `unmapped` instead of
 * being skipped silently, so an operator can see exactly which fields a pull
 * could not cover. */
export async function refreshAirportWeather(input: {
  airportIds: readonly number[];
  kind?: WeatherReportKind;
}): Promise<IngestResult & { fetched: number; unmapped: number[] }> {
  const source = configuredWeatherSource();
  if (!source)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Aviation weather source is disabled",
    });
  const db = requireDb();
  const kind = input.kind ?? "metar";
  const mapped = await db
    .select({
      airportId: airportWeatherStations.airportId,
      icaoCode: airportWeatherStations.icaoCode,
    })
    .from(airportWeatherStations)
    .where(inArray(airportWeatherStations.airportId, [...input.airportIds]));
  const mappedIds = new Set(mapped.map(row => row.airportId));
  const unmapped = [...input.airportIds].filter(id => !mappedIds.has(id));
  const result = await pullStationReports(
    source,
    kind,
    mapped.map(row => row.icaoCode),
    reports => db.transaction(tx => ingestReports(tx, source, reports))
  );
  return { ...result, unmapped };
}

export async function getFlightWeatherAdvisory(flightId: number) {
  const db = requireDb();
  return await flightWeatherAdvisory(db, flightId);
}

export async function getStationWeather(
  stations: readonly string[],
  kind: WeatherReportKind = "metar"
) {
  const db = requireDb();
  const codes = stations.map(station => {
    const parsed = icaoCodec.safeParse(station);
    if (!parsed.success)
      reject("Invalid ICAO station identifier", "BAD_REQUEST");
    return parsed.data;
  });
  const latest = await latestObservations(db, codes, kind);
  return codes.map(code => {
    const observation = latest.get(code);
    return {
      icaoCode: code,
      observation: observation
        ? {
            ...observation,
            issuedAt: observation.issuedAt.toISOString(),
            concerns: concernsFrom(observation),
          }
        : null,
    };
  });
}
