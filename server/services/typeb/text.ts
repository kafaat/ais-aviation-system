/**
 * Shared Type B text rules: character set, line length, dates and times.
 *
 * Type B text is the Baudot-era teletype subset: upper-case letters, digits,
 * space and a handful of punctuation. All times are UTC (IATA AHM 780/583 and
 * the Type B whitepaper); the station's local time never appears.
 */
import { TypeBFormatError, type FlightDesignator } from "./model";

/** Letters, digits, space and the punctuation permitted in Type B text. */
export const TYPEB_TEXT = /^[A-Z0-9 \-?:().,'=/+]*$/;
/** Maximum characters per text line accepted by the common switches. */
export const MAX_LINE_LENGTH = 69;
/** Maximum characters of a single Type B message (header + text). */
export const MAX_MESSAGE_LENGTH = 3840;

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** DDMMM in UTC, e.g. 03NOV. */
export function ddmmm(date: Date): string {
  return `${pad(date.getUTCDate(), 2)}${MONTHS[date.getUTCMonth()]}`;
}

/** DDMMMYY in UTC, e.g. 03NOV26 (used by SSR INFT/DOCS free text). */
export function ddmmmyy(date: Date): string {
  return `${ddmmm(date)}${pad(date.getUTCFullYear() % 100, 2)}`;
}

/** Two-digit UTC day of month. */
export function dd(date: Date): string {
  return pad(date.getUTCDate(), 2);
}

/** HHMM in UTC. */
export function hhmm(date: Date): string {
  return `${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}`;
}

/** DDHHMM in UTC (origin line date-time group). */
export function ddhhmm(date: Date): string {
  return `${dd(date)}${hhmm(date)}`;
}

/** Minutes as HHMM duration (delay durations), capped at 9959. */
export function durationHhmm(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0)
    throw new TypeBFormatError("Duration must be a non-negative integer");
  const hours = Math.min(99, Math.floor(minutes / 60));
  return `${pad(hours, 2)}${pad(minutes % 60, 2)}`;
}

/**
 * Resolve DDMMM against a reference year. The month/day must exist; a date
 * more than six months in the past relative to the reference rolls into the
 * next year so late-December references read January correctly.
 */
export function parseDdmmm(value: string, reference = new Date()): Date {
  const m = /^(\d{2})([A-Z]{3})$/.exec(value);
  const month = m ? MONTHS.indexOf(m[2] as (typeof MONTHS)[number]) : -1;
  if (!m || month < 0)
    throw new TypeBFormatError(`Invalid DDMMM date: ${value}`, value);
  const day = Number(m[1]);
  let year = reference.getUTCFullYear();
  let date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day)
    throw new TypeBFormatError(`Invalid calendar date: ${value}`, value);
  if (date.getTime() < reference.getTime() - 183 * 86400000) {
    year += 1;
    date = new Date(Date.UTC(year, month, day));
  }
  return date;
}

/** HHMM → { hours, minutes } with range checks. */
export function parseHhmm(value: string): { hours: number; minutes: number } {
  const m = /^(\d{2})(\d{2})$/.exec(value);
  if (!m) throw new TypeBFormatError(`Invalid HHMM time: ${value}`, value);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59)
    throw new TypeBFormatError(`Invalid HHMM time: ${value}`, value);
  return { hours, minutes };
}

/** Combine a UTC calendar day with an HHMM string. */
export function atUtcTime(day: Date, time: string): Date {
  const { hours, minutes } = parseHhmm(time);
  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hours,
      minutes
    )
  );
}

/** Strip diacritics and anything outside A–Z; names in Type B are letters only. */
export function nameLetters(value: string): string {
  const letters = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!letters)
    throw new TypeBFormatError(`Name has no transmittable letters: ${value}`);
  return letters;
}

/** Upper-case a free-text remark and replace characters outside the Type B set. */
export function sanitizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 \-?:().,'=/+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Validate a finished text line against the character set and length. */
export function assertLine(
  line: string,
  maxLength = MAX_LINE_LENGTH,
  element?: string
): string {
  if (!TYPEB_TEXT.test(line))
    throw new TypeBFormatError(
      `Line contains characters outside the Type B set: ${line}`,
      element
    );
  if (line.length > maxLength)
    throw new TypeBFormatError(
      `Line exceeds ${maxLength} characters: ${line}`,
      element
    );
  return line;
}

