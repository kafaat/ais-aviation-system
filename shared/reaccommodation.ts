/** Advisory reaccommodation assignment (R2-11).
 *
 * The system already *ranks* disrupted passengers by priority. Ranking is not
 * assignment: with several alternative flights of differing capacity and
 * arrival time, walking the ranked list and taking the best remaining seat is
 * provably worse than an optimal assignment, and the tests here demonstrate a
 * case where it is.
 *
 * This module computes an exact optimum for a declared objective. Three things
 * it deliberately does not do:
 *
 *  - **It never writes.** The output is an advisory. Rebooking, inventory and
 *    the IROPS authority are untouched; a human or an existing authority acts
 *    on it or ignores it.
 *  - **It never upgrades a passenger.** Moving someone into a higher cabin is
 *    a commercial decision with revenue consequences, and an optimiser has no
 *    authority to make it. A downgrade is offered, at a declared penalty.
 *  - **It never silently drops anyone.** When there are fewer seats than
 *    passengers, the unassigned are named, with the objective's own penalty
 *    for leaving them out, rather than disappearing from the result.
 *
 * The objective is stated in `OBJECTIVE` below rather than buried in the
 * arithmetic, so an operator can disagree with the weights instead of having
 * to reverse-engineer them.
 */
import { z } from "zod";

export const cabin = z.enum(["economy", "business"]);
export type Cabin = z.infer<typeof cabin>;

/** Cabins a passenger in a given cabin may be offered, best first. Business
 * may be downgraded to economy; economy is never upgraded. */
const ACCEPTABLE: Record<Cabin, readonly Cabin[]> = {
  business: ["business", "economy"],
  economy: ["economy"],
};

/** The declared objective. Every number a reader might want to argue with is
 * here, and nothing else weights the result. */
export const OBJECTIVE = {
  /** Cost is weighted delay. A passenger's weight rises with priority, so an
   * hour of delay costs more for a higher-priority passenger — which is what
   * makes the optimum prefer to delay lower-priority passengers. */
  weightAtZeroPriority: 1,
  weightPerPriorityPoint: 0.01,
  /** Equivalent delay charged for a cabin downgrade. */
  downgradeMinutes: 180,
  /** Equivalent delay charged for not reaccommodating someone at all. Larger
   * than any realistic option delay, so the optimum fills every seat it can
   * before leaving anyone out. */
  unassignedMinutes: 1440,
} as const;

export function passengerWeight(priorityScore: number): number {
  const bounded = Math.min(Math.max(priorityScore, 0), 100);
  return (
    OBJECTIVE.weightAtZeroPriority + OBJECTIVE.weightPerPriorityPoint * bounded
  );
}

export const reaccommodationPassenger = z.object({
  passengerId: z.number().int().positive(),
  bookingId: z.number().int().positive(),
  priorityScore: z.number().finite().min(0).max(100),
  cabin,
});
export type ReaccommodationPassenger = z.infer<typeof reaccommodationPassenger>;

export const reaccommodationOption = z.object({
  flightId: z.number().int().positive(),
  flightNumber: z.string().min(1).max(10),
  arrivalTime: z.string().datetime(),
  seats: z.object({
    economy: z.number().int().nonnegative().max(1000),
    business: z.number().int().nonnegative().max(1000),
  }),
});
export type ReaccommodationOption = z.infer<typeof reaccommodationOption>;

/** Bounded so one advisory cannot turn into an unbounded computation. The
 * assignment is cubic in the padded size, so the cap is what keeps a request
 * predictable rather than a matter of luck. */
export const MAX_PASSENGERS = 150;
export const MAX_SLOTS = 300;

export const reaccommodationRequest = z.object({
  disruptedFlightId: z.number().int().positive(),
  /** The arrival the passengers were promised. Delay is measured from here. */
  originalArrival: z.string().datetime(),
  passengers: z.array(reaccommodationPassenger).max(MAX_PASSENGERS),
  options: z.array(reaccommodationOption).max(50),
});
export type ReaccommodationRequest = z.infer<typeof reaccommodationRequest>;

export interface Assignment {
  passengerId: number;
  bookingId: number;
  flightId: number | null;
  flightNumber: string | null;
  cabin: Cabin | null;
  delayMinutes: number | null;
  downgraded: boolean;
  /** Why this passenger got this seat, in the objective's own terms. */
  cost: number;
  reason: string;
}

