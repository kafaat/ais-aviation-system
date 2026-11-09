/**
 * Crew legality engine (flight and duty time limitations).
 *
 * Pure functions: a rule set document, a crew member's duty history and a
 * proposed duty go in; a verdict with every rule checked and its margin comes
 * out. Time zones come from the airports of each sector (airports.timezone)
 * and the crew member's home base; acclimatisation follows the EASA
 * ORO.FTL.105 definition. Nothing here reads a database or a clock.
 */
import { civilDateInZone, civilDayWindowUtc, zoneOffsetMs } from "./civil-day";
import type {
  FdpTableKind,
  LimitKey,
  RuleSetDocument,
} from "./crew-ftl-rule-set";

export type LegalityVerdictKind = "legal" | "legal_with_extension" | "illegal";
export type CheckStatus =
  "pass" | "pass_with_extension" | "fail" | "advisory" | "not_evaluable";
export type AcclimatisationState = "B" | "D" | "X";

export interface Sector {
  departureAt: Date;
  arrivalAt: Date;
  originCode: string;
  originTimeZone: string;
  destinationCode: string;
  destinationTimeZone: string;
  flightId?: number | null;
  flightNumber?: string | null;
}

export type DutyKind =
  "fdp" | "standby_airport" | "standby_home" | "positioning" | "other";

export interface DutyPeriod {
  kind: DutyKind;
  reportAt: Date;
  releaseAt: Date;
  sectors: Sector[];
  /** Location where a duty without sectors takes place (standby). */
  locationCode?: string | null;
  locationTimeZone?: string | null;
  reference?: string | null;
}

export interface CrewProfile {
  homeBaseCode: string | null;
  homeBaseTimeZone: string;
}

/** Cumulative flight-time limits carried by the signed operator profile
 * (crew_rules evidence). The engine is the single authority for these limits:
 * it applies the stricter of the rule set and the operator value, so the
 * operator profile never evaluates them itself. */
export interface OperatorFlightTimeLimits {
  maxFlightMinutes28Days?: number | null;
  maxFlightMinutes365Days?: number | null;
  /** Names the profile in the check reference, e.g. "operator profile v3". */
  reference?: string;
}

export interface LegalityInput {
  ruleSet: RuleSetDocument;
  crew: CrewProfile;
  history: DutyPeriod[];
  proposed: DutyPeriod;
  now: Date;
  operatorLimits?: OperatorFlightTimeLimits | null;
}

export interface RuleCheck {
  code: string;
  reference: string;
  status: CheckStatus;
  limit: number | null;
  actual: number | null;
  /** limit - actual in `unit`; negative means exceeded. */
  margin: number | null;
  unit: "minutes" | "count" | "days";
  detail: string;
}

export interface FatigueFactor {
  code: string;
  weight: number;
  detail: string;
}

export interface FatigueIndicator {
  score: number;
  level: "low" | "elevated" | "high";
  factors: FatigueFactor[];
  woclEncroachmentMinutes: number;
  consecutiveEarlyStarts: number;
  consecutiveLateFinishes: number;
  disclaimer: string;
}

export interface AcclimatisationResult {
  state: AcclimatisationState;
  referenceTimeZone: string;
  localTimeZone: string;
  timeDifferenceHours: number;
  elapsedHoursSinceReference: number | null;
  tableUsed: FdpTableKind;
  reportLocalMinutes: number;
}

export interface LegalityVerdict {
  verdict: LegalityVerdictKind;
  checks: RuleCheck[];
  acclimatisation: AcclimatisationResult;
  fdpMinutes: number;
  extensionUsed: boolean;
  fatigue: FatigueIndicator;
  ruleSet: { code: string; version: string };
  evaluatedAt: string;
}

export const FATIGUE_DISCLAIMER =
  "Advisory fatigue indicator derived from schedule features only; not a certified fatigue risk management system (FRMS) and not a legality rule.";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export class LegalityInputError extends Error {}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function localMinutesOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const field = (type: string) =>
    Number(parts.find(p => p.type === type)?.value ?? "0");
  return field("hour") * 60 + field("minute");
}

function minuteInBand(minute: number, start: number, end: number): boolean {
  return end > start
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MINUTE;
}

function overlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / MINUTE;
}

/** Minutes of [start, end) that fall inside the daily local window
 * [windowStart, windowEnd) minutes-of-day in `timeZone`. */
