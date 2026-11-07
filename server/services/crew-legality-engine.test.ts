import { describe, expect, it } from "vitest";
import {
  acclimatisationState,
  dailyWindowOverlapMinutes,
  evaluateLegality,
  lookupFdpLimit,
  type DutyPeriod,
  type Sector,
} from "./crew-legality-engine";
import {
  easaOroFtlRuleSet,
  gacarPart117RuleSet,
  ruleSetReadinessIssues,
} from "./crew-ftl-rule-set";

const easa = easaOroFtlRuleSet();
const RUH = { code: "RUH", tz: "Asia/Riyadh" };
const JED = { code: "JED", tz: "Asia/Riyadh" };
const LHR = { code: "LHR", tz: "Europe/London" };
const JFK = { code: "JFK", tz: "America/New_York" };
const crew = { homeBaseCode: "RUH", homeBaseTimeZone: "Asia/Riyadh" };
const H = 3_600_000;
const D = 24 * H;

const at = (iso: string) => new Date(iso);
function sector(
  dep: string | Date,
  arr: string | Date,
  from = RUH,
  to = JED
): Sector {
  return {
    departureAt: new Date(dep),
    arrivalAt: new Date(arr),
    originCode: from.code,
    originTimeZone: from.tz,
    destinationCode: to.code,
    destinationTimeZone: to.tz,
  };
}
/** FDP with one sector: report 60 min before departure, release 30 min after. */
function fdp(dep: string, arr: string, from = RUH, to = JED): DutyPeriod {
  const s = sector(dep, arr, from, to);
  return {
    kind: "fdp",
    reportAt: new Date(s.departureAt.getTime() - H),
    releaseAt: new Date(s.arrivalAt.getTime() + H / 2),
    sectors: [s],
  };
}
function duty(
  reportAt: string,
  releaseAt: string,
  sectors: Sector[]
): DutyPeriod {
  return {
    kind: "fdp",
    reportAt: at(reportAt),
    releaseAt: at(releaseAt),
    sectors,
  };
}
const check = (verdict: ReturnType<typeof evaluateLegality>, code: string) => {
  const found = verdict.checks.find(c => c.code === code);
  if (!found) throw new Error(`missing check ${code}`);
  return found;
};
const now = at("2026-10-01T00:00:00Z");

describe("ORO.FTL.205 Table 1 lookups at band edges (acclimatised)", () => {
  it.each([
    [5 * 60 + 59, 1, 765], // 05:45-05:59 column 1-2 sectors
    [6 * 60, 1, 780], // 06:00 start of the 13:00 band
    [13 * 60 + 29, 2, 780], // last minute of the 13:00 band
    [13 * 60 + 30, 2, 765], // 13:30 band
    [16 * 60 + 59, 1, 675],
    [17 * 60, 1, 660], // 17:00-04:59 wraps midnight
    [0, 1, 660],
    [4 * 60 + 59, 1, 660],
    [5 * 60, 1, 720], // 05:00-05:14
    [6 * 60, 4, 720], // 4 sectors
    [6 * 60, 10, 540], // 10+ sectors column
    [6 * 60, 14, 540],
  ])("report %i min, %i sectors -> %i", (minute, sectors, expected) => {
    expect(lookupFdpLimit(easa, "acclimatised", minute, sectors)).toEqual({
      maxFdpMinutes: expected,
      matched: true,
    });
  });
  it("unknown acclimatisation ignores report time: 11:00 / 10:30 / 10:00", () => {
    expect(
      lookupFdpLimit(easa, "unknown_acclimatisation", 3 * 60, 2).maxFdpMinutes
    ).toBe(660);
    expect(
      lookupFdpLimit(easa, "unknown_acclimatisation", 15 * 60, 3).maxFdpMinutes
    ).toBe(630);
    expect(
      lookupFdpLimit(easa, "unknown_acclimatisation", 23 * 60, 4).maxFdpMinutes
    ).toBe(600);
  });
  it("the seed tiles every report minute for every sector column", () => {
    expect(ruleSetReadinessIssues(easa)).toEqual([]);
  });
});

