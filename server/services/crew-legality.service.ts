/**
 * Crew legality service: persistence for FTL rule sets, verdict audit log,
 * operational overrides, and the gate that every assignment path must pass.
 *
 * The engine itself is pure (crew-legality-engine.ts). This module loads the
 * active operator-confirmed rule set, the crew member's duty history and the
 * proposed sector, runs the engine, logs the verdict and blocks illegal
 * assignments unless a documented override applies.
 */
import { and, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { getDb } from "../db";
import {
  airports,
  crewAssignments,
  crewFtlFdpLimits,
  crewFtlLimits,
  crewFtlRuleSets,
  crewLegalityOverrides,
  crewLegalityVerdicts,
  crewMembers,
  crewStandbyDuties,
  flights,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";
import { fallbackAirportTimeZone, isValidTimeZone } from "./civil-day";
import {
  ruleSetDocumentSchema,
  ruleSetReadinessIssues,
  ruleSetTemplates,
  type RuleSetDocument,
  type RuleSetTemplateCode,
} from "./crew-ftl-rule-set";
import {
  evaluateLegality,
  failedRuleCodes,
  type CrewProfile,
  type DutyPeriod,
  type LegalityVerdict,
  type OperatorFlightTimeLimits,
  type Sector,
} from "./crew-legality-engine";

export type AssignmentPath =
  "manual" | "bulk_roster" | "recovery_swap" | "standby_activation" | "preview";

/** History window: 12 calendar months plus slack for the calendar-year rule. */
const HISTORY_BACK_MS = 400 * 86_400_000;
const HISTORY_FORWARD_MS = 14 * 86_400_000;
const HISTORY_ROW_LIMIT = 5000;

export class CrewLegalityError extends Error {
  constructor(
    message: string,
    readonly verdict: LegalityVerdict | null,
    readonly verdictId: number | null
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Rule sets
// ---------------------------------------------------------------------------

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("Crew legality storage unavailable");
  return db;
}

export async function importRuleSet(input: {
  airlineId: number;
  tenantId: number | null;
  actorId: number;
  template?: RuleSetTemplateCode;
  document?: unknown;
}) {
  if (!input.template && input.document === undefined)
    throw new Error("A template code or a rule set document is required");
  const doc = input.template
    ? ruleSetTemplates[input.template]()
    : ruleSetDocumentSchema.parse(input.document);
  const db = requireDb();
  return await db.transaction(async tx => {
    const [existing] = await tx
      .select({ id: crewFtlRuleSets.id })
      .from(crewFtlRuleSets)
      .where(
        and(
          eq(crewFtlRuleSets.airlineId, input.airlineId),
          eq(crewFtlRuleSets.code, doc.code),
          eq(crewFtlRuleSets.version, doc.version)
        )
      )
      .limit(1);
    if (existing)
      throw new Error(`Rule set ${doc.code} ${doc.version} already imported`);
    const [header] = await tx.insert(crewFtlRuleSets).values({
      airlineId: input.airlineId,
      tenantId: input.tenantId,
      code: doc.code,
      version: doc.version,
      name: doc.name,
      jurisdiction: doc.jurisdiction,
      effectiveFrom: new Date(doc.effectiveFrom),
      effectiveTo: doc.effectiveTo ? new Date(doc.effectiveTo) : null,
      sourceUrl: doc.sourceUrl,
      sourceNotes: doc.sourceNotes,
      valuesStatus: doc.valuesStatus,
      allowsOverride: doc.allowsOverride,
      importedBy: input.actorId,
    });
    const ruleSetId = Number(header.insertId);
    if (doc.fdpLimits.length)
      await tx.insert(crewFtlFdpLimits).values(
        doc.fdpLimits.map(r => ({
          ruleSetId,
          tableKind: r.table,
          bandStartMinute: r.bandStartMinute,
          bandEndMinute: r.bandEndMinute,
          sectorsFrom: r.sectorsFrom,
          sectorsTo: r.sectorsTo,
          qualifier: r.qualifier,
          maxFdpMinutes: r.maxFdpMinutes,
          sourceStatus: r.sourceStatus,
        }))
      );
    if (doc.limits.length)
      await tx.insert(crewFtlLimits).values(
        doc.limits.map(l => ({
          ruleSetId,
          limitKey: l.key,
          qualifier: l.qualifier,
          value: l.value,
          unit: l.unit,
          reference: l.reference,
          sourceStatus: l.sourceStatus,
        }))
      );
    await recordEvent(tx, {
      aggregateType: "crewFtlRuleSet",
      aggregateId: ruleSetId,
      tenantId: input.tenantId,
      eventType: "crew.ftl_rule_set_imported",
      payload: {
        ruleSetId,
        airlineId: input.airlineId,
        code: doc.code,
        version: doc.version,
        valuesStatus: doc.valuesStatus,
        actorId: input.actorId,
      },
    });
    return {
      id: ruleSetId,
      code: doc.code,
      version: doc.version,
      readinessIssues: ruleSetReadinessIssues(doc),
    };
  });
}

export async function readRuleSetDocument(
  tx: SettlementTx,
  ruleSetId: number
): Promise<{
  header: typeof crewFtlRuleSets.$inferSelect;
  doc: RuleSetDocument;
} | null> {
  const [header] = await tx
    .select()
    .from(crewFtlRuleSets)
    .where(eq(crewFtlRuleSets.id, ruleSetId))
    .limit(1);
  if (!header) return null;
  const fdpRows = await tx
    .select()
    .from(crewFtlFdpLimits)
    .where(eq(crewFtlFdpLimits.ruleSetId, ruleSetId))
    .limit(2001);
  const limitRows = await tx
    .select()
    .from(crewFtlLimits)
    .where(eq(crewFtlLimits.ruleSetId, ruleSetId))
    .limit(201);
  if (fdpRows.length > 2000 || limitRows.length > 200)
    throw new Error("Rule set exceeds the supported row count");
  const doc = ruleSetDocumentSchema.parse({
    code: header.code,
    version: header.version,
    name: header.name,
    jurisdiction: header.jurisdiction,
    sourceUrl: header.sourceUrl,
    sourceNotes: header.sourceNotes ?? "",
    effectiveFrom: header.effectiveFrom.toISOString(),
    effectiveTo: header.effectiveTo?.toISOString() ?? null,
    valuesStatus: header.valuesStatus,
    allowsOverride: header.allowsOverride,
    fdpLimits: fdpRows.map(r => ({
      table: r.tableKind,
      bandStartMinute: r.bandStartMinute,
      bandEndMinute: r.bandEndMinute,
      sectorsFrom: r.sectorsFrom,
      sectorsTo: r.sectorsTo,
      qualifier: r.qualifier,
      maxFdpMinutes: r.maxFdpMinutes,
      sourceStatus: r.sourceStatus,
    })),
    limits: limitRows.map(l => ({
      key: l.limitKey,
      qualifier: l.qualifier,
      value: l.value,
      unit: l.unit,
      reference: l.reference,
      sourceStatus: l.sourceStatus,
    })),
  });
  return { header, doc };
}

export async function listRuleSets(filters: {
  airlineId?: number;
  tenantId: number | null;
}) {
  const db = requireDb();
  const rows = await db
    .select()
    .from(crewFtlRuleSets)
    .where(
      and(
        filters.airlineId
          ? eq(crewFtlRuleSets.airlineId, filters.airlineId)
          : undefined,
        filters.tenantId === null
          ? undefined
          : sql`${crewFtlRuleSets.tenantId} <=> ${filters.tenantId}`
      )
    )
    .orderBy(desc(crewFtlRuleSets.active), desc(crewFtlRuleSets.createdAt))
    .limit(200);
  const result = [];
  for (const header of rows) {
    const full = await readRuleSetDocument(db, header.id);
    result.push({
      id: header.id,
      airlineId: header.airlineId,
      code: header.code,
      version: header.version,
      name: header.name,
      jurisdiction: header.jurisdiction,
      sourceUrl: header.sourceUrl,
      sourceNotes: header.sourceNotes,
      valuesStatus: header.valuesStatus,
      approvalStatus: header.approvalStatus,
      operatorConfirmed: header.operatorConfirmed,
      confirmedBy: header.confirmedBy,
      confirmedAt: header.confirmedAt,
      confirmationNote: header.confirmationNote,
      active: header.active,
      activatedAt: header.activatedAt,
      allowsOverride: header.allowsOverride,
      effectiveFrom: header.effectiveFrom,
      effectiveTo: header.effectiveTo,
      fdpRows: full?.doc.fdpLimits.length ?? 0,
      limitRows: full?.doc.limits.length ?? 0,
      pendingValues:
        (full?.doc.fdpLimits.filter(r => r.maxFdpMinutes === null).length ??
          0) + (full?.doc.limits.filter(l => l.value === null).length ?? 0),
      unverifiedValues:
        (full?.doc.fdpLimits.filter(
          r => r.sourceStatus === "transcribed_unverified"
        ).length ?? 0) +
        (full?.doc.limits.filter(
          l => l.sourceStatus === "transcribed_unverified"
        ).length ?? 0),
      readinessIssues: full
        ? ruleSetReadinessIssues(full.doc)
        : ["Rule set unreadable"],
    });
  }
  return result;
}

/** Operator confirmation attests that every value was verified against the
 * official text. It is refused while any value is pending. */
export async function confirmRuleSet(input: {
  ruleSetId: number;
  actorId: number;
  tenantId: number | null;
  note: string;
}) {
  const db = requireDb();
  return await db.transaction(async tx => {
    const full = await readRuleSetDocument(tx, input.ruleSetId);
    if (!full) throw new Error("Rule set not found");
    if (input.tenantId !== null && full.header.tenantId !== input.tenantId)
      throw new Error("Rule set is outside the tenant scope");
    const issues = ruleSetReadinessIssues(full.doc);
    if (issues.length)
      throw new Error(`Rule set cannot be confirmed: ${issues.join("; ")}`);
    if (!input.note.trim())
      throw new Error(
        "A confirmation note naming the verified source text is required"
      );
    await tx
      .update(crewFtlRuleSets)
      .set({
        approvalStatus: "operator_confirmed",
        operatorConfirmed: true,
        confirmedBy: input.actorId,
        confirmedAt: new Date(),
        confirmationNote: input.note.slice(0, 500),
      })
      .where(eq(crewFtlRuleSets.id, input.ruleSetId));
    await recordEvent(tx, {
      aggregateType: "crewFtlRuleSet",
      aggregateId: input.ruleSetId,
      tenantId: full.header.tenantId,
      eventType: "crew.ftl_rule_set_confirmed",
      payload: {
        ruleSetId: input.ruleSetId,
        airlineId: full.header.airlineId,
        code: full.header.code,
        version: full.header.version,
        confirmedBy: input.actorId,
      },
    });
    return {
      id: input.ruleSetId,
      approvalStatus: "operator_confirmed" as const,
    };
  });
}

/** Activation refuses any rule set that is not operator-confirmed. */
export async function activateRuleSet(input: {
  ruleSetId: number;
  actorId: number;
  tenantId: number | null;
}) {
  const db = requireDb();
  return await db.transaction(async tx => {
    const full = await readRuleSetDocument(tx, input.ruleSetId);
    if (!full) throw new Error("Rule set not found");
    if (input.tenantId !== null && full.header.tenantId !== input.tenantId)
      throw new Error("Rule set is outside the tenant scope");
    if (
      !full.header.operatorConfirmed ||
      full.header.approvalStatus !== "operator_confirmed"
    )
      throw new Error(
        "Rule set is not operator-confirmed and cannot be activated"
      );
    const issues = ruleSetReadinessIssues(full.doc);
    if (issues.length)
      throw new Error(`Rule set cannot be activated: ${issues.join("; ")}`);
    const others = await tx
      .select({ id: crewFtlRuleSets.id })
      .from(crewFtlRuleSets)
      .where(
        and(
          eq(crewFtlRuleSets.airlineId, full.header.airlineId),
          eq(crewFtlRuleSets.active, true),
          ne(crewFtlRuleSets.id, input.ruleSetId)
        )
      )
      .for("update");
    if (others.length)
      await tx
        .update(crewFtlRuleSets)
        .set({ active: false })
        .where(
          inArray(
            crewFtlRuleSets.id,
            others.map(o => o.id)
          )
        );
    await tx
      .update(crewFtlRuleSets)
      .set({
        active: true,
        activatedBy: input.actorId,
        activatedAt: new Date(),
      })
      .where(eq(crewFtlRuleSets.id, input.ruleSetId));
    await recordEvent(tx, {
      aggregateType: "crewFtlRuleSet",
      aggregateId: input.ruleSetId,
      tenantId: full.header.tenantId,
      eventType: "crew.ftl_rule_set_activated",
      payload: {
        ruleSetId: input.ruleSetId,
        airlineId: full.header.airlineId,
        code: full.header.code,
        version: full.header.version,
        activatedBy: input.actorId,
        deactivatedRuleSetIds: others.map(o => o.id),
      },
    });
    return {
      id: input.ruleSetId,
      active: true,
      deactivated: others.map(o => o.id),
    };
  });
}

export async function setRuleSetOverridePolicy(input: {
  ruleSetId: number;
  allowsOverride: boolean;
  tenantId: number | null;
}) {
  const db = requireDb();
  const [header] = await db
    .select()
    .from(crewFtlRuleSets)
    .where(eq(crewFtlRuleSets.id, input.ruleSetId))
    .limit(1);
  if (!header) throw new Error("Rule set not found");
  if (input.tenantId !== null && header.tenantId !== input.tenantId)
    throw new Error("Rule set is outside the tenant scope");
  await db
    .update(crewFtlRuleSets)
    .set({ allowsOverride: input.allowsOverride })
    .where(eq(crewFtlRuleSets.id, input.ruleSetId));
  return { id: input.ruleSetId, allowsOverride: input.allowsOverride };
}

export async function loadActiveRuleSet(
  tx: SettlementTx,
  airlineId: number,
  tenantId: number | null | undefined,
  at: Date
): Promise<{
  id: number;
  doc: RuleSetDocument;
  allowsOverride: boolean;
} | null> {
  const rows = await tx
    .select({ id: crewFtlRuleSets.id })
    .from(crewFtlRuleSets)
    .where(
      and(
        eq(crewFtlRuleSets.airlineId, airlineId),
        eq(crewFtlRuleSets.active, true),
        eq(crewFtlRuleSets.operatorConfirmed, true),
        tenantId === undefined || tenantId === null
          ? undefined
          : sql`${crewFtlRuleSets.tenantId} <=> ${tenantId}`,
        sql`${crewFtlRuleSets.effectiveFrom} <= ${at}`,
        or(
          sql`${crewFtlRuleSets.effectiveTo} IS NULL`,
          gt(crewFtlRuleSets.effectiveTo, at)
        )
      )
    )
    .limit(2);
  if (rows.length !== 1) return null;
  const full = await readRuleSetDocument(tx, rows[0].id);
  if (!full || ruleSetReadinessIssues(full.doc).length) return null;
  return {
    id: full.header.id,
    doc: full.doc,
    allowsOverride: full.header.allowsOverride,
  };
}

// ---------------------------------------------------------------------------
// Crew profile, sectors and duty history
// ---------------------------------------------------------------------------

function airportZone(timezone: string | null | undefined): string {
  return isValidTimeZone(timezone) ? timezone : fallbackAirportTimeZone();
}

export async function loadCrewProfile(
  tx: SettlementTx,
  crewMemberId: number,
  fallbackTimeZone: string
): Promise<CrewProfile & { airlineId: number }> {
  const [row] = await tx
    .select({ crew: crewMembers, base: airports })
    .from(crewMembers)
    .leftJoin(airports, eq(airports.id, crewMembers.homeBaseAirportId))
    .where(eq(crewMembers.id, crewMemberId))
    .limit(1);
  if (!row) throw new Error("Crew member not found");
  return {
    airlineId: row.crew.airlineId,
    homeBaseCode: row.base?.code ?? null,
    homeBaseTimeZone: row.base
      ? airportZone(row.base.timezone)
      : isValidTimeZone(fallbackTimeZone)
        ? fallbackTimeZone
        : fallbackAirportTimeZone(),
  };
}

export async function loadFlightSector(
  tx: SettlementTx,
  flightId: number
): Promise<Sector> {
  const [row] = await tx
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!row) throw new Error("Flight not found");
  const ports = await tx
    .select({
      id: airports.id,
      code: airports.code,
      timezone: airports.timezone,
    })
    .from(airports)
    .where(inArray(airports.id, [row.originId, row.destinationId]));
  const origin = ports.find(p => p.id === row.originId);
  const destination = ports.find(p => p.id === row.destinationId);
  return {
    flightId: row.id,
    flightNumber: row.flightNumber,
    departureAt: row.departureTime,
    arrivalAt: row.arrivalTime,
    originCode: origin?.code ?? `#${row.originId}`,
    originTimeZone: airportZone(origin?.timezone),
    destinationCode: destination?.code ?? `#${row.destinationId}`,
    destinationTimeZone: airportZone(destination?.timezone),
  };
}

type HistoryRow = {
  crewMemberId: number;
  flightId: number;
  flightNumber: string;
  dutyStart: Date | null;
  dutyEnd: Date | null;
  departureAt: Date;
  arrivalAt: Date;
  originCode: string | null;
  originTz: string | null;
  destinationCode: string | null;
  destinationTz: string | null;
};

/** Assignments sharing identical report/release bounds form one duty period. */
function groupDuties(rows: HistoryRow[]): DutyPeriod[] {
  const grouped = new Map<string, DutyPeriod>();
  for (const row of rows) {
    if (!row.dutyStart || !row.dutyEnd)
      throw new Error(
        `Assignment on flight ${row.flightNumber} lacks certified duty bounds`
      );
    const key = `${row.dutyStart.toISOString()}/${row.dutyEnd.toISOString()}`;
    const duty = grouped.get(key) ?? {
      kind: "fdp" as const,
      reportAt: row.dutyStart,
      releaseAt: row.dutyEnd,
      sectors: [],
      reference: row.flightNumber,
    };
    duty.sectors.push({
      flightId: row.flightId,
      flightNumber: row.flightNumber,
      departureAt: row.departureAt,
      arrivalAt: row.arrivalAt,
      originCode: row.originCode ?? "?",
      originTimeZone: airportZone(row.originTz),
      destinationCode: row.destinationCode ?? "?",
      destinationTimeZone: airportZone(row.destinationTz),
    });
    grouped.set(key, duty);
  }
  return [...grouped.values()];
}

export async function loadDutyHistory(
  tx: SettlementTx,
  crewMemberIds: number[],
  options: { excludeFlightId: number | null; from: Date; to: Date }
): Promise<Map<number, DutyPeriod[]>> {
  const result = new Map<number, DutyPeriod[]>(
    crewMemberIds.map(id => [id, []])
  );
  if (!crewMemberIds.length) return result;
  const origin = alias(airports, "origin_airport");
  const destination = alias(airports, "destination_airport");
  const rows = await tx
    .select({
      crewMemberId: crewAssignments.crewMemberId,
      flightId: flights.id,
      flightNumber: flights.flightNumber,
      dutyStart: crewAssignments.dutyStartTime,
      dutyEnd: crewAssignments.dutyEndTime,
      departureAt: flights.departureTime,
      arrivalAt: flights.arrivalTime,
      originCode: origin.code,
      originTz: origin.timezone,
      destinationCode: destination.code,
      destinationTz: destination.timezone,
    })
    .from(crewAssignments)
    .innerJoin(flights, eq(flights.id, crewAssignments.flightId))
    .leftJoin(origin, eq(origin.id, flights.originId))
    .leftJoin(destination, eq(destination.id, flights.destinationId))
    .where(
      and(
        inArray(crewAssignments.crewMemberId, crewMemberIds),
        ne(crewAssignments.status, "removed"),
        options.excludeFlightId
          ? ne(crewAssignments.flightId, options.excludeFlightId)
          : undefined,
        gt(flights.arrivalTime, options.from),
        lt(flights.departureTime, options.to)
      )
    )
    .limit(HISTORY_ROW_LIMIT + 1);
  if (rows.length > HISTORY_ROW_LIMIT)
    throw new Error("Duty history exceeds the evaluable window");
  const byCrew = new Map<number, HistoryRow[]>();
  for (const row of rows)
    byCrew.set(row.crewMemberId, [
      ...(byCrew.get(row.crewMemberId) ?? []),
      row,
    ]);
  for (const [crewMemberId, own] of byCrew)
    result.set(crewMemberId, groupDuties(own));
  const standby = await tx
    .select({ duty: crewStandbyDuties, port: airports })
    .from(crewStandbyDuties)
    .leftJoin(airports, eq(airports.id, crewStandbyDuties.locationAirportId))
    .where(
      and(
        inArray(crewStandbyDuties.crewMemberId, crewMemberIds),
        inArray(crewStandbyDuties.status, ["planned", "activated"]),
        gt(crewStandbyDuties.endsAt, options.from),
        lt(crewStandbyDuties.startsAt, options.to)
      )
    )
    .limit(HISTORY_ROW_LIMIT + 1);
  if (standby.length > HISTORY_ROW_LIMIT)
    throw new Error("Standby history exceeds the evaluable window");
  for (const { duty, port } of standby)
    result.get(duty.crewMemberId)?.push({
      kind: duty.kind === "airport" ? "standby_airport" : "standby_home",
      reportAt: duty.startsAt,
      releaseAt: duty.endsAt,
      sectors: [],
      locationCode: port?.code ?? null,
      locationTimeZone: port ? airportZone(port.timezone) : null,
      reference: `standby-${duty.id}`,
    });
  return result;
}

// ---------------------------------------------------------------------------
// Overrides and verdict log
// ---------------------------------------------------------------------------

export async function createOverride(input: {
  airlineId: number;
  tenantId: number | null;
  crewMemberId: number;
  flightId: number;
  ruleCodes: string[];
  reason: string;
  approvedBy: number;
  expiresAt: Date;
  createdBy: number;
}) {
  const db = requireDb();
  if (!input.reason.trim() || input.reason.trim().length < 10)
    throw new Error("An operational override requires a documented reason");
  if (input.expiresAt.getTime() <= Date.now())
    throw new Error("Override expiry must be in the future");
  if (!input.ruleCodes.length)
    throw new Error("Override must name the rules it covers");
  return await db.transaction(async tx => {
    const [crew] = await tx
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.id, input.crewMemberId))
      .limit(1);
    if (!crew || crew.airlineId !== input.airlineId)
      throw new Error("Crew member is outside the operator scope");
    const [result] = await tx.insert(crewLegalityOverrides).values({
      airlineId: input.airlineId,
      tenantId: input.tenantId,
      crewMemberId: input.crewMemberId,
      flightId: input.flightId,
      ruleCodes: input.ruleCodes,
      reason: input.reason.trim(),
      approvedBy: input.approvedBy,
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
    });
    const overrideId = Number(result.insertId);
    await recordEvent(tx, {
      aggregateType: "crewLegalityOverride",
      aggregateId: overrideId,
      tenantId: input.tenantId,
      eventType: "crew.legality_override_created",
      payload: {
        overrideId,
        crewMemberId: input.crewMemberId,
        flightId: input.flightId,
        ruleCodes: input.ruleCodes,
        approvedBy: input.approvedBy,
        expiresAt: input.expiresAt.toISOString(),
        createdBy: input.createdBy,
      },
    });
    return { id: overrideId };
  });
}

