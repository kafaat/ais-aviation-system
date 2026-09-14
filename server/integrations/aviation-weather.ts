/** Aviation weather source adapter (R2-10).
 *
 * Reads station bulletins from the Aviation Weather Center data API, the
 * NOAA/NWS service that publishes METAR and TAF:
 *   https://aviationweather.gov/data/api/
 *
 * Scope and the reasons for it:
 *
 *  - **METAR is an observation and is classified. TAF is a forecast and is
 *    not.** A TAF is stored as the bulletin its station issued, with its issue
 *    and validity times, and never receives a derived flight category. Reading
 *    a forecast period as if it were current conditions would misrepresent it,
 *    so the classification path accepts observations only.
 *  - **A present-but-undecodable field rejects the report.** Silently nulling
 *    it would turn provider schema drift into quietly missing weather. The
 *    adapter would rather fail loudly and leave the field uncovered.
 *  - **No fallback, ever.** If the source is unreachable or disabled, the
 *    caller gets an error or nothing. Nothing here manufactures a bulletin.
 *
 * The response schema below is written against the published field names of
 * the AWC data API. Like every other adapter in this repository, it still
 * needs verification against live responses before it is trusted in
 * production; nothing in the local tests establishes that.
 */
import { z } from "zod";
import {
  icaoCode,
  weatherReport,
  type WeatherReport,
  type WeatherReportKind,
} from "../../shared/aviation-weather";

const REQUEST_TIMEOUT_MS = 15_000;
/** A single station's METAR page is a few kilobytes; 2 MB is generous for a
 * multi-station request and still bounds a runaway body. */
const MAX_RESPONSE_BYTES = 2_000_000;
/** Bounded so one operator command cannot fan out into a bulk scrape. */
const MAX_STATIONS_PER_REQUEST = 20;

export const DEFAULT_BASE_URL = "https://aviationweather.gov/api/data";

export interface WeatherSource {
  mode: "sandbox" | "live";
  /** The source the operator recorded as accepted, kept on every stored row so
   * a bulletin can always be traced back to where it came from. */
  reference: string;
  fetch(
    kind: WeatherReportKind,
    stations: readonly string[]
  ): Promise<WeatherReport[]>;
}

/** AWC reports visibility in statute miles, either as a number or as a
 * string with a `+` suffix meaning "at least this". `10+` is stored as 10:
 * the categories treat everything above 5 alike, so the bound is enough. */
function decodeVisibility(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : reject("visibility", value);
  if (typeof value === "string") {
    const match = /^(\d+(?:\.\d+)?)\+?$/.exec(value.trim());
    if (match) return Number(match[1]);
    // Fractions appear in low-visibility reports, e.g. `1 1/2` or `1/2`.
    const fraction = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(value.trim());
    if (fraction) {
      const whole = fraction[1] ? Number(fraction[1]) : 0;
      const denominator = Number(fraction[3]);
      if (denominator > 0) return whole + Number(fraction[2]) / denominator;
    }
  }
  return reject("visibility", value);
}

/** `VRB` marks a direction that varies; it has no single value, so the
 * direction is absent while the speed stays usable. */
function decodeWindDirection(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    if (value.trim().toUpperCase() === "VRB") return null;
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed)) return parsed;
    return reject("wind direction", value);
  }
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return reject("wind direction", value);
}

function decodeInteger(field: string, value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed))
    return reject(field, value);
  return Math.round(parsed);
}

function decodeNumber(field: string, value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed))
    return reject(field, value);
  return parsed;
}

function reject(field: string, _value: unknown): never {
  // The offending value is deliberately not echoed: these strings reach logs.
  throw new Error(`Aviation weather report has an undecodable ${field}`);
}

const rawCloudLayer = z.object({
  cover: z.string().min(1).max(8),
  base: z.union([z.number(), z.string(), z.null()]).optional(),
});

const rawMetar = z.looseObject({
  icaoId: z.string().min(1),
  rawOb: z.string().min(1),
  reportTime: z.string().min(1).optional(),
  obsTime: z.union([z.number(), z.string()]).optional(),
  temp: z.unknown().optional(),
  dewp: z.unknown().optional(),
  wdir: z.unknown().optional(),
  wspd: z.unknown().optional(),
  wgst: z.unknown().optional(),
  visib: z.unknown().optional(),
  altim: z.unknown().optional(),
  clouds: z.array(rawCloudLayer).max(8).optional(),
});

const rawTaf = z.looseObject({
  icaoId: z.string().min(1),
  rawTAF: z.string().min(1),
  issueTime: z.string().min(1).optional(),
});

/** AWC timestamps arrive either as unix seconds or as `YYYY-MM-DD HH:MM:SS`
 * in UTC without a zone marker. The space form is normalised explicitly
 * rather than handed to `new Date`, whose behaviour on it is not specified. */
function decodeTimestamp(field: string, value: unknown): Date {
  if (typeof value === "number" && Number.isFinite(value))
    return boundedDate(field, new Date(value * 1000));
  if (typeof value === "string") {
    const text = value.trim();
    const spaced = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})Z?$/.exec(text);
    if (spaced)
      return boundedDate(field, new Date(`${spaced[1]}T${spaced[2]}Z`));
    const parsed = new Date(text);
    if (Number.isFinite(parsed.getTime())) return boundedDate(field, parsed);
  }
  return reject(field, value);
}

/** A bulletin dated decades away is provider corruption, not weather. */
function boundedDate(field: string, date: Date): Date {
  const skewMs = Math.abs(date.getTime() - Date.now());
  if (!Number.isFinite(date.getTime()) || skewMs > 365 * 24 * 3600_000)
    return reject(field, date);
  return date;
}