describe("maximum FDP and extensions", () => {
  // Report 06:00 Riyadh = 03:00Z. Two sectors.
  const base = (fdpMinutes: number) =>
    duty(
      "2026-10-10T03:00:00Z",
      new Date(
        at("2026-10-10T03:00:00Z").getTime() + fdpMinutes * 60000 + 30 * 60000
      ).toISOString(),
      [
        sector("2026-10-10T04:00:00Z", "2026-10-10T06:00:00Z"),
        sector(
          "2026-10-10T07:00:00Z",
          new Date(
            at("2026-10-10T03:00:00Z").getTime() + fdpMinutes * 60000
          ).toISOString(),
          JED,
          RUH
        ),
      ]
    );
  it("accepts an FDP exactly at the 13:00 limit with zero margin", () => {
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [],
      proposed: base(780),
      now,
    });
    expect(v.verdict).toBe("legal");
    expect(check(v, "FDP_MAX")).toMatchObject({
      status: "pass",
      limit: 780,
      actual: 780,
      margin: 0,
    });
    expect(v.acclimatisation).toMatchObject({
      state: "D",
      tableUsed: "acclimatised",
      reportLocalMinutes: 360,
    });
  });
  it("one minute over the basic limit is legal only with an extension", () => {
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [],
      proposed: base(781),
      now,
    });
    expect(v.verdict).toBe("legal_with_extension");
    expect(v.extensionUsed).toBe(true);
    expect(check(v, "FDP_MAX")).toMatchObject({
      status: "pass_with_extension",
      margin: -1,
    });
    expect(check(v, "FDP_EXTENSIONS_7D")).toMatchObject({
      status: "pass",
      actual: 1,
      limit: 2,
    });
  });
  it("beyond basic plus one hour is illegal", () => {
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [],
      proposed: base(841),
      now,
    });
    expect(v.verdict).toBe("illegal");
    expect(check(v, "FDP_MAX").status).toBe("fail");
  });
  it("counts extensions across a rolling 7-day window", () => {
    // Two extended FDPs (13:30 at 06:00 report) on day -6 and day -3.
    const extended = (dayOffset: number) => {
      const report = new Date(
        at("2026-10-10T03:00:00Z").getTime() + dayOffset * D
      );
      return duty(
        report.toISOString(),
        new Date(report.getTime() + 810 * 60000 + 30 * 60000).toISOString(),
        [
          sector(
            new Date(report.getTime() + H),
            new Date(report.getTime() + 810 * 60000)
          ),
        ]
      );
    };
    const inWindow = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [extended(-6), extended(-3)],
      proposed: base(800),
      now,
    });
    expect(check(inWindow, "FDP_EXTENSIONS_7D")).toMatchObject({
      status: "fail",
      actual: 3,
      limit: 2,
      margin: -1,
    });
    expect(inWindow.verdict).toBe("illegal");
    const oneOutside = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [extended(-8), extended(-3)],
      proposed: base(800),
      now,
    });
    expect(check(oneOutside, "FDP_EXTENSIONS_7D")).toMatchObject({
      status: "pass",
      actual: 2,
    });
    expect(oneOutside.verdict).toBe("legal_with_extension");
  });
});

