/** Aviation weather contract (R2-10).
 *
 * Pure decoding and classification. No I/O, no database, no provider calls, so
 * both the server and the tests share exactly one definition of what a report
 * means.
 *
 * Two rules hold throughout and are the reason most functions are nullable:
 *
 *  1. A value that was not reported is `null`. Nothing here substitutes a
 *     default, an average, or a "probably fine" for a missing measurement.
 *  2. Everything derived here is **advisory**. It never becomes a dispatch
 *     authority, never blocks a flight, and never changes a booking. The
 *     authorities stay booking, payments, inventory and the outbox.
 */
import { z } from "zod";

/** ICAO station identifier, e.g. `OEJN`. Two letters then two alphanumerics.
 * Never derived from an IATA code: the two code spaces are not related by any
 * rule, so a station mapping has to be recorded by an operator. */
export const icaoCode = z
  .string()
  .trim()
  .transform(value => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}[A-Z0-9]{2}$/, "Invalid ICAO station"));

export const weatherReportKind = z.enum(["metar", "taf"]);
export type WeatherReportKind = z.infer<typeof weatherReportKind>;

/** FAA flight category, as published alongside METARs. */
export const flightCategory = z.enum(["VFR", "MVFR", "IFR", "LIFR"]);
export type FlightCategory = z.infer<typeof flightCategory>;

/** Sky cover abbreviations that appear in a METAR/TAF sky condition group. */
export const cloudCover = z.enum([
  "SKC",
  "CLR",
  "CAVOK",
  "NSC",
  "NCD",
  "FEW",
  "SCT",
  "BKN",
  "OVC",
  "OVX",
]);
export type CloudCover = z.infer<typeof cloudCover>;

export const cloudLayer = z.object({
  cover: cloudCover,
  /** Height above ground in feet. `null` for a layer reported without a base,
   * such as an obscured sky with no measured vertical visibility. */
  baseFeetAgl: z.number().int().nonnegative().max(60000).nullable(),
});
export type CloudLayer = z.infer<typeof cloudLayer>;

/** A normalized report. The adapter produces this from a provider payload and
 * always keeps `rawText`, so a stored classification can be re-derived and
 * audited against the bulletin the station actually published. */
export const weatherReport = z.object({
  icaoCode,
  kind: weatherReportKind,
  issuedAt: z.string().datetime(),
  rawText: z.string().trim().min(1).max(2048),
  windDirection: z.number().int().min(0).max(360).nullable(),
  windSpeed: z.number().int().nonnegative().max(250).nullable(),
  windGust: z.number().int().nonnegative().max(300).nullable(),
  visibilityStatuteMiles: z.number().nonnegative().max(100).nullable(),
  clouds: z.array(cloudLayer).max(8),
  temperatureC: z.number().int().min(-100).max(70).nullable(),
  dewpointC: z.number().int().min(-100).max(70).nullable(),
  altimeterHpa: z.number().min(800).max(1100).nullable(),
});
export type WeatherReport = z.infer<typeof weatherReport>;

/** A ceiling is the lowest broken, overcast or obscured layer.
 *
 * The three cases are genuinely different and collapsing them loses safety
 * meaning: a sky with only few/scattered layers has **no** ceiling, which is
 * not the same as a high one, and an obscured sky reported without a vertical
 * visibility has a ceiling that exists but was not measured. */
export type Ceiling =
  | { kind: "none" }
  | { kind: "at"; feet: number }
  | { kind: "indeterminate" };

const CEILING_COVERS: ReadonlySet<CloudCover> = new Set(["BKN", "OVC", "OVX"]);

export function ceilingOf(clouds: readonly CloudLayer[]): Ceiling {
  const ceilingLayers = clouds.filter(layer => CEILING_COVERS.has(layer.cover));
  if (!ceilingLayers.length) return { kind: "none" };
  const bases = ceilingLayers
    .map(layer => layer.baseFeetAgl)
    .filter((base): base is number => base !== null);
  // A ceiling layer whose base was not reported cannot be compared against the
  // category thresholds, so the ceiling stays unmeasured rather than being
  // read off the remaining layers.
  if (bases.length !== ceilingLayers.length) return { kind: "indeterminate" };
  return { kind: "at", feet: Math.min(...bases) };
}

/** Worst-first, so the numeric index doubles as "how restricted". */
const CATEGORY_ORDER: readonly FlightCategory[] = [
  "LIFR",
  "IFR",
  "MVFR",
  "VFR",
];

function visibilityCategory(statuteMiles: number): FlightCategory {
  if (statuteMiles < 1) return "LIFR";
  if (statuteMiles < 3) return "IFR";
  if (statuteMiles <= 5) return "MVFR";
  return "VFR";
}

function ceilingCategory(feet: number): FlightCategory {
  if (feet < 500) return "LIFR";
  if (feet < 1000) return "IFR";
  if (feet <= 3000) return "MVFR";
  return "VFR";
}

/** FAA flight category from ceiling and visibility, taking the more
 * restrictive of the two.
 *
 * Returns `null` — not `"VFR"` — whenever either input is unusable: a missing
 * visibility or an unmeasured ceiling means the field was not classified, and
 * reporting the unrestricted category for it would invent a clearance. */
export function deriveFlightCategory(input: {
  visibilityStatuteMiles: number | null;
  ceiling: Ceiling;
}): FlightCategory | null {
  if (input.visibilityStatuteMiles === null) return null;
  if (input.ceiling.kind === "indeterminate") return null;
  const byVisibility = visibilityCategory(input.visibilityStatuteMiles);
  const byCeiling =
    input.ceiling.kind === "none" ? "VFR" : ceilingCategory(input.ceiling.feet);
  const worst = Math.min(
    CATEGORY_ORDER.indexOf(byVisibility),
    CATEGORY_ORDER.indexOf(byCeiling)
  );
  return CATEGORY_ORDER[worst];
}

