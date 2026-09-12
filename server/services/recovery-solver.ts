import { z } from "zod";
export const recoveryProblem = z.object({
  groups: z
    .array(
      z.object({
        bookingId: z.number().int().positive(),
        passengers: z.number().int().positive().max(50),
        candidates: z
          .array(
            z.object({
              key: z.string(),
              delayMinutes: z.number().int().nonnegative(),
            })
          )
          .max(8),
      })
    )
    .min(1)
    .max(20),
  capacities: z.record(z.string(), z.number().int().nonnegative()),
});
export type RecoveryProblem = z.infer<typeof recoveryProblem>;
export type RecoveryChoice = { bookingId: number; key: string | null };
export function validateRecoverySolution(
  problem: RecoveryProblem,
  choices: RecoveryChoice[]
) {
  if (
    new Set(problem.groups.map(g => g.bookingId)).size !==
      problem.groups.length ||
    choices.length !== problem.groups.length ||
    new Set(choices.map(c => c.bookingId)).size !== choices.length
  )
    throw new Error("Invalid recovery groups");
  const remaining = { ...problem.capacities };
  let unassignedPassengers = 0,
    passengerDelayMinutes = 0;
  for (const group of problem.groups) {
    const chosen = choices.find(c => c.bookingId === group.bookingId);
    if (!chosen) throw new Error("Missing recovery group");
    if (chosen.key === null) {
      unassignedPassengers += group.passengers;
      continue;
    }
    const candidate = group.candidates.find(c => c.key === chosen.key);
    if (
      !candidate ||
      !Number.isInteger(remaining[chosen.key]) ||
      remaining[chosen.key] < group.passengers
    )
      throw new Error("Infeasible recovery solution");
    remaining[chosen.key] -= group.passengers;
    passengerDelayMinutes += candidate.delayMinutes * group.passengers;
  }
  return { unassignedPassengers, passengerDelayMinutes };
}
/** Bounded exhaustive search, minimizing unserved passengers first and delay second. */
export function solveRecovery(raw: RecoveryProblem, nodeBudget = 50000) {
  const problem = recoveryProblem.parse(raw);
  if (!Number.isInteger(nodeBudget) || nodeBudget < 1 || nodeBudget > 1000000)
    throw new Error("Invalid search budget");
  let best = problem.groups.map(g => ({
    bookingId: g.bookingId,
    key: null as string | null,
  }));
  let score = validateRecoverySolution(problem, best),
    nodes = 0,
    exhausted = false;
  const remaining = { ...problem.capacities };
  const groups = [...problem.groups].sort(
    (a, b) =>
      a.candidates.length - b.candidates.length ||
      b.passengers - a.passengers ||
      a.bookingId - b.bookingId
  );
  function search(
    i: number,
    choices: RecoveryChoice[],
    missing: number,
    delay: number
  ) {
    if (++nodes > nodeBudget) {
      exhausted = true;
      return;
    }
    if (
      missing > score.unassignedPassengers ||
      (missing === score.unassignedPassengers &&
        delay >= score.passengerDelayMinutes)
    )
      return;
    if (i === groups.length) {
      best = [...choices];
      score = validateRecoverySolution(problem, best);
      return;
    }
    const g = groups[i];
    for (const c of [...g.candidates].sort(
      (a, b) => a.delayMinutes - b.delayMinutes || a.key.localeCompare(b.key)
    )) {
      if (remaining[c.key] < g.passengers || remaining[c.key] === undefined)
        continue;
      remaining[c.key] -= g.passengers;
      search(
        i + 1,
        [...choices, { bookingId: g.bookingId, key: c.key }],
        missing,
        delay + c.delayMinutes * g.passengers
      );
      remaining[c.key] += g.passengers;
      if (exhausted) break;
    }
    if (!exhausted)
      search(
        i + 1,
        [...choices, { bookingId: g.bookingId, key: null }],
        missing + g.passengers,
        delay
      );
  }
  search(0, [], 0, 0);
  return {
    choices: best,
    ...score,
    optimal: !exhausted,
    gap: exhausted ? null : 0,
    nodes: Math.min(nodes, nodeBudget),
    objective: "unassigned_passengers_then_passenger_delay" as const,
  };
}