describe("minimum rest (ORO.FTL.235)", () => {
  const proposed = fdp("2026-10-11T05:00:00Z", "2026-10-11T07:00:00Z");
  it("at home base requires 12 h or the preceding duty, whichever is longer", () => {
    // Previous duty ends at RUH 11h before the proposed report (04:00Z).
    const previous = fdp(
      "2026-10-10T15:00:00Z",
      "2026-10-10T16:30:00Z",
      JED,
      RUH
    ); // release 17:00Z
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [previous],
      proposed,
      now,
    });
    expect(check(v, "REST_BEFORE")).toMatchObject({
      status: "fail",
      limit: 720,
      actual: 660,
      margin: -60,
    });
    const longDuty = duty("2026-10-09T20:00:00Z", "2026-10-10T15:00:00Z", [
      sector("2026-10-09T21:00:00Z", "2026-10-10T14:30:00Z", JED, RUH),
    ]); // 19 h duty, rest 13 h
    const w = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [longDuty],
      proposed,
      now,
    });
    expect(check(w, "REST_BEFORE")).toMatchObject({
      status: "fail",
      limit: 19 * 60,
      actual: 13 * 60,
    });
  });
  it("away from base the floor is 10 h", () => {
    const awayProposed = fdp(
      "2026-10-11T05:00:00Z",
      "2026-10-11T07:00:00Z",
      JED,
      RUH
    );
    const previous = fdp(
      "2026-10-10T15:00:00Z",
      "2026-10-10T17:30:00Z",
      RUH,
      JED
    ); // release 18:00Z, rest 10h
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [previous],
      proposed: awayProposed,
      now,
    });
    expect(check(v, "REST_BEFORE")).toMatchObject({
      status: "pass",
      limit: 600,
      actual: 600,
      margin: 0,
    });
    const shorter = fdp(
      "2026-10-10T15:00:00Z",
      "2026-10-10T18:00:00Z",
      RUH,
      JED
    ); // rest 9h30
    const w = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [shorter],
      proposed: awayProposed,
      now,
    });
    expect(check(w, "REST_BEFORE")).toMatchObject({
      status: "fail",
      margin: -30,
    });
  });
  it("also protects the rest before an already rostered later duty", () => {
    const next = fdp("2026-10-11T15:00:00Z", "2026-10-11T17:00:00Z", JED, RUH); // report 14:00Z, proposed release 07:30Z
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [next],
      proposed,
      now,
    });
    expect(check(v, "REST_AFTER")).toMatchObject({
      status: "fail",
      limit: 600,
      actual: 390,
    });
  });
  it("rejects overlapping duties", () => {
    const overlap = fdp("2026-10-11T06:00:00Z", "2026-10-11T08:00:00Z");
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [overlap],
      proposed,
      now,
    });
    expect(check(v, "NO_OVERLAP").status).toBe("fail");
    expect(v.verdict).toBe("illegal");
  });
});

