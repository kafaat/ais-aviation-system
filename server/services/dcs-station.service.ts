import { createRetailOffer } from "./retail-offer.service";
import {
  confirmNoChargeService,
  quotePaidOrderService,
} from "./order-servicing.service";
import { getFlightBaggageCloseout } from "./baggage-custody.service";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import type { z } from "zod";
import {
  bookings,
  bookingSegments,
  dcsOperationEvents,
  flights,
  passengers,
  seatInventory,
  seatMaps,
  specialServices,
} from "../../drizzle/schema";
import { cabinLayoutSchema } from "../contracts/seat-layout";
import { buildSeatRecords } from "./seat-map.service";
import type {
  downgradeQuote,
  downgradeConfirm,
  finalizeStation,
  remapStationSeats,
  addStationNote,
  blockStationSeats,
  openStationCase,
  resolveStationCase,
  stationCommand,
  stationReport,
} from "../contracts/dcs-station";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import {
  countActiveHolds,
  inventoryTransactionConfig,
} from "./inventory-capacity.service";
import {
  assertFundedDepartureReservation,
  lockDepartureContext,
} from "./departure-control.service";
import {
  appendEvent,
  getDcsDesk,
  passengerContext,
  scopedFlight,
  type DcsActor,
} from "./dcs-operations.service";
import {
  calculateRequestHash,
  withTransactionalIdempotency,
} from "./idempotency-v2.service";
import { adjustFlightAvailability } from "./inventory-adjustment.service";
import { assertTenantOperational } from "./tenant.service";
import { assertFlightDepartureFinanciallyReconciled } from "./departure-financial-authority.service";

function reject(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}

function stationTenant(actor: DcsActor) {
  if (actor.tenantId == null)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Select the operating tenant",
    });
  return actor.tenantId;
}

type StationEvent = typeof dcsOperationEvents.$inferSelect;
const caseActions = ["no_rec", "go_show", "case_resolved", "case_dismissed"];
function caseKind(event: StationEvent): "go_show" | "no_rec" | null {
  return event.action === "go_show" || event.action === "no_rec"
    ? event.action
    : null;
}
async function readCaseHistory(
  tx: SettlementTx,
  flightId: number,
  tenantId: number
) {
  const events = await tx
    .select()
    .from(dcsOperationEvents)
    .where(
      and(
        eq(dcsOperationEvents.flightId, flightId),
        eq(dcsOperationEvents.tenantId, tenantId),
        inArray(dcsOperationEvents.action, caseActions)
      )
    )
    .orderBy(asc(dcsOperationEvents.id))
    .limit(4001);
  if (events.length > 4000) reject("Station case history needs reconciliation");
  const resolved = new Map(
    events
      .filter(e => e.action === "case_resolved")
      .map(e => [e.details?.caseId, e.passengerId])
  );
  const dismissed = new Set(
    events
      .filter(e => e.action === "case_dismissed")
      .map(e => e.details?.caseId)
  );
  return events.flatMap(e => {
    const kind = caseKind(e);
    return kind && e.details?.stationReference
      ? [
          {
            id: e.id,
            kind,
            stationReference: e.details.stationReference,
            resolvedPassengerId: resolved.get(e.id) ?? null,
            dismissed: dismissed.has(e.id),
          },
        ]
      : [];
  });
}

