import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approveLoadPlan, finalizeLoadPlan } from "../services/dcs.service";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import {
  assignLoadSheetAircraft,
  loadSheetReview,
  evaluateLoadSheet,
  verifyCurrentLoadSheet,
} from "../services/load-sheet-lifecycle.service";

const actor = { userId: 9, tenantId: 3 };
const control = {
  status: "accepted",
  approvedAt: new Date("2025-01-01Z"),
  approvedBy: 10,
  effectiveFrom: new Date("2025-01-01Z"),
  effectiveTo: null,
  evidenceId: 1,
  airlineId: 2,
  aircraftTypeId: 5,
};
const envelope = ["zfw", "tow", "law"].flatMap(phase =>
  [30000, 70000].map(weightKg => ({
    phase,
    weightKg,
    forwardMacPercent: 0,
    aftMacPercent: 100,
  }))
);
const load = {
  trafficLoadKg: 8000,
  trafficIndex: 2,
  takeoffFuelKg: 10000,
  takeoffFuelIndex: 3,
  tripFuelKg: 5000,
  tripFuelIndex: 1,
};
const sheet = {
  flightId: 1,
  registrationId: 1,
  profileId: 6,
  expectedEdition: 0,
  load,
};
const swap = {
  flightId: 1,
  registrationId: 2,
  expectedRegistrationId: 1,
  reason: "Substitute aircraft after maintenance",
};
let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  vi.stubEnv("AIS_ENABLE_DEMOS", "true");
  vi.stubEnv(
    "AIS_LOAD_SHEET_DRAFT_KEY",
    "disposable-synthetic-load-sheet-key-01"
  );
  fixture = transactionMemory({
    flights: [
      {
        id: 1,
        tenantId: 3,
        airlineId: 2,
        status: "scheduled",
        aircraftType: "TEST",
        aircraftRegistrationId: 1,
      },
    ],
    aircraft_registrations: [1, 2].map(id => ({
      ...control,
      id,
      registration: `TEST-${id}`,
      dataVersion: "v1",
      dryOperatingWeightKg: id === 1 ? 40000 : 40500,
      dryOperatingIndex: 10,
    })),
    aircraft_balance_profiles: [
      {
        ...control,
        id: 6,
        version: "p1",
        referenceStationMm: 10000,
        lemacMm: 10000,
        macLengthMm: 4000,
        indexConstant: 0,
        indexCoefficient: 100000,
        maxLmcIndex: 1,
        maxLmcWeightKg: 500,
        envelope,
      },
    ],
    aircraft_types: [
      {
        id: 5,
        code: "TEST",
        name: "Fixture",
        active: true,
        maxZeroFuelWeight: 60000,
        maxTakeoffWeight: 70000,
        maxLandingWeight: 65000,
      },
    ],
  });
  boundary.db = fixture.db;
});
afterEach(() => vi.unstubAllEnvs());
describe("controlled load sheet editions", () => {
  it("invalidates signed editions on swap, records actor/reason and recalculates using the replacement tail", async () => {
    expect(await evaluateLoadSheet(sheet, actor)).toMatchObject({
      edition: 1,
      withinLimits: true,
      dispatchAcceptanceRequired: true,
    });
    const before = await verifyCurrentLoadSheet(
      { flightId: 1, edition: 1 },
      actor
    );
    await assignLoadSheetAircraft(swap, actor);
    await expect(
      verifyCurrentLoadSheet({ flightId: 1, edition: 1 }, actor)
    ).rejects.toThrow(/reevaluation/);
    const [old] = fixture.rows("load_sheet_documents");
    expect(old).toMatchObject({
      status: "superseded",
      digestSha256: before.digestSha256,
    });
    expect(fixture.rows("audit_logs")).toMatchObject([
      {
        userId: 9,
        changeDescription: swap.reason,
        previousValue: '{"registrationId":1,"edition":1}',
        newValue: '{"registrationId":2}',
      },
    ]);
    await expect(
      evaluateLoadSheet({ ...sheet, expectedEdition: 1 }, actor)
    ).rejects.toThrow(/changed/);
    expect(
      await evaluateLoadSheet(
        { ...sheet, registrationId: 2, expectedEdition: 1 },
        actor
      )
    ).toMatchObject({ edition: 2, withinLimits: true });
    expect(
      JSON.parse(fixture.rows("load_sheet_documents")[1].result.signedJson)
        .calculation.weights.zeroFuelWeightKg
    ).toBe(48500);
    const after = await verifyCurrentLoadSheet(
      { flightId: 1, edition: 2 },
      actor
    );
    expect(after.digestSha256).not.toBe(before.digestSha256);
    await assignLoadSheetAircraft(
      { ...swap, expectedRegistrationId: 2, registrationId: 1 },
      actor
    );
    await expect(
      verifyCurrentLoadSheet({ flightId: 1, edition: 1 }, actor)
    ).rejects.toThrow(/reevaluation/);
  });
  it("invalidates a previously approved simulated DCS plan and closes the legacy approval path", async () => {
    fixture.rows("flights")[0].aircraftRegistrationId = null;
    await fixture.db
      .insert((await import("../../drizzle/schema")).loadPlans)
      .values({ id: 8, flightId: 1, status: "calculated", withinLimits: true });
    await approveLoadPlan(8, 9);
    expect(fixture.rows("load_plans")[0].status).toBe("approved");
    await assignLoadSheetAircraft(
      { ...swap, expectedRegistrationId: null },
      actor
    );
    expect(fixture.rows("load_plans")[0]).toMatchObject({
      status: "draft",
      withinLimits: false,
    });
    await expect(approveLoadPlan(8, 9)).rejects.toThrow(
      /separate dispatch acceptance/
    );
    await expect(finalizeLoadPlan(8, 9)).rejects.toThrow(
      /separate dispatch acceptance/
    );
  });

  it("rejects a stale operator screen after a tail changes away and back, even without a new sheet edition", async () => {
    const before = await loadSheetReview(1, actor);
    await assignLoadSheetAircraft(swap, actor);
    await assignLoadSheetAircraft(
      { ...swap, registrationId: 1, expectedRegistrationId: 2 },
      actor
    );
    const after = await loadSheetReview(1, actor);
    expect(after.registrationId).toBe(before.registrationId);
    expect(after.edition).toBe(before.edition);
    expect(after.assignment?.userId).toBe(actor.userId);
    await expect(
      assignLoadSheetAircraft(
        {
          ...swap,
          expectedEdition: before.edition,
          expectedAssignmentEventId: null,
        },
        actor
      )
    ).rejects.toThrow(/changed/);
    await expect(
      evaluateLoadSheet({ ...sheet, expectedAssignmentEventId: null }, actor)
    ).rejects.toThrow(/changed/);
  });
  it("rolls back assignment and supersession together if audit insert fails", async () => {
    await evaluateLoadSheet(sheet, actor);
    fixture.failInsert("audit_logs");
    await expect(assignLoadSheetAircraft(swap, actor)).rejects.toThrow(
      /Injected/
    );
    expect(fixture.rows("flights")[0].aircraftRegistrationId).toBe(1);
    expect(fixture.rows("load_sheet_documents")[0].status).toBe("signed_draft");
  });
  it("rejects cross-tenant updates, stale editions and withdrawn controlled data", async () => {
    await expect(
      assignLoadSheetAircraft(swap, { ...actor, tenantId: 7 })
    ).rejects.toThrow(/not found/);
    await evaluateLoadSheet(sheet, actor);
    await expect(evaluateLoadSheet(sheet, actor)).rejects.toThrow(/changed/);
    fixture.rows("aircraft_balance_profiles")[0].status = "suspended";
    await expect(
      verifyCurrentLoadSheet({ flightId: 1, edition: 1 }, actor)
    ).rejects.toThrow(/currently accepted/);
  });
  it("persists an overweight replacement as a failed evaluation and denies verification", async () => {
    await evaluateLoadSheet(sheet, actor);
    await assignLoadSheetAircraft(swap, actor);
    const invalid = await evaluateLoadSheet(
      {
        ...sheet,
        registrationId: 2,
        expectedEdition: 1,
        load: { ...load, trafficLoadKg: 90000 },
      },
      actor
    );
    expect(invalid.withinLimits).toBe(false);
    await expect(
      verifyCurrentLoadSheet({ flightId: 1, edition: 2 }, actor)
    ).rejects.toThrow(/reevaluation/);
  });
  it("keeps production gated even with draft keys and the demo flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(evaluateLoadSheet(sheet, actor)).rejects.toThrow(
      /no verified production adapter/
    );
    expect(fixture.rows("load_sheet_documents")).toHaveLength(0);
  });
});