describe("cumulative flight time", () => {
  // Proposed sector 2 h on 2026-10-11. History: 49 x 2 h sectors (one per day) = 98 h.
  const proposed = fdp("2026-10-11T05:00:00Z", "2026-10-11T07:00:00Z");
  const dailyHistory = (count: number, minutes = 120) =>
    Array.from({ length: count }, (_, i) => {
      const dep = new Date(at("2026-10-10T05:00:00Z").getTime() - i * D);
      return fdp(
        dep.toISOString(),
        new Date(dep.getTime() + minutes * 60000).toISOString()
      );
    }).filter(d => d.releaseAt.getTime() - H / 2 > now.getTime() - 400 * D);
  it("passes with zero margin at exactly 100 h in 28 days", () => {
    // 27 days before the proposed with 3h38 each would be awkward; use 24 duties of 4h05 = 98h, plus 2h proposed.
    const history = Array.from({ length: 24 }, (_, i) => {
      const dep = new Date(at("2026-10-10T05:00:00Z").getTime() - i * D);
      return fdp(
        dep.toISOString(),
        new Date(dep.getTime() + 245 * 60000).toISOString()
      );
    });
    const v = evaluateLegality({ ruleSet: easa, crew, history, proposed, now });
    expect(check(v, "FLIGHT_28D")).toMatchObject({
      status: "pass",
      limit: 6000,
      actual: 6000,
      margin: 0,
    });
  });
  it("fails one minute over the 28-day limit and ignores sectors outside the window", () => {
    const history = Array.from({ length: 24 }, (_, i) => {
      const dep = new Date(at("2026-10-10T05:00:00Z").getTime() - i * D);
      return fdp(
        dep.toISOString(),
        new Date(
          dep.getTime() + 245 * 60000 + (i === 0 ? 60000 : 0)
        ).toISOString()
      );
    });
    const old = fdp("2026-09-01T05:00:00Z", "2026-09-01T15:00:00Z"); // outside 28 days
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [...history, old],
      proposed,
      now,
    });
    expect(check(v, "FLIGHT_28D")).toMatchObject({
      status: "fail",
      actual: 6001,
      margin: -1,
    });
    expect(v.verdict).toBe("illegal");
  });
  it("calendar year and 12-month windows differ for a sector flown last December", () => {
    const december = fdp("2025-12-20T05:00:00Z", "2025-12-20T07:00:00Z");
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [...dailyHistory(5), december],
      proposed,
      now,
    });
    expect(check(v, "FLIGHT_CALENDAR_YEAR").actual).toBe(6 * 120);
    expect(check(v, "FLIGHT_12_MONTHS").actual).toBe(7 * 120);
    const octoberLastYear = fdp("2025-10-20T05:00:00Z", "2025-10-20T07:00:00Z"); // before 2025-11-01
    const w = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [...dailyHistory(5), octoberLastYear],
      proposed,
      now,
    });
    expect(check(w, "FLIGHT_12_MONTHS").actual).toBe(6 * 120);
  });
  it("counts a later rostered duty's rolling window when the proposed sector still falls inside it", () => {
    // 24 x 245 min history (10-10 back to 09-17) plus the proposed 2 h sector
    // is exactly 100 h at the proposed duty's own endpoint.
    const history = Array.from({ length: 24 }, (_, i) => {
      const dep = new Date(at("2026-10-10T05:00:00Z").getTime() - i * D);
      return fdp(
        dep.toISOString(),
        new Date(dep.getTime() + 245 * 60000).toISOString()
      );
    });
    // A duty 27 days later only sees 60 min of the proposed sector and the
    // 10-10 duty; its window (425 min) is not the tightest one.
    const distant = fdp("2026-11-07T04:00:00Z", "2026-11-07T06:00:00Z");
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [...history, distant],
      proposed,
      now,
    });
    expect(check(v, "FLIGHT_28D")).toMatchObject({
      status: "pass",
      actual: 6000,
      margin: 0,
    });
    expect(check(v, "FLIGHT_28D").detail).toContain("ending at the proposed");
    // A duty the next day still holds the whole history: 5880 + 120 + 120.
    const nextDay = fdp("2026-10-12T05:00:00Z", "2026-10-12T07:00:00Z");
    const w = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [...history, nextDay],
      proposed,
      now,
    });
    expect(check(w, "FLIGHT_28D")).toMatchObject({
      status: "fail",
      actual: 6120,
      margin: -120,
    });
    expect(check(w, "FLIGHT_28D").detail).toContain("last arrival of");
    expect(w.verdict).toBe("illegal");
  });
  it("sums rolling duty windows and counts airport standby in full", () => {
    const standby: DutyPeriod = {
      kind: "standby_airport",
      reportAt: at("2026-10-10T01:00:00Z"),
      releaseAt: at("2026-10-10T07:00:00Z"),
      sectors: [],
      locationCode: "RUH",
      locationTimeZone: "Asia/Riyadh",
    };
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [standby],
      proposed,
      now,
    });
    // proposed duty 04:00Z-07:30Z = 210 min + 360 min standby
    expect(check(v, "DUTY_7D")).toMatchObject({ actual: 570, limit: 3600 });
  });
});