export async function listOverrides(filters: {
  tenantId: number | null;
  crewMemberId?: number;
  flightId?: number;
}) {
  const db = requireDb();
  return await db
    .select()
    .from(crewLegalityOverrides)
    .where(
      and(
        filters.tenantId === null
          ? undefined
          : sql`${crewLegalityOverrides.tenantId} <=> ${filters.tenantId}`,
        filters.crewMemberId
          ? eq(crewLegalityOverrides.crewMemberId, filters.crewMemberId)
          : undefined,
        filters.flightId
          ? eq(crewLegalityOverrides.flightId, filters.flightId)
          : undefined
      )
    )
    .orderBy(desc(crewLegalityOverrides.createdAt))
    .limit(200);
}

export async function listVerdicts(filters: {
  tenantId: number | null;
  crewMemberId?: number;
  flightId?: number;
  limit?: number;
}) {
  const db = requireDb();
  const rows = await db
    .select({
      verdict: crewLegalityVerdicts,
      crew: crewMembers,
      flight: flights,
    })
    .from(crewLegalityVerdicts)
    .innerJoin(
      crewMembers,
      eq(crewMembers.id, crewLegalityVerdicts.crewMemberId)
    )
    .leftJoin(flights, eq(flights.id, crewLegalityVerdicts.flightId))
    .where(
      and(
        filters.tenantId === null
          ? undefined
          : sql`${crewLegalityVerdicts.tenantId} <=> ${filters.tenantId}`,
        filters.crewMemberId
          ? eq(crewLegalityVerdicts.crewMemberId, filters.crewMemberId)
          : undefined,
        filters.flightId
          ? eq(crewLegalityVerdicts.flightId, filters.flightId)
          : undefined
      )
    )
    .orderBy(
      desc(crewLegalityVerdicts.createdAt),
      desc(crewLegalityVerdicts.id)
    )
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200));
  return rows.map(({ verdict, crew, flight }) => ({
    id: verdict.id,
    ruleSetId: verdict.ruleSetId,
    crewMemberId: verdict.crewMemberId,
    crewName: `${crew.firstName} ${crew.lastName}`,
    employeeId: crew.employeeId,
    flightId: verdict.flightId,
    flightNumber: flight?.flightNumber ?? null,
    pairingId: verdict.pairingId,
    standbyId: verdict.standbyId,
    path: verdict.path,
    verdict: verdict.verdict,
    blocked: verdict.blocked,
    overrideId: verdict.overrideId,
    checks: verdict.checks as unknown as LegalityVerdict["checks"],
    fatigue: verdict.fatigue as unknown as LegalityVerdict["fatigue"],
    summary: verdict.summary,
    actorId: verdict.actorId,
    createdAt: verdict.createdAt,
  }));
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface LegalityGateInput {
  crewMemberId: number;
  airlineId: number;
  tenantId: number | null;
  flightId: number;
  reportAt: Date;
  releaseAt: Date;
  path: AssignmentPath;
  actorId: number | null;
  pairingId?: number | null;
  standbyId?: number | null;
  /** Operator profile time zone used when the crew member has no home base. */
  fallbackTimeZone: string;
  /** Cumulative flight-time limits from the signed operator profile; the
   * engine applies the stricter of these and the rule set. */
  operatorLimits?: OperatorFlightTimeLimits | null;
}

