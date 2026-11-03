import { z } from "zod";
export const crewRuleSchema = z
  .object({
    airlineId: z.number().int().positive(),
    version: z.string().min(1).max(50),
    reference: z.string().url(),
    effectiveFrom: z.iso.datetime(),
    effectiveTo: z.iso.datetime(),
    timeZone: z.string().refine(v => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
    aircraftTypes: z.array(z.string().min(1)).min(1),
    reportBeforeMinutes: z.number().int().min(0).max(240),
    releaseAfterMinutes: z.number().int().min(0).max(240),
    maxDuty24Minutes: z.number().int().positive().max(1440),
    maxDuty7DayMinutes: z.number().int().positive().max(10080),
    // These cumulative flight-time limits are operator data. The service does
    // not ship a regulatory table or infer a value when either is omitted.
    maxFlightTime28DayMinutes: z
      .number()
      .int()
      .positive()
      .max(40320)
      .optional(),
    maxFlightTime365DayMinutes: z
      .number()
      .int()
      .positive()
      .max(525600)
      .optional(),
    minRestMinutes: z.number().int().positive().max(2880),
    minimumCrew: z.object({
      captain: z.number().int().min(0).max(10),
      first_officer: z.number().int().min(0).max(10),
      purser: z.number().int().min(0).max(10),
      cabin_crew: z.number().int().min(0).max(40),
    }),
    fdpBands: z
      .array(
        z
          .object({
            startHour: z.number().int().min(0).max(23),
            endHour: z.number().int().min(1).max(24),
            minSegments: z.number().int().positive().max(12).default(1),
            maxSegments: z.number().int().positive().max(12),
            maxMinutes: z.number().int().positive().max(1440),
          })
          .refine(
            b => b.startHour < b.endHour && b.minSegments <= b.maxSegments
          )
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(p => Date.parse(p.effectiveFrom) < Date.parse(p.effectiveTo));
export type CrewRule = z.infer<typeof crewRuleSchema>;
export interface Duty {
  aircraftType?: string | null;
  start: Date;
  end: Date;
  departure: Date;
  arrival: Date;
}
export function validateDuty(
  proposed: Duty,
  other: Duty[],
  rule: CrewRule,
  futureProfile: (duty: Duty) => CrewRule | undefined = () => rule
) {
  const violations: string[] = [];
  const valid = (d: Duty) =>
    [d.start, d.end, d.departure, d.arrival].every(v =>
      Number.isFinite(v.getTime())
    ) &&
    d.start <= d.departure &&
    d.departure < d.arrival &&
    d.arrival <= d.end;
  if (!valid(proposed) || other.some(d => !valid(d)))
    return {
      compliant: false,
      violations: ["Missing or inconsistent duty records"],
      totalDutyMinutes: null,
    };
  if (
    proposed.start.getTime() >
      proposed.departure.getTime() - rule.reportBeforeMinutes * 60000 ||
    proposed.end.getTime() <
      proposed.arrival.getTime() + rule.releaseAfterMinutes * 60000
  )
    violations.push("Duty bounds omit required reporting or release time");
  if (
    proposed.start.getTime() < Date.parse(rule.effectiveFrom) ||
    proposed.end.getTime() > Date.parse(rule.effectiveTo)
  )
    violations.push("Operator profile does not cover the complete duty");
  const grouped = new Map<string, Duty[]>();
  for (const d of [...other, proposed]) {
    const key = `${d.start.toISOString()}:${d.end.toISOString()}`;
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }
  const duties = [...grouped.values()]
    .map(group => ({ start: group[0].start, end: group[0].end, legs: group }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const futureRules = new Map<Duty, CrewRule | undefined>();
  for (const d of other) {
    if (d.end < proposed.start) continue;
    const profile = futureProfile(d);
    futureRules.set(d, profile);
    if (
      !profile ||
      d.start.getTime() < Date.parse(profile.effectiveFrom) ||
      d.end.getTime() > Date.parse(profile.effectiveTo)
    )
      violations.push(
        "An affected assignment is missing an effective operator profile"
      );
  }
  for (let i = 1; i < duties.length; i++) {
    const before = duties[i - 1],
      after = duties[i];
    if (!before.legs.includes(proposed) && !after.legs.includes(proposed))
      continue;
    const minRest = Math.max(
      rule.minRestMinutes,
      ...after.legs.map(leg => futureRules.get(leg)?.minRestMinutes ?? 0)
    );
    if (after.start.getTime() - before.end.getTime() < minRest * 60000)
      violations.push("Insufficient rest between distinct duties");
  }
  for (const duty of duties) {
    if (!duty.legs.includes(proposed)) continue;
    const legs = [...duty.legs].sort(
      (a, b) => a.departure.getTime() - b.departure.getTime()
    );
    for (let i = 1; i < legs.length; i++)
      if (legs[i].departure < legs[i - 1].arrival)
        violations.push("Overlapping flight assignments");
    const applicable = new Set([
      rule,
      ...legs
        .map(leg => futureRules.get(leg))
        .filter((r): r is CrewRule => r !== undefined),
    ]);
    for (const profile of applicable) {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          hourCycle: "h23",
          timeZone: profile.timeZone,
        }).format(duty.start)
      );
      const bands = profile.fdpBands.filter(
        b =>
          hour >= b.startHour &&
          hour < b.endHour &&
          legs.length >= b.minSegments &&
          legs.length <= b.maxSegments
      );
      if (bands.length !== 1)
        violations.push(
          "The report time and segment count require one explicit FDP rule"
        );
      else if (
        (legs[legs.length - 1].arrival.getTime() - duty.start.getTime()) /
          60000 >
        bands[0].maxMinutes
      )
        violations.push("Flight duty period exceeds the configured band");
    }
  }
  const allLegs = [...other, proposed];
  function inWindow(start: number, end: number, from: Date, to: Date) {
    return (
      Math.max(
        0,
        Math.min(end, to.getTime()) - Math.max(start, from.getTime())
      ) / 60000
    );
  }
  let proposed24 = 0;
  // A rolling total can increase only while a flight/duty is in progress.
  // Check affected interval endpoints under the rule effective for that leg.
  for (const leg of allLegs) {
    const profile = leg === proposed ? rule : futureRules.get(leg);
    if (!profile) continue;
    for (const [days, limit] of [
      [28, profile.maxFlightTime28DayMinutes],
      [365, profile.maxFlightTime365DayMinutes],
    ] as const) {
      if (limit === undefined) continue;
      const end = leg.arrival.getTime(),
        start = end - days * 86400000;
      if (!inWindow(start, end, proposed.departure, proposed.arrival)) continue;
      const total = allLegs.reduce(
        (sum, l) => sum + inWindow(start, end, l.departure, l.arrival),
        0
      );
      if (total > limit)
        violations.push(`Rolling ${days}-day flight-time limit exceeded`);
    }
    for (const days of [1, 7]) {
      const end = leg.end.getTime(),
        start = end - days * 86400000;
      if (!inWindow(start, end, proposed.start, proposed.end)) continue;
      const minutes = duties.reduce(
        (sum, d) => sum + inWindow(start, end, d.start, d.end),
        0
      );
      if (leg === proposed && days === 1) proposed24 = minutes;
      if (
        minutes >
        (days === 1 ? profile.maxDuty24Minutes : profile.maxDuty7DayMinutes)
      )
        violations.push(
          `Rolling ${days === 1 ? 24 : 168}-hour duty limit exceeded`
        );
    }
  }
  return {
    compliant: violations.length === 0,
    violations: [...new Set(violations)],
    totalDutyMinutes: proposed24,
  };
}