export function dailyWindowOverlapMinutes(
  start: Date,
  end: Date,
  timeZone: string,
  windowStart: number,
  windowEnd: number
): number {
  if (end <= start) return 0;
  let total = 0;
  let day = civilDateInZone(new Date(start.getTime() - DAY), timeZone);
  const last = civilDateInZone(new Date(end.getTime() + DAY), timeZone);
  for (let guard = 0; guard < 400; guard++) {
    const civil = civilDayWindowUtc(day, timeZone);
    const dayLength = civil.end.getTime() - civil.start.getTime();
    const wStart =
      civil.start.getTime() + Math.min(windowStart * MINUTE, dayLength);
    const wEnd =
      civil.start.getTime() + Math.min(windowEnd * MINUTE, dayLength);
    total += overlapMinutes(start.getTime(), end.getTime(), wStart, wEnd);
    if (day === last) break;
    day = civilDateInZone(new Date(civil.end.getTime() + HOUR), timeZone);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Rule-set access
// ---------------------------------------------------------------------------

export function limitValue(
  ruleSet: RuleSetDocument,
  key: LimitKey,
  qualifier: string | null = null
): { value: number | null; reference: string } | null {
  const row = ruleSet.limits.find(
    l => l.key === key && l.qualifier === qualifier
  );
  return row ? { value: row.value, reference: row.reference } : null;
}

export function lookupFdpLimit(
  ruleSet: RuleSetDocument,
  table: FdpTableKind,
  reportLocalMinutes: number,
  sectors: number
): { maxFdpMinutes: number | null; matched: boolean } {
  const count = Math.max(1, sectors);
  const rows = ruleSet.fdpLimits.filter(
    r =>
      r.table === table &&
      r.qualifier === null &&
      count >= r.sectorsFrom &&
      count <= r.sectorsTo &&
      minuteInBand(reportLocalMinutes, r.bandStartMinute, r.bandEndMinute)
  );
  if (rows.length !== 1) return { maxFdpMinutes: null, matched: false };
  return { maxFdpMinutes: rows[0].maxFdpMinutes, matched: true };
}

// ---------------------------------------------------------------------------
// Acclimatisation (ORO.FTL.105(1))
// ---------------------------------------------------------------------------

/** ORO.FTL.105(1) table: state after `elapsedHours` since reporting at
 * reference time, given the time difference to the local zone. B keeps the
 * reference zone, D re-acclimatises to the local zone, X is unknown. */
export function acclimatisationState(
  timeDifferenceHours: number,
  elapsedHours: number
): AcclimatisationState {
  const diff = Math.abs(timeDifferenceHours);
  if (diff < 2) return "D";
  if (elapsedHours < 48) return "B";
  if (elapsedHours >= 120) return "D";
  if (elapsedHours < 72) return diff < 4 ? "D" : "X";
  if (elapsedHours < 96) return diff < 6 ? "D" : "X";
  return diff < 9 ? "D" : "X";
}

interface AcclimatisationTracker {
  referenceTimeZone: string;
  lastReferenceReportAt: Date | null;
}

function dutyLocalTimeZone(duty: DutyPeriod, crew: CrewProfile): string {
  return (
    duty.sectors[0]?.originTimeZone ??
    duty.locationTimeZone ??
    crew.homeBaseTimeZone
  );
}

function zoneDifferenceHours(a: string, b: string, at: Date): number {
  return (zoneOffsetMs(at, a) - zoneOffsetMs(at, b)) / HOUR;
}

/** Advances the tracker through one duty and returns its acclimatisation. */
function stepAcclimatisation(
  tracker: AcclimatisationTracker,
  duty: DutyPeriod,
  crew: CrewProfile
): AcclimatisationResult {
  const localTimeZone = dutyLocalTimeZone(duty, crew);
  const timeDifferenceHours = zoneDifferenceHours(
    localTimeZone,
    tracker.referenceTimeZone,
    duty.reportAt
  );
  const elapsedHours = tracker.lastReferenceReportAt
    ? minutesBetween(tracker.lastReferenceReportAt, duty.reportAt) / 60
    : null;
  const state = acclimatisationState(timeDifferenceHours, elapsedHours ?? 0);
  // D: (re-)acclimatised to the local zone, which becomes the reference and
  // restarts the elapsed-time clock. B/X keep the reference and the clock.
  if (state === "D") {
    tracker.referenceTimeZone = localTimeZone;
    tracker.lastReferenceReportAt = duty.reportAt;
  }
  const tableUsed: FdpTableKind =
    state === "X" ? "unknown_acclimatisation" : "acclimatised";
  const reportZone = state === "D" ? localTimeZone : tracker.referenceTimeZone;
  return {
    state,
    referenceTimeZone: tracker.referenceTimeZone,
    localTimeZone,
    timeDifferenceHours,
    elapsedHoursSinceReference: elapsedHours,
    tableUsed,
    reportLocalMinutes: localMinutesOfDay(duty.reportAt, reportZone),
  };
}

// ---------------------------------------------------------------------------
// Duty arithmetic
// ---------------------------------------------------------------------------

function sortedSectors(duty: DutyPeriod): Sector[] {
  return [...duty.sectors].sort(
    (a, b) => a.departureAt.getTime() - b.departureAt.getTime()
  );
}

/** FDP: report until on-blocks of the last sector (ORO.FTL.105(13)). */
export function fdpMinutes(duty: DutyPeriod): number {
  const sectors = sortedSectors(duty);
  const end = sectors.length
    ? sectors[sectors.length - 1].arrivalAt
    : duty.releaseAt;
  return Math.max(0, minutesBetween(duty.reportAt, end));
}

function dutyCountFactor(duty: DutyPeriod, ruleSet: RuleSetDocument): number {
  if (duty.kind === "standby_home") {
    const percent = limitValue(
      ruleSet,
      "home_standby_duty_count_percent"
    )?.value;
    // Without a documented factor, standby counts in full (conservative).
    return percent === null || percent === undefined ? 1 : percent / 100;
  }
  if (duty.kind === "standby_airport") {
    const counts = limitValue(ruleSet, "airport_standby_counts_as_duty")?.value;
    return counts === 0 ? 0 : 1;
  }
  return 1;
}

function dutyMinutesInWindow(
  duties: DutyPeriod[],
  ruleSet: RuleSetDocument,
  windowStart: Date,
  windowEnd: Date
): number {
  return duties.reduce(
    (sum, d) =>
      sum +
      overlapMinutes(
        d.reportAt.getTime(),
        d.releaseAt.getTime(),
        windowStart.getTime(),
        windowEnd.getTime()
      ) *
        dutyCountFactor(d, ruleSet),
    0
  );
}

function flightMinutesInWindow(
  duties: DutyPeriod[],
  windowStart: Date,
  windowEnd: Date
): number {
  return duties.reduce(
    (sum, d) =>
      sum +
      d.sectors.reduce(
        (inner, s) =>
          inner +
          overlapMinutes(
            s.departureAt.getTime(),
            s.arrivalAt.getTime(),
            windowStart.getTime(),
            windowEnd.getTime()
          ),
        0
      ),
    0
  );
}

function restLocationIsHomeBase(duty: DutyPeriod, crew: CrewProfile): boolean {
  if (!crew.homeBaseCode) return false;
  const sectors = sortedSectors(duty);
  const code = sectors.length
    ? sectors[sectors.length - 1].destinationCode
    : (duty.locationCode ??
      (duty.kind === "standby_home" ? crew.homeBaseCode : null));
  return code === crew.homeBaseCode;
}

function validateDuty(duty: DutyPeriod, label: string) {
  const times = [
    duty.reportAt,
    duty.releaseAt,
    ...duty.sectors.flatMap(s => [s.departureAt, s.arrivalAt]),
  ];
  if (times.some(t => !(t instanceof Date) || !Number.isFinite(t.getTime())))
    throw new LegalityInputError(`${label}: duty has an invalid time`);
  if (duty.releaseAt <= duty.reportAt)
    throw new LegalityInputError(`${label}: release must follow report`);
  for (const s of duty.sectors) {
    if (s.arrivalAt <= s.departureAt)
      throw new LegalityInputError(
        `${label}: sector arrival must follow departure`
      );
    if (s.departureAt < duty.reportAt || s.arrivalAt > duty.releaseAt)
      throw new LegalityInputError(
        `${label}: sector lies outside report/release bounds`
      );
  }
}

// ---------------------------------------------------------------------------
// Fatigue indicator (advisory)
// ---------------------------------------------------------------------------

/** EASA ORO.FTL.105 definitions at the acclimatised reference time:
 * early start 05:00-05:59, late finish 23:00-01:59, WOCL 02:00-05:59. */
const EARLY_START = { start: 5 * 60, end: 6 * 60 };
const LATE_FINISH = { start: 23 * 60, end: 2 * 60 };

export function fatigueIndicator(input: {
  ruleSet: RuleSetDocument;
  duties: DutyPeriod[]; // history + proposed, chronological
  proposed: DutyPeriod;
  referenceTimeZone: string;
  fdpLimit: number | null;
  restMarginMinutes: number | null;
  duty28Utilisation: number | null;
}): FatigueIndicator {
  const factors: FatigueFactor[] = [];
  const woclStart =
    limitValue(input.ruleSet, "wocl_start_minute")?.value ?? 120;
  const woclEnd = limitValue(input.ruleSet, "wocl_end_minute")?.value ?? 360;
  const wocl = dailyWindowOverlapMinutes(
    input.proposed.reportAt,
    input.proposed.releaseAt,
    input.referenceTimeZone,
    woclStart,
    woclEnd
  );
  if (wocl > 0)
    factors.push({
      code: "WOCL_ENCROACHMENT",
      weight: Math.min(40, Math.round(wocl / 6)),
      detail: `${Math.round(wocl)} min of duty inside the window of circadian low (${fmt(woclStart)}-${fmt(woclEnd)} reference time)`,
    });
  const recent = input.duties.filter(
    d =>
      d.kind === "fdp" &&
      d.reportAt.getTime() >= input.proposed.reportAt.getTime() - 7 * DAY &&
      d.reportAt.getTime() <= input.proposed.reportAt.getTime()
  );
  const consecutive = (predicate: (d: DutyPeriod) => boolean) => {
    let count = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (predicate(recent[i])) count++;
      else break;
    }
    return count;
  };
  const earlyStarts = consecutive(d =>
    minuteInBand(
      localMinutesOfDay(d.reportAt, input.referenceTimeZone),
      EARLY_START.start,
      EARLY_START.end
    )
  );
  const lateFinishes = consecutive(d =>
    minuteInBand(
      localMinutesOfDay(d.releaseAt, input.referenceTimeZone),
      LATE_FINISH.start,
      LATE_FINISH.end
    )
  );
  if (earlyStarts >= 2)
    factors.push({
      code: "CONSECUTIVE_EARLY_STARTS",
      weight: Math.min(30, (earlyStarts - 1) * 10),
      detail: `${earlyStarts} consecutive duties reporting 05:00-05:59`,
    });
  if (lateFinishes >= 2)
    factors.push({
      code: "CONSECUTIVE_LATE_FINISHES",
      weight: Math.min(30, (lateFinishes - 1) * 10),
      detail: `${lateFinishes} consecutive duties released 23:00-01:59`,
    });
  const fdp = fdpMinutes(input.proposed);
  if (input.fdpLimit && fdp / input.fdpLimit >= 0.9)
    factors.push({
      code: "FDP_NEAR_LIMIT",
      weight: 15,
      detail: `FDP at ${Math.round((fdp / input.fdpLimit) * 100)}% of the daily maximum`,
    });
  if (input.restMarginMinutes !== null && input.restMarginMinutes < 60)
    factors.push({
      code: "MINIMUM_REST",
      weight: 10,
      detail: `Preceding rest exceeds the minimum by only ${Math.round(input.restMarginMinutes)} min`,
    });
  if (input.proposed.sectors.length > 4)
    factors.push({
      code: "HIGH_SECTOR_COUNT",
      weight: Math.min(15, (input.proposed.sectors.length - 4) * 5),
      detail: `${input.proposed.sectors.length} sectors in one FDP`,
    });
  if (input.duty28Utilisation !== null && input.duty28Utilisation >= 0.8)
    factors.push({
      code: "CUMULATIVE_DUTY_LOAD",
      weight: 10,
      detail: `28-day duty at ${Math.round(input.duty28Utilisation * 100)}% of the limit`,
    });
  const score = Math.min(
    100,
    factors.reduce((s, f) => s + f.weight, 0)
  );
  return {
    score,
    level: score < 25 ? "low" : score < 50 ? "elevated" : "high",
    factors,
    woclEncroachmentMinutes: Math.round(wocl),
    consecutiveEarlyStarts: earlyStarts,
    consecutiveLateFinishes: lateFinishes,
    disclaimer: FATIGUE_DISCLAIMER,
  };
}

function fmt(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export function evaluateLegality(input: LegalityInput): LegalityVerdict {
  const { ruleSet, crew } = input;
  validateDuty(input.proposed, "proposed");
  input.history.forEach((d, i) => validateDuty(d, `history[${i}]`));
  const history = [...input.history].sort(
    (a, b) => a.reportAt.getTime() - b.reportAt.getTime()
  );
  const proposed = input.proposed;
  const checks: RuleCheck[] = [];
  const push = (check: RuleCheck) => checks.push(check);

  // -- Overlap with existing duties -----------------------------------------
  const overlapping = history.filter(
    d => d.reportAt < proposed.releaseAt && d.releaseAt > proposed.reportAt
  );
  push({
    code: "NO_OVERLAP",
    reference: "duty integrity",
    status: overlapping.length ? "fail" : "pass",
    limit: 0,
    actual: overlapping.length,
    margin: -overlapping.length,
    unit: "count",
    detail: overlapping.length
      ? `Overlaps ${overlapping.length} existing duty period(s)`
      : "No overlapping duty",
  });

  // -- Acclimatisation walk and extension usage in history -----------------
  const tracker: AcclimatisationTracker = {
    referenceTimeZone: crew.homeBaseTimeZone,
    lastReferenceReportAt: null,
  };
  const extensionMinutes =
    limitValue(ruleSet, "fdp_extension_minutes")?.value ?? null;
  const extensionEvents: Date[] = [];
  const before = history.filter(d => d.reportAt < proposed.reportAt);
  const after = history.filter(d => d.reportAt >= proposed.reportAt);
  for (const duty of before) {
    const acc = stepAcclimatisation(tracker, duty, crew);
    if (duty.kind !== "fdp" || !duty.sectors.length) continue;
    const limit = lookupFdpLimit(
      ruleSet,
      acc.tableUsed,
      acc.reportLocalMinutes,
      duty.sectors.length
    );
    if (limit.maxFdpMinutes !== null && fdpMinutes(duty) > limit.maxFdpMinutes)
      extensionEvents.push(duty.releaseAt);
  }
  const acclimatisation = stepAcclimatisation(tracker, proposed, crew);

  // -- Maximum FDP (ORO.FTL.205) --------------------------------------------
  const fdp = fdpMinutes(proposed);
  const sectors = proposed.sectors.length;
  let extensionUsed = false;
  let fdpLimit: number | null = null;
  if (proposed.kind === "fdp" && sectors > 0) {
    const lookup = lookupFdpLimit(
      ruleSet,
      acclimatisation.tableUsed,
      acclimatisation.reportLocalMinutes,
      sectors
    );
    fdpLimit = lookup.maxFdpMinutes;
    if (!lookup.matched || fdpLimit === null)
      push({
        code: "FDP_MAX",
        reference: "FDP table",
        status: "not_evaluable",
        limit: null,
        actual: fdp,
        margin: null,
        unit: "minutes",
        detail: `No ${acclimatisation.tableUsed} FDP value for report ${fmt(acclimatisation.reportLocalMinutes)} and ${sectors} sector(s)`,
      });
    else if (fdp <= fdpLimit)
      push({
        code: "FDP_MAX",
        reference: `FDP table (${acclimatisation.tableUsed}, state ${acclimatisation.state})`,
        status: "pass",
        limit: fdpLimit,
        actual: fdp,
        margin: fdpLimit - fdp,
        unit: "minutes",
        detail: `FDP ${fmt(fdp)} within ${fmt(fdpLimit)} for report ${fmt(acclimatisation.reportLocalMinutes)} reference time, ${sectors} sector(s)`,
      });
    else {
      const maxSectors =
        limitValue(ruleSet, "fdp_extension_max_sectors")?.value ?? null;
      const extendable =
        acclimatisation.state !== "X" &&
        extensionMinutes !== null &&
        fdp <= fdpLimit + extensionMinutes &&
        (maxSectors === null || sectors <= maxSectors);
      extensionUsed = extendable;
      push({
        code: "FDP_MAX",
        reference: `FDP table (${acclimatisation.tableUsed}, state ${acclimatisation.state})`,
        status: extendable ? "pass_with_extension" : "fail",
        limit: fdpLimit,
        actual: fdp,
        margin: fdpLimit - fdp,
        unit: "minutes",
        detail: extendable
          ? `FDP ${fmt(fdp)} exceeds basic ${fmt(fdpLimit)} and relies on a ${extensionMinutes} min extension`
          : `FDP ${fmt(fdp)} exceeds ${fmt(fdpLimit)}${extensionMinutes === null ? "" : ` and the ${extensionMinutes} min extension`}`,
      });
    }
  }

  // -- Extension count per 7 consecutive days (ORO.FTL.205(d)) --------------
  const extensionsLimit = limitValue(ruleSet, "fdp_extensions_per_7_days");
  if (extensionsLimit && extensionsLimit.value !== null) {
    const windowStart = new Date(proposed.releaseAt.getTime() - 7 * DAY);
    const used =
      extensionEvents.filter(t => t > windowStart && t <= proposed.releaseAt)
        .length + (extensionUsed ? 1 : 0);
    push({
      code: "FDP_EXTENSIONS_7D",
      reference: extensionsLimit.reference,
      status: used > extensionsLimit.value ? "fail" : "pass",
      limit: extensionsLimit.value,
      actual: used,
      margin: extensionsLimit.value - used,
      unit: "count",
      detail: `${used} extension(s) in the 7 days ending at release, limit ${extensionsLimit.value}`,
    });
  }

  // -- Minimum rest before and after (ORO.FTL.235) --------------------------
  const homeRest = limitValue(ruleSet, "min_rest_home_base_minutes");
  const awayRest = limitValue(ruleSet, "min_rest_away_minutes");
  const precedingRule =
    limitValue(ruleSet, "min_rest_at_least_preceding_duty")?.value ?? 1;
  let restMarginMinutes: number | null = null;
  const restCheck = (code: string, previous: DutyPeriod, next: DutyPeriod) => {
    const atHome = restLocationIsHomeBase(previous, crew);
    const floor = atHome ? homeRest : awayRest;
    const precedingMinutes = minutesBetween(
      previous.reportAt,
      previous.releaseAt
    );
    if (!floor || floor.value === null) {
      push({
        code,
        reference: atHome
          ? "min_rest_home_base_minutes"
          : "min_rest_away_minutes",
        status: "not_evaluable",
        limit: null,
        actual: minutesBetween(previous.releaseAt, next.reportAt),
        margin: null,
        unit: "minutes",
        detail: "Minimum rest value missing from the rule set",
      });
      return;
    }
    const required = Math.max(
      floor.value,
      precedingRule ? precedingMinutes : 0
    );
    const actual = minutesBetween(previous.releaseAt, next.reportAt);
    push({
      code,
      reference: floor.reference,
      status: actual >= required ? "pass" : "fail",
      limit: required,
      actual,
      margin: actual - required,
      unit: "minutes",
      detail: `Rest ${fmt(Math.max(0, actual))} ${atHome ? "at home base" : "away from base"}; required max(${fmt(floor.value)}, preceding duty ${fmt(precedingMinutes)})`,
    });
    if (code === "REST_BEFORE") restMarginMinutes = actual - required;
  };
  const previous = before.filter(d => d.releaseAt <= proposed.reportAt).at(-1);
  if (previous) restCheck("REST_BEFORE", previous, proposed);
  else
    push({
      code: "REST_BEFORE",
      reference: homeRest?.reference ?? "min_rest",
      status: "pass",
      limit: null,
      actual: null,
      margin: null,
      unit: "minutes",
      detail: "No preceding duty in the evaluated history",
    });
  const next = after.find(d => d.reportAt >= proposed.releaseAt);
  if (next) restCheck("REST_AFTER", proposed, next);

  // -- Cumulative duty windows (ORO.FTL.210(c)) -----------------------------
  const allDuties = [...before, proposed, ...after];
  let duty28Utilisation: number | null = null;
  for (const [days, key] of [
    [7, "max_duty_minutes_7_days"],
    [14, "max_duty_minutes_14_days"],
    [28, "max_duty_minutes_28_days"],
  ] as Array<[number, LimitKey]>) {
    const limit = limitValue(ruleSet, key);
    const windowStart = new Date(proposed.releaseAt.getTime() - days * DAY);
    const actual = Math.round(
      dutyMinutesInWindow(allDuties, ruleSet, windowStart, proposed.releaseAt)
    );
    push(
      cumulative(
        `DUTY_${days}D`,
        limit,
        actual,
        `${days} consecutive days ending at release`
      )
    );
    if (days === 28 && limit?.value) duty28Utilisation = actual / limit.value;
  }

  // -- Cumulative flight time (ORO.FTL.210(a)) ------------------------------
  // Rolling windows: the rule set and the signed operator profile may both
  // carry a value; the stricter applies. A rolling total can only grow while a
  // sector is in progress, so every window ending at the last arrival of the
  // proposed duty or of a later rostered duty that still sees a proposed
  // sector is checked, and the tightest one is reported.
  const operator = input.operatorLimits ?? null;
  push(
    rollingFlightTime(
      "FLIGHT_28D",
      28,
      limitValue(ruleSet, "max_flight_minutes_28_days"),
      operator?.maxFlightMinutes28Days ?? null,
      operator?.reference ?? "operator profile",
      proposed,
      after,
      allDuties
    )
  );
  const flight365 = limitValue(ruleSet, "max_flight_minutes_365_days");
  if (
    (flight365 && flight365.value !== null) ||
    (operator?.maxFlightMinutes365Days ?? null) !== null
  )
    push(
      rollingFlightTime(
        "FLIGHT_365D",
        365,
        flight365,
        operator?.maxFlightMinutes365Days ?? null,
        operator?.reference ?? "operator profile",
        proposed,
        after,
        allDuties
      )
    );
  const homeTz = crew.homeBaseTimeZone;
  const releaseDate = civilDateInZone(proposed.releaseAt, homeTz);
  const yearStart = civilDayWindowUtc(
    `${releaseDate.slice(0, 4)}-01-01`,
    homeTz
  ).start;
  push(
    cumulative(
      "FLIGHT_CALENDAR_YEAR",
      limitValue(ruleSet, "max_flight_minutes_calendar_year"),
      Math.round(
        flightMinutesInWindow(allDuties, yearStart, proposed.releaseAt)
      ),
      `calendar year ${releaseDate.slice(0, 4)} (${homeTz})`
    )
  );
  const [y, m] = releaseDate.split("-").map(Number);
  const monthIndex = y * 12 + (m - 1) - 11;
  const twelveMonthStart = civilDayWindowUtc(
    `${Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, "0")}-01`,
    homeTz
  ).start;
  push(
    cumulative(
      "FLIGHT_12_MONTHS",
      limitValue(ruleSet, "max_flight_minutes_12_months"),
      Math.round(
        flightMinutesInWindow(allDuties, twelveMonthStart, proposed.releaseAt)
      ),
      "12 consecutive calendar months ending with the release month"
    )
  );

  // -- Recurrent extended recovery rest (ORO.FTL.235(d)) --------------------
  const recurrentRest = limitValue(ruleSet, "recurrent_extended_rest_minutes");
  const maxBetween = limitValue(ruleSet, "max_minutes_between_recurrent_rest");
  if (recurrentRest?.value && maxBetween?.value && before.length) {
    const chain = [...before, proposed];
    let lastRecoveryEnd: Date | null = null;
    for (let i = 1; i < chain.length; i++)
      if (
        minutesBetween(chain[i - 1].releaseAt, chain[i].reportAt) >=
        recurrentRest.value
      )
        lastRecoveryEnd = chain[i].reportAt;
    const since = lastRecoveryEnd
      ? minutesBetween(lastRecoveryEnd, proposed.releaseAt)
      : minutesBetween(before[0].reportAt, proposed.releaseAt);
    const evaluable = lastRecoveryEnd !== null || since > maxBetween.value;
    push({
      code: "RECURRENT_REST_168H",
      reference: maxBetween.reference,
      status: !evaluable ? "pass" : since <= maxBetween.value ? "pass" : "fail",
      limit: maxBetween.value,
      actual: Math.round(since),
      margin: Math.round(maxBetween.value - since),
      unit: "minutes",
      detail: lastRecoveryEnd
        ? `${fmt(Math.round(since))} since the end of the last ${fmt(recurrentRest.value)} recovery rest`
        : `No ${fmt(recurrentRest.value)} recovery rest found in the evaluated history`,
    });
  }

  // -- Consecutive duty days (optional rule) ---------------------------------
  const consecutiveLimit = limitValue(ruleSet, "max_consecutive_duty_days");
  if (consecutiveLimit && consecutiveLimit.value !== null) {
    const days = new Set(
      allDuties.map(d => civilDateInZone(d.reportAt, homeTz))
    );
    let count = 0;
    let cursor = civilDateInZone(proposed.reportAt, homeTz);
    while (days.has(cursor) && count < 400) {
      count++;
      const [cy, cm, cd] = cursor.split("-").map(Number);
      cursor = new Date(Date.UTC(cy, cm - 1, cd - 1))
        .toISOString()
        .slice(0, 10);
    }
    push({
      code: "MAX_CONSECUTIVE_DUTY_DAYS",
      reference: consecutiveLimit.reference,
      status: count > consecutiveLimit.value ? "fail" : "pass",
      limit: consecutiveLimit.value,
      actual: count,
      margin: consecutiveLimit.value - count,
      unit: "days",
      detail: `${count} consecutive duty day(s) ending with the proposed duty`,
    });
  }

  // -- Roster publication lead (planning rule, advisory on disruption) ------
  const lead = limitValue(ruleSet, "roster_publication_lead_days");
  if (lead && lead.value !== null) {
    const noticeDays = minutesBetween(input.now, proposed.reportAt) / (24 * 60);
    push({
      code: "ROSTER_PUBLICATION_LEAD",
      reference: lead.reference,
      status: noticeDays >= lead.value ? "pass" : "advisory",
      limit: lead.value,
      actual: Math.round(noticeDays * 10) / 10,
      margin: Math.round((noticeDays - lead.value) * 10) / 10,
      unit: "days",
      detail:
        noticeDays >= lead.value
          ? "Assignment notice meets the roster publication lead"
          : "Short-notice assignment: roster publication lead not met (advisory; disruption changes are logged)",
    });
  }

  // -- Rule-set completeness --------------------------------------------------
  if (ruleSet.valuesStatus === "pending_official_text")
    push({
      code: "RULE_SET_VALUES",
      reference: ruleSet.code,
      status: "not_evaluable",
      limit: null,
      actual: null,
      margin: null,
      unit: "count",
      detail: "Rule set values are pending the official text",
    });

  const verdict: LegalityVerdictKind = checks.some(
    c => c.status === "fail" || c.status === "not_evaluable"
  )
    ? "illegal"
    : checks.some(c => c.status === "pass_with_extension")
      ? "legal_with_extension"
      : "legal";

  const fatigue = fatigueIndicator({
    ruleSet,
    duties: allDuties,
    proposed,
    referenceTimeZone: acclimatisation.referenceTimeZone,
    fdpLimit,
    restMarginMinutes,
    duty28Utilisation,
  });

  return {
    verdict,
    checks,
    acclimatisation,
    fdpMinutes: fdp,
    extensionUsed,
    fatigue,
    ruleSet: { code: ruleSet.code, version: ruleSet.version },
    evaluatedAt: input.now.toISOString(),
  };
}

function cumulative(
  code: string,
  limit: { value: number | null; reference: string } | null,
  actual: number,
  window: string
): RuleCheck {
  if (!limit || limit.value === null)
    return {
      code,
      reference: limit?.reference ?? code,
      status: "not_evaluable",
      limit: null,
      actual,
      margin: null,
      unit: "minutes",
      detail: `Limit missing from the rule set (${window})`,
    };
  return {
    code,
    reference: limit.reference,
    status: actual > limit.value ? "fail" : "pass",
    limit: limit.value,
    actual,
    margin: limit.value - actual,
    unit: "minutes",
    detail: `${fmt(actual)} of ${fmt(limit.value)} in ${window}`,
  };
}

/** Last on-blocks time of a duty, or its release when it has no sectors. */
function lastArrival(duty: DutyPeriod): Date {
  const sectors = sortedSectors(duty);
  return sectors.length
    ? sectors[sectors.length - 1].arrivalAt
    : duty.releaseAt;
}

function rollingFlightTime(
  code: string,
  days: number,
  ruleSetLimit: { value: number | null; reference: string } | null,
  operatorLimit: number | null,
  operatorReference: string,
  proposed: DutyPeriod,
  after: DutyPeriod[],
  allDuties: DutyPeriod[]
): RuleCheck {
  const window = `${days} consecutive days`;
  const windowMinutes = (end: Date) =>
    Math.round(
      flightMinutesInWindow(
        allDuties,
        new Date(end.getTime() - days * DAY),
        end
      )
    );
  const proposedEnd = lastArrival(proposed);
  // Later rostered duties whose rolling window still contains a proposed sector.
  const endpoints = [
    { end: proposedEnd, reference: proposed.reference ?? "proposed duty" },
    ...after
      .filter(d => d.sectors.length)
      .map(d => ({
        end: lastArrival(d),
        reference: d.reference ?? "later duty",
      }))
      .filter(
        e =>
          e.end > proposedEnd &&
          proposed.sectors.some(
            s => s.arrivalAt.getTime() > e.end.getTime() - days * DAY
          )
      ),
  ];
  const totals = endpoints.map(e => ({ ...e, actual: windowMinutes(e.end) }));
  const worst = totals.reduce((a, b) => (b.actual > a.actual ? b : a));
  const sources: string[] = [];
  let limit: number | null = null;
  if (ruleSetLimit && ruleSetLimit.value !== null) {
    limit = ruleSetLimit.value;
    sources.push(ruleSetLimit.reference);
  }
  if (operatorLimit !== null && (limit === null || operatorLimit < limit)) {
    limit = operatorLimit;
    sources.unshift(operatorReference);
  } else if (operatorLimit !== null) sources.push(operatorReference);
  if (limit === null)
    return {
      code,
      reference: ruleSetLimit?.reference ?? code,
      status: "not_evaluable",
      limit: null,
      actual: worst.actual,
      margin: null,
      unit: "minutes",
      detail: `Limit missing from the rule set and the operator profile (${window})`,
    };
  const where =
    worst.end === proposedEnd
      ? `${window} ending at the proposed duty's last arrival`
      : `${window} ending at the last arrival of ${worst.reference}`;
  return {
    code,
    reference: sources.join(" / "),
    status: worst.actual > limit ? "fail" : "pass",
    limit,
    actual: worst.actual,
    margin: limit - worst.actual,
    unit: "minutes",
    detail: `${fmt(worst.actual)} of ${fmt(limit)} in ${where}`,
  };
}

export function failedRuleCodes(verdict: LegalityVerdict): string[] {
  return verdict.checks
    .filter(c => c.status === "fail" || c.status === "not_evaluable")
    .map(c => c.code);
}