export async function getStationReport(
  flightId: number,
  actor: DcsActor
): Promise<z.infer<typeof stationReport>> {
  const tenantId = stationTenant(actor);
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(
    async tx => {
      const desk = await getDcsDesk(flightId, actor, tx);
      await assertTenantOperational(tx, tenantId);
      const members = new Map(desk.passengers.map(p => [p.passengerId, p]));
      const bookingIds = [...new Set(desk.passengers.map(p => p.bookingId))];
      const requests = bookingIds.length
        ? await tx
            .select({
              bookingId: specialServices.bookingId,
              passengerId: specialServices.passengerId,
              flightId: specialServices.flightId,
              segmentId: specialServices.bookingSegmentId,
              code: specialServices.serviceCode,
              type: specialServices.serviceType,
              status: specialServices.status,
            })
            .from(specialServices)
            .where(
              and(
                inArray(specialServices.bookingId, bookingIds),
                or(
                  eq(specialServices.flightId, flightId),
                  isNull(specialServices.flightId)
                ),
                inArray(specialServices.status, ["confirmed", "pending"])
              )
            )
            .orderBy(asc(specialServices.id))
            .limit(10001)
        : [];
      const notes = await tx
        .select()
        .from(dcsOperationEvents)
        .where(
          and(
            eq(dcsOperationEvents.flightId, flightId),
            eq(dcsOperationEvents.tenantId, tenantId),
            eq(dcsOperationEvents.action, "osi")
          )
        )
        .orderBy(asc(dcsOperationEvents.id))
        .limit(10001);
      if (requests.length > 10000 || notes.length > 10000)
        reject("Station report exceeds safe read limit");
      const items: z.infer<typeof stationReport>["items"] = [];
      let unresolvedServices = 0;
      for (const r of requests) {
        const p = members.get(r.passengerId);
        if (
          !p ||
          p.bookingId !== r.bookingId ||
          r.flightId !== flightId ||
          r.segmentId !== p.segmentId
        ) {
          unresolvedServices++;
          continue;
        }
        if (r.status !== "confirmed" && r.status !== "pending") continue;
        items.push({
          passengerId: p.passengerId,
          name: p.name,
          seat: p.seatNumber,
          category: r.type === "meal" ? "meal" : "ssr",
          code: r.code,
          status: r.status,
          note: null,
        });
      }
      for (const note of notes) {
        const p = members.get(note.passengerId ?? -1);
        if (
          !p ||
          p.bookingId !== note.bookingId ||
          p.segmentId !== note.details?.segmentId
        )
          continue;
        items.push({
          passengerId: p.passengerId,
          name: p.name,
          seat: p.seatNumber,
          category: "osi",
          code: "OSI",
          status: "recorded",
          note: note.reason,
        });
      }
      return {
        flightId,
        flightNumber: desk.flight.flightNumber,
        departureTime: desk.flight.departureTime,
        items,
        unresolvedServices,
        closedAt: desk.flight.dcsClosedAt ?? null,
        stationOffBlocksAt: desk.flight.stationOffBlocksAt ?? null,
        cases: await readCaseHistory(tx, flightId, tenantId),
      };
    },
    { isolationLevel: "repeatable read" }
  );
}