export interface VerdictRecord {
  ruleSetId: number | null;
  airlineId: number;
  tenantId: number | null;
  crewMemberId: number;
  flightId: number | null;
  pairingId: number | null;
  standbyId: number | null;
  path: AssignmentPath;
  verdict: LegalityVerdict["verdict"];
  blocked: boolean;
  overrideId: number | null;
  checks: Record<string, unknown>[];
  fatigue: Record<string, unknown>;
  summary: Record<string, unknown>;
  actorId: number | null;
}

export interface LegalityGateDeps {
  now: () => Date;
  loadRuleSet: (
    airlineId: number,
    tenantId: number | null,
    at: Date
  ) => Promise<{
    id: number;
    doc: RuleSetDocument;
    allowsOverride: boolean;
  } | null>;
  loadCrewProfile: (
    crewMemberId: number,
    fallbackTimeZone: string
  ) => Promise<CrewProfile>;
  loadSector: (flightId: number) => Promise<Sector>;
  loadHistory: (
    crewMemberId: number,
    excludeFlightId: number,
    from: Date,
    to: Date
  ) => Promise<DutyPeriod[]>;
  findOverride: (
    crewMemberId: number,
    flightId: number,
    now: Date
  ) => Promise<{ id: number; ruleCodes: string[] } | null>;
  /** Must persist outside the assignment transaction so blocked verdicts survive rollback. */
  persistVerdict: (record: VerdictRecord) => Promise<number>;
  consumeOverride: (overrideId: number, verdictId: number) => Promise<void>;
  publish: (event: {
    tenantId: number | null;
    verdictId: number;
    payload: Record<string, unknown>;
  }) => Promise<void>;
}