describe("operator flight-time limits from the signed profile", () => {
  // Three 40 min sectors a week apart: 120 min in both the 28 and 365 day windows.
  const proposed = fdp("2026-09-15T07:00:00Z", "2026-09-15T07:40:00Z");
  const history = [
    fdp("2026-09-08T07:00:00Z", "2026-09-08T07:40:00Z"),
    fdp("2026-09-01T07:00:00Z", "2026-09-01T07:40:00Z"),
  ];
  const operator = {
    maxFlightMinutes28Days: 100,
    maxFlightMinutes365Days: 100,
    reference: "operator profile operator-test",
  };
  it("applies the stricter operator 28-day limit and a 365-day limit the rule set lacks", () => {
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history,
      proposed,
      now,
      operatorLimits: operator,
    });
    expect(check(v, "FLIGHT_28D")).toMatchObject({
      status: "fail",
      limit: 100,
      actual: 120,
      margin: -20,
    });
    expect(check(v, "FLIGHT_28D").reference).toBe(
      "operator profile operator-test / ORO.FTL.210(a)(1)"
    );
    expect(check(v, "FLIGHT_365D")).toMatchObject({
      status: "fail",
      limit: 100,
      actual: 120,
      reference: "operator profile operator-test",
    });
    expect(v.verdict).toBe("illegal");
  });
  it("keeps the rule-set limit when the operator value is looser, and skips a 365-day check nobody defines", () => {
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history,
      proposed,
      now,
      operatorLimits: { maxFlightMinutes28Days: 9000 },
    });
    expect(check(v, "FLIGHT_28D")).toMatchObject({
      status: "pass",
      limit: 6000,
      actual: 120,
    });
    expect(check(v, "FLIGHT_28D").reference).toBe(
      "ORO.FTL.210(a)(1) / operator profile"
    );
    expect(v.checks.find(c => c.code === "FLIGHT_365D")).toBeUndefined();
    const plain = evaluateLegality({
      ruleSet: easa,
      crew,
      history,
      proposed,
      now,
    });
    expect(plain.checks.find(c => c.code === "FLIGHT_365D")).toBeUndefined();
  });
  it("protects a later rostered duty's own rolling window under the operator limit", () => {
    // Proposed 07:00-12:00Z flight on 09-15; a later sector on 10-13 11:00-11:20Z
    // sees only the last 40 min of it (window starts 09-15 11:20Z): 60 min total.
    const long = duty("2026-09-15T06:00:00Z", "2026-09-15T12:30:00Z", [
      sector("2026-09-15T07:00:00Z", "2026-09-15T12:00:00Z"),
    ]);
    const later = duty("2026-10-13T10:00:00Z", "2026-10-13T11:30:00Z", [
      sector("2026-10-13T11:00:00Z", "2026-10-13T11:20:00Z"),
    ]);
    const limits = (minutes: number) => ({
      maxFlightMinutes28Days: minutes,
      reference: "operator profile",
    });
    const ok = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [later],
      proposed: long,
      now,
      operatorLimits: limits(300),
    });
    expect(check(ok, "FLIGHT_28D")).toMatchObject({
      status: "pass",
      actual: 300,
    });
    const atLimit = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [later],
      proposed: long,
      now,
      operatorLimits: limits(60),
    });
    // The proposed duty's own window (300 min) fails first at 60.
    expect(check(atLimit, "FLIGHT_28D").status).toBe("fail");
    const shortProposed = duty("2026-09-15T06:00:00Z", "2026-09-15T12:30:00Z", [
      sector("2026-09-15T11:20:00Z", "2026-09-15T12:00:00Z"),
    ]);
    for (const [limit, status] of [
      [60, "pass"],
      [59, "fail"],
    ] as const) {
      const v = evaluateLegality({
        ruleSet: easa,
        crew,
        history: [later],
        proposed: shortProposed,
        now,
        operatorLimits: limits(limit),
      });
      expect(check(v, "FLIGHT_28D")).toMatchObject({
        status,
        limit,
        actual: 60,
      });
      expect(check(v, "FLIGHT_28D").detail).toContain("last arrival of");
    }
  });
});

describe("acclimatisation after a time-zone shift (ORO.FTL.105)", () => {
  it("state table", () => {
    expect(acclimatisationState(1, 200)).toBe("D");
    expect(acclimatisationState(8, 30)).toBe("B");
    expect(acclimatisationState(3, 50)).toBe("D");
    expect(acclimatisationState(5, 50)).toBe("X");
    expect(acclimatisationState(5, 80)).toBe("D");
    expect(acclimatisationState(7, 80)).toBe("X");
    expect(acclimatisationState(7, 100)).toBe("D");
    expect(acclimatisationState(10, 100)).toBe("X");
    expect(acclimatisationState(10, 125)).toBe("D");
  });
  // Riyadh (+3) to New York (-4 in October) = 7 h difference.
  const outbound = fdp(
    "2026-10-01T06:00:00Z",
    "2026-10-01T18:00:00Z",
    RUH,
    JFK
  );
  it("stays acclimatised to home base (reference time) within 48 h", () => {
    const next = fdp("2026-10-02T15:00:00Z", "2026-10-02T17:00:00Z", JFK, JFK);
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [outbound],
      proposed: next,
      now,
    });
    expect(v.acclimatisation).toMatchObject({
      state: "B",
      referenceTimeZone: "Asia/Riyadh",
      tableUsed: "acclimatised",
    });
    // Report 14:00Z = 17:00 Riyadh reference time -> 17:00-04:59 band, 11:00.
    expect(check(v, "FDP_MAX").limit).toBe(660);
  });
  it("becomes unknown between 72 h and 96 h with a 7 h difference and uses Table 2", () => {
    const next = fdp("2026-10-04T15:00:00Z", "2026-10-04T17:00:00Z", JFK, JFK);
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [outbound],
      proposed: next,
      now,
    });
    expect(v.acclimatisation.state).toBe("X");
    expect(v.acclimatisation.tableUsed).toBe("unknown_acclimatisation");
    expect(check(v, "FDP_MAX").limit).toBe(660);
    expect(check(v, "FDP_MAX").reference).toContain("unknown_acclimatisation");
  });
  it("re-acclimatises to the local zone after 120 h", () => {
    const next = fdp("2026-10-06T15:00:00Z", "2026-10-06T17:00:00Z", JFK, JFK);
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [outbound],
      proposed: next,
      now,
    });
    expect(v.acclimatisation).toMatchObject({
      state: "D",
      referenceTimeZone: "America/New_York",
    });
    // Report 14:00Z = 10:00 New York -> 06:00-13:29 band, 13:00.
    expect(check(v, "FDP_MAX").limit).toBe(780);
  });
  it("an unknown-state crew cannot use the extension", () => {
    const next = duty("2026-10-04T14:00:00Z", "2026-10-05T02:00:00Z", [
      sector("2026-10-04T15:00:00Z", "2026-10-05T01:30:00Z", JFK, LHR),
    ]); // FDP 11:30 > 11:00
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [outbound],
      proposed: next,
      now,
    });
    expect(check(v, "FDP_MAX").status).toBe("fail");
  });
});