type Command = z.infer<typeof stationCommand>;
async function stationMutation<T>(
  input: Command & { bookingId?: number },
  actor: DcsActor,
  scope: string,
  run: (
    tx: SettlementTx,
    flight: typeof flights.$inferSelect,
    record: (
      event: Pick<
        typeof dcsOperationEvents.$inferInsert,
        "action" | "fromState" | "toState"
      > &
        Partial<
          Pick<
            typeof dcsOperationEvents.$inferInsert,
            "bookingId" | "passengerId" | "details" | "flightId"
          >
        >
    ) => Promise<number>
  ) => Promise<T>,
  options: { allowCancelledReopen?: boolean } = {}
) {
  const tenantId = stationTenant(actor);
  if (
    (input.expectedActorId !== undefined ||
      input.expectedTenantId !== undefined) &&
    (input.expectedActorId !== actor.userId ||
      input.expectedTenantId !== tenantId)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Station staff or operating tenant changed",
    });
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(async tx => {
    await scopedFlight(tx, input.flightId, actor);
    await assertTenantOperational(tx, tenantId);
    const request = { tenantId, input };
    return withTransactionalIdempotency(
      {
        scope,
        key: input.idempotencyKey,
        userId: actor.userId,
        request,
        run: async tx => {
          // Replays need only scope authorization. New passenger writes take
          // booking and sorted itinerary locks before the selected flight.
          if (input.bookingId !== undefined)
            await lockDepartureContext(tx, input.bookingId, input.flightId);
          const flight = await scopedFlight(
            tx,
            input.flightId,
            actor,
            scope !== "dcs.seats.block"
          );
          if (
            (!["scheduled", "delayed"].includes(flight.status) &&
              !(
                options.allowCancelledReopen &&
                scope === "dcs.final" &&
                flight.status === "cancelled"
              )) ||
            (scope !== "dcs.final" &&
              (flight.dcsClosedAt != null ||
                flight.departureTime <= new Date()))
          )
            reject("Flight is outside active station operations");
          return run(tx, flight, e =>
            appendEvent(tx, {
              tenantId,
              flightId: flight.id,
              actorId: actor.userId,
              actorRole: actor.role,
              reason: input.reason,
              idempotencyKey: input.idempotencyKey,
              requestHash: calculateRequestHash(request),
              ...e,
            })
          );
        },
      },
      tx
    );
  }, inventoryTransactionConfig);
}
export function openDeskCase(
  input: z.infer<typeof openStationCase>,
  actor: DcsActor
) {
  return stationMutation(
    input,
    actor,
    "dcs.case.open",
    async (tx, flight, record) => {
      const cases = await readCaseHistory(tx, flight.id, stationTenant(actor));
      if (cases.some(c => c.stationReference === input.stationReference))
        reject("Station reference already exists on this flight");
      const eventId = await record({
        action: input.kind,
        fromState: "unrecorded",
        toState: "open",
        details: { stationReference: input.stationReference },
      });
      return { flightId: flight.id, eventId };
    }
  );
}
export function resolveDeskCase(
  input: z.infer<typeof resolveStationCase>,
  actor: DcsActor
) {
  return stationMutation(
    input,
    actor,
    "dcs.case.resolve",
    async (tx, flight, record) => {
      const cases = await readCaseHistory(tx, flight.id, stationTenant(actor));
      const entry = cases.find(c => c.id === input.caseId);
      if (!entry || entry.dismissed || entry.resolvedPassengerId != null)
        reject("Select an open case on this flight");
      const context = await passengerContext(tx, input, actor);
      assertFundedDepartureReservation(context);
      const eventId = await record({
        action: "case_resolved",
        fromState: "open",
        toState: "reservation_linked",
        bookingId: input.bookingId,
        passengerId: input.passengerId,
        details: { caseId: entry.id },
      });
      return { flightId: flight.id, eventId };
    }
  );
}
export function addDeskNote(
  input: z.infer<typeof addStationNote>,
  actor: DcsActor
) {
  return stationMutation(
    input,
    actor,
    "dcs.osi",
    async (tx, flight, record) => {
      const context = await passengerContext(tx, input, actor);
      assertFundedDepartureReservation(context);
      const eventId = await record({
        action: "osi",
        fromState: "none",
        toState: "recorded",
        bookingId: input.bookingId,
        passengerId: input.passengerId,
        details: {
          segmentId:
            context.legs.find(
              l =>
                l.flightId === flight.id &&
                ["pending", "confirmed"].includes(l.status)
            )?.id ?? null,
        },
      });
      return { flightId: flight.id, eventId };
    }
  );
}
export function blockDeskSeats(
  input: z.infer<typeof blockStationSeats>,
  actor: DcsActor
) {
  if (!["airline_admin", "admin", "super_admin"].includes(actor.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Seat blocking requires airline administration",
    });
  return stationMutation(
    input,
    actor,
    "dcs.seats.block",
    async (tx, flight, record) => {
      const start = new Date(input.startDate),
        end = new Date(Date.parse(input.endDate) + 86400000);
      if (flight.departureTime < start || flight.departureTime >= end)
        reject("Range must include the selected flight");
      const match = and(
        eq(flights.tenantId, stationTenant(actor)),
        eq(flights.airlineId, flight.airlineId),
        eq(flights.originId, flight.originId),
        eq(flights.destinationId, flight.destinationId),
        eq(flights.flightNumber, flight.flightNumber),
        gte(flights.departureTime, start),
        lt(flights.departureTime, end),
        inArray(flights.status, ["scheduled", "delayed"])
      );
      const candidates = await tx
        .select({ id: flights.id })
        .from(flights)
        .where(match)
        .orderBy(asc(flights.id))
        .limit(101);
      if (candidates.length > 100 || !candidates.some(f => f.id === flight.id))
        reject(
          "Range must include the selected flight and at most 100 active flights"
        );
      const instances = [];
      for (const { id } of candidates) {
        const [current] = await tx
          .select()
          .from(flights)
          .where(and(eq(flights.id, id), match))
          .for("update");
        if (!current) reject("Flight range changed; refresh the desk");
        instances.push(current);
      }
      if (
        instances.some(
          f => f.dcsClosedAt != null || f.departureTime <= new Date()
        )
      )
        reject("Range includes past departures or exceeds 100 active flights");
      for (const f of instances) {
        const rows = await tx
          .select()
          .from(seatInventory)
          .where(
            and(
              eq(seatInventory.flightId, f.id),
              inArray(seatInventory.seatNumber, input.seatNumbers)
            )
          )
          .orderBy(asc(seatInventory.id))
          .for("update");
        if (
          rows.length !== input.seatNumbers.length ||
          new Set(rows.map(r => r.seatNumber)).size !== rows.length ||
          rows.some(
            r =>
              r.status !== "available" ||
              r.bookingId != null ||
              r.passengerId != null ||
              r.checkInNonce != null
          )
        )
          reject(
            "Every requested seat must exist and be available on every flight"
          );
        for (const cabin of ["economy", "business"] as const) {
          const newlyBlocked = rows.filter(r => r.cabinClass === cabin).length;
          if (!newlyBlocked) continue;
          const available =
            cabin === "economy" ? f.economyAvailable : f.businessAvailable;
          await adjustFlightAvailability(
            {
              flightId: f.id,
              cabinClass: cabin,
              seats: available - newlyBlocked,
              tenantId: stationTenant(actor),
              actorId: actor.userId,
              reason: input.reason,
            },
            tx
          );
        }
        await tx
          .update(seatInventory)
          .set({ status: "blocked" })
          .where(
            inArray(
              seatInventory.id,
              rows.map(r => r.id)
            )
          );
        await record({
          flightId: f.id,
          action: "block_seats",
          fromState: "available",
          toState: "blocked",
          details: { seatNumbers: input.seatNumbers },
        });
      }
      return {
        flights: instances.length,
        seats: instances.length * input.seatNumbers.length,
      };
    }
  );
}