export function defaultGateDeps(tx: SettlementTx): LegalityGateDeps {
  return {
    now: () => new Date(),
    loadRuleSet: (airlineId, tenantId, at) =>
      loadActiveRuleSet(tx, airlineId, tenantId, at),
    loadCrewProfile: (crewMemberId, fallbackTimeZone) =>
      loadCrewProfile(tx, crewMemberId, fallbackTimeZone),
    loadSector: flightId => loadFlightSector(tx, flightId),
    loadHistory: async (crewMemberId, excludeFlightId, from, to) =>
      (
        await loadDutyHistory(tx, [crewMemberId], { excludeFlightId, from, to })
      ).get(crewMemberId) ?? [],
    findOverride: async (crewMemberId, flightId, now) => {
      const [row] = await tx
        .select()
        .from(crewLegalityOverrides)
        .where(
          and(
            eq(crewLegalityOverrides.crewMemberId, crewMemberId),
            eq(crewLegalityOverrides.flightId, flightId),
            eq(crewLegalityOverrides.status, "active"),
            gt(crewLegalityOverrides.expiresAt, now)
          )
        )
        .orderBy(desc(crewLegalityOverrides.createdAt))
        .limit(1)
        .for("update");
      return row ? { id: row.id, ruleCodes: row.ruleCodes } : null;
    },
    persistVerdict: async record => {
      // The audit row is written on the root connection, not the caller's
      // transaction: a blocked assignment rolls back, its verdict must not.
      const [result] = await requireDb()
        .insert(crewLegalityVerdicts)
        .values(record);
      return Number(result.insertId);
    },
    consumeOverride: async (overrideId, verdictId) => {
      await tx
        .update(crewLegalityOverrides)
        .set({ status: "consumed", consumedByAssignmentId: verdictId })
        .where(eq(crewLegalityOverrides.id, overrideId));
    },
    publish: async event => {
      await recordEvent(tx, {
        aggregateType: "crewLegalityVerdict",
        aggregateId: event.verdictId,
        tenantId: event.tenantId,
        eventType: "crew.legality_verdict_recorded",
        payload: event.payload,
      });
    },
  };
}

