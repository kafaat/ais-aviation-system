import { describe, expect, it } from "vitest";
import {
  OBJECTIVE,
  greedyByPriority,
  minimumCostAssignment,
  passengerWeight,
  planReaccommodation,
  type ReaccommodationRequest,
} from "../../shared/reaccommodation";

const BASE = "2026-09-14T12:00:00.000Z";
const at = (minutesLater: number) =>
  new Date(Date.parse(BASE) + minutesLater * 60_000).toISOString();

/** Exhaustive minimum over all assignments. Exponential, so only usable on
 * tiny matrices — which is exactly what makes it a trustworthy oracle: it has
 * no cleverness to be wrong about. */
function bruteForceCost(cost: number[][]): number {
  const rows = cost.length;
  const columns = cost[0].length;
  let best = Number.POSITIVE_INFINITY;
  const used = new Array<boolean>(columns).fill(false);
  const walk = (row: number, total: number) => {
    if (total >= best) return;
    if (row === rows) {
      best = total;
      return;
    }
    for (let column = 0; column < columns; column++) {
      if (used[column] || !Number.isFinite(cost[row][column])) continue;
      used[column] = true;
      walk(row + 1, total + cost[row][column]);
      used[column] = false;
    }
  };
  walk(0, 0);
  return best;
}

function totalOf(cost: number[][], assignment: number[]): number {
  return assignment.reduce((sum, column, row) => sum + cost[row][column], 0);
}

describe("minimum-cost assignment", () => {
  it("matches exhaustive search on random dense matrices", () => {
    // The property the whole package rests on. A heuristic that is usually
    // right would make "why was this passenger left behind" unanswerable.
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 60; trial++) {
      const rows = 1 + Math.floor(random() * 5);
      const columns = rows + Math.floor(random() * 3);
      const cost = Array.from({ length: rows }, () =>
        Array.from({ length: columns }, () => Math.floor(random() * 100))
      );
      const assignment = minimumCostAssignment(cost);
      expect(new Set(assignment).size).toBe(rows);
      expect(totalOf(cost, assignment)).toBeCloseTo(bruteForceCost(cost), 6);
    }
  });

  it("matches exhaustive search when some pairings are forbidden", () => {
    let seed = 99;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 60; trial++) {
      const rows = 1 + Math.floor(random() * 4);
      const columns = rows + 2;
      const cost = Array.from({ length: rows }, () =>
        Array.from({ length: columns }, (_unused, column) =>
          // Keep the last two columns always available, mirroring the
          // "unassigned" padding the planner adds.
          column < columns - 2 && random() < 0.4
            ? Number.POSITIVE_INFINITY
            : Math.floor(random() * 100)
        )
      );
      const assignment = minimumCostAssignment(cost);
      expect(totalOf(cost, assignment)).toBeCloseTo(bruteForceCost(cost), 6);
    }
  });

  it("handles the degenerate sizes", () => {
    expect(minimumCostAssignment([])).toEqual([]);
    expect(minimumCostAssignment([[5]])).toEqual([0]);
    expect(() =>
      minimumCostAssignment([
        [1, 2],
        [3, 4],
        [5, 6],
      ])
    ).toThrow(/at least one column per row/);
  });
});

describe("objective weights", () => {
  it("rises with priority and is bounded at the ends of the scale", () => {
    expect(passengerWeight(0)).toBe(1);
    expect(passengerWeight(100)).toBe(2);
    expect(passengerWeight(50)).toBeCloseTo(1.5, 10);
    // Out-of-range scores are clamped rather than allowed to invert a weight.
    expect(passengerWeight(-20)).toBe(1);
    expect(passengerWeight(500)).toBe(2);
  });
});

