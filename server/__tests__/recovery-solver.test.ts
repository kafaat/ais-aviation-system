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
  it("keeps mixed booking classes inside both the cabin and the RBD limits", () => {
    const problem = {
      groups: ["Q", "Q", "Y", "absent"].map((classKey, i) => ({
        bookingId: i + 1,
        passengers: 1,
        candidates: [{ key: "economy", classKey, delayMinutes: 0 }],
      })),
      capacities: { economy: 2, Q: 1, Y: 4 },
    };
    const result = solveRecovery(problem);
    expect(result.unassignedPassengers).toBe(2);
    expect(result.choices.find(c => c.bookingId === 3)?.key).toBe("economy");
    expect(() =>
      validateRecoverySolution(problem, result.choices)
    ).not.toThrow();
    expect(() =>
      validateRecoverySolution(
        problem,
        problem.groups.map(g => ({
          bookingId: g.bookingId,
          key: g.bookingId <= 2 ? "economy" : null,
        }))
      )
    ).toThrow("Infeasible");
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
  it("rejects shortened reporting/release and profiles outside the complete duty", () => {
    for (const bounds of [{ start: duty.departure }, { end: duty.arrival }])
      expect(
        validateDuty({ ...duty, ...bounds }, [], rule).violations
      ).toContain("Duty bounds omit required reporting or release time");
    for (const window of [
      { effectiveFrom: duty.departure.toISOString() },
      { effectiveTo: duty.arrival.toISOString() },
    ])
      expect(
        validateDuty(duty, [], { ...rule, ...window }).violations
      ).toContain("Operator profile does not cover the complete duty");
  });
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
  it("enforces the next assignment's own rest and cumulative rules when adding earlier duties", () => {
    const future = {
      ...d(
        "2026-09-16T06:00Z",
        "2026-09-16T12:30Z",
        "2026-09-16T07:00Z",
        "2026-09-16T12:00Z"
      ),
      aircraftType: "B737",
    };
    const futureRule = {
      ...rule,
      minRestMinutes: 1200,
      maxFlightTime28DayMinutes: 550,
    };
    const nextOnly = validateDuty(future, [], futureRule);
    expect(nextOnly.compliant).toBe(true);
    expect(
      validateDuty(duty, [future], rule, () => futureRule).violations
    ).toEqual(
      expect.arrayContaining([
        "Insufficient rest between distinct duties",
        "Rolling 28-day flight-time limit exceeded",
      ])
    );
    expect(validateDuty(duty, [future], rule, () => undefined).compliant).toBe(
      false
    );
    expect(validateDuty(duty, [future], rule, () => rule).compliant).toBe(true);
  });
  it("excludes flight time already outside the future rolling window", () => {
    const future = d(
      "2026-10-13T10:00Z",
      "2026-10-13T11:30Z",
      "2026-10-13T11:00Z",
      "2026-10-13T11:20Z"
    );
    // At 11:20 only the last 40 minutes from the earlier flight remain.
    expect(
      validateDuty(duty, [future], rule, () => ({
        ...rule,
        maxFlightTime28DayMinutes: 60,
      })).compliant
    ).toBe(true);
    expect(
      validateDuty(duty, [future], rule, () => ({
        ...rule,
        maxFlightTime28DayMinutes: 59,
      })).violations
    ).toContain("Rolling 28-day flight-time limit exceeded");
  });
  it("enforces operator-supplied 28 and 365 day flight-time limits", () => {
    const proposed = d(
      "2026-09-15T06:00Z",
      "2026-09-15T08:10Z",
      "2026-09-15T07:00Z",
      "2026-09-15T07:40Z"
    );
    const history = [
      d(
        "2026-09-08T06:00Z",
        "2026-09-08T08:10Z",
        "2026-09-08T07:00Z",
        "2026-09-08T07:40Z"
      ),
      d(
        "2026-09-01T06:00Z",
        "2026-09-01T08:10Z",
        "2026-09-01T07:00Z",
        "2026-09-01T07:40Z"
      ),
    ];
    const assessed = validateDuty(proposed, history, {
      ...rule,
      maxFlightTime28DayMinutes: 100,
      maxFlightTime365DayMinutes: 100,
    });
    expect(assessed.violations).toEqual(
      expect.arrayContaining([
        "Rolling 28-day flight-time limit exceeded",
        "Rolling 365-day flight-time limit exceeded",
      ])
    );
  });
});
