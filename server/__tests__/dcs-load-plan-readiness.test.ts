import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import { authorityRelationalFixture } from "./helpers/authority-relational-fixture";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  approveLoadPlan,
  createLoadPlan,
  finalizeLoadPlan,
  getLoadPlan,
} from "../services/dcs.service";

// Executes the production aggregates and transactions on SQLite. It establishes
// local simulation readiness, not native lock behavior or dispatch acceptance.
let fixture: ReturnType<typeof authorityRelationalFixture>;
const input = { flightId: 11, aircraftTypeId: 1, fuelWeight: 1000 };
const plan = (id: number) =>
  fixture.rows(s.loadPlans).find(row => row.id === id)!;

beforeEach(() => {
  vi.stubEnv("AIS_ENABLE_DEMOS", "true");
  fixture = authorityRelationalFixture([
    s.flights,
    s.aircraftTypes,
    s.bookings,
    s.bookingSegments,
    s.passengers,
    s.baggageItems,
    s.baggageCustodyEvents,
    s.loadPlans,
  ]);
  state.db = fixture.db;
  fixture.insert(s.flights, {
    id: 11,
    tenantId: 1,
    airlineId: 1,
    status: "scheduled",
    aircraftType: "SYN",
    aircraftRegistrationId: null,
  });
  fixture.insert(s.aircraftTypes, {
    id: 1,
    code: "SYN",
    name: "Synthetic training aircraft",
    active: 1,
    operatingEmptyWeight: 10000,
    maxTakeoffWeight: 15000,
    maxLandingWeight: 14000,
    maxZeroFuelWeight: 13000,
    maxPayload: 3000,
    maxFuelCapacity: 2000,
    forwardCgLimit: "15",
    aftCgLimit: "35",
    cargoZones: '[{"zone":"FWD","maxWeight":2000}]',
  });
  fixture.insert(s.bookings, {
    id: 3,
    flightId: 11,
    tenantId: 1,
    userId: 7,
    status: "confirmed",
    paymentStatus: "paid",
    seatsReserved: 1,
    deletedAt: null,
  });
  fixture.insert(s.passengers, {
    id: 4,
    bookingId: 3,
    tenantId: 1,
    type: "adult",
  });
  fixture.insert(s.baggageItems, {
    id: 5,
    bookingId: 3,
    passengerId: 4,
    weight: 20,
    tagNumber: "0123000005",
    status: "checked_in",
  });
});
afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
});

describe("simulated DCS load-plan readiness", () => {
  it("approves and finalizes a current calculation without rewriting actors on replay", async () => {
    const created = await createLoadPlan(input);
    await approveLoadPlan(created.id, 9);
    const approved = { ...plan(created.id) };
    await approveLoadPlan(created.id, 10);
    expect(plan(created.id)).toEqual(approved);
    await finalizeLoadPlan(created.id, 9);
    const finalized = { ...plan(created.id) };
    await expect(finalizeLoadPlan(created.id, 10)).resolves.toEqual({
      success: true,
    });
    expect(plan(created.id)).toEqual(finalized);
    await expect(approveLoadPlan(created.id, 9)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(plan(created.id)).toEqual(finalized);
  });

  it.each(["passenger", "baggage"])(
    "rejects approval after a late %s change and permits a new calculation",
    async change => {
      const created = await createLoadPlan(input);
      const before = { ...plan(created.id) };
      if (change === "passenger")
        fixture.insert(s.passengers, {
          id: 6,
          bookingId: 3,
          tenantId: 1,
          type: "child",
        });
      else
        await fixture.db
          .update(s.baggageItems)
          .set({ weight: 30 })
          .where(eq(s.baggageItems.id, 5));
      await expect(approveLoadPlan(created.id, 9)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(plan(created.id)).toEqual(before);
      const updated = await createLoadPlan(input);
      expect(updated.id).not.toBe(created.id);
      await expect(approveLoadPlan(updated.id, 9)).resolves.toEqual({
        success: true,
      });
    }
  );

  it("rejects finalization after baggage changes following approval", async () => {
    const created = await createLoadPlan(input);
    await approveLoadPlan(created.id, 9);
    const before = { ...plan(created.id) };
    await fixture.db
      .update(s.baggageItems)
      .set({ weight: 30 })
      .where(eq(s.baggageItems.id, 5));
    await expect(finalizeLoadPlan(created.id, 9)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(plan(created.id)).toEqual(before);
  });

  it("rejects a formerly safe plan when current limits are exceeded", async () => {
    const created = await createLoadPlan(input);
    await fixture.db
      .update(s.aircraftTypes)
      .set({ maxTakeoffWeight: 10000 })
      .where(eq(s.aircraftTypes.id, 1));
    const before = { ...plan(created.id) };
    await expect(approveLoadPlan(created.id, 9)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(plan(created.id)).toEqual(before);
  });

  it("rejects superseded plans and chooses the latest ID when calculation times tie", async () => {
    const first = await createLoadPlan(input);
    await approveLoadPlan(first.id, 9);
    const second = await createLoadPlan({ ...input, fuelWeight: 900 });
    await fixture.db
      .update(s.loadPlans)
      .set({ createdAt: new Date("2030-11-20T12:00:00Z") })
      .where(eq(s.loadPlans.flightId, 11));
    expect((await getLoadPlan(11))?.id).toBe(second.id);
    await expect(approveLoadPlan(first.id, 9)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(finalizeLoadPlan(first.id, 9)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(approveLoadPlan(second.id, 9)).resolves.toEqual({
      success: true,
    });
  });

  it("counts the current sector manifest, including onward passengers and excluding removed primary legs", async () => {
    fixture.insert(s.flights, {
      id: 12,
      tenantId: 1,
      airlineId: 1,
      status: "scheduled",
      aircraftType: "SYN",
      aircraftRegistrationId: null,
    });
    fixture.insert(s.bookingSegments, {
      id: 30,
      bookingId: 3,
      flightId: 12,
      segmentOrder: 1,
      status: "confirmed",
      seatsReserved: 1,
    });
    const oldPrimary = await createLoadPlan(input);
    expect(oldPrimary.weights.passengers).toEqual({ count: 0, weight: 0 });
    const onward = await createLoadPlan({ ...input, flightId: 12 });
    expect(onward.weights.passengers).toEqual({ count: 1, weight: 84 });
  });

  it("keeps production disabled even when a safe demo plan and demo opt-in exist", async () => {
    const created = await createLoadPlan(input);
    vi.stubEnv("NODE_ENV", "production");
    const before = { ...plan(created.id) };
    await expect(approveLoadPlan(created.id, 9)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(finalizeLoadPlan(created.id, 9)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(plan(created.id)).toEqual(before);
  });

  it.each([-1, 0.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects unsupported fuel quantities (%s) without publishing a calculation",
    async fuelWeight => {
      await expect(
        createLoadPlan({ ...input, fuelWeight })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fixture.rows(s.loadPlans)).toHaveLength(0);
    }
  );
});
