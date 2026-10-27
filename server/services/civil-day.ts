/**
 * Civil-date handling for flight search.
 *
 * A search is for a calendar day at the origin airport, not for a 24-hour
 * window around the instant a browser happened to encode. Three clocks used
 * to disagree here: the client sent its local midnight as an instant, the
 * server sliced a day around it in the server's own zone, and the cache was
 * keyed by the UTC date of that instant. A Riyadh user asking for 15 Nov got
 * most of 14 Nov from a UTC server. Everything below is pure UTC arithmetic
 * plus Intl, so the process time zone cannot influence it.
 */

export const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day a search means, as YYYY-MM-DD. A string must already be
 * a civil date. A Date is treated as a browser's local midnight for that
 * day: shifting it by twelve hours lands inside the intended day for any
 * UTC offset strictly between -12h and +12h, which covers every inhabited
 * zone except the +12/+13/+14 islands, where the same instant still maps
 * to the day the user chose or the next one, never to the day before. */
export function civilDateOf(value: Date | string): string {
  if (typeof value === "string") {
    if (!CIVIL_DATE.test(value) || Number.isNaN(Date.parse(value)))
      throw new RangeError("Departure date must be YYYY-MM-DD");
    return value;
  }
  if (Number.isNaN(value.getTime()))
    throw new RangeError("Departure date is invalid");
  return new Date(value.getTime() + 12 * 3600_000).toISOString().slice(0, 10);
}

export function isValidTimeZone(
  timeZone: string | null | undefined
): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds
 * (positive east of Greenwich). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const field = (type: string) =>
    Number(parts.find(p => p.type === type)?.value ?? "0");
  const wall = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second")
  );
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instants [start, end) that make up the civil day `ymd` in
 * `timeZone`. `end` is the start of the next civil day, so a departure at
 * 23:59:59 local is included and 00:00:00 the next day is not. Computed in
 * two passes so a daylight-saving change on that day resolves correctly. */
export function civilDayWindowUtc(
  ymd: string,
  timeZone: string
): { start: Date; end: Date } {
  const [y, m, d] = civilDateOf(ymd).split("-").map(Number);
  const localMidnight = (dayOffset: number) => {
    const naive = Date.UTC(y, m - 1, d + dayOffset);
    let guess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
    guess = new Date(naive - zoneOffsetMs(guess, timeZone));
    return guess;
  };
  return { start: localMidnight(0), end: localMidnight(1) };
}

/** The zone a search day is interpreted in when the origin airport has no
 * usable `timezone` value. */
export function fallbackAirportTimeZone(): string {
  const configured = process.env.DEFAULT_AIRPORT_TZ;
  return isValidTimeZone(configured) ? configured : "UTC";
}
