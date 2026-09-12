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
  start: Date;
  end: Date;
  departure: Date;
  arrival: Date;
}
export function validateDuty(proposed: Duty, other: Duty[], rule: CrewRule) {
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
  const grouped = new Map<string, Duty[]>();
  for (const d of [...other, proposed]) {
    const key = `${d.start.toISOString()}:${d.end.toISOString()}`;
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }
  const duties = [...grouped.values()]
    .map(group => ({ start: group[0].start, end: group[0].end, legs: group }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < duties.length; i++)
    if (
      duties[i].start.getTime() - duties[i - 1].end.getTime() <
      rule.minRestMinutes * 60000
    )
      violations.push("Insufficient rest between distinct duties");
  for (const duty of duties) {
    const legs = [...duty.legs].sort(
      (a, b) => a.departure.getTime() - b.departure.getTime()
    );
    for (let i = 1; i < legs.length; i++)
      if (legs[i].departure < legs[i - 1].arrival)
        violations.push("Overlapping flight assignments");
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        hourCycle: "h23",
        timeZone: rule.timeZone,
      }).format(duty.start)
    );
    const bands = rule.fdpBands.filter(
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
      (Math.max(...legs.map(l => l.arrival.getTime())) - duty.start.getTime()) /
        60000 >
      bands[0].maxMinutes
    )
      violations.push("Flight duty period exceeds the configured band");
  }
  let proposed24 = 0;
  for (const endpoint of duties.map(d => d.end.getTime()))
    for (const days of [1, 7]) {
      const start = endpoint - days * 86400000;
      const minutes = duties.reduce(
        (sum, d) =>
          sum +
          Math.max(
            0,
            Math.min(endpoint, d.end.getTime()) -
              Math.max(start, d.start.getTime())
          ) /
            60000,
        0
      );
      if (endpoint === proposed.end.getTime() && days === 1)
        proposed24 = minutes;
      if (
        minutes > (days === 1 ? rule.maxDuty24Minutes : rule.maxDuty7DayMinutes)
      )
        violations.push(
          `Rolling ${days === 1 ? 24 : 168}-hour duty limit exceeded`
        );
    }
  return {
    compliant: violations.length === 0,
    violations: [...new Set(violations)],
    totalDutyMinutes: proposed24,
  };
}