export interface ReaccommodationPlan {
  disruptedFlightId: number;
  /** Total objective value. Lower is better; comparable only within one
   * request, since it depends on that request's passengers. */
  objectiveValue: number;
  assignments: Assignment[];
  unassigned: number[];
  /** Stated so a reader knows this is a recommendation, not a booking. */
  advisory: true;
  objective: typeof OBJECTIVE;
}

interface Slot {
  flightId: number;
  flightNumber: string;
  cabin: Cabin;
  delayMinutes: number;
}

function delayMinutes(originalArrival: Date, arrival: Date): number {
  // Never negative: an earlier alternative is a bonus nobody asked to price,
  // and treating it as negative cost would let the optimum chase early
  // arrivals at the expense of everything else.
  return Math.max(
    0,
    Math.round((arrival.getTime() - originalArrival.getTime()) / 60_000)
  );
}

function buildSlots(request: ReaccommodationRequest): Slot[] {
  const originalArrival = new Date(request.originalArrival);
  const slots: Slot[] = [];
  for (const option of request.options) {
    const delay = delayMinutes(originalArrival, new Date(option.arrivalTime));
    for (const seatCabin of ["business", "economy"] as const)
      for (let seat = 0; seat < option.seats[seatCabin]; seat++)
        slots.push({
          flightId: option.flightId,
          flightNumber: option.flightNumber,
          cabin: seatCabin,
          delayMinutes: delay,
        });
  }
  return slots;
}

const UNAVAILABLE = Number.POSITIVE_INFINITY;

function seatCost(
  passenger: ReaccommodationPassenger,
  slot: Slot
): number | null {
  if (!ACCEPTABLE[passenger.cabin].includes(slot.cabin)) return null;
  const downgraded = slot.cabin !== passenger.cabin;
  return (
    passengerWeight(passenger.priorityScore) *
    (slot.delayMinutes + (downgraded ? OBJECTIVE.downgradeMinutes : 0))
  );
}

function unassignedCost(passenger: ReaccommodationPassenger): number {
  return passengerWeight(passenger.priorityScore) * OBJECTIVE.unassignedMinutes;
}

/** Exact minimum-cost assignment (Jonker–Volgenant shortest augmenting path
 * with potentials), O(n^2 m). Rows are passengers, columns are seats.
 *
 * An exact method rather than a heuristic because the result is shown to an
 * operator as *the* recommendation: a heuristic that is usually good would
 * make "why was this passenger left behind" unanswerable. Optimality is
 * checked against exhaustive search in the tests.
 */
export function minimumCostAssignment(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  if (m < n) throw new Error("Assignment requires at least one column per row");

  const INF = Number.POSITIVE_INFINITY;
  const rowPotential = new Array<number>(n + 1).fill(0);
  const colPotential = new Array<number>(m + 1).fill(0);
  // matched[j] is the 1-based row matched to column j, 0 for none.
  const matched = new Array<number>(m + 1).fill(0);
  const previous = new Array<number>(m + 1).fill(0);

  for (let row = 1; row <= n; row++) {
    matched[0] = row;
    let current = 0;
    const minCost = new Array<number>(m + 1).fill(INF);
    const visited = new Array<boolean>(m + 1).fill(false);
    do {
      visited[current] = true;
      const currentRow = matched[current];
      let delta = INF;
      let next = 0;
      for (let col = 1; col <= m; col++) {
        if (visited[col]) continue;
        const reduced =
          cost[currentRow - 1][col - 1] -
          rowPotential[currentRow] -
          colPotential[col];
        if (reduced < minCost[col]) {
          minCost[col] = reduced;
          previous[col] = current;
        }
        if (minCost[col] < delta) {
          delta = minCost[col];
          next = col;
        }
      }
      if (!Number.isFinite(delta))
        // Every remaining column is forbidden for this row. The caller pads
        // with an always-available "unassigned" column precisely so this
        // cannot happen; reaching it is a programming error, not an input one.
        throw new Error("Assignment has no feasible completion");
      for (let col = 0; col <= m; col++) {
        if (visited[col]) {
          rowPotential[matched[col]] += delta;
          colPotential[col] -= delta;
        } else minCost[col] -= delta;
      }
      current = next;
    } while (matched[current] !== 0);
    do {
      const step = previous[current];
      matched[current] = matched[step];
      current = step;
    } while (current);
  }

  const assignment = new Array<number>(n).fill(-1);
  for (let col = 1; col <= m; col++)
    if (matched[col] > 0) assignment[matched[col] - 1] = col - 1;
  return assignment;
}

