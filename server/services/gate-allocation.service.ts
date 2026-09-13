/** The sole gate allocation writer. Lock order: flight -> sorted gates -> assignments. */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  airportGates,
  airports,
  flights,
  gateAssignments,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";

export interface GateActor {
  userId: number;
  tenantId: number | null;
  platformAdmin: boolean;
}
export interface GateWindow {
  occupiedFrom: Date;
  occupiedUntil: Date;
}
const active = () => inArray(gateAssignments.status, ["assigned", "boarding"]);
function reject(
  message: string,
  code:
    | "CONFLICT"
    | "BAD_REQUEST"
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "PRECONDITION_FAILED" = "CONFLICT"
): never {
  throw new TRPCError({ code, message });
}

export function allocationWindow(
  departure: Date,
  input: Partial<GateWindow> & {
    boardingStartTime?: Date | null;
    boardingEndTime?: Date | null;
  } = {}
): GateWindow {
  // Conservative planning default; operators can supply an explicit reviewed window.
  const occupiedFrom =
    input.occupiedFrom ?? new Date(departure.getTime() - 2 * 3600_000);
  const occupiedUntil =
    input.occupiedUntil ?? new Date(departure.getTime() + 2 * 3600_000);
  if (
    ![departure, occupiedFrom, occupiedUntil].every(d =>
      Number.isFinite(d.getTime())
    ) ||
    occupiedFrom > departure ||
    occupiedUntil <= departure ||
    occupiedUntil.getTime() - occupiedFrom.getTime() > 24 * 3600_000
  )
    reject(
      "Gate occupancy must cover departure and last at most 24 hours",
      "BAD_REQUEST"
    );
  for (const time of [input.boardingStartTime, input.boardingEndTime])
    if (
      time &&
      (!Number.isFinite(time.getTime()) ||
        time < occupiedFrom ||
        time >= occupiedUntil)
    )
      reject("Boarding time is outside the gate reservation", "BAD_REQUEST");
  if (
    input.boardingStartTime &&
    input.boardingEndTime &&
    input.boardingStartTime >= input.boardingEndTime
  )
    reject("Boarding must end after it starts", "BAD_REQUEST");
  return { occupiedFrom, occupiedUntil };
}

export function windowsConflict(
  a: { occupiedFrom: Date | null; occupiedUntil: Date | null },
  b: GateWindow
) {
  return (
    !a.occupiedFrom ||
    !a.occupiedUntil ||
    (a.occupiedFrom < b.occupiedUntil && a.occupiedUntil > b.occupiedFrom)
  );
}

async function lockFlight(
  tx: SettlementTx,
  flightId: number,
  actor: GateActor
) {
  if (!actor || !Number.isSafeInteger(actor.userId) || actor.userId <= 0)
    reject("An authenticated gate operator is required", "FORBIDDEN");
  const [flight] = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1)
    .for("update");
  if (!flight) return reject("Flight not found", "NOT_FOUND");
  if (
    !actor.platformAdmin &&
    (actor.tenantId == null || flight.tenantId !== actor.tenantId)
  )
    reject("Flight is outside the operator's tenant", "FORBIDDEN");
  return flight;
}

async function lockGates(tx: SettlementTx, ids: number[]) {
  const result = new Map<number, typeof airportGates.$inferSelect>();
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const [gate] = await tx
      .select()
      .from(airportGates)
      .where(eq(airportGates.id, id))
      .limit(1)
      .for("update");
    if (!gate) return reject("Gate not found", "NOT_FOUND");
    result.set(id, gate);
  }
  return result;
}

async function syncGateStatus(tx: SettlementTx, gateId: number) {
  const [gate] = await tx
    .select()
    .from(airportGates)
    .where(eq(airportGates.id, gateId))
    .limit(1)
    .for("update");
  if (!gate || gate.status === "maintenance") return;
  const [assignment] = await tx
    .select({ id: gateAssignments.id })
    .from(gateAssignments)
    .where(and(eq(gateAssignments.gateId, gateId), active()))
    .limit(1)
    .for("update");
  await tx
    .update(airportGates)
    .set({
      status: assignment ? "occupied" : "available",
      updatedAt: new Date(),
    })
    .where(eq(airportGates.id, gateId));
}

