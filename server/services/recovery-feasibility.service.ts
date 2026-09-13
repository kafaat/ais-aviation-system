import { and, eq, ne } from "drizzle-orm";
import {
  flights,
  aircraftRotations,
  crewAssignments,
  crewMembers,
  aviationEvidence,
  type Flight,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { readMaintenance, validateRotation } from "./aircraft-rotation.service";
import { getCrewRules, evaluateCrewDuty } from "./crew-rule.service";
import { calculateRequestHash } from "./idempotency-v2.service";
import { requireCurrentAviationSource } from "./aviation-evidence.service";

/** Caller holds the operator and candidate flight locks. This is planning, not dispatch. */
export async function readRecoveryFeasibility(
  tx: SettlementTx,
  flight: Flight
) {
  const [rotation] = await tx
    .select()
    .from(aircraftRotations)
    .where(eq(aircraftRotations.flightId, flight.id));
  if (
    !rotation ||
    rotation.airlineId !== flight.airlineId ||
    rotation.tenantId !== flight.tenantId
  )
    throw new Error("Candidate has no scoped aircraft assignment");
  const scheduleDigest = calculateRequestHash({
    flightId: flight.id,
    tailNumber: rotation.tailNumber,
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    originId: flight.originId,
    destinationId: flight.destinationId,
  });
  if (rotation.scheduleDigest !== scheduleDigest)
    throw new Error("Aircraft assignment schedule changed");
  const maintenance = await readMaintenance(
    tx,
    flight.airlineId,
    rotation.tailNumber,
    flight.tenantId
  );
  if (
    maintenance.evidenceId !== rotation.maintenanceEvidenceId ||
    maintenance.payload.status !== "released" ||
    maintenance.payload.aircraftType !== flight.aircraftType ||
    Date.parse(maintenance.payload.validUntil) < flight.arrivalTime.getTime()
  )
    throw new Error(
      "Current maintenance release does not cover candidate arrival"
    );
  const tailRows = await tx
    .select({ flight: flights, rotation: aircraftRotations })
    .from(aircraftRotations)
    .innerJoin(flights, eq(flights.id, aircraftRotations.flightId))
    .where(
      and(
        eq(aircraftRotations.airlineId, flight.airlineId),
        eq(aircraftRotations.tailNumber, rotation.tailNumber),
        ne(flights.status, "cancelled")
      )
    );
  const tailLegs = tailRows
    .filter(r => r.flight.arrivalTime.getTime() > Date.now() - 86400000)
    .map(({ flight: f, rotation: r }) => {
      if (
        f.tenantId !== flight.tenantId ||
        f.aircraftType !== flight.aircraftType ||
        r.scheduleDigest !==
          calculateRequestHash({
            flightId: f.id,
            tailNumber: r.tailNumber,
            departureTime: f.departureTime,
            arrivalTime: f.arrivalTime,
            originId: f.originId,
            destinationId: f.destinationId,
          })
      )
        throw new Error("Tail rotation requires revalidation");
      return {
        id: f.id,
        originId: f.originId,
        destinationId: f.destinationId,
        departureTime: f.departureTime,
        arrivalTime: f.arrivalTime,
      };
    });
  validateRotation(tailLegs, maintenance.payload.minimumTurnaroundMinutes);
  const source = requireCurrentAviationSource(
    maintenance.sourceId,
    "maintenance",
    flight.tenantId,
    flight.airlineId
  );
  const profile = await getCrewRules(
    tx,
    flight.airlineId,
    flight.tenantId,
    flight.departureTime,
    flight.aircraftType
  );
  if (Date.parse(profile.rule.effectiveTo) <= flight.arrivalTime.getTime())
    throw new Error("Crew rules expire during the flight");
  const [ruleEvidence] = await tx
    .select()
    .from(aviationEvidence)
    .where(eq(aviationEvidence.id, profile.evidenceId));
  if (!ruleEvidence) throw new Error("Crew rule receipt unavailable");
  const crewSource = requireCurrentAviationSource(
    ruleEvidence.sourceId,
    "crew_rules",
    flight.tenantId,
    flight.airlineId
  );
  const assigned = await tx
    .select({ assignment: crewAssignments, member: crewMembers })
    .from(crewAssignments)
    .innerJoin(crewMembers, eq(crewMembers.id, crewAssignments.crewMemberId))
    .where(
      and(
        eq(crewAssignments.flightId, flight.id),
        ne(crewAssignments.status, "removed")
      )
    );
  if (new Set(assigned.map(a => a.member.id)).size !== assigned.length)
    throw new Error("Duplicate crew assignments");
  for (const [role, required] of Object.entries(profile.rule.minimumCrew))
    if (assigned.filter(a => a.assignment.role === role).length < required)
      throw new Error(`Missing required ${role} crew`);
  const crew = [];
  for (const { assignment: a, member } of assigned) {
    if (
      member.airlineId !== flight.airlineId ||
      member.role !== a.role ||
      a.ruleEvidenceId !== profile.evidenceId ||
      !a.dutyStartTime ||
      !a.dutyEndTime
    )
      throw new Error("Crew assignment no longer matches operator policy");
    const check = await evaluateCrewDuty(tx, member.id, {
      flightId: flight.id,
      tenantId: flight.tenantId,
      aircraftType: flight.aircraftType,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      dutyStartTime: a.dutyStartTime,
      dutyEndTime: a.dutyEndTime,
    });
    if (!check.compliant)
      throw new Error(
        `Candidate crew not feasible: ${check.violations.join("; ")}`
      );
    crew.push({ assignment: a, member, duty: check.duty });
  }
  return {
    rotation,
    tailLegs,
    maintenance,
    source,
    crewSource,
    crewRuleEvidenceId: profile.evidenceId,
    crew,
  };
}