/** Merge an existing duty with the same bounds into the proposed duty: the
 * proposed sector joins that FDP instead of being a second duty period. */
function buildProposed(
  input: LegalityGateInput,
  sector: Sector,
  history: DutyPeriod[]
): { proposed: DutyPeriod; history: DutyPeriod[] } {
  const same = history.find(
    d =>
      d.kind === "fdp" &&
      d.reportAt.getTime() === input.reportAt.getTime() &&
      d.releaseAt.getTime() === input.releaseAt.getTime()
  );
  const proposed: DutyPeriod = {
    kind: "fdp",
    reportAt: input.reportAt,
    releaseAt: input.releaseAt,
    sectors: [...(same?.sectors ?? []), sector],
    reference: sector.flightNumber ?? String(input.flightId),
  };
  return { proposed, history: history.filter(d => d !== same) };
}

export interface GateResult {
  verdict: LegalityVerdict;
  verdictId: number;
  ruleSetId: number | null;
  overrideId: number | null;
  blocked: boolean;
}

/**
 * Evaluate, log and enforce. Throws CrewLegalityError when the assignment is
 * illegal and no documented override applies. Previews never throw.
 */
export async function enforceCrewLegality(
  tx: SettlementTx,
  input: LegalityGateInput,
  deps: LegalityGateDeps = defaultGateDeps(tx)
): Promise<GateResult> {
  const now = deps.now();
  const ruleSet = await deps.loadRuleSet(
    input.airlineId,
    input.tenantId,
    input.reportAt
  );
  const base: Omit<
    VerdictRecord,
    "verdict" | "blocked" | "overrideId" | "checks" | "fatigue" | "summary"
  > = {
    ruleSetId: ruleSet?.id ?? null,
    airlineId: input.airlineId,
    tenantId: input.tenantId,
    crewMemberId: input.crewMemberId,
    flightId: input.flightId,
    pairingId: input.pairingId ?? null,
    standbyId: input.standbyId ?? null,
    path: input.path,
    actorId: input.actorId,
  };
  if (!ruleSet) {
    const blocked = input.path !== "preview";
    const verdictId = await deps.persistVerdict({
      ...base,
      verdict: "illegal",
      blocked,
      overrideId: null,
      checks: [
        {
          code: "RULE_SET_ACTIVE",
          status: "not_evaluable",
          detail: "No active operator-confirmed FTL rule set for this operator",
        },
      ],
      fatigue: {},
      summary: { reason: "no_active_rule_set" },
    });
    if (blocked)
      throw new CrewLegalityError(
        "Crew legality: no active operator-confirmed FTL rule set; assignment blocked",
        null,
        verdictId
      );
    return {
      verdict: {
        verdict: "illegal",
        checks: [
          {
            code: "RULE_SET_ACTIVE",
            reference: "crew_ftl_rule_sets",
            status: "not_evaluable",
            limit: null,
            actual: null,
            margin: null,
            unit: "count",
            detail:
              "No active operator-confirmed FTL rule set for this operator",
          },
        ],
        acclimatisation: {
          state: "X",
          referenceTimeZone: input.fallbackTimeZone,
          localTimeZone: input.fallbackTimeZone,
          timeDifferenceHours: 0,
          elapsedHoursSinceReference: null,
          tableUsed: "unknown_acclimatisation",
          reportLocalMinutes: 0,
        },
        fdpMinutes: 0,
        extensionUsed: false,
        fatigue: {
          score: 0,
          level: "low",
          factors: [],
          woclEncroachmentMinutes: 0,
          consecutiveEarlyStarts: 0,
          consecutiveLateFinishes: 0,
          disclaimer: "Not evaluated",
        },
        ruleSet: { code: "none", version: "none" },
        evaluatedAt: now.toISOString(),
      },
      verdictId,
      ruleSetId: null,
      overrideId: null,
      blocked: false,
    };
  }
  const [crew, sector, rawHistory] = await Promise.all([
    deps.loadCrewProfile(input.crewMemberId, input.fallbackTimeZone),
    deps.loadSector(input.flightId),
    deps.loadHistory(
      input.crewMemberId,
      input.flightId,
      new Date(input.reportAt.getTime() - HISTORY_BACK_MS),
      new Date(input.releaseAt.getTime() + HISTORY_FORWARD_MS)
    ),
  ]);
  const { proposed, history } = buildProposed(input, sector, rawHistory);
  const verdict = evaluateLegality({
    ruleSet: ruleSet.doc,
    crew,
    history,
    proposed,
    now,
    operatorLimits: input.operatorLimits ?? null,
  });
  const failed = failedRuleCodes(verdict);
  let overrideId: number | null = null;
  let blocked = false;
  if (verdict.verdict === "illegal" && input.path !== "preview") {
    const override = ruleSet.allowsOverride
      ? await deps.findOverride(input.crewMemberId, input.flightId, now)
      : null;
    const covers =
      override !== null &&
      failed.every(code => override.ruleCodes.includes(code)) &&
      !failed.includes("RULE_SET_VALUES") &&
      !failed.includes("NO_OVERLAP");
    if (covers && override) overrideId = override.id;
    else blocked = true;
  }
  const verdictId = await deps.persistVerdict({
    ...base,
    verdict: verdict.verdict,
    blocked,
    overrideId,
    checks: verdict.checks as unknown as Record<string, unknown>[],
    fatigue: verdict.fatigue as unknown as Record<string, unknown>,
    summary: {
      acclimatisation: verdict.acclimatisation,
      fdpMinutes: verdict.fdpMinutes,
      extensionUsed: verdict.extensionUsed,
      ruleSet: verdict.ruleSet,
      failedRules: failed,
      sectors: proposed.sectors.length,
      operatorLimits: input.operatorLimits ?? null,
    },
  });
  if (blocked)
    throw new CrewLegalityError(
      `Crew legality: ${verdict.verdict} (${failed.join(", ")}); assignment blocked`,
      verdict,
      verdictId
    );
  if (overrideId !== null) await deps.consumeOverride(overrideId, verdictId);
  await deps.publish({
    tenantId: input.tenantId,
    verdictId,
    payload: {
      verdictId,
      crewMemberId: input.crewMemberId,
      flightId: input.flightId,
      ruleSetId: ruleSet.id,
      path: input.path,
      verdict: verdict.verdict,
      blocked,
      failedRules: failed,
      overrideId,
    },
  });
  return { verdict, verdictId, ruleSetId: ruleSet.id, overrideId, blocked };
}