describe("fatigue indicator (advisory) and WOCL", () => {
  it("measures WOCL encroachment in the reference zone", () => {
    // 22:00Z-04:00Z = 01:00-07:00 Riyadh; WOCL 02:00-05:59 -> 240 min
    expect(
      dailyWindowOverlapMinutes(
        at("2026-10-10T22:00:00Z"),
        at("2026-10-11T04:00:00Z"),
        "Asia/Riyadh",
        120,
        360
      )
    ).toBe(240);
  });
  it("surfaces WOCL and consecutive early starts without affecting legality", () => {
    const early = (day: string) => fdp(`${day}T03:00:00Z`, `${day}T05:00:00Z`); // report 02:00Z = 05:00 Riyadh
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [early("2026-10-09"), early("2026-10-10")],
      proposed: early("2026-10-11"),
      now,
    });
    expect(v.verdict).toBe("legal");
    expect(v.fatigue.consecutiveEarlyStarts).toBe(3);
    expect(v.fatigue.woclEncroachmentMinutes).toBe(60);
    expect(v.fatigue.factors.map(f => f.code)).toEqual(
      expect.arrayContaining(["WOCL_ENCROACHMENT", "CONSECUTIVE_EARLY_STARTS"])
    );
    expect(v.fatigue.disclaimer).toMatch(/not a certified/i);
  });
});

describe("rule sets without values", () => {
  it("the GACAR skeleton is not ready and yields an illegal, not-evaluable verdict", () => {
    const gacar = gacarPart117RuleSet();
    expect(ruleSetReadinessIssues(gacar)).toEqual(
      expect.arrayContaining([
        "Rule values must be loaded from the official text first",
        "Missing acclimatised FDP table",
      ])
    );
    expect(gacar.fdpLimits).toEqual([]);
    expect(gacar.limits.every(l => l.value === null)).toBe(true);
    const v = evaluateLegality({
      ruleSet: gacar,
      crew,
      history: [],
      proposed: fdp("2026-10-11T05:00:00Z", "2026-10-11T07:00:00Z"),
      now,
    });
    expect(v.verdict).toBe("illegal");
    expect(check(v, "FDP_MAX").status).toBe("not_evaluable");
    expect(check(v, "RULE_SET_VALUES").status).toBe("not_evaluable");
  });
  it("roster publication lead is advisory, never blocking", () => {
    const v = evaluateLegality({
      ruleSet: easa,
      crew,
      history: [],
      proposed: fdp("2026-10-02T05:00:00Z", "2026-10-02T07:00:00Z"),
      now,
    });
    expect(check(v, "ROSTER_PUBLICATION_LEAD").status).toBe("advisory");
    expect(v.verdict).toBe("legal");
  });
});