export function planReaccommodation(
  input: ReaccommodationRequest
): ReaccommodationPlan {
  const request = reaccommodationRequest.parse(input);
  const slots = buildSlots(request);
  if (slots.length > MAX_SLOTS)
    throw new Error(
      `Reaccommodation advisory is bounded to ${MAX_SLOTS} seats; narrow the options`
    );

  const passengers = request.passengers;
  if (!passengers.length)
    return {
      disruptedFlightId: request.disruptedFlightId,
      objectiveValue: 0,
      assignments: [],
      unassigned: [],
      advisory: true,
      objective: OBJECTIVE,
    };

  // One "unassigned" column per passenger, so the matrix is always solvable
  // and leaving someone out is a priced choice rather than a failure mode.
  const columns = slots.length + passengers.length;
  const cost = passengers.map(passenger => {
    const row = new Array<number>(columns).fill(UNAVAILABLE);
    slots.forEach((slot, index) => {
      const value = seatCost(passenger, slot);
      if (value !== null) row[index] = value;
    });
    row.fill(unassignedCost(passenger), slots.length);
    return row;
  });

  const chosen = minimumCostAssignment(cost);
  const assignments: Assignment[] = [];
  const unassigned: number[] = [];
  let objectiveValue = 0;

  passengers.forEach((passenger, index) => {
    const column = chosen[index];
    const value = cost[index][column];
    objectiveValue += value;
    if (column >= slots.length) {
      unassigned.push(passenger.passengerId);
      assignments.push({
        passengerId: passenger.passengerId,
        bookingId: passenger.bookingId,
        flightId: null,
        flightNumber: null,
        cabin: null,
        delayMinutes: null,
        downgraded: false,
        cost: value,
        reason: "No acceptable seat remained in the offered options",
      });
      return;
    }
    const slot = slots[column];
    const downgraded = slot.cabin !== passenger.cabin;
    assignments.push({
      passengerId: passenger.passengerId,
      bookingId: passenger.bookingId,
      flightId: slot.flightId,
      flightNumber: slot.flightNumber,
      cabin: slot.cabin,
      delayMinutes: slot.delayMinutes,
      downgraded,
      cost: value,
      reason: downgraded
        ? `${slot.flightNumber}, ${slot.delayMinutes} min later, downgraded to ${slot.cabin}`
        : `${slot.flightNumber}, ${slot.delayMinutes} min later`,
    });
  });

  return {
    disruptedFlightId: request.disruptedFlightId,
    // Rounded only for presentation; comparisons inside the solver used the
    // exact values.
    objectiveValue: Math.round(objectiveValue * 1000) / 1000,
    assignments,
    unassigned,
    advisory: true,
    objective: OBJECTIVE,
  };
}

/** The behaviour this package replaces: walk the ranked list, take the best
 * seat still free. Kept so the advisory can be compared against what an
 * operator would otherwise do, and so the tests can show the difference on a
 * concrete case rather than asserting it.
 */
export function greedyByPriority(input: ReaccommodationRequest): {
  objectiveValue: number;
} {
  const request = reaccommodationRequest.parse(input);
  const slots = buildSlots(request);
  const taken = new Array<boolean>(slots.length).fill(false);
  let objectiveValue = 0;
  const ordered = [...request.passengers].sort(
    (left, right) =>
      right.priorityScore - left.priorityScore ||
      left.passengerId - right.passengerId
  );
  for (const passenger of ordered) {
    let best = -1;
    let bestCost = UNAVAILABLE;
    slots.forEach((slot, index) => {
      if (taken[index]) return;
      const value = seatCost(passenger, slot);
      if (value !== null && value < bestCost) {
        bestCost = value;
        best = index;
      }
    });
    if (best < 0) {
      objectiveValue += unassignedCost(passenger);
      continue;
    }
    taken[best] = true;
    objectiveValue += bestCost;
  }
  return { objectiveValue: Math.round(objectiveValue * 1000) / 1000 };
}
