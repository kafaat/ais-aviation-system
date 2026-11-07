/**
 * BSP reporting periods are cut in the BSP country's local time: the RET
 * for reporting date D covers documents issued from the cut-off on D−1 up to
 * (excluding) the cut-off on D. Pure UTC arithmetic plus Intl, like
 * `civil-day.ts`, so the process time zone cannot influence the window.
 */
import { addCivilDays, civilDateOf, zoneOffsetMs } from "../civil-day";

export const CUTOFF_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The UTC instant of `HH:MM` local on civil date `ymd` in `timeZone`,
 * resolved in two passes so a daylight-saving change on that day is honoured. */
export function localTimeToUtc(
  ymd: string,
  hhmm: string,
  timeZone: string
): Date {
  const m = CUTOFF_TIME.exec(hhmm);
  if (!m) throw new RangeError(`Cut-off time must be HH:MM, got ${hhmm}`);
  const [y, mo, d] = civilDateOf(ymd).split("-").map(Number);
  const naive = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]));
  let guess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  guess = new Date(naive - zoneOffsetMs(guess, timeZone));
  return guess;
}

export interface ReportingWindow {
  reportingDate: string;
  start: Date;
  end: Date;
}

/** [start, end) for the RET of `reportingDate`. */
export function retReportingWindow(
  reportingDate: string,
  cutoffLocalTime: string,
  timeZone: string
): ReportingWindow {
  const date = civilDateOf(reportingDate);
  return {
    reportingDate: date,
    start: localTimeToUtc(addCivilDays(date, -1), cutoffLocalTime, timeZone),
    end: localTimeToUtc(date, cutoffLocalTime, timeZone),
  };
}

/** The reporting date whose window contains `instant`. */
export function reportingDateOf(
  instant: Date,
  cutoffLocalTime: string,
  timeZone: string
): string {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
  const sameDay = shifted.toISOString().slice(0, 10);
  const window = retReportingWindow(sameDay, cutoffLocalTime, timeZone);
  if (instant >= window.end) return addCivilDays(sameDay, 1);
  if (instant < window.start) return addCivilDays(sameDay, -1);
  return sameDay;
}

/** Inclusive civil date range → [start of first window, end of last window). */
export function periodWindow(
  periodStart: string,
  periodEnd: string,
  cutoffLocalTime: string,
  timeZone: string
): { start: Date; end: Date } {
  if (civilDateOf(periodStart) > civilDateOf(periodEnd))
    throw new RangeError("Period start must not be after period end");
  return {
    start: retReportingWindow(periodStart, cutoffLocalTime, timeZone).start,
    end: retReportingWindow(periodEnd, cutoffLocalTime, timeZone).end,
  };
}
