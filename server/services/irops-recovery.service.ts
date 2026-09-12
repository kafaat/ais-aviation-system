import { requireValue } from "./required-value";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb } from "../db";
import {
  bookings,
  bookingSegments,
  bookingModifications,
  bookingAncillaries,
  flights,
  flightDisruptions,
  iropsActions,
  iropsRecoveryPlans,
  passengers,
  seatInventory,
  notifications,
  ndcOrders,
} from "../../drizzle/schema";
import { calculateRequestHash } from "./idempotency-v2.service";
import {
  solveRecovery,
  recoveryProblem,
  validateRecoverySolution,
} from "./recovery-solver";
import {
  assertNoCollectionReview,
  reserveSeats,
  restoreSeats,
  type SettlementTx,
} from "./booking-settlement.service";
import { countActiveHolds } from "./inventory-capacity.service";
import { assertBaggageNotInCustody } from "./baggage-custody.service";
import { recordReaccommodation } from "./irops.service";
import { assertTenantOperational } from "./tenant.service";
import { recordEvent } from "./outbox.service";
import { storedJson } from "./booking-invoice.service";
export const recoveryInput = z.object({
  eventId: z.number().int().positive(),
  bookingIds: z.array(z.number().int().positive()).min(1).max(20),
  candidateFlightIds: z.array(z.number().int().positive()).min(1).max(8),
});
const savedPlan = z.object({
  input: recoveryInput,
  problem: recoveryProblem,
  snapshot: z.string(),
  choices: z.array(
    z.object({ bookingId: z.number().int(), key: z.string().nullable() })
  ),
  optimal: z.boolean(),
  gap: z.number().nullable(),
  unassignedPassengers: z.number().int(),
  passengerDelayMinutes: z.number().int(),
});
async function readInputs(
  tx: SettlementTx,
  input: z.infer<typeof recoveryInput>,
  tenantId: number | null
) {
  const [event] = await tx
    .select()
    .from(flightDisruptions)
    .where(eq(flightDisruptions.id, input.eventId))
    .for("update");
  if (!event || event.status === "resolved")
    throw new Error("Active disruption required");
  const groups = [];
  const original = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, event.flightId))
    .limit(1);
  if (!original[0] || (tenantId !== null && original[0].tenantId !== tenantId))
    throw new Error("Disruption outside tenant");
  const flightIds = new Set([event.flightId, ...input.candidateFlightIds]);
  const records = [];
  for (const id of [...new Set(input.bookingIds)].sort((a, b) => a - b)) {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, id))
      .for("update");
    if (
      !booking ||
      booking.tenantId !== original[0].tenantId ||
      booking.status !== "confirmed" ||
      booking.paymentStatus !== "paid" ||
      !booking.seatsReserved ||
      booking.checkedIn
    )
      throw new Error("Recovery requires a paid reservation before check-in");
    await assertTenantOperational(tx, booking.tenantId);
    await assertNoCollectionReview(tx, booking.id);
    await assertBaggageNotInCustody(tx, booking.id);
    const [pending] = await tx
      .select()
      .from(bookingModifications)
      .where(
        and(
          eq(bookingModifications.bookingId, id),
          eq(bookingModifications.status, "pending")
        )
      )
      .limit(1);
    const [ancillary] = await tx
      .select()
      .from(bookingAncillaries)
      .where(
        and(
          eq(bookingAncillaries.bookingId, id),
          ne(bookingAncillaries.status, "cancelled")
        )
      )
      .limit(1);
    if (pending || ancillary)
      throw new Error(
        "Resolve pending servicing or ancillary rerouting before recovery"
      );
    const segments = await tx
      .select()
      .from(bookingSegments)
      .where(eq(bookingSegments.bookingId, id))
      .orderBy(asc(bookingSegments.segmentOrder));
    const legs = segments.length
      ? segments.map(s => s.flightId)
      : [booking.flightId];
    if (
      legs.filter(f => f === event.flightId).length !== 1 ||
      segments.some(s => !s.seatsReserved || s.status !== "confirmed")
    )
      throw new Error("Affected itinerary reservation is inconsistent");
    const actions = await tx
      .select()
      .from(iropsActions)
      .where(
        and(
          eq(iropsActions.eventId, event.id),
          eq(iropsActions.actionType, "rebook"),
          ne(iropsActions.status, "completed")
        )
      );
    if (!actions.some(a => a.details.bookingId === id))
      throw new Error("Plan passenger protection before solving recovery");
    for (const f of legs) flightIds.add(f);
    records.push({ booking, segments, legs });
  }
  const locked = [];
  for (const id of [...flightIds].sort((a, b) => a - b)) {
    const [f] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, id))
      .for("update");
    if (!f) throw new Error("Recovery flight unavailable");
    locked.push(f);
  }
  const capacities: Record<string, number> = {};
  for (const f of locked.filter(f => input.candidateFlightIds.includes(f.id)))
    for (const cabin of ["economy", "business"] as const)
      capacities[`${f.id}:${cabin}`] = Math.max(
        0,
        (cabin === "business" ? f.businessAvailable : f.economyAvailable) -
          (await countActiveHolds(tx, f.id, cabin))
      );
  const old = requireValue(locked.find(f => f.id === event.flightId));
  for (const r of records) {
    const idx = r.legs.indexOf(old.id),
      prev = locked.find(f => f.id === r.legs[idx - 1]),
      next = locked.find(f => f.id === r.legs[idx + 1]);
    const candidates = locked
      .filter(
        f =>
          input.candidateFlightIds.includes(f.id) &&
          f.id !== old.id &&
          !r.legs.includes(f.id) &&
          f.tenantId === old.tenantId &&
          f.airlineId === old.airlineId &&
          f.originId === old.originId &&
          f.destinationId === old.destinationId &&
          ["scheduled", "delayed"].includes(f.status) &&
          f.departureTime.getTime() > Date.now() + 30 * 60000 &&
          f.departureTime.getTime() <
            old.departureTime.getTime() + 48 * 3600000 &&
          f.arrivalTime > f.departureTime &&
          (!prev ||
            f.departureTime.getTime() - prev.arrivalTime.getTime() >=
              45 * 60000) &&
          (!next ||
            next.departureTime.getTime() - f.arrivalTime.getTime() >=
              45 * 60000)
      )
      .map(f => ({
        key: `${f.id}:${r.booking.cabinClass}`,
        delayMinutes: Math.max(
          0,
          Math.ceil(
            (f.arrivalTime.getTime() - old.arrivalTime.getTime()) / 60000
          )
        ),
      }));
    groups.push({
      bookingId: r.booking.id,
      passengers: r.booking.numberOfPassengers,
      candidates,
    });
  }
  // Availability can improve without invalidating approval; inventory is rechecked atomically at execution.
  const snapshot = calculateRequestHash({
    eventId: event.id,
    status: event.status,
    records: records.map(r => ({ booking: r.booking, segments: r.segments })),
    flights: locked.map(
      ({ economyAvailable: _e, businessAvailable: _b, updatedAt: _u, ...f }) =>
        f
    ),
  });
  return {
    event,
    records,
    locked,
    problem: { groups, capacities },
    snapshot,
    tenantId: old.tenantId,
  };
}
export async function proposeRecovery(
  raw: z.infer<typeof recoveryInput>,
  tenantId: number | null
) {
  const input = recoveryInput.parse(raw),
    db = await getDb();
  if (!db) throw new Error("Recovery storage unavailable");
  return db.transaction(async tx => {
    const state = await readInputs(tx, input, tenantId),
      solution = solveRecovery(state.problem),
      id = randomUUID(),
      expiresAt = new Date(Date.now() + 10 * 60000);
    const payload = {
      input,
      problem: state.problem,
      snapshot: state.snapshot,
      ...solution,
    };
    const digest = calculateRequestHash(payload);
    await tx.insert(iropsRecoveryPlans).values({
      id,
      eventId: input.eventId,
      tenantId: state.tenantId,
      payload,
      digest,
      expiresAt,
    });
    await recordEvent(tx, {
      aggregateType: "recoveryPlan",
      aggregateId: id,
      tenantId: state.tenantId,
      eventType: "irops.recovery_proposed",
      payload: { digest, ...solution },
    });
    return { id, digest, expiresAt, ...solution };
  });
}
export async function approveRecovery(
  id: string,
  digest: string,
  actorId: number,
  tenantId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Recovery storage unavailable");
  return db.transaction(async tx => {
    const [plan] = await tx
      .select()
      .from(iropsRecoveryPlans)
      .where(eq(iropsRecoveryPlans.id, id))
      .for("update");
    if (
      !plan ||
      (tenantId !== null && plan.tenantId !== tenantId) ||
      plan.digest !== digest ||
      calculateRequestHash(plan.payload) !== digest ||
      plan.expiresAt <= new Date() ||
      plan.status === "executed"
    )
      throw new Error("Recovery approval is stale or outside scope");
    await tx
      .update(iropsRecoveryPlans)
      .set({ status: "approved", approvedBy: actorId })
      .where(eq(iropsRecoveryPlans.id, id));
    await recordEvent(tx, {
      aggregateType: "recoveryPlan",
      aggregateId: id,
      tenantId: plan.tenantId,
      eventType: "irops.recovery_approved",
      payload: { actorId, digest },
    });
    return { id, digest };
  });
}
export async function executeRecovery(
  id: string,
  digest: string,
  actorId: number,
  tenantId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Recovery storage unavailable");
  return db.transaction(async tx => {
    const [plan] = await tx
      .select()
      .from(iropsRecoveryPlans)
      .where(eq(iropsRecoveryPlans.id, id))
      .for("update");
    if (
      !plan ||
      (tenantId !== null && plan.tenantId !== tenantId) ||
      plan.digest !== digest ||
      calculateRequestHash(plan.payload) !== digest
    )
      throw new Error("Recovery digest or tenant mismatch");
    if (plan.status === "executed" && plan.executionEventId)
      return { receiptId: plan.executionEventId };
    if (
      plan.status !== "approved" ||
      !plan.approvedBy ||
      plan.expiresAt <= new Date()
    )
      throw new Error("Effective human approval required");
    const saved = savedPlan.parse(plan.payload),
      state = await readInputs(tx, saved.input, tenantId);
    if (state.snapshot !== saved.snapshot)
      throw new Error(
        "Booking or schedule changed; propose a new recovery plan"
      );
    validateRecoverySolution(state.problem, saved.choices);
    for (const choice of saved.choices) {
      if (choice.key === null) continue;
      const r = requireValue(
        state.records.find(r => r.booking.id === choice.bookingId)
      );
      const newId = Number(choice.key.split(":")[0]),
        target = requireValue(state.locked.find(f => f.id === newId));
      await reserveSeats(
        tx,
        newId,
        r.booking.cabinClass,
        r.booking.numberOfPassengers
      );
      await restoreSeats(
        tx,
        state.event.flightId,
        r.booking.cabinClass,
        r.booking.numberOfPassengers
      );
      if (r.segments.length)
        await tx
          .update(bookingSegments)
          .set({
            flightId: newId,
            departureDate: target.departureTime,
            inventoryLockId: null,
          })
          .where(
            and(
              eq(bookingSegments.bookingId, r.booking.id),
              eq(bookingSegments.flightId, state.event.flightId)
            )
          );
      if (r.booking.flightId === state.event.flightId)
        await tx
          .update(bookings)
          .set({ flightId: newId, inventoryLockId: null })
          .where(eq(bookings.id, r.booking.id));
      await tx
        .update(seatInventory)
        .set({
          bookingId: null,
          passengerId: null,
          status: "available",
          assignedAt: null,
          checkedInAt: null,
          boardingPassIssued: false,
        })
        .where(
          and(
            eq(seatInventory.bookingId, r.booking.id),
            eq(seatInventory.flightId, state.event.flightId)
          )
        );
      await tx
        .update(passengers)
        .set({ seatNumber: null, ticketNumber: null })
        .where(eq(passengers.bookingId, r.booking.id));
      const orders = await tx
        .select()
        .from(ndcOrders)
        .where(eq(ndcOrders.bookingId, r.booking.id))
        .for("update");
      for (const order of orders) {
        const payload = storedJson<Record<string, unknown>>(
          order.orderPayload,
          {}
        );
        payload.segments = r.legs.map(f => {
          const flight = requireValue(
            state.locked.find(
              x => x.id === (f === state.event.flightId ? newId : f)
            )
          );
          return {
            flightId: flight.id,
            flightNumber: flight.flightNumber,
            originId: flight.originId,
            destinationId: flight.destinationId,
            departureTime: flight.departureTime.toISOString(),
            arrivalTime: flight.arrivalTime.toISOString(),
            cabinClass: r.booking.cabinClass,
          };
        });
        payload.fulfillment = "awaiting_ticket_reissue";
        await tx
          .update(ndcOrders)
          .set({
            orderPayload: JSON.stringify(payload),
            lastServicingAction: "InvoluntaryRecovery",
          })
          .where(eq(ndcOrders.id, order.id));
      }
      const actions = await tx
        .select()
        .from(iropsActions)
        .where(
          and(
            eq(iropsActions.eventId, state.event.id),
            ne(iropsActions.status, "completed")
          )
        )
        .for("update");
      for (const action of actions.filter(
        a => a.details.bookingId === r.booking.id
      )) {
        if (action.actionType === "rebook")
          await recordReaccommodation(tx, action.id, r.booking.id);
        if (action.actionType === "notification") {
          const [notice] = await tx.insert(notifications).values({
            userId: r.booking.userId,
            type: "flight",
            title: "تم تعديل الرحلة بسبب اضطراب تشغيلي",
            message: `تم نقل الحجز إلى الرحلة ${target.flightNumber}. مستند السفر يحتاج إعادة إصدار.`,
            data: JSON.stringify({ bookingId: r.booking.id, planId: id }),
          });
          await tx
            .update(iropsActions)
            .set({
              status: "completed",
              evidenceType: "in_app_notification",
              evidenceId: String(notice.insertId),
              completedAt: new Date(),
            })
            .where(eq(iropsActions.id, action.id));
        }
      }
    }
    const receiptId = await recordEvent(tx, {
      aggregateType: "recoveryPlan",
      aggregateId: id,
      tenantId: plan.tenantId,
      eventType: "irops.recovery_executed",
      payload: {
        actorId,
        digest,
        choices: saved.choices,
        unassignedPassengers: saved.unassignedPassengers,
        fulfillment: "awaiting_ticket_reissue",
      },
    });
    await tx
      .update(iropsRecoveryPlans)
      .set({ status: "executed", executionEventId: receiptId })
      .where(eq(iropsRecoveryPlans.id, id));
    return { receiptId };
  });
}