/** Reload an approved layout without moving a passenger, changing a purchased
 * seat feature or erasing an operational block. Conflicts require reseating first. */
export function remapDeskSeats(
  input: z.infer<typeof remapStationSeats>,
  actor: DcsActor
) {
  if (!["airline_admin", "admin", "super_admin"].includes(actor.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Seat plan changes require airline administration",
    });
  return stationMutation(
    input,
    actor,
    "dcs.seats.remap",
    async (tx, flight, record) => {
      const [map] = await tx
        .select()
        .from(seatMaps)
        .where(
          and(
            eq(seatMaps.id, input.seatMapId),
            eq(seatMaps.airlineId, flight.airlineId),
            eq(seatMaps.active, true)
          )
        )
        .for("update");
      if (
        !map ||
        !flight.aircraftType ||
        map.aircraftType !== flight.aircraftType
      )
        reject(
          "Choose an active airline layout matching the assigned equipment"
        );
      const layout = cabinLayoutSchema.parse(JSON.parse(map.cabinLayout));
      const next = buildSeatRecords(flight.id, map.id, layout);
      const planned = new Map(next.map(s => [s.seatNumber, s]));
      if (
        next.length > 1000 ||
        next.length !== map.totalSeats ||
        planned.size !== next.length ||
        next.some(s => !/^[1-9]\d{0,2}[A-Z]{1,2}$/.test(s.seatNumber))
      )
        reject("Invalid or duplicate seats in replacement layout");
      const old = await tx
        .select()
        .from(seatInventory)
        .where(eq(seatInventory.flightId, flight.id))
        .orderBy(asc(seatInventory.id))
        .for("update");
      if (
        !old.length ||
        old.length > 1000 ||
        new Set(old.map(s => s.seatNumber)).size !== old.length ||
        new Set(old.map(s => s.seatMapId)).size !== 1
      )
        reject("Existing seat inventory needs reconciliation");
      if (
        old.some(
          s =>
            s.status === "checked_in" || s.checkInNonce || s.boardingPassIssued
        )
      )
        reject(
          "Resolve issued passes and checked-in seats before equipment remapping"
        );
      // Remapping may preserve an existing operational block, never remove it
      // or introduce a new template restriction without reconciliation. The
      // protected-seat checks below also retain its identity and features.
      for (const cabin of [
        "economy",
        "business",
        "first",
        "premium_economy",
      ] as const) {
        const previous = old.filter(s => s.cabinClass === cabin);
        const proposed = next.filter(s => s.cabinClass === cabin);
        if (
          proposed.length !== previous.length ||
          proposed
            .filter(s => s.status === "blocked")
            .some(
              s =>
                !previous.some(
                  o => o.seatNumber === s.seatNumber && o.status === "blocked"
                )
            )
        )
          reject(
            "Capacity or new restrictions require inventory reconciliation before seat remapping"
          );
      }
      for (const seat of old) {
        const target = planned.get(seat.seatNumber);
        const protectedSeat =
          seat.status !== "available" ||
          seat.bookingId != null ||
          seat.passengerId != null;
        if (
          protectedSeat &&
          (!target ||
            target.cabinClass !== seat.cabinClass ||
            target.seatType !== seat.seatType ||
            target.seatPrice !== seat.seatPrice ||
            target.priceTier !== seat.priceTier ||
            target.hasExtraLegroom !== seat.hasExtraLegroom ||
            target.hasPowerOutlet !== seat.hasPowerOutlet ||
            target.isReclinable !== seat.isReclinable ||
            target.nearLavatory !== seat.nearLavatory ||
            target.nearGalley !== seat.nearGalley ||
            (target.status === "blocked" && seat.status !== "blocked"))
        )
          reject(
            "Assigned, held or restricted seat " +
              seat.seatNumber +
              " cannot be remapped safely"
          );
        if (!target) {
          await tx.delete(seatInventory).where(eq(seatInventory.id, seat.id));
          continue;
        }
        await tx
          .update(seatInventory)
          .set({
            ...target,
            status: protectedSeat ? seat.status : target.status,
          })
          .where(eq(seatInventory.id, seat.id));
        planned.delete(seat.seatNumber);
      }
      if (planned.size)
        await tx.insert(seatInventory).values([...planned.values()]);
      const eventId = await record({
        action: "remap_seats",
        fromState: String(old[0].seatMapId),
        toState: String(map.id),
      });
      return { eventId, flightId: flight.id };
    }
  );
}