/** Fold free text into lines no longer than `maxLength`, breaking at spaces. */
export function foldText(text: string, maxLength = MAX_LINE_LENGTH): string[] {
  const words = sanitizeText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const piece = word.length > maxLength ? word.slice(0, maxLength) : word;
    if (!current) current = piece;
    else if (current.length + 1 + piece.length <= maxLength)
      current += ` ${piece}`;
    else {
      lines.push(current);
      current = piece;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export const STATION = /^[A-Z]{3}$/;
export const REGISTRATION = /^[A-Z0-9]{3,8}$/;

export function assertStation(code: string, element = "station"): string {
  const upper = code.toUpperCase();
  if (!STATION.test(upper))
    throw new TypeBFormatError(`Invalid station code: ${code}`, element);
  return upper;
}

/** Registration marks are transmitted without the hyphen (HZ-ASA → HZASA). */
export function normalizeRegistration(value: string): string {
  const reg = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!REGISTRATION.test(reg))
    throw new TypeBFormatError(
      `Invalid aircraft registration: ${value}`,
      "registration"
    );
  return reg;
}

export function assertFlight(flight: FlightDesignator): FlightDesignator {
  const carrier = flight.carrier.toUpperCase();
  const number = flight.number.replace(/^0+(?=\d)/, "");
  const suffix = flight.suffix?.toUpperCase();
  // Two or three alphanumerics with at least one letter (9W, SV, XY, SVA).
  if (!/^[A-Z0-9]{2,3}$/.test(carrier) || !/[A-Z]/.test(carrier))
    throw new TypeBFormatError(`Invalid carrier code: ${flight.carrier}`);
  if (!/^\d{1,4}$/.test(number))
    throw new TypeBFormatError(`Invalid flight number: ${flight.number}`);
  if (suffix !== undefined && !/^[A-Z]$/.test(suffix))
    throw new TypeBFormatError(`Invalid flight suffix: ${flight.suffix}`);
  return suffix ? { carrier, number, suffix } : { carrier, number };
}

/** XY123 / XY123A — unpadded form used by PNL, ADL, MVT and LDM. */
export function flightCode(flight: FlightDesignator): string {
  const f = assertFlight(flight);
  return `${f.carrier}${f.number}${f.suffix ?? ""}`;
}

/** XY0123 — four-digit form used inside baggage messages (.F/.O/.I). */
export function paddedFlightCode(flight: FlightDesignator): string {
  const f = assertFlight(flight);
  return `${f.carrier}${f.number.padStart(4, "0")}${f.suffix ?? ""}`;
}

/** Parse XY123, XY0123 or XY123A into a designator. */
export function parseFlightCode(value: string): FlightDesignator {
  const m = /^([A-Z0-9]{2}[A-Z]?)(\d{1,4})([A-Z])?$/.exec(value);
  if (!m || !/[A-Z]/.test(m[1]))
    throw new TypeBFormatError(`Invalid flight designator: ${value}`);
  return assertFlight({ carrier: m[1], number: m[2], suffix: m[3] });
}

/** Split a flight number column (e.g. "XY123") used elsewhere in AIS. */
export function designatorFromFlightNumber(
  flightNumber: string,
  fallbackCarrier?: string
): FlightDesignator {
  const compact = flightNumber.replace(/\s+/g, "").toUpperCase();
  const m = /^([A-Z][A-Z0-9][A-Z]?|[0-9][A-Z][A-Z]?)?(\d{1,4})([A-Z])?$/.exec(
    compact
  );
  if (!m || (!m[1] && !fallbackCarrier))
    throw new TypeBFormatError(
      `Cannot derive a designator from ${flightNumber}`
    );
  return assertFlight({
    carrier: (m[1] ?? fallbackCarrier) as string,
    number: m[2],
    suffix: m[3],
  });
}
