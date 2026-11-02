/**
 * Airport-local time formatting.
 *
 * Flight times are stored as instants. An airline UI shows a departure in the
 * origin airport's clock and an arrival in the destination airport's clock,
 * never in whatever zone the browser happens to run in: a 23:30 Riyadh
 * departure must read 23:30 in London too. Everything here is Intl based, so
 * the output does not depend on the process or browser time zone whenever an
 * airport zone is known. A missing or invalid zone (airports.timezone is
 * nullable) falls back to the viewer's zone rather than failing.
 */

export type AirportTimeZone = string | null | undefined;

export type DateInput = Date | string | number;

const DEFAULT_LOCALE = "en-GB";

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const zoneCache = new Map<string, boolean>();

/** True when Intl accepts `timeZone` as an IANA zone. */
export function isValidTimeZone(timeZone: AirportTimeZone): timeZone is string {
  if (!timeZone) return false;
  const cached = zoneCache.get(timeZone);
  if (cached !== undefined) return cached;
  let valid = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    valid = true;
  } catch {
    valid = false;
  }
  zoneCache.set(timeZone, valid);
  return valid;
}

/** The zone to format in: the airport's when usable, otherwise `undefined`,
 * which Intl reads as the viewer's own zone. */
export function resolveTimeZone(timeZone: AirportTimeZone): string | undefined {
  return isValidTimeZone(timeZone) ? timeZone : undefined;
}

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Flight times and dates keep Latin digits in every language, as the
 * date-fns output they replace did; Intl would otherwise pick Arabic-Indic
 * digits for `ar`. A tag that already carries a Unicode extension is kept. */
export function withLatinDigits(locale: string): string {
  return locale.includes("-u-") ? locale : `${locale}-u-nu-latn`;
}

function safeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(withLatinDigits(locale), options);
  } catch {
    // An unknown locale tag must not take the page down.
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, options);
  }
}

/**
 * "HH:mm" at the given airport. The locale only chooses the digits; the
 * default keeps Latin digits and a 24-hour clock, matching the previous
 * date-fns `HH:mm` output.
 */
export function formatFlightTime(
  date: DateInput,
  timeZone?: AirportTimeZone,
  locale: string = DEFAULT_LOCALE
): string {
  const instant = toDate(date);
  if (!instant) return "";
  return safeFormat(locale, {
    timeZone: resolveTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/**
 * The calendar date at the given airport. `options` selects the shape
 * (defaults to "15 Nov 2026"); the time zone is always the airport's.
 */
export function formatFlightDate(
  date: DateInput,
  timeZone?: AirportTimeZone,
  locale: string = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTIONS
): string {
  const instant = toDate(date);
  if (!instant) return "";
  return safeFormat(locale, {
    ...options,
    timeZone: resolveTimeZone(timeZone),
  }).format(instant);
}

/** The civil date at the airport as YYYY-MM-DD. */
export function civilDateAt(
  date: DateInput,
  timeZone?: AirportTimeZone
): string {
  const instant = toDate(date);
  if (!instant) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function civilDayNumber(date: DateInput, timeZone?: AirportTimeZone): number {
  const civil = civilDateAt(date, timeZone);
  if (!civil) return Number.NaN;
  const [year, month, day] = civil.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * How many calendar days the arrival's local date is from the departure's
 * local date: 0 for a same-day arrival, 1 for the "+1" marker, 2 for a
 * two-night long haul, -1 when crossing the date line westward.
 */
export function dayOffset(
  departure: DateInput,
  departureZone: AirportTimeZone,
  arrival: DateInput,
  arrivalZone: AirportTimeZone
): number {
  const from = civilDayNumber(departure, departureZone);
  const to = civilDayNumber(arrival, arrivalZone);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round(to - from);
}

/** "+1", "+2", "-1"; empty for a same-day arrival. */
export function formatDayOffset(offset: number): string {
  if (!offset || Number.isNaN(offset)) return "";
  return offset > 0 ? `+${offset}` : `${offset}`;
}
