import { describe, it, expect } from "vitest";
import {
  solveRecovery,
  validateRecoverySolution,
} from "../services/recovery-solver";
import { crewRuleSchema, validateDuty } from "../services/crew-duty-policy";
describe("bounded recovery", () => {
  const problem = {
    groups: [
      {
        bookingId: 1,
        passengers: 2,
        candidates: [
          { key: "a", delayMinutes: 0 },
          { key: "b", delayMinutes: 20 },
        ],
      },
      {
        bookingId: 2,
        passengers: 2,
        candidates: [{ key: "a", delayMinutes: 0 }],
      },
    ],
    capacities: { a: 2, b: 2 },
  };
  it("protects constrained connections before minimizing delay", () => {
    const r = solveRecovery(problem);
    expect(r.optimal).toBe(true);
    expect(r.unassignedPassengers).toBe(0);
    expect(r.choices.find(c => c.bookingId === 1)?.key).toBe("b");
  });
  it("reports unresolved passengers when capacity is insufficient", () => {
    expect(
      solveRecovery({ ...problem, capacities: { a: 2, b: 1 } })
        .unassignedPassengers
    ).toBe(2);
  });
  it("does not claim optimality when the search budget is exhausted", () => {
    const r = solveRecovery(problem, 1);
    expect(r.optimal).toBe(false);
    expect(r.gap).toBeNull();
    expect(() => validateRecoverySolution(problem, r.choices)).not.toThrow();
  });
  it("independently rejects oversold or duplicate assignments", () => {
    expect(() =>
      validateRecoverySolution(problem, [
        { bookingId: 1, key: "a" },
        { bookingId: 2, key: "a" },
      ])
    ).toThrow();
    expect(() =>
      solveRecovery({
        ...problem,
        groups: [problem.groups[0], problem.groups[0]],
      })
    ).toThrow();
  });
});
describe("operator duty profiles", () => {
  const rule = crewRuleSchema.parse({
    airlineId: 1,
    version: "operator-test",
    reference: "https://example.org/operator-policy",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: "2027-01-01T00:00:00Z",
    timeZone: "Asia/Riyadh",
    aircraftTypes: ["A320"],
    reportBeforeMinutes: 60,
    releaseAfterMinutes: 30,
    maxDuty24Minutes: 840,
    maxDuty7DayMinutes: 3600,
    minRestMinutes: 600,
    minimumCrew: { captain: 1, first_officer: 1, purser: 1, cabin_crew: 3 },
    fdpBands: [
      {
        startHour: 0,
        endHour: 24,
        minSegments: 1,
        maxSegments: 4,
        maxMinutes: 780,
      },
    ],
  });
  const d = (start: string, end: string, departure = start, arrival = end) => ({
    start: new Date(start),
    end: new Date(end),
    departure: new Date(departure),
    arrival: new Date(arrival),
  });
  const duty = d(
    "2026-09-15T06:00Z",
    "2026-09-15T12:30Z",
    "2026-09-15T07:00Z",
    "2026-09-15T12:00Z"
  );
  it("includes report and release time", () =>
    expect(validateDuty(duty, [], rule)).toMatchObject({
      compliant: true,
      totalDutyMinutes: 390,
    }));
  it("rejects missing historical bounds and insufficient rest", () => {
    expect(
      validateDuty(duty, [{ ...duty, start: new Date(NaN) }], rule).compliant
    ).toBe(false);
    expect(
      validateDuty(duty, [d("2026-09-14T18:00Z", "2026-09-15T03:00Z")], rule)
        .violations
    ).toContain("Insufficient rest between distinct duties");
  });
  it("counts a multiple-leg duty once and enforces report-time FDP", () => {
    const leg = { ...duty, departure: new Date("2026-09-15T10:00Z") };
    const first = { ...duty, arrival: new Date("2026-09-15T09:00Z") };
    expect(validateDuty(leg, [first], rule).totalDutyMinutes).toBe(390);
    expect(
      validateDuty(duty, [], {
        ...rule,
        fdpBands: [
          {
            startHour: 0,
            endHour: 24,
            minSegments: 1,
            maxSegments: 4,
            maxMinutes: 300,
          },
        ],
      }).compliant
    ).toBe(false);
  });
});
