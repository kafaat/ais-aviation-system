import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookings,
  airlines,
  flights,
  flightStatusHistory,
  flightDisruptions,
  crewAssignments,
  aircraftRotations,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";
export type FlightStatus = typeof flights.$inferSelect.status;
const transitions: Record<FlightStatus, FlightStatus[]> = {
  scheduled: ["delayed", "cancelled", "completed"],
  delayed: ["scheduled", "cancelled", "completed"],
  cancelled: [],
  completed: [],
};
/** Current segment membership takes precedence over a historical primary flight. */
export function flightBookingCondition(flightId: number) {
  return sql`((NOT EXISTS (SELECT 1 FROM booking_segments bs WHERE bs.bookingId = ${bookings.id}) AND ${bookings.flightId} = ${flightId}) OR EXISTS (SELECT 1 FROM booking_segments bs WHERE bs.bookingId = ${bookings.id} AND bs.flightId = ${flightId} AND bs.status IN ('pending','confirmed'))) `;
}
export async function transitionFlight(
  tx: SettlementTx,
  update: {
    flightId: number;
    status: FlightStatus;
    delayMinutes?: number;
    reason?: string;
    adminUserId?: number;
    newDepartureTime?: Date;
    newArrivalTime?: Date;
    disruptionId?: number;
  }
) {
  const [hint] = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, update.flightId));
  if (!hint) throw new Error("Flight not found");
  await tx
    .select()
    .from(airlines)
    .where(eq(airlines.id, hint.airlineId))
    .for("update");
  const [flight] = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, update.flightId))
    .for("update");
  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  if (
    update.delayMinutes !== undefined &&
    (!Number.isSafeInteger(update.delayMinutes) || update.delayMinutes < 0)
  )
    throw new Error("Delay minutes must be a nonnegative integer");
  const departureTime = update.newDepartureTime ?? flight.departureTime;
  // A delay shifts the planned arrival by the same duration unless an explicit
  // revised arrival is supplied. Actual movement evidence remains separate.
  const arrivalTime =
    update.newArrivalTime ??
    new Date(
      flight.arrivalTime.getTime() +
        departureTime.getTime() -
        flight.departureTime.getTime()
    );
  if (
    !Number.isFinite(departureTime.getTime()) ||
    !Number.isFinite(arrivalTime.getTime()) ||
    arrivalTime <= departureTime ||
    (update.newDepartureTime && departureTime <= new Date())
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid flight schedule: arrival must follow departure",
    });
  const scheduleChanged =
    departureTime.getTime() !== flight.departureTime.getTime() ||
    arrivalTime.getTime() !== flight.arrivalTime.getTime();
  const changed = update.status !== flight.status || scheduleChanged;
  if (
    (update.status !== flight.status &&
      !transitions[flight.status].includes(update.status)) ||
    (scheduleChanged && ["cancelled", "completed"].includes(flight.status))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid status transition from '${flight.status}' to '${update.status}'`,
    });
  const affected = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        flightBookingCondition(flight.id),
        eq(bookings.status, "confirmed"),
        isNull(bookings.deletedAt)
      )
    );
  let disruptionId = update.disruptionId;
  if (changed) {
    await tx
      .update(flights)
      .set({ status: update.status, departureTime, arrivalTime })
      .where(eq(flights.id, flight.id));
    await tx.insert(flightStatusHistory).values({
      flightId: flight.id,
      oldStatus: flight.status,
      newStatus: update.status,
      delayMinutes: update.delayMinutes,
      reason: update.reason,
      changedBy: update.adminUserId ?? null,
    });
    if (scheduleChanged || update.status === "cancelled") {
      await tx
        .update(crewAssignments)
        .set({
          status: "removed",
          notes:
            "Flight schedule/state changed; operational reassignment required",
        })
        .where(eq(crewAssignments.flightId, flight.id));
      // Keep the former tail/evidence for investigation, but make validity explicit.
      await tx
        .update(aircraftRotations)
        .set({ scheduleDigest: "invalidated" })
        .where(eq(aircraftRotations.flightId, flight.id));
    }
    if (!disruptionId && ["cancelled", "delayed"].includes(update.status)) {
      const type =
        update.status === "cancelled"
          ? ("cancellation" as const)
          : ("delay" as const);
      const [row] = await tx.insert(flightDisruptions).values({
        flightId: flight.id,
        type,
        iropsType: type,
        reason: update.reason ?? `Flight ${update.status}`,
        severity: type === "cancellation" ? "severe" : "moderate",
        iropsSeverity: type === "cancellation" ? "high" : "medium",
        originalDepartureTime: flight.departureTime,
        newDepartureTime: update.newDepartureTime ?? null,
        delayMinutes: update.delayMinutes ?? null,
        createdBy: update.adminUserId ?? null,
      });
      disruptionId = row.insertId;
      await recordEvent(tx, {
        aggregateType: "disruption",
        aggregateId: disruptionId,
        tenantId: flight.tenantId,
        eventType: "irops.created",
        payload: { flightId: flight.id, type },
      });
    }
    await recordEvent(tx, {
      aggregateType: "flight",
      aggregateId: flight.id,
      tenantId: flight.tenantId,
      eventType: "flight.status_changed",
      payload: {
        flightId: flight.id,
        flightNumber: flight.flightNumber,
        oldStatus: flight.status,
        newStatus: update.status,
        departureTime: departureTime.toISOString(),
        arrivalTime: arrivalTime.toISOString(),
        delayMinutes: update.delayMinutes ?? null,
        reason: update.reason ?? null,
        actorId: update.adminUserId ?? null,
        bookingIds: affected.map(b => b.id),
        disruptionId: disruptionId ?? null,
      },
    });
  } else if (!disruptionId) {
    const [existing] = await tx
      .select({ id: flightDisruptions.id })
      .from(flightDisruptions)
      .where(
        and(
          eq(flightDisruptions.flightId, flight.id),
          eq(flightDisruptions.status, "active")
        )
      )
      .orderBy(desc(flightDisruptions.id))
      .limit(1);
    disruptionId = existing?.id;
  }
  return { success: true, affectedBookings: affected.length, disruptionId };
}