export function finalizeDesk(
  input: z.infer<typeof finalizeStation>,
  actor: DcsActor
) {
  if (!["airline_admin", "admin", "super_admin"].includes(actor.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Final DCS changes require airline administration",
    });
  return stationMutation(
    input,
    actor,
    "dcs.final",
    async (tx, flight, record) => {
      const now = new Date();
      if (flight.stationOffBlocksAt)
        reject("Station OUT has already been recorded");
      if (input.action === "reopen") {
        if (!flight.dcsClosedAt) reject("DCS is not closed");
        await tx
          .update(flights)
          .set({ dcsClosedAt: null })
          .where(eq(flights.id, flight.id));
      } else {
        if ((input.action === "close") === Boolean(flight.dcsClosedAt))
          reject("Flight is not in the expected DCS state");
        if (flight.departureTime.getTime() > now.getTime() + 48 * 3600000)
          reject("Flight is outside the departure window");
        // The idempotent callback holds the flight under READ COMMITTED. A
        // prior command receipt remains readable; fresh closure/OUT requires
        // current cash authority without taking booking locks after the flight.
        await assertFlightDepartureFinanciallyReconciled(tx, flight);
        if (input.action === "close") {
          for (const cabin of ["economy", "business"] as const)
            if (await countActiveHolds(tx, flight.id, cabin, undefined, false))
              reject("Reconcile active seat holds before final closure");
          const [reserved] = await tx
            .select({ id: bookings.id })
            .from(bookings)
            .leftJoin(
              bookingSegments,
              eq(bookingSegments.bookingId, bookings.id)
            )
            .where(
              and(
                eq(bookings.status, "pending"),
                or(
                  and(
                    eq(bookings.flightId, flight.id),
                    eq(bookings.seatsReserved, true)
                  ),
                  and(
                    eq(bookingSegments.flightId, flight.id),
                    eq(bookingSegments.seatsReserved, true)
                  )
                )
              )
            )
            .limit(1);
          if (reserved)
            reject("Reconcile pending reserved bookings before final closure");
        }
        const desk = await getDcsDesk(flight.id, actor, tx);
        if (
          desk.checkInState !== "closed" ||
          !desk.stateConfigured ||
          !desk.passengers.some(p => p.attendanceState === "boarded") ||
          desk.passengers.some(
            p => p.checkedIn && p.attendanceState !== "boarded"
          )
        )
          reject(
            "Close check-in and reconcile all checked-in passengers before final closure"
          );
        if (
          (await readCaseHistory(tx, flight.id, stationTenant(actor))).some(
            c => !c.dismissed && c.resolvedPassengerId == null
          )
        )
          reject("Resolve open station cases before final closure");
        const bags = await getFlightBaggageCloseout(
          flight.id,
          stationTenant(actor),
          tx,
          new Set(
            desk.passengers
              .filter(p => p.attendanceState === "boarded")
              .map(p => `${p.bookingId}:${p.passengerId}`)
          )
        );
        if (
          bags.unexpectedBags ||
          bags.unresolvedRegistrations.length ||
          (bags.expectedBags > 0 && !bags.readyToClose)
        )
          reject("Resolve flight baggage reconciliation before final closure");
        if (input.action === "record_out") {
          if (!input.offBlocksAt)
            reject("Supply the observed UTC off-blocks time");
          const out = new Date(input.offBlocksAt);
          if (!flight.dcsClosedAt || out < flight.dcsClosedAt || out > now)
            reject("Observed OUT must be between final closure and now");
          await tx
            .update(flights)
            .set({ stationOffBlocksAt: out })
            .where(eq(flights.id, flight.id));
        } else
          await tx
            .update(flights)
            .set({ dcsClosedAt: now })
            .where(eq(flights.id, flight.id));
      }
      const eventId = await record({
        action: "dcs_" + input.action,
        fromState: flight.dcsClosedAt ? "closed" : "open",
        toState:
          input.action === "record_out"
            ? "out_recorded"
            : input.action === "close"
              ? "closed"
              : "open",
      });
      return { eventId, flightId: flight.id };
    },
    // Cancellation before observed OUT must allow supervised recovery of
    // boarded passengers. It must not permit a new closure or an OUT record.
    { allowCancelledReopen: input.action === "reopen" }
  );
}

