import {
  planReaccommodation,
  reaccommodationRequest,
  type ReaccommodationRequest,
  type ReaccommodationPlan,
} from "./reaccommodation";

export interface ContingencyPlan {
  excludedFlightIds: number[];
  plan: ReaccommodationPlan;
}
const MAX_SOLVES = 8;
const compare = (a: ContingencyPlan, b: ContingencyPlan) =>
  a.plan.unassigned.length - b.plan.unassigned.length ||
  a.plan.objectiveValue - b.plan.objectiveValue ||
  a.excludedFlightIds.join(",").localeCompare(b.excludedFlightIds.join(","));
const signature = (plan: ReaccommodationPlan) =>
  JSON.stringify(
    plan.assignments.map(a => [a.passengerId, a.flightId, a.cabin])
  );

/** Up to two distinct fallback allocations if one or more selected flights
 * becomes unavailable. Each solve uses the same objective and the declared
 * exclusion set. The bounded exclusion search is not a k-best proof. */
export function planReaccommodationContingencies(raw: ReaccommodationRequest) {
  const input = reaccommodationRequest.parse(raw);
  const primary = planReaccommodation(input);
  const pending: ContingencyPlan[] = [{ excludedFlightIds: [], plan: primary }];
  const seenSets = new Set([""]),
    seenPlans = new Set([signature(primary)]);
  const candidates: ContingencyPlan[] = [];
  let solves = 0,
    truncated = false;
  while (pending.length && solves < MAX_SOLVES) {
    pending.sort(compare);
    const current = pending.shift();
    if (!current) break;
    const flights = [
      ...new Set(
        current.plan.assignments.flatMap(a =>
          a.flightId === null ? [] : [a.flightId]
        )
      ),
    ].sort((a, b) => a - b);
    for (const flight of flights) {
      const excludedFlightIds = [...current.excludedFlightIds, flight].sort(
        (a, b) => a - b
      );
      const key = excludedFlightIds.join(",");
      if (seenSets.has(key)) continue;
      if (solves === MAX_SOLVES) {
        truncated = true;
        break;
      }
      seenSets.add(key);
      solves++;
      const plan = planReaccommodation({
        ...input,
        options: input.options.filter(
          option => !excludedFlightIds.includes(option.flightId)
        ),
      });
      const candidate = { excludedFlightIds, plan };
      pending.push(candidate);
      const identity = signature(plan);
      if (!seenPlans.has(identity)) {
        seenPlans.add(identity);
        candidates.push(candidate);
      }
    }
  }
  return {
    plan: primary,
    contingencies: candidates.sort(compare).slice(0, 2),
    contingencySearchTruncated: truncated || pending.length > 0,
  };
}