/** Read-only verdicts for a candidate pool (one history query). Not persisted:
 * replacement searches are exploratory; the chosen assignment is gated. */
export async function previewCandidateLegality(
  tx: SettlementTx,
  candidates: Array<{ id: number; airlineId: number }>,
  input: {
    flightId: number;
    tenantId: number | null;
    reportAt: Date;
    releaseAt: Date;
    fallbackTimeZone: string;
    operatorLimits?: OperatorFlightTimeLimits | null;
  }
): Promise<
  Map<number, LegalityVerdict | { verdict: "illegal"; reason: string }>
> {
  const result = new Map<
    number,
    LegalityVerdict | { verdict: "illegal"; reason: string }
  >();
  if (!candidates.length) return result;
  const airlineId = candidates[0].airlineId;
  const ruleSet = await loadActiveRuleSet(
    tx,
    airlineId,
    input.tenantId,
    input.reportAt
  );
  if (!ruleSet) {
    for (const c of candidates)
      result.set(c.id, {
        verdict: "illegal",
        reason: "No active operator-confirmed FTL rule set",
      });
    return result;
  }
  const sector = await loadFlightSector(tx, input.flightId);
  const histories = await loadDutyHistory(
    tx,
    candidates.map(c => c.id),
    {
      excludeFlightId: input.flightId,
      from: new Date(input.reportAt.getTime() - HISTORY_BACK_MS),
      to: new Date(input.releaseAt.getTime() + HISTORY_FORWARD_MS),
    }
  );
  const profiles = await tx
    .select({ crew: crewMembers, base: airports })
    .from(crewMembers)
    .leftJoin(airports, eq(airports.id, crewMembers.homeBaseAirportId))
    .where(
      inArray(
        crewMembers.id,
        candidates.map(c => c.id)
      )
    );
  const now = new Date();
  for (const c of candidates) {
    const profile = profiles.find(p => p.crew.id === c.id);
    const crew: CrewProfile = {
      homeBaseCode: profile?.base?.code ?? null,
      homeBaseTimeZone: profile?.base
        ? airportZone(profile.base.timezone)
        : isValidTimeZone(input.fallbackTimeZone)
          ? input.fallbackTimeZone
          : fallbackAirportTimeZone(),
    };
    try {
      const { proposed, history } = buildProposed(
        {
          ...input,
          crewMemberId: c.id,
          airlineId,
          path: "preview",
          actorId: null,
        },
        sector,
        histories.get(c.id) ?? []
      );
      result.set(
        c.id,
        evaluateLegality({
          ruleSet: ruleSet.doc,
          crew,
          history,
          proposed,
          now,
          operatorLimits: input.operatorLimits ?? null,
        })
      );
    } catch (error) {
      result.set(c.id, {
        verdict: "illegal",
        reason:
          error instanceof Error ? error.message : "Legality not evaluable",
      });
    }
  }
  return result;
}
