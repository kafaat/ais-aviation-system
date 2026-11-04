import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  airlines,
  aviationEvidence,
  crewAssignments,
  crewMembers,
  flights,
} from "../../drizzle/schema";
import { authorityRelationalFixture } from "../__tests__/helpers/authority-relational-fixture";
import type { SettlementTx } from "./booking-settlement.service";
import type { EvidenceEnvelope } from "./aviation-evidence.service";

const state = vi.hoisted(() => ({
  db: null as unknown,
  event: vi.fn(),
  operational: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("./outbox.service", () => ({ recordEvent: state.event }));
vi.mock("./tenant.service", () => ({
  assertTenantOperational: state.operational,
}));
import {
  assignCrewWithRules,
  evaluateCrewCandidates,
  evaluateCrewDuty,
  getCrewRules,
  ingestCrewRules,
} from "./crew-rule.service";
import { calculateRequestHash } from "./idempotency-v2.service";

const rule = {
  airlineId: 1,
  version: "synthetic-profile-1",
  reference: "https://example.invalid/synthetic-operator-profile",
  effectiveFrom: "2030-01-01T00:00:00.000Z",
  effectiveTo: "2031-01-01T00:00:00.000Z",
  timeZone: "UTC",
  aircraftTypes: ["A320"],
  reportBeforeMinutes: 60,
  releaseAfterMinutes: 30,
  maxDuty24Minutes: 840,
  maxDuty7DayMinutes: 3600,
  minRestMinutes: 720,
  minimumCrew: { captain: 1, first_officer: 1, purser: 1, cabin_crew: 2 },
  fdpBands: [
    {
      startHour: 0,
      endHour: 24,
      minSegments: 1,
      maxSegments: 4,
      maxMinutes: 720,
    },
  ],
};
const proposed = {
  flightId: 1,
  tenantId: 101,
  aircraftType: "A320",
  departureTime: new Date("2030-06-15T12:00:00.000Z"),
  arrivalTime: new Date("2030-06-15T14:00:00.000Z"),
};
const assignment = {
  flightId: 1,
  crewMemberId: 1,
  role: "captain" as const,
  assignedBy: 7,
  tenantId: 101,
};
const source = {
  sourceId: "synthetic-coverage-operator",
  tenantId: 101,
  capabilities: ["crew_rules"],
  secretEnv: "AIS_COVERAGE_CREW_SOURCE_SECRET",
  validUntil: "2031-01-01T00:00:00.000Z",
  airlineIds: [1],
};
let fixture: ReturnType<typeof authorityRelationalFixture>;
let tx: SettlementTx;
function seedPolicy(
  id = 10,
  overrides: {
    sourceId?: string;
    tenantId?: number;
    payload?: typeof rule;
  } = {}
) {
  fixture.insert(aviationEvidence, {
    id,
    sourceId: overrides.sourceId ?? source.sourceId,
    sourceEventId: `synthetic-profile-event-${id}`,
    tenantId: overrides.tenantId ?? 101,
    flightId: null,
    kind: "crew_rules",
    payload: JSON.stringify(overrides.payload ?? rule),
    digest: "0".repeat(64),
    observedAt: "2030-06-01 00:00:00",
  });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-06-01T00:00:00.000Z"));
  vi.stubEnv("AVIATION_SOURCE_REGISTRY", JSON.stringify([source]));
  vi.stubEnv(source.secretEnv, randomBytes(32).toString("hex"));
  fixture = authorityRelationalFixture([
    airlines,
    aviationEvidence,
    crewMembers,
    crewAssignments,
    flights,
  ]);
  state.db = fixture.db;
  tx = fixture.db as unknown as SettlementTx;
  state.event.mockReset().mockResolvedValue(undefined);
  state.operational.mockReset().mockResolvedValue(undefined);
  fixture.insert(airlines, { id: 1 });
  for (const id of [1, 2])
    fixture.insert(crewMembers, {
      id,
      firstName: "Synthetic",
      lastName: `Crew${id}`,
      airlineId: 1,
      role: "captain",
      status: "active",
      qualifiedAircraft: JSON.stringify(["A320"]),
      medicalExpiry: "2030-12-31 00:00:00",
      licenseExpiry: "2030-12-31 00:00:00",
    });
  fixture.insert(flights, {
    id: 1,
    tenantId: 101,
    airlineId: 1,
    flightNumber: "SYN001",
    aircraftType: "A320",
    departureTime: "2030-06-15 12:00:00",
    arrivalTime: "2030-06-15 14:00:00",
    status: "scheduled",
  });
  seedPolicy();
});
afterEach(() => {
  state.db = null;
  fixture.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("crew profile and assignment authority over executing SQL", () => {
  it("derives complete reporting/release bounds and keeps dispatch acceptance separate", async () => {
    const result = await evaluateCrewDuty(tx, 1, proposed);
    expect(result).toMatchObject({
      compliant: true,
      totalDutyHours: 3.5,
      maxDutyHours: 14,
      proposedFlightDuration: 2,
      profileEvidenceId: 10,
      violations: [],
    });
    expect(result.duty.start.toISOString()).toBe("2030-06-15T11:00:00.000Z");
    expect(result.duty.end.toISOString()).toBe("2030-06-15T14:30:00.000Z");
    expect(result.warnings).toEqual([
      "Operator profile synthetic-profile-1; dispatch acceptance is separate",
    ]);
  });

  it.each(["medicalExpiry", "licenseExpiry"])(
    "rejects malformed %s in both individual and candidate assessments",
    async column => {
      fixture.sqlite
        .prepare(`UPDATE crew_members SET \`${column}\` = ? WHERE id = 1`)
        .run("invalid-date-evidence");
      const individual = await evaluateCrewDuty(tx, 1, proposed);
      expect(individual.compliant).toBe(false);
      expect(individual.violations.join(";")).toContain(
        column === "medicalExpiry" ? "medical evidence" : "license evidence"
      );
      const candidates = await tx.select().from(crewMembers);
      const batch = await evaluateCrewCandidates(tx, candidates, proposed);
      expect(batch.map(candidate => candidate.compliant)).toEqual([
        false,
        true,
      ]);
      await expect(assignCrewWithRules(assignment)).rejects.toThrow(
        column === "medicalExpiry" ? "medical evidence" : "license evidence"
      );
      expect(fixture.rows(crewAssignments)).toEqual([]);
      expect(state.event).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["medicalExpiry", null, "medical evidence"],
    ["medicalExpiry", "2030-06-15 14:29:59.999", "medical evidence"],
    ["licenseExpiry", null, "license evidence"],
    ["status", "inactive", "not active"],
    ["qualifiedAircraft", "malformed-json", "qualification"],
    ["qualifiedAircraft", '["B777"]', "qualification"],
  ])(
    "rejects missing or insufficient %s evidence",
    async (column, value, diagnostic) => {
      fixture.sqlite
        .prepare(`UPDATE crew_members SET \`${column}\` = ? WHERE id = 1`)
        .run(value);
      const result = await evaluateCrewDuty(tx, 1, proposed);
      expect(result.compliant).toBe(false);
      expect(result.violations.join(";")).toContain(diagnostic);
    }
  );

  it("does not impose a pilot licence on cabin crew, but still requires medical and aircraft evidence", async () => {
    fixture.sqlite.exec(
      "UPDATE crew_members SET role = 'cabin_crew', licenseExpiry = NULL WHERE id = 1"
    );
    expect((await evaluateCrewDuty(tx, 1, proposed)).compliant).toBe(true);
  });

  it("treats incomplete persisted duty records as unavailable evidence", async () => {
    fixture.insert(flights, {
      id: 2,
      aircraftType: "A320",
      departureTime: "2030-06-14 12:00:00",
      arrivalTime: "2030-06-14 14:00:00",
    });
    fixture.insert(crewAssignments, {
      id: 20,
      crewMemberId: 1,
      flightId: 2,
      status: "assigned",
      dutyStartTime: null,
      dutyEndTime: null,
    });
    const result = await evaluateCrewDuty(tx, 1, proposed);
    expect(result.compliant).toBe(false);
    expect(result.violations).toContain("Missing or inconsistent duty records");
  });

  it("evaluates one bounded history per candidate set and counts a shared multi-leg duty once", async () => {
    for (const [id, departure, arrival] of [
      [2, "08:00:00", "08:30:00"],
      [3, "09:00:00", "09:30:00"],
    ] as const) {
      fixture.insert(flights, {
        id,
        flightNumber: `SYN00${id}`,
        aircraftType: "A320",
        departureTime: `2030-06-15 ${departure}`,
        arrivalTime: `2030-06-15 ${arrival}`,
      });
      fixture.insert(crewAssignments, {
        id,
        crewMemberId: 1,
        flightId: id,
        status: "assigned",
        dutyStartTime: "2030-06-15 07:00:00",
        dutyEndTime: "2030-06-15 10:00:00",
      });
    }
    fixture.insert(crewAssignments, {
      id: 40,
      crewMemberId: 2,
      flightId: 2,
      status: "removed",
    });
    const candidates = await tx.select().from(crewMembers);
    const result = await evaluateCrewCandidates(tx, candidates, proposed);
    expect(result.map(row => row.dutyHours)).toEqual([3, 0]);
    expect(result.map(row => row.compliant)).toEqual([false, true]);
    expect(result[0].violations).toContain(
      "Insufficient rest between distinct duties"
    );
    expect(
      fixture.queries.filter(query => /from `crew_assignments`/.test(query.sql))
    ).toHaveLength(1);
  });

  it("rejects foreign operator, tenant, aircraft and missing source authority", async () => {
    for (const [airlineId, tenantId, aircraftType] of [
      [2, 101, "A320"],
      [1, 202, "A320"],
      [1, 101, "B777"],
    ] as const) {
      await expect(
        getCrewRules(
          tx,
          airlineId,
          tenantId,
          proposed.departureTime,
          aircraftType
        )
      ).rejects.toThrow("Exactly one effective");
    }
    vi.stubEnv("AVIATION_SOURCE_REGISTRY", "[]");
    await expect(
      getCrewRules(tx, 1, 101, proposed.departureTime, "A320")
    ).rejects.toThrow("no longer authorized");
  });

  it("rejects ambiguous effective profiles from different sources", async () => {
    const secondSource = { ...source, sourceId: "synthetic-second-operator" };
    vi.stubEnv(
      "AVIATION_SOURCE_REGISTRY",
      JSON.stringify([source, secondSource])
    );
    seedPolicy(11, { sourceId: secondSource.sourceId });
    await expect(evaluateCrewDuty(tx, 1, proposed)).rejects.toThrow(
      "Exactly one effective"
    );
  });

  it("bounds policy history instead of silently selecting from a truncated set", async () => {
    fixture.sqlite.exec("DELETE FROM aviation_evidence");
    for (let id = 1; id <= 201; id++) seedPolicy(id);
    await expect(evaluateCrewDuty(tx, 1, proposed)).rejects.toThrow(
      "Narrow the operator policy history"
    );
  });

  it("locks operator, crew and flight before recording one assignment and rejects a duplicate", async () => {
    expect(await assignCrewWithRules(assignment)).toMatchObject({
      id: 1,
      flightNumber: "SYN001",
      role: "captain",
    });
    expect(fixture.rows(crewAssignments)[0]).toMatchObject({
      crewMemberId: 1,
      flightId: 1,
      ruleEvidenceId: 10,
      dutyStartTime: "2030-06-15 11:00:00.000",
      dutyEndTime: "2030-06-15 14:30:00.000",
    });
    const locks = fixture.queries.filter(query =>
      /for update$/i.test(query.sql)
    );
    expect(locks.map(query => query.sql.match(/from `([^`]+)`/)?.[1])).toEqual([
      "airlines",
      "crew_members",
      "flights",
    ]);
    expect(locks.every(query => query.inTransaction)).toBe(true);
    expect(state.operational).toHaveBeenCalledWith(expect.anything(), 101);
    expect(state.event).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        aggregateType: "crewAssignment",
        tenantId: 101,
        eventType: "crew.assignment_created",
      })
    );
    await expect(assignCrewWithRules(assignment)).rejects.toThrow(
      "already assigned"
    );
    expect(fixture.rows(crewAssignments)).toHaveLength(1);
    expect(state.event).toHaveBeenCalledTimes(1);
  });

  it("rolls the assignment back when its event cannot be recorded", async () => {
    state.event.mockRejectedValueOnce(
      new Error("Synthetic outbox unavailable")
    );
    await expect(assignCrewWithRules(assignment)).rejects.toThrow(
      "outbox unavailable"
    );
    expect(fixture.rows(crewAssignments)).toEqual([]);
  });

  it.each([
    { ...assignment, tenantId: 202 },
    { ...assignment, role: "first_officer" as const },
    { ...assignment, flightId: 404 },
    { ...assignment, crewMemberId: 404 },
  ])(
    "rejects an assignment outside the actual crew/flight/role scope",
    async input => {
      await expect(assignCrewWithRules(input)).rejects.toThrow();
      expect(fixture.rows(crewAssignments)).toEqual([]);
      expect(state.event).not.toHaveBeenCalled();
    }
  );

  it("authenticates an operator profile, records its receipt once and preserves replay identity", async () => {
    const envelope: EvidenceEnvelope = {
      sourceId: source.sourceId,
      eventId: "synthetic-ingest-receipt",
      issuedAt: new Date().toISOString(),
      observedAt: new Date().toISOString(),
      flightId: null,
      kind: "crew_rules",
      payload: rule,
    };
    const signature = createHmac("sha256", process.env[source.secretEnv]!)
      .update(calculateRequestHash(envelope))
      .digest("hex");
    const first = await ingestCrewRules(envelope, signature, 7, 101);
    expect(first.duplicate).toBe(false);
    expect(await ingestCrewRules(envelope, signature, 7, 101)).toEqual({
      evidenceId: first.evidenceId,
      duplicate: true,
    });
    expect(fixture.rows(aviationEvidence)).toHaveLength(2);
    expect(state.event).toHaveBeenCalledTimes(2);
    await expect(ingestCrewRules(envelope, signature, 7, 202)).rejects.toThrow(
      "operator scope"
    );
    await expect(
      ingestCrewRules(envelope, "0".repeat(64), 7, 101)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fixture.rows(aviationEvidence)).toHaveLength(2);
  });
});