async function assertCompatible(
  tx: SettlementTx,
  gate: typeof airportGates.$inferSelect,
  flight: typeof flights.$inferSelect
) {
  if (gate.airportId !== flight.originId)
    reject("Gate is not at the flight's departure airport", "BAD_REQUEST");
  if (gate.status === "maintenance")
    reject("Gate is under maintenance", "PRECONDITION_FAILED");
  if (["cancelled", "completed"].includes(flight.status))
    reject("Flight is not open for gate assignment", "BAD_REQUEST");
  if (
    !gate.compatibilityEvidence?.trim() ||
    !flight.aircraftType ||
    !gate.compatibleAircraftTypes?.some(
      t => t.trim().toUpperCase() === flight.aircraftType?.trim().toUpperCase()
    )
  )
    reject(
      "Operator-approved gate/aircraft compatibility is required",
      "PRECONDITION_FAILED"
    );
  if (gate.type !== "both") {
    const ends = await tx
      .select()
      .from(airports)
      .where(inArray(airports.id, [flight.originId, flight.destinationId]));
    const origin = ends.find(a => a.id === flight.originId);
    const destination = ends.find(a => a.id === flight.destinationId);
    if (!origin || !destination)
      reject("Flight airport data is incomplete", "PRECONDITION_FAILED");
    const type =
      origin.country === destination.country ? "domestic" : "international";
    if (gate.type !== type)
      reject("Gate does not support this flight type", "BAD_REQUEST");
  }
}

export async function allocateGate(
  tx: SettlementTx,
  input: {
    flightId: number;
    gateId: number;
    actor: GateActor;
    replace?: boolean;
    changeReason?: string;
    boardingStartTime?: Date;
    boardingEndTime?: Date;
    occupiedFrom?: Date;
    occupiedUntil?: Date;
  }
) {
  const flight = await lockFlight(tx, input.flightId, input.actor);
  const hints = await tx
    .select()
    .from(gateAssignments)
    .where(and(eq(gateAssignments.flightId, flight.id), active()));
  if (hints.length > 1)
    reject(
      "Multiple legacy assignments require explicit release before reassignment"
    );
  const current = hints[0];
  if (input.replace && !current)
    reject("No active gate assignment found for this flight", "NOT_FOUND");
  if (!input.replace && current)
    reject("Flight already has an active gate assignment");
  const locked = await lockGates(tx, [
    input.gateId,
    ...hints.map(a => a.gateId),
  ]);
  const gate = locked.get(input.gateId);
  if (!gate) return reject("Gate not found", "NOT_FOUND");
  await assertCompatible(tx, gate, flight);
  const times = {
    boardingStartTime:
      input.boardingStartTime ?? current?.boardingStartTime ?? null,
    boardingEndTime: input.boardingEndTime ?? current?.boardingEndTime ?? null,
  };
  const window = allocationWindow(flight.departureTime, {
    ...times,
    occupiedFrom: input.occupiedFrom ?? current?.occupiedFrom ?? undefined,
    occupiedUntil: input.occupiedUntil ?? current?.occupiedUntil ?? undefined,
  });
  const reservations = await tx
    .select()
    .from(gateAssignments)
    .where(and(eq(gateAssignments.gateId, gate.id), active()))
    .for("update");
  if (
    reservations.some(
      a => a.flightId !== flight.id && windowsConflict(a, window)
    )
  )
    reject("Gate is reserved for an overlapping flight");
  if (gate.status === "occupied" && !reservations.length)
    reject(
      "Unexplained gate occupancy requires operator review",
      "PRECONDITION_FAILED"
    );
  if (current)
    await tx
      .update(gateAssignments)
      .set({ status: "changed", updatedAt: new Date() })
      .where(eq(gateAssignments.id, current.id));
  const [insert] = await tx.insert(gateAssignments).values({
    flightId: flight.id,
    gateId: gate.id,
    ...times,
    ...window,
    assignedBy: input.actor.userId,
    status: "assigned",
    previousGateId: current?.gateId ?? null,
    changeReason: input.changeReason ?? null,
  });
  for (const id of locked.keys()) await syncGateStatus(tx, id);
  await recordEvent(tx, {
    aggregateType: "flight",
    aggregateId: flight.id,
    tenantId: flight.tenantId,
    eventType: current ? "gate.changed" : "gate.assigned",
    payload: {
      flightId: flight.id,
      assignmentId: insert.insertId,
      gateId: gate.id,
      gateNumber: gate.gateNumber,
      previousGateId: current?.gateId ?? null,
      actorId: input.actor.userId,
      occupiedFrom: window.occupiedFrom.toISOString(),
      occupiedUntil: window.occupiedUntil.toISOString(),
    },
  });
  return {
    id: insert.insertId,
    flightId: flight.id,
    gateId: gate.id,
    gateNumber: gate.gateNumber,
    terminal: gate.terminal,
    newGateId: gate.id,
    oldGateId: current?.gateId ?? gate.id,
    newGateNumber: gate.gateNumber,
    newTerminal: gate.terminal,
  };
}

