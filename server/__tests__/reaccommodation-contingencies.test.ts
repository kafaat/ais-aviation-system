import { describe, it, expect } from "vitest";
import { planReaccommodationContingencies } from "../../shared/reaccommodation-contingencies";
import {
  planReaccommodation,
  type ReaccommodationRequest,
} from "../../shared/reaccommodation";

const input: ReaccommodationRequest = {
  disruptedFlightId: 1,
  originalArrival: "2026-09-16T10:00:00Z",
  passengers: [
    { passengerId: 7, bookingId: 3, cabin: "economy", priorityScore: 50 },
  ],
  options: [2, 3, 4].map((flightId, index) => ({
    flightId,
    flightNumber: `T${flightId}`,
    arrivalTime: `2026-09-16T${11 + index}:00:00Z`,
    seats: { economy: 1, business: 0 },
  })),
};
describe("bounded flight-unavailability contingencies", () => {
  it("returns three distinct feasible plans and the exact optimum for each displayed exclusion", () => {
    const result = planReaccommodationContingencies(input);
    expect(result.plan).toEqual(planReaccommodation(input));
    expect(result.contingencies).toHaveLength(2);
    expect(
      [result.plan, ...result.contingencies.map(c => c.plan)].map(
        p => p.assignments[0].flightId
      )
    ).toEqual([2, 3, 4]);
    for (const fallback of result.contingencies) {
      expect(fallback.plan).toEqual(
        planReaccommodation({
          ...input,
          options: input.options.filter(
            f => !fallback.excludedFlightIds.includes(f.flightId)
          ),
        })
      );
      expect(
        fallback.plan.assignments.every(
          a =>
            a.flightId === null ||
            !fallback.excludedFlightIds.includes(a.flightId)
        )
      ).toBe(true);
    }
  });
  it("does not fabricate alternatives when no seats exist", () => {
    const result = planReaccommodationContingencies({ ...input, options: [] });
    expect(result.contingencies).toEqual([]);
    expect(result.plan.unassigned).toEqual([7]);
  });
  it("reports the bounded search rather than claiming all plans were enumerated", () => {
    const result = planReaccommodationContingencies({
      ...input,
      options: Array.from({ length: 20 }, (_, n) => ({
        ...input.options[0],
        flightId: n + 2,
        flightNumber: `F${n}`,
      })),
    });
    expect(result.contingencySearchTruncated).toBe(true);
  });
});