describe("reaccommodation planning", () => {
  const request = (
    overrides: Partial<ReaccommodationRequest> = {}
  ): ReaccommodationRequest => ({
    disruptedFlightId: 1,
    originalArrival: BASE,
    passengers: [
      { passengerId: 1, bookingId: 1, priorityScore: 90, cabin: "economy" },
      { passengerId: 2, bookingId: 2, priorityScore: 10, cabin: "economy" },
    ],
    options: [
      {
        flightId: 10,
        flightNumber: "SV10",
        arrivalTime: at(60),
        seats: { economy: 1, business: 0 },
      },
      {
        flightId: 11,
        flightNumber: "SV11",
        arrivalTime: at(300),
        seats: { economy: 1, business: 0 },
      },
    ],
    ...overrides,
  });

  it("gives the scarce early seat to the higher-priority passenger", () => {
    const plan = planReaccommodation(request());
    const first = plan.assignments.find(a => a.passengerId === 1);
    const second = plan.assignments.find(a => a.passengerId === 2);
    expect(first?.flightNumber).toBe("SV10");
    expect(first?.delayMinutes).toBe(60);
    expect(second?.flightNumber).toBe("SV11");
    expect(plan.unassigned).toEqual([]);
    expect(plan.advisory).toBe(true);
  });

  it("beats greedy-by-rank on a case where ranking is not enough", () => {
    // Found by searching the instance space, not constructed to flatter the
    // optimiser. Greedy walks the ranked list: the top-priority business
    // passenger takes a scarce *early economy* seat at the downgrade penalty,
    // which displaces an economy passenger into a five-hour-later flight. The
    // optimum leaves that passenger in business on the later flight — worse
    // for them alone, better overall — and frees the early seat.
    const scenario: ReaccommodationRequest = {
      disruptedFlightId: 1,
      originalArrival: BASE,
      passengers: [
        { passengerId: 1, bookingId: 1, priorityScore: 99, cabin: "business" },
        { passengerId: 2, bookingId: 2, priorityScore: 59, cabin: "economy" },
        { passengerId: 3, bookingId: 3, priorityScore: 16, cabin: "economy" },
        { passengerId: 4, bookingId: 4, priorityScore: 77, cabin: "economy" },
      ],
      options: [
        {
          flightId: 10,
          flightNumber: "SV10",
          arrivalTime: at(35),
          seats: { economy: 2, business: 0 },
        },
        {
          flightId: 11,
          flightNumber: "SV11",
          arrivalTime: at(303),
          seats: { economy: 2, business: 1 },
        },
      ],
    };
    const plan = planReaccommodation(scenario);
    const greedy = greedyByPriority(scenario);
    expect(plan.objectiveValue).toBeCloseTo(1072.05, 2);
    expect(greedy.objectiveValue).toBeCloseTo(1323.05, 2);
    expect(plan.objectiveValue).toBeLessThan(greedy.objectiveValue);

    // The business passenger keeps their cabin rather than consuming an early
    // economy seat, which is the whole difference.
    const business = plan.assignments.find(a => a.passengerId === 1);
    expect(business).toMatchObject({
      flightNumber: "SV11",
      cabin: "business",
      downgraded: false,
    });
    // Both early seats go to economy passengers, highest priority first.
    expect(
      plan.assignments
        .filter(a => a.flightNumber === "SV10")
        .map(a => a.passengerId)
        .sort()
    ).toEqual([2, 4]);
    expect(plan.unassigned).toEqual([]);
  });

  it("never upgrades a passenger into a higher cabin", () => {
    // Upgrading is a revenue decision; the optimiser has no authority for it,
    // so an economy passenger is left unassigned rather than given business.
    const plan = planReaccommodation(
      request({
        passengers: [
          {
            passengerId: 1,
            bookingId: 1,
            priorityScore: 100,
            cabin: "economy",
          },
        ],
        options: [
          {
            flightId: 10,
            flightNumber: "SV10",
            arrivalTime: at(30),
            seats: { economy: 0, business: 5 },
          },
        ],
      })
    );
    expect(plan.unassigned).toEqual([1]);
    expect(plan.assignments[0].cabin).toBeNull();
  });

  it("offers a downgrade at its declared price rather than refusing", () => {
    const plan = planReaccommodation(
      request({
        passengers: [
          { passengerId: 1, bookingId: 1, priorityScore: 0, cabin: "business" },
        ],
        options: [
          {
            flightId: 10,
            flightNumber: "SV10",
            arrivalTime: at(30),
            seats: { economy: 1, business: 0 },
          },
        ],
      })
    );
    expect(plan.assignments[0]).toMatchObject({
      cabin: "economy",
      downgraded: true,
      delayMinutes: 30,
    });
    expect(plan.assignments[0].cost).toBeCloseTo(
      30 + OBJECTIVE.downgradeMinutes,
      6
    );
    expect(plan.assignments[0].reason).toMatch(/downgraded to economy/);
  });

  it("names everyone it cannot seat instead of dropping them", () => {
    const plan = planReaccommodation(
      request({
        passengers: [
          { passengerId: 1, bookingId: 1, priorityScore: 90, cabin: "economy" },
          { passengerId: 2, bookingId: 2, priorityScore: 80, cabin: "economy" },
          { passengerId: 3, bookingId: 3, priorityScore: 5, cabin: "economy" },
        ],
        options: [
          {
            flightId: 10,
            flightNumber: "SV10",
            arrivalTime: at(45),
            seats: { economy: 1, business: 0 },
          },
        ],
      })
    );
    expect(plan.assignments).toHaveLength(3);
    // The seat goes to the highest priority; the objective's penalty makes
    // leaving the lowest-priority passengers out the cheapest option.
    expect(plan.assignments.find(a => a.passengerId === 1)?.flightNumber).toBe(
      "SV10"
    );
    expect(plan.unassigned.sort()).toEqual([2, 3]);
    for (const id of [2, 3]) {
      const entry = plan.assignments.find(a => a.passengerId === id);
      expect(entry?.reason).toMatch(/No acceptable seat/);
      expect(entry?.cost).toBeGreaterThan(0);
    }
  });

  it("prices an earlier alternative as no delay, never as a bonus", () => {
    // A negative cost would let the optimum chase early arrivals at the
    // expense of everything else in the objective.
    const plan = planReaccommodation(
      request({
        passengers: [
          { passengerId: 1, bookingId: 1, priorityScore: 50, cabin: "economy" },
        ],
        options: [
          {
            flightId: 10,
            flightNumber: "SV10",
            arrivalTime: at(-120),
            seats: { economy: 1, business: 0 },
          },
        ],
      })
    );
    expect(plan.assignments[0].delayMinutes).toBe(0);
    expect(plan.objectiveValue).toBe(0);
  });

  it("returns an empty plan for no passengers", () => {
    const plan = planReaccommodation(request({ passengers: [] }));
    expect(plan.assignments).toEqual([]);
    expect(plan.objectiveValue).toBe(0);
  });

  it("compresses equivalent seats without rejecting ordinary flight capacity", () => {
    const plan = planReaccommodation(
      request({
        options: [
          {
            flightId: 10,
            flightNumber: "SV10",
            arrivalTime: at(30),
            seats: { economy: 1000, business: 1000 },
          },
        ],
      })
    );
    expect(plan.unassigned).toEqual([]);
    expect(plan.assignments).toHaveLength(request().passengers.length);
  });

  it("fills acceptable seats even when delay exceeds the unassigned preference", () => {
    const plan = planReaccommodation(
      request({
        passengers: [
          {
            passengerId: 1,
            bookingId: 1,
            priorityScore: 100,
            cabin: "economy",
          },
        ],
        options: [
          {
            flightId: 10,
            flightNumber: "SV10",
            arrivalTime: at(1800),
            seats: { economy: 1, business: 0 },
          },
        ],
      })
    );
    expect(plan.unassigned).toEqual([]);
    expect(plan.assignments[0].cost).toBe(3600);
  });

  it("rejects duplicate identities before they can double count people or capacity", () => {
    const input = request();
    expect(() =>
      planReaccommodation({
        ...input,
        passengers: [input.passengers[0], input.passengers[0]],
      })
    ).toThrow(/Duplicate passenger/);
    expect(() =>
      planReaccommodation({
        ...input,
        options: [input.options[0], input.options[0]],
      })
    ).toThrow(/Duplicate flight/);
  });

  it("matches exhaustive lexicographic search over full passenger/flight plans", () => {
    // The oracle enumerates real seats, including ones the planner may prune.
    // It compares cardinality first, then the independently computed policy cost.
    let seed = 7847;
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 0x1_0000_0000) * max);
    };
    for (let trial = 0; trial < 80; trial++) {
      const input = request({
        passengers: Array.from({ length: 1 + random(4) }, (_, i) => ({
          passengerId: i + 1,
          bookingId: i + 1,
          priorityScore: random(101),
          cabin: random(2) ? "business" : "economy",
        })),
        options: Array.from({ length: 1 + random(3) }, (_, i) => ({
          flightId: i + 10,
          flightNumber: `SV${i}`,
          arrivalTime: at(random(3001)),
          seats: { economy: random(3), business: random(3) },
        })),
      });
      const seats = input.options.flatMap(option =>
        (["economy", "business"] as const).flatMap(cabin =>
          Array.from({ length: option.seats[cabin] }, () => ({
            cabin,
            delay: (Date.parse(option.arrivalTime) - Date.parse(BASE)) / 60_000,
          }))
        )
      );
      let best = { missing: Infinity, cost: Infinity };
      const used = new Set<number>();
      const walk = (index: number, missing: number, cost: number) => {
        if (index === input.passengers.length) {
          if (
            missing < best.missing ||
            (missing === best.missing && cost < best.cost)
          )
            best = { missing, cost };
          return;
        }
        const pax = input.passengers[index];
        const weight = 1 + pax.priorityScore / 100;
        walk(index + 1, missing + 1, cost + weight * 1440);
        seats.forEach((seat, i) => {
          if (
            used.has(i) ||
            (pax.cabin === "economy" && seat.cabin === "business")
          )
            return;
          used.add(i);
          walk(
            index + 1,
            missing,
            cost + weight * (seat.delay + (pax.cabin !== seat.cabin ? 180 : 0))
          );
          used.delete(i);
        });
      };
      walk(0, 0, 0);
      const plan = planReaccommodation(input);
      expect(plan.unassigned.length, `trial ${trial}`).toBe(best.missing);
      expect(plan.objectiveValue, `trial ${trial}`).toBeCloseTo(best.cost, 3);
    }
  });

  it("reports the objective it used, so the weights can be argued with", () => {
    const plan = planReaccommodation(request());
    expect(plan.objective).toEqual(OBJECTIVE);
  });
});
