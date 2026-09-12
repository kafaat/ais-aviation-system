import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  aviationEvidence,
  airlines,
  crewAssignments,
  crewMembers,
  flights,
} from "../../drizzle/schema";
import { crewRuleSchema, validateDuty, type Duty } from "./crew-duty-policy";
import {
  verifyAviationSource,
  persistAviationEvidence,
  type EvidenceEnvelope,
} from "./aviation-evidence.service";
import { assertTenantOperational } from "./tenant.service";
import { recordEvent } from "./outbox.service";
import type { SettlementTx } from "./booking-settlement.service";
export async function ingestCrewRules(
  e: EvidenceEnvelope,
  signature: string,
  actorId: number,
  tenantId: number | null
) {
  const rule = crewRuleSchema.parse(e.payload);
  if (e.kind !== "crew_rules" || e.flightId !== null)
    throw new Error("Operator profile cannot be a flight event");
  const source = verifyAviationSource(e, signature, "crew_rules");
  if (
    !source.airlineIds?.includes(rule.airlineId) ||
    (tenantId !== null && tenantId !== source.tenantId)
  )
    throw new Error("Source is outside the operator scope");
  const db = await getDb();
  if (!db) throw new Error("Crew policy storage unavailable");
  return db.transaction(async tx => {
    const [airline] = await tx
      .select()
      .from(airlines)
      .where(eq(airlines.id, rule.airlineId))
      .for("update");
    if (!airline) throw new Error("Operator not found");
    const receipt = await persistAviationEvidence(tx, e, source);
    if (!receipt.duplicate)
      await recordEvent(tx, {
        aggregateType: "crewPolicy",
        aggregateId: receipt.evidenceId,
        tenantId: source.tenantId,
        eventType: "crew.rules_accepted",
        payload: { actorId, version: rule.version, airlineId: rule.airlineId },
      });
    return receipt;
  });
}
export async function getCrewRules(
  tx: SettlementTx,
  airlineId: number,
  tenantId: number | null | undefined,
  date: Date,
  aircraftType?: string | null
) {
  const rows = await tx
    .select()
    .from(aviationEvidence)
    .where(
      and(
        eq(aviationEvidence.kind, "crew_rules"),
        sql`JSON_EXTRACT(${aviationEvidence.payload}, '$.airlineId') = ${airlineId}`,
        tenantId === undefined
          ? undefined
          : sql`${aviationEvidence.tenantId} <=> ${tenantId}`
      )
    )
    .orderBy(desc(aviationEvidence.observedAt), desc(aviationEvidence.id))
    .limit(201);
  if (rows.length > 200) throw new Error("Narrow the operator policy history");
  const sources = new Set<string>();
  const matches: Array<{
    evidenceId: number;
    rule: ReturnType<typeof crewRuleSchema.parse>;
  }> = [];
  for (const row of rows) {
    const rule = crewRuleSchema.parse(row.payload);
    if (
      rule.airlineId !== airlineId ||
      Date.parse(rule.effectiveFrom) > date.getTime() ||
      Date.parse(rule.effectiveTo) <= date.getTime() ||
      (aircraftType && !rule.aircraftTypes.includes(aircraftType)) ||
      sources.has(row.sourceId)
    )
      continue;
    sources.add(row.sourceId);
    matches.push({ evidenceId: row.id, rule });
  }
  if (matches.length !== 1)
    throw new Error(
      "Exactly one effective operator-approved crew profile is required"
    );
  return matches[0];
}
export async function evaluateCrewDuty(
  tx: SettlementTx,
  crewMemberId: number,
  proposed: {
    departureTime: Date;
    arrivalTime: Date;
    dutyStartTime?: Date;
    dutyEndTime?: Date;
    flightId?: number;
    tenantId?: number | null;
    aircraftType?: string | null;
  }
) {
  const [crew] = await tx
    .select()
    .from(crewMembers)
    .where(eq(crewMembers.id, crewMemberId))
    .limit(1);
  if (!crew) throw new Error("Crew member not found");
  const profile = await getCrewRules(
    tx,
    crew.airlineId,
    proposed.tenantId,
    proposed.departureTime,
    proposed.aircraftType
  );
  const duty: Duty = {
    start:
      proposed.dutyStartTime ??
      new Date(
        proposed.departureTime.getTime() -
          profile.rule.reportBeforeMinutes * 60000
      ),
    end:
      proposed.dutyEndTime ??
      new Date(
        proposed.arrivalTime.getTime() +
          profile.rule.releaseAfterMinutes * 60000
      ),
    departure: proposed.departureTime,
    arrival: proposed.arrivalTime,
  };
  const rows = await tx
    .select({
      start: crewAssignments.dutyStartTime,
      end: crewAssignments.dutyEndTime,
      departure: flights.departureTime,
      arrival: flights.arrivalTime,
    })
    .from(crewAssignments)
    .innerJoin(flights, eq(flights.id, crewAssignments.flightId))
    .where(
      and(
        eq(crewAssignments.crewMemberId, crewMemberId),
        ne(crewAssignments.status, "removed"),
        proposed.flightId
          ? ne(crewAssignments.flightId, proposed.flightId)
          : undefined,
        sql`${flights.arrivalTime} > ${new Date(duty.start.getTime() - 7 * 86400000)}`,
        sql`${flights.departureTime} < ${new Date(duty.end.getTime() + 7 * 86400000)}`
      )
    )
    .limit(1001);
  if (rows.length > 1000) throw new Error("Duty window exceeds limit");
  const history = rows.map(r => ({
    start: r.start ?? new Date(NaN),
    end: r.end ?? new Date(NaN),
    departure: r.departure,
    arrival: r.arrival,
  }));
  const checked = validateDuty(duty, history, profile.rule);
  const violations = [...checked.violations];
  if (crew.status !== "active") violations.push("Crew member is not active");
  if (!crew.medicalExpiry || crew.medicalExpiry < duty.end)
    violations.push("Valid medical evidence through duty end is required");
  if (
    ["captain", "first_officer"].includes(crew.role) &&
    (!crew.licenseExpiry || crew.licenseExpiry < duty.end)
  )
    violations.push("Valid flight-crew license evidence is required");
  let qualified: string[] = [];
  try {
    const parsed: unknown = JSON.parse(crew.qualifiedAircraft ?? "null");
    if (Array.isArray(parsed) && parsed.every(v => typeof v === "string"))
      qualified = parsed;
  } catch {
    /* Invalid evidence remains unavailable. */
  }
  if (proposed.aircraftType && !qualified.includes(proposed.aircraftType))
    violations.push("Aircraft qualification is missing");
  return {
    crewMemberId,
    compliant: violations.length === 0,
    totalDutyHours:
      checked.totalDutyMinutes === null ? 0 : checked.totalDutyMinutes / 60,
    maxDutyHours: profile.rule.maxDuty24Minutes / 60,
    proposedFlightDuration:
      (proposed.arrivalTime.getTime() - proposed.departureTime.getTime()) /
      3600000,
    violations,
    warnings: [
      `Operator profile ${profile.rule.version}; dispatch acceptance is separate`,
    ],
    profileEvidenceId: profile.evidenceId,
    duty,
  };
}
export async function assignCrewWithRules(input: {
  flightId: number;
  crewMemberId: number;
  role: "captain" | "first_officer" | "purser" | "cabin_crew";
  assignedBy: number;
  tenantId?: number | null;
  notes?: string;
  dutyStartTime?: Date;
  dutyEndTime?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Crew storage unavailable");
  return db.transaction(async tx => {
    const [crew] = await tx
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.id, input.crewMemberId))
      .for("update");
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, input.flightId))
      .for("update");
    if (
      !crew ||
      !flight ||
      crew.airlineId !== flight.airlineId ||
      crew.role !== input.role ||
      (input.tenantId != null && flight.tenantId !== input.tenantId) ||
      !["scheduled", "delayed"].includes(flight.status) ||
      flight.departureTime <= new Date()
    )
      throw new Error("Crew/flight/operator/role mismatch");
    await assertTenantOperational(tx, flight.tenantId);
    const [duplicate] = await tx
      .select()
      .from(crewAssignments)
      .where(
        and(
          eq(crewAssignments.crewMemberId, crew.id),
          eq(crewAssignments.flightId, flight.id),
          ne(crewAssignments.status, "removed")
        )
      )
      .limit(1);
    if (duplicate) throw new Error("Crew member already assigned");
    const check = await evaluateCrewDuty(tx, crew.id, {
      ...input,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      aircraftType: flight.aircraftType,
      tenantId: flight.tenantId,
    });
    if (!check.compliant) throw new Error(check.violations.join("; "));
    const [result] = await tx.insert(crewAssignments).values({
      flightId: flight.id,
      crewMemberId: crew.id,
      role: input.role,
      assignedBy: input.assignedBy,
      notes: input.notes,
      dutyStartTime: check.duty.start,
      dutyEndTime: check.duty.end,
      ruleEvidenceId: check.profileEvidenceId,
    });
    await recordEvent(tx, {
      aggregateType: "crewAssignment",
      aggregateId: Number(result.insertId),
      tenantId: flight.tenantId,
      eventType: "crew.assignment_created",
      payload: {
        crewMemberId: crew.id,
        flightId: flight.id,
        ruleEvidenceId: check.profileEvidenceId,
        assignedBy: input.assignedBy,
      },
    });
    return {
      id: Number(result.insertId),
      flightNumber: flight.flightNumber,
      crewName: `${crew.firstName} ${crew.lastName}`,
      role: input.role,
      ftlWarnings: check.warnings,
    };
  });
}