/** Caller holds the flight lock. Schedule changes invalidate the old reservation atomically. */
export async function invalidateGateAssignments(
  tx: SettlementTx,
  flight: Pick<typeof flights.$inferSelect, "id" | "tenantId">,
  reason: string,
  status: "cancelled" | "departed" = "cancelled"
) {
  const hints = await tx
    .select()
    .from(gateAssignments)
    .where(and(eq(gateAssignments.flightId, flight.id), active()));
  if (!hints.length) return;
  const gates = await lockGates(
    tx,
    hints.map(a => a.gateId)
  );
  await tx
    .update(gateAssignments)
    .set({ status, changeReason: reason, updatedAt: new Date() })
    .where(and(eq(gateAssignments.flightId, flight.id), active()));
  for (const id of gates.keys()) await syncGateStatus(tx, id);
  await recordEvent(tx, {
    aggregateType: "flight",
    aggregateId: flight.id,
    tenantId: flight.tenantId,
    eventType: "gate.released",
    payload: {
      flightId: flight.id,
      reason,
      gateIds: [...gates.keys()],
      status,
    },
  });
}

export async function releaseFlightGate(
  tx: SettlementTx,
  flightId: number,
  actor: GateActor
) {
  const flight = await lockFlight(tx, flightId, actor);
  await invalidateGateAssignments(
    tx,
    flight,
    "Operator released gate",
    "departed"
  );
  return { success: true };
}

export async function changeGateStatus(
  tx: SettlementTx,
  gateId: number,
  status: "available" | "occupied" | "maintenance"
) {
  await lockGates(tx, [gateId]);
  const [assignment] = await tx
    .select({ id: gateAssignments.id })
    .from(gateAssignments)
    .where(and(eq(gateAssignments.gateId, gateId), active()))
    .limit(1)
    .for("update");
  if (assignment && status !== "occupied")
    reject("Release active reservations before changing gate status");
  if (!assignment && status === "occupied")
    reject("Gate occupancy is derived from active reservations", "BAD_REQUEST");
  await tx
    .update(airportGates)
    .set({ status, updatedAt: new Date() })
    .where(eq(airportGates.id, gateId));
  return { success: true };
}

export async function configureGateCompatibility(
  tx: SettlementTx,
  gateId: number,
  types: string[],
  evidence: string
) {
  if (
    !types.length ||
    types.length > 100 ||
    types.some(t => !t.trim() || t.length > 50) ||
    !evidence.trim() ||
    evidence.length > 255
  )
    reject(
      "Aircraft identifiers and approval evidence are required",
      "BAD_REQUEST"
    );
  await lockGates(tx, [gateId]);
  const [assignment] = await tx
    .select({ id: gateAssignments.id })
    .from(gateAssignments)
    .where(and(eq(gateAssignments.gateId, gateId), active()))
    .limit(1)
    .for("update");
  if (assignment) reject("Release reservations before changing compatibility");
  await tx
    .update(airportGates)
    .set({
      compatibleAircraftTypes: [...new Set(types.map(t => t.trim()))],
      compatibilityEvidence: evidence.trim(),
      updatedAt: new Date(),
    })
    .where(eq(airportGates.id, gateId));
  return { success: true };
}

export async function removeGate(tx: SettlementTx, gateId: number) {
  await lockGates(tx, [gateId]);
  const [history] = await tx
    .select({ id: gateAssignments.id })
    .from(gateAssignments)
    .where(eq(gateAssignments.gateId, gateId))
    .limit(1)
    .for("update");
  if (history)
    reject(
      "Gate has assignment history; use maintenance instead of deleting it"
    );
  await tx.delete(airportGates).where(eq(airportGates.id, gateId));
  return { success: true };
}

export async function availableGates(
  tx: SettlementTx,
  airportId: number,
  departure: Date,
  flightType?: "domestic" | "international"
) {
  const window = allocationWindow(departure);
  const gates = await tx
    .select()
    .from(airportGates)
    .where(eq(airportGates.airportId, airportId))
    .orderBy(asc(airportGates.gateNumber));
  if (!gates.length) return [];
  const assignments = await tx
    .select()
    .from(gateAssignments)
    .where(
      and(
        inArray(
          gateAssignments.gateId,
          gates.map(g => g.id)
        ),
        active()
      )
    );
  return gates
    .filter(
      g =>
        g.status !== "maintenance" &&
        g.compatibilityEvidence &&
        g.compatibleAircraftTypes?.length &&
        (!flightType || g.type === "both" || g.type === flightType) &&
        !(
          g.status === "occupied" && !assignments.some(a => a.gateId === g.id)
        ) &&
        !assignments.some(a => a.gateId === g.id && windowsConflict(a, window))
    )
    .map(g => ({
      ...g,
      amenities: g.amenities ? JSON.parse(g.amenities) : [],
    }));
}