const COVER_ALIASES: Record<string, string> = {
  // AWC writes clear skies as CLR or SKC depending on the station type.
  CAVOK: "CAVOK",
  CLR: "CLR",
  SKC: "SKC",
  NSC: "NSC",
  NCD: "NCD",
  FEW: "FEW",
  SCT: "SCT",
  BKN: "BKN",
  OVC: "OVC",
  OVX: "OVX",
};

function decodeClouds(
  layers: z.infer<typeof rawCloudLayer>[] | undefined
): WeatherReport["clouds"] {
  return (layers ?? []).map(layer => {
    const cover = COVER_ALIASES[layer.cover.trim().toUpperCase()];
    if (!cover) return reject("sky cover", layer.cover);
    return {
      cover: cover as WeatherReport["clouds"][number]["cover"],
      baseFeetAgl: decodeInteger("cloud base", layer.base ?? null),
    };
  });
}

export function decodeMetar(value: unknown): WeatherReport {
  const raw = rawMetar.parse(value);
  return weatherReport.parse({
    icaoCode: raw.icaoId,
    kind: "metar",
    issuedAt: decodeTimestamp(
      "observation time",
      raw.reportTime ?? raw.obsTime
    ).toISOString(),
    rawText: raw.rawOb,
    windDirection: decodeWindDirection(raw.wdir),
    windSpeed: decodeInteger("wind speed", raw.wspd),
    windGust: decodeInteger("wind gust", raw.wgst),
    visibilityStatuteMiles: decodeVisibility(raw.visib),
    clouds: decodeClouds(raw.clouds),
    temperatureC: decodeInteger("temperature", raw.temp),
    dewpointC: decodeInteger("dewpoint", raw.dewp),
    altimeterHpa: decodeNumber("altimeter", raw.altim),
  });
}

/** A forecast carries no observed measurements here on purpose: every
 * measurement field stays `null` and no category is derived, so a TAF can
 * never be read as the weather at the field right now. */
export function decodeTaf(value: unknown): WeatherReport {
  const raw = rawTaf.parse(value);
  return weatherReport.parse({
    icaoCode: raw.icaoId,
    kind: "taf",
    issuedAt: decodeTimestamp("issue time", raw.issueTime).toISOString(),
    rawText: raw.rawTAF,
    windDirection: null,
    windSpeed: null,
    windGust: null,
    visibilityStatuteMiles: null,
    clouds: [],
    temperatureC: null,
    dewpointC: null,
    altimeterHpa: null,
  });
}

export interface WeatherSourceConfig {
  mode: "sandbox" | "live";
  reference: string;
  baseUrl: string;
}

export function createAviationWeatherSource(
  config: WeatherSourceConfig
): WeatherSource {
  async function call(path: string): Promise<unknown> {
    const url = new URL(
      path.replace(/^\//, ""),
      config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`
    );
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok)
      throw new Error(
        `Aviation weather request failed (${response.status} ${response.statusText})`
      );
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
      throw new Error("Aviation weather response is too large");
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES)
      throw new Error("Aviation weather response is too large");
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("Aviation weather response is not JSON");
    }
  }

  return {
    mode: config.mode,
    reference: config.reference,
    async fetch(kind, stations) {
      const ids = stations.map(station => icaoCode.parse(station));
      if (!ids.length) return [];
      if (ids.length > MAX_STATIONS_PER_REQUEST)
        throw new Error("Too many weather stations in one request");
      const unique = [...new Set(ids)];
      const payload = await call(
        `${kind}?ids=${encodeURIComponent(unique.join(","))}&format=json`
      );
      const rows = z.array(z.unknown()).max(500).parse(payload);
      const decode = kind === "metar" ? decodeMetar : decodeTaf;
      const reports = rows.map(row => decode(row));
      // A source that answers about a station nobody asked for is not one we
      // can attribute, so the whole response is refused.
      for (const report of reports)
        if (!unique.includes(report.icaoCode))
          throw new Error("Aviation weather returned an unrequested station");
      return reports;
    },
  };
}

/** Reads `AVIATION_WEATHER_MODE` (`disabled` by default, so an unconfigured
 * deployment fetches nothing).
 *
 * `live` additionally requires `AVIATION_WEATHER_SOURCE_REFERENCE`: the AWC
 * API is a public service with no contract or availability commitment to this
 * system, so an operator has to record which source they accepted before its
 * bulletins are stored. `sandbox` requires an explicit base URL, because a
 * sandbox that silently pointed at the real service would not be one. */
export function configuredWeatherSource(): WeatherSource | null {
  const mode = process.env.AVIATION_WEATHER_MODE;
  if (!mode || mode === "disabled") return null;
  if (mode !== "sandbox" && mode !== "live")
    throw new Error("Invalid AVIATION_WEATHER_MODE");
  const baseUrl = process.env.AVIATION_WEATHER_BASE_URL?.trim();
  if (mode === "sandbox" && !baseUrl)
    throw new Error("Sandbox aviation weather requires an explicit base URL");
  const reference =
    mode === "live"
      ? process.env.AVIATION_WEATHER_SOURCE_REFERENCE?.trim()
      : `sandbox:${baseUrl}`;
  if (!reference)
    throw new Error(
      "Live aviation weather requires a recorded source reference"
    );
  return createAviationWeatherSource({
    mode,
    reference: reference.slice(0, 255),
    baseUrl: baseUrl || DEFAULT_BASE_URL,
  });
}