export function categoryFromReport(
  report: WeatherReport
): FlightCategory | null {
  return deriveFlightCategory({
    visibilityStatuteMiles: report.visibilityStatuteMiles,
    ceiling: ceilingOf(report.clouds),
  });
}

/** Advisory concerns. Each is a published-threshold observation about the
 * bulletin, not a recommendation and not an operational restriction. */
export const weatherConcern = z.enum([
  "low_visibility",
  "low_ceiling",
  "strong_wind",
  "gusting",
  "freezing",
]);
export type WeatherConcern = z.infer<typeof weatherConcern>;

/** Advisory thresholds. Declared here so the runbook, the tests and the ops
 * screen all cite the same numbers instead of three copies drifting apart. */
export const CONCERN_THRESHOLDS = {
  /** Below the IFR visibility boundary. */
  lowVisibilityStatuteMiles: 3,
  /** Below the IFR ceiling boundary. */
  lowCeilingFeet: 1000,
  strongWindKnots: 30,
  gustKnots: 25,
  gustSpreadKnots: 10,
  freezingTemperatureC: 0,
} as const;

/** The measurements the derivations need, independent of whether they came
 * from a freshly decoded bulletin or from a stored row. A stored observation
 * keeps its ceiling as a resolved value rather than a cloud array, so both
 * callers meet here. */
export interface WeatherMeasurements {
  visibilityStatuteMiles: number | null;
  ceiling: Ceiling;
  windSpeed: number | null;
  windGust: number | null;
  temperatureC: number | null;
}

export function measurementsOf(report: WeatherReport): WeatherMeasurements {
  return {
    visibilityStatuteMiles: report.visibilityStatuteMiles,
    ceiling: ceilingOf(report.clouds),
    windSpeed: report.windSpeed,
    windGust: report.windGust,
    temperatureC: report.temperatureC,
  };
}

export function concernsFrom(
  measurements: WeatherMeasurements
): WeatherConcern[] {
  const concerns: WeatherConcern[] = [];
  const {
    visibilityStatuteMiles: visibility,
    ceiling,
    windSpeed,
    windGust,
    temperatureC,
  } = measurements;
  if (
    visibility !== null &&
    visibility < CONCERN_THRESHOLDS.lowVisibilityStatuteMiles
  )
    concerns.push("low_visibility");
  if (ceiling.kind === "at" && ceiling.feet < CONCERN_THRESHOLDS.lowCeilingFeet)
    concerns.push("low_ceiling");
  if (windSpeed !== null && windSpeed >= CONCERN_THRESHOLDS.strongWindKnots)
    concerns.push("strong_wind");
  if (
    windGust !== null &&
    windGust >= CONCERN_THRESHOLDS.gustKnots &&
    windGust - (windSpeed ?? 0) >= CONCERN_THRESHOLDS.gustSpreadKnots
  )
    concerns.push("gusting");
  if (
    temperatureC !== null &&
    temperatureC <= CONCERN_THRESHOLDS.freezingTemperatureC
  )
    concerns.push("freezing");
  return concerns;
}

export function concernsFromReport(report: WeatherReport): WeatherConcern[] {
  return concernsFrom(measurementsOf(report));
}

/** Why a field has, or has not, a usable classification.
 *
 * The three non-`classified` values are the honest outcomes of a missing
 * mapping, a silent station and an expired bulletin. They are reported as
 * themselves so an operator sees uncovered fields instead of a screen that
 * looks calm because it has no data. */
export const weatherCoverage = z.enum([
  "station_unmapped",
  "no_observation",
  "stale_observation",
  "classified",
]);
export type WeatherCoverage = z.infer<typeof weatherCoverage>;

/** Freshness budgets.
 *
 * A routine METAR is issued hourly, so 90 minutes allows one late bulletin
 * before the field is called stale. A TAF is issued every six hours, so its
 * budget spans a full issue cycle plus a margin. */
export const FRESHNESS_MINUTES: Record<WeatherReportKind, number> = {
  metar: 90,
  taf: 480,
};

export interface FieldWeather {
  airportId: number;
  airportCode: string;
  role: "origin" | "destination";
  icaoCode: string | null;
  coverage: WeatherCoverage;
  issuedAt: string | null;
  ageMinutes: number | null;
  flightCategory: FlightCategory | null;
  concerns: WeatherConcern[];
  rawText: string | null;
}

export interface FlightWeatherAdvisory {
  flightId: number;
  evaluatedAt: string;
  fields: FieldWeather[];
  /** True only when every field carries a fresh classified bulletin. A partly
   * covered advisory is never presented as a complete picture. */
  complete: boolean;
}

export function coverageLabel(
  coverage: WeatherCoverage,
  arabic = false
): string {
  const labels: Record<WeatherCoverage, [string, string]> = {
    station_unmapped: [
      "No weather station recorded for this airport",
      "لا توجد محطة أرصاد مسجّلة لهذا المطار",
    ],
    no_observation: [
      "Station recorded, no bulletin stored yet",
      "المحطة مسجّلة، ولا يوجد تقرير مخزَّن بعد",
    ],
    stale_observation: [
      "Latest bulletin is older than its issue cycle",
      "أحدث تقرير أقدم من دورة إصداره",
    ],
    classified: ["Classified from a current bulletin", "مصنَّف من تقرير حالي"],
  };
  return labels[coverage][arabic ? 1 : 0];
}
