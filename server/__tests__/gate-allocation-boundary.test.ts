import { beforeEach, describe, expect, it } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import { airportGates } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  allocateGate,
  allocationWindow,
  changeGateStatus,
  configureGateCompatibility,
  invalidateGateAssignments,
  releaseFlightGate,
  windowsConflict,
} from "../services/gate-allocation.service";

const departure = new Date("2035-01-01T10:00:00Z");
const actor = { userId: 9, tenantId: 3, platformAdmin: false };
let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    flights: [
      {
        id: 1,
        tenantId: 3,
        originId: 10,
        destinationId: 11,
        status: "scheduled",
        aircraftType: "A320",
        departureTime: departure,
      },
    ],
    airport_gates: [1, 2].map(id => ({
      id,
      airportId: 10,
      gateNumber: `G${id}`,
      type: "both",
      status: "available",
      compatibleAircraftTypes: ["A320"],
      compatibilityEvidence: "operator-approval-fixture",
    })),
  });
});
const assign = (more = {}) =>
  fixture.db.transaction((tx: any) =>
    allocateGate(tx, { flightId: 1, gateId: 1, actor, ...more })
  );

describe("canonical gate allocation", () => {
  it("persists the resource window and event atomically", async () => {
    await assign();
    expect(fixture.rows("gate_assignments")[0]).toMatchObject({
      assignedBy: 9,
      occupiedFrom: new Date("2035-01-01T08:00:00Z"),
      occupiedUntil: new Date("2035-01-01T12:00:00Z"),
    });
    expect(fixture.rows("airport_gates")[0].status).toBe("occupied");
    expect(fixture.rows("outbox")[0]).toMatchObject({
      eventType: "gate.assigned",
      tenantId: 3,
    });
  });
  it("rejects a foreign tenant before any write", async () => {
    await expect(assign({ actor: { ...actor, tenantId: 4 } })).rejects.toThrow(
      "tenant"
    );
    expect(fixture.rows("gate_assignments")).toHaveLength(0);
  });
  it.each([
    [{ airportId: 99 }, "departure airport"],
    [{ status: "maintenance" }, "maintenance"],
    [{ compatibleAircraftTypes: ["B777"] }, "compatibility"],
    [{ compatibilityEvidence: null }, "compatibility"],
  ])("rejects invalid gate configuration %j", async (change, message) => {
    await fixture.db
      .update(airportGates)
      .set(change)
      .where(eq(airportGates.id, 1));
    await expect(assign()).rejects.toThrow(message);
    expect(fixture.rows("outbox")).toHaveLength(0);
  });
  it("rolls back allocation and gate status if outbox insertion fails", async () => {
    fixture.failInsert("outbox");
    await expect(assign()).rejects.toThrow("Injected");
    expect(fixture.rows("gate_assignments")).toHaveLength(0);
    expect(fixture.rows("airport_gates")[0].status).toBe("available");
  });
  it("changes gates and then releases without partial writes", async () => {
    await assign();
    await assign({ replace: true, gateId: 2 });
    expect(fixture.rows("gate_assignments").map(a => a.status)).toEqual([
      "changed",
      "assigned",
    ]);
    expect(fixture.rows("airport_gates").map(g => g.status)).toEqual([
      "available",
      "occupied",
    ]);
    await fixture.db.transaction((tx: any) => releaseFlightGate(tx, 1, actor));
    expect(
      fixture.rows("airport_gates").every(g => g.status === "available")
    ).toBe(true);
  });
  it("invalidates the old gate on a flight schedule change", async () => {
    await assign();
    await fixture.db.transaction((tx: any) =>
      invalidateGateAssignments(tx, { id: 1, tenantId: 3 }, "schedule changed")
    );
    expect(fixture.rows("gate_assignments")[0].status).toBe("cancelled");
    expect(fixture.rows("outbox").at(-1)).toMatchObject({
      eventType: "gate.released",
      payload: { reason: "schedule changed" },
    });
  });
  it("does not allow maintenance or policy changes around an active reservation", async () => {
    await assign();
    await expect(
      fixture.db.transaction((tx: any) =>
        changeGateStatus(tx, 1, "maintenance")
      )
    ).rejects.toThrow("Release active");
    await expect(
      fixture.db.transaction((tx: any) =>
        configureGateCompatibility(tx, 1, ["B777"], "new approval")
      )
    ).rejects.toThrow("Release reservations");
  });
  it("uses half-open windows and blocks unknown legacy intervals", () => {
    const a = allocationWindow(departure);
    expect(
      windowsConflict(a, {
        occupiedFrom: a.occupiedUntil,
        occupiedUntil: new Date(a.occupiedUntil.getTime() + 1000),
      })
    ).toBe(false);
    expect(
      windowsConflict({ occupiedFrom: null, occupiedUntil: null }, a)
    ).toBe(true);
    expect(() =>
      allocationWindow(departure, {
        boardingStartTime: new Date("2035-01-01T15:00:00Z"),
      })
    ).toThrow("outside");
  });
});