export function quoteDeskDowngrade(
  input: z.infer<typeof downgradeQuote>,
  actor: DcsActor
) {
  if (!["airline_admin", "admin", "super_admin"].includes(actor.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cabin changes require airline administration",
    });
  return stationMutation(
    input,
    actor,
    "dcs.downgrade.quote",
    async (tx, flight, record) => {
      const c = await passengerContext(tx, input, actor);
      assertFundedDepartureReservation(c);
      if (
        c.booking.flightId !== flight.id ||
        c.booking.numberOfPassengers !== 1 ||
        c.legs.length > 1 ||
        c.booking.checkedIn ||
        c.booking.cabinClass !== "business" ||
        c.booking.fareClassId != null ||
        c.legs.some(l => l.fareClassId != null)
      )
        reject(
          "Desk downgrade requires a single passenger and sector in business before check-in, without a named fare bucket"
        );
      const [p] = await tx
        .select()
        .from(passengers)
        .where(eq(passengers.id, input.passengerId));
      const [seat] = await tx
        .select()
        .from(seatInventory)
        .where(
          and(
            eq(seatInventory.flightId, flight.id),
            eq(seatInventory.passengerId, p.id)
          )
        )
        .for("update");
      if (seat?.checkInNonce || seat?.status === "checked_in")
        reject("Undo passenger check-in before changing cabin");
      const offer = await createRetailOffer(
        {
          flightId: flight.id,
          passengerTypes: [p.type],
          cabinClass: "economy",
          channel: "direct",
          userId: c.booking.userId,
        },
        tx
      );
      const quote = await quotePaidOrderService(
        {
          bookingId: input.bookingId,
          offerIds: [offer.id],
          idempotencyKey: calculateRequestHash({
            staff: actor.userId,
            key: input.idempotencyKey,
            offer: offer.id,
          }),
        },
        c.booking.userId,
        stationTenant(actor),
        tx
      );
      if (quote.requiresPayment)
        reject("This change requires a paid commercial exchange");
      const eventId = await record({
        action: "downgrade_quote",
        fromState: "business",
        toState: "quoted",
        bookingId: input.bookingId,
        passengerId: p.id,
        details: {
          modificationId: quote.modificationId,
          refundDue: quote.refundDue,
        },
      });
      return {
        eventId,
        flightId: flight.id,
        modificationId: quote.modificationId,
        refundDue: quote.refundDue,
      };
    }
  );
}
export function confirmDeskDowngrade(
  input: z.infer<typeof downgradeConfirm>,
  actor: DcsActor
) {
  if (!["airline_admin", "admin", "super_admin"].includes(actor.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cabin changes require airline administration",
    });
  return stationMutation(
    input,
    actor,
    "dcs.downgrade.confirm",
    async (tx, flight, record) => {
      const c = await passengerContext(tx, input, actor);
      assertFundedDepartureReservation(c);
      const [quote] = await tx
        .select()
        .from(dcsOperationEvents)
        .where(
          and(
            eq(dcsOperationEvents.id, input.quoteEventId),
            eq(dcsOperationEvents.flightId, flight.id),
            eq(dcsOperationEvents.tenantId, stationTenant(actor)),
            eq(dcsOperationEvents.bookingId, input.bookingId),
            eq(dcsOperationEvents.passengerId, input.passengerId),
            eq(dcsOperationEvents.action, "downgrade_quote")
          )
        )
        .for("update");
      const id = quote?.details?.modificationId;
      if (
        !id ||
        c.booking.cabinClass !== "business" ||
        c.booking.numberOfPassengers !== 1 ||
        c.legs.length > 1 ||
        quote.details?.refundDue !== input.expectedRefund
      )
        reject("Review a current downgrade quote for this passenger");
      const result = await confirmNoChargeService(
        id,
        c.booking.userId,
        stationTenant(actor),
        tx
      );
      if (result.refundDue !== input.expectedRefund)
        reject("Downgrade terms have changed");
      const eventId = await record({
        action: "downgrade",
        fromState: "business",
        toState: "economy",
        bookingId: input.bookingId,
        passengerId: input.passengerId,
        details: { modificationId: id, refundDue: result.refundDue },
      });
      return {
        eventId,
        flightId: flight.id,
        modificationId: id,
        refundDue: result.refundDue,
      };
    }
  );
}

export function dismissDeskCase(
  input: z.infer<typeof stationCommand> & { caseId: number },
  actor: DcsActor
) {
  return stationMutation(
    input,
    actor,
    "dcs.case.dismiss",
    async (tx, flight, record) => {
      const entry = (
        await readCaseHistory(tx, flight.id, stationTenant(actor))
      ).find(c => c.id === input.caseId);
      if (!entry || entry.dismissed || entry.resolvedPassengerId != null)
        reject("Select an open station case");
      const eventId = await record({
        action: "case_dismissed",
        fromState: "open",
        toState: "closed_no_travel",
        details: { caseId: entry.id },
      });
      return { flightId: flight.id, eventId };
    }
  );
}
