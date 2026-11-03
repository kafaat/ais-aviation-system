import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  dcsBagReturnGrants,
  users,
  baggageItems,
  baggageCustodyEvents,
  baggageTracking,
  bookings,
  bookingSegments,
  dcsFlightOperations,
  dcsOperationEvents,
  dcsPassengerStates,
  flights,
  passengers,
  seatInventory,
} from "../../drizzle/schema";
import {
  changeDcsFlightInput,
  dcsCheckInInput,
  dcsReturnBagInput,
  dcsBagReturnGrantInput,
  dcsTransitionInput,
  type DcsDesk,
} from "../contracts/dcs-operations";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import {
  assertDepartureOpen,
  assertFundedDepartureReservation,
  checkInPassengersTx,
  lockDepartureContext,
  refreshBookingCheckIn,
} from "./departure-control.service";
import {
  departureState,
  readDcsPassengerState,
  readReconciledBoardings,
  writeDcsPassengerState,
  type DcsAttendanceState,
  type DcsPassengerKey,
} from "./dcs-state.service";
import {
  assertDcsBoardingEligibility,
  assertScopedBoardingPass,
} from "./boarding-pass.service";
import { assertPassengerBaggageCanOffload } from "./baggage-custody.service";
import { setCouponCheckIn } from "./ticket-coupons.service";
import { assertTenantOperational } from "./tenant.service";
import { isAdmin } from "./rbac.service";
import {
  calculateRequestHash,
  withTransactionalIdempotency,
} from "./idempotency-v2.service";

export type DcsActor = {
  userId: number;
  role: string;
  tenantId: number | null;
};
type Flight = typeof flights.$inferSelect;
type DepartureContext = Awaited<ReturnType<typeof lockDepartureContext>>;
const MAX_DESK_PASSENGERS = 2000;
const HISTORY_LIMIT = 200;

function reject(
  message: string,
  code: "FORBIDDEN" | "CONFLICT" | "PRECONDITION_FAILED" = "PRECONDITION_FAILED"
): never {
  throw new TRPCError({ code, message });
}
function assertFlightScope(actor: DcsActor, flight: Flight) {
  if (
    !Number.isSafeInteger(actor.userId) ||
    actor.userId <= 0 ||
    (!isAdmin(actor.role) && !["ops", "airline_admin"].includes(actor.role)) ||
    (!isAdmin(actor.role) && actor.tenantId == null) ||
    (actor.tenantId != null && flight.tenantId !== actor.tenantId)
  )
    reject("Flight is outside the departure operator's scope", "FORBIDDEN");
}
function database() {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return db;
}
async function scopedFlight(
  tx: SettlementTx,
  flightId: number,
  actor: DcsActor,
  lock = false
) {
  const query = tx.select().from(flights).where(eq(flights.id, flightId));
  const [flight] = await (lock ? query.for("update") : query);
  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  assertFlightScope(actor, flight);
  return flight;
}
async function passengerContext(
  tx: SettlementTx,
  key: DcsPassengerKey,
  actor: DcsActor
) {
  const c = await lockDepartureContext(tx, key.bookingId, key.flightId);
  assertFlightScope(actor, c.flight);
  if (c.booking.tenantId !== c.flight.tenantId)
    reject(
      "Booking and operating flight do not share an authorized tenant",
      "FORBIDDEN"
    );
  await assertTenantOperational(tx, c.flight.tenantId);
  const [passenger] = await tx
    .select()
    .from(passengers)
    .where(
      and(
        eq(passengers.id, key.passengerId),
        eq(passengers.bookingId, key.bookingId)
      )
    )
    .for("update");
  if (!passenger)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found on this booking",
    });
  if (passenger.tenantId != null && passenger.tenantId !== c.booking.tenantId)
    reject("Passenger is outside the booking tenant", "FORBIDDEN");
  return c;
}
async function passengerSeat(tx: SettlementTx, key: DcsPassengerKey) {
  const seats = await tx
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, key.flightId),
        eq(seatInventory.bookingId, key.bookingId),
        eq(seatInventory.passengerId, key.passengerId)
      )
    )
    .for("update");
  if (seats.length > 1)
    reject("Passenger has ambiguous seat assignments", "CONFLICT");
  return seats[0] ?? null;
}
function currentAttendance(
  state: Awaited<ReturnType<typeof readDcsPassengerState>>,
  checkedIn: boolean
): DcsAttendanceState {
  if (state?.state === "boarded") return "boarded";
  if (checkedIn) return "checked_in";
  return state?.state === "offloaded" ? "offloaded" : "not_checked_in";
}

/**
 * A schedule cutoff or flight cancellation must not strand current attendance.
 * Recovery still requires the locked active itinerary, funding and seat; it
 * never admits new travel or resolves a completed/refunded reservation.
 */
function assertDcsRecoveryAllowed(c: DepartureContext) {
  assertFundedDepartureReservation(c);
  if (!["scheduled", "delayed", "cancelled"].includes(c.flight.status))
    reject(
      "Flight requires departure reconciliation before attendance recovery"
    );
}

async function appendEvent(
  tx: SettlementTx,
  value: typeof dcsOperationEvents.$inferInsert
) {
  const [result] = await tx
    .insert(dcsOperationEvents)
    .values({ ...value, createdAt: new Date() });
  return Number(result.insertId);
}
function scopedRequest(actor: DcsActor, input: unknown) {
  return { tenantId: actor.tenantId, input };
}
function checkInWindowOpen(flight: Flight) {
  const remaining = flight.departureTime.getTime() - Date.now();
  return (
    ["scheduled", "delayed"].includes(flight.status) &&
    remaining > 3600000 &&
    remaining <= 48 * 3600000
  );
}
function assertDeskBound(count: number, limit = MAX_DESK_PASSENGERS) {
  if (count > limit)
    reject(
      "Flight desk exceeds its safe read limit; narrow the operational scope"
    );
}

/** No tenant, carrier or station ownership is inferred from client-provided IDs. */
export async function getDcsDesk(
  flightId: number,
  actor: DcsActor
): Promise<DcsDesk> {
  z.number().int().positive().parse(flightId);
  const db = await database();
  return db.transaction(
    async tx => {
      const flight = await scopedFlight(tx, flightId, actor);
      const tenant =
        flight.tenantId == null
          ? isNull(bookings.tenantId)
          : eq(bookings.tenantId, flight.tenantId);
      const activeLegs = await tx
        .select()
        .from(bookingSegments)
        .where(
          and(
            eq(bookingSegments.flightId, flightId),
            inArray(bookingSegments.status, ["confirmed", "pending"]),
            eq(bookingSegments.seatsReserved, true)
          )
        )
        .limit(MAX_DESK_PASSENGERS + 1);
      assertDeskBound(activeLegs.length);
      const direct = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.flightId, flightId),
            tenant,
            isNull(bookings.deletedAt),
            eq(bookings.status, "confirmed"),
            eq(bookings.paymentStatus, "paid")
          )
        )
        .limit(MAX_DESK_PASSENGERS + 1);
      assertDeskBound(direct.length);
      const legIds = [...new Set(activeLegs.map(l => l.bookingId))];
      const connected = legIds.length
        ? await tx
            .select()
            .from(bookings)
            .where(
              and(
                inArray(bookings.id, legIds),
                tenant,
                isNull(bookings.deletedAt),
                eq(bookings.status, "confirmed"),
                eq(bookings.paymentStatus, "paid")
              )
            )
        : [];
      const candidates = [
        ...new Map([...direct, ...connected].map(b => [b.id, b])).values(),
      ];
      assertDeskBound(candidates.length);
      const candidateIds = candidates.map(b => b.id);
      const legs = candidateIds.length
        ? await tx
            .select()
            .from(bookingSegments)
            .where(inArray(bookingSegments.bookingId, candidateIds))
            .limit(20001)
        : [];
      assertDeskBound(legs.length, 20000);
      const eligible = candidates.flatMap(booking => {
        const allLegs = legs.filter(l => l.bookingId === booking.id);
        const matches = allLegs.filter(
          l =>
            l.flightId === flightId &&
            ["confirmed", "pending"].includes(l.status)
        );
        if (matches.length > 1)
          reject("Flight maps to more than one active booking segment");
        if (
          allLegs.length ? !matches[0]?.seatsReserved : !booking.seatsReserved
        )
          return [];
        return [{ booking, segmentId: matches[0]?.id ?? null }];
      });
      const ids = eligible.map(e => e.booking.id);
      const ps = ids.length
        ? await tx
            .select()
            .from(passengers)
            .where(inArray(passengers.bookingId, ids))
            .orderBy(asc(passengers.id))
            .limit(MAX_DESK_PASSENGERS + 1)
        : [];
      assertDeskBound(ps.length);
      const seats = ids.length
        ? await tx
            .select()
            .from(seatInventory)
            .where(
              and(
                eq(seatInventory.flightId, flightId),
                inArray(seatInventory.bookingId, ids)
              )
            )
            .limit(MAX_DESK_PASSENGERS + 1)
        : [];
      assertDeskBound(seats.length);
      const states = ids.length
        ? await tx
            .select()
            .from(dcsPassengerStates)
            .where(
              and(
                eq(dcsPassengerStates.flightId, flightId),
                inArray(dcsPassengerStates.bookingId, ids)
              )
            )
            .limit(MAX_DESK_PASSENGERS + 1)
        : [];
      assertDeskBound(states.length);
      await readReconciledBoardings(tx, flight);
      const [gate] = await tx
        .select()
        .from(dcsFlightOperations)
        .where(eq(dcsFlightOperations.flightId, flightId));
      const events = await tx
        .select()
        .from(dcsOperationEvents)
        .where(
          and(
            eq(dcsOperationEvents.flightId, flightId),
            flight.tenantId == null
              ? isNull(dcsOperationEvents.tenantId)
              : eq(dcsOperationEvents.tenantId, flight.tenantId)
          )
        )
        .orderBy(desc(dcsOperationEvents.id))
        .limit(HISTORY_LIMIT + 1);
      const grant =
        actor.tenantId != null
          ? await stationGrant(tx, flight, actor.userId)
          : null;
      return {
        canReturnBags: Boolean(grant?.enabled),
        flight: {
          id: flight.id,
          flightNumber: flight.flightNumber,
          tenantId: flight.tenantId,
          airlineId: flight.airlineId,
          originId: flight.originId,
          destinationId: flight.destinationId,
          departureTime: flight.departureTime,
          status: flight.status,
        },
        checkInState: gate?.checkInState ?? "open",
        stateConfigured: Boolean(gate),
        checkInWindowOpen: checkInWindowOpen(flight),
        passengers: ps.map(p => {
          const entry = eligible.find(e => e.booking.id === p.bookingId);
          if (!entry) reject("Passenger does not have an eligible reservation");
          if (p.tenantId != null && p.tenantId !== flight.tenantId)
            reject("Passenger is outside the booking tenant", "FORBIDDEN");
          const assigned = seats.filter(
            s => s.bookingId === p.bookingId && s.passengerId === p.id
          );
          if (assigned.length > 1)
            reject("Passenger has ambiguous seat assignments", "CONFLICT");
          const seat = assigned[0];
          const state = states.find(
            s => s.bookingId === p.bookingId && s.passengerId === p.id
          );
          const checkedIn =
            seat?.status === "checked_in" && Boolean(seat.checkInNonce);
          return {
            bookingId: p.bookingId,
            passengerId: p.id,
            segmentId: entry.segmentId,
            name: `${p.firstName} ${p.lastName}`.trim(),
            pnr: entry.booking.pnr,
            bookingReference: entry.booking.bookingReference,
            cabinClass: entry.booking.cabinClass,
            seatNumber: seat?.seatNumber ?? null,
            departureState: departureState(state, checkedIn),
            attendanceState: currentAttendance(state ?? null, checkedIn),
            boardingDenied: Boolean(state?.boardingDenied),
            checkedIn,
          };
        }),
        history: events.slice(0, HISTORY_LIMIT).map(e => ({
          id: e.id,
          bookingId: e.bookingId,
          passengerId: e.passengerId,
          action: e.action,
          fromState: e.fromState,
          toState: e.toState,
          actorId: e.actorId,
          actorRole: e.actorRole,
          reason: e.reason,
          createdAt: e.createdAt,
        })),
        historyHasMore: events.length > HISTORY_LIMIT,
      };
    },
    { isolationLevel: "repeatable read" }
  );
}

export async function changeDcsFlightState(
  raw: z.infer<typeof changeDcsFlightInput>,
  actor: DcsActor
) {
  const input = changeDcsFlightInput.parse(raw);
  const db = await database();
  return db.transaction(async tx => {
    const flight = await scopedFlight(tx, input.flightId, actor, true);
    await assertTenantOperational(tx, flight.tenantId);
    const request = scopedRequest(actor, input);
    return withTransactionalIdempotency(
      {
        scope: "dcs.flight_state",
        key: input.idempotencyKey,
        userId: actor.userId,
        request,
        run: async tx => {
          if (
            !["scheduled", "delayed"].includes(flight.status) ||
            flight.departureTime <= new Date()
          )
            reject("Flight is not open for departure operations");
          const [current] = await tx
            .select()
            .from(dcsFlightOperations)
            .where(eq(dcsFlightOperations.flightId, flight.id))
            .for("update");
          if (input.action === "open" && current?.checkInState === "closed")
            reject("Use reopen to reverse a flight closure", "CONFLICT");
          if (input.action === "reopen" && current?.checkInState !== "closed")
            reject("Only a closed flight can be reopened", "CONFLICT");
          const state =
            input.action === "close" ? ("closed" as const) : ("open" as const);
          const changed = !current || current.checkInState !== state;
          if (current)
            await tx
              .update(dcsFlightOperations)
              .set({ checkInState: state, updatedAt: new Date() })
              .where(eq(dcsFlightOperations.id, current.id));
          else
            await tx.insert(dcsFlightOperations).values({
              flightId: flight.id,
              tenantId: flight.tenantId,
              checkInState: state,
              updatedAt: new Date(),
            });
          const eventId = await appendEvent(tx, {
            tenantId: flight.tenantId,
            flightId: flight.id,
            bookingId: null,
            passengerId: null,
            action: input.action,
            fromState: current?.checkInState ?? "unconfigured",
            toState: state,
            actorId: actor.userId,
            actorRole: actor.role,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            requestHash: calculateRequestHash(request),
          });
          return { eventId, flightId: flight.id, state, changed };
        },
      },
      tx
    );
  });
}

async function passengerCommand<
  Result,
  T extends {
    flightId: number;
    bookingId: number;
    passengerId: number;
    idempotencyKey: string;
  },
>(
  input: T,
  actor: DcsActor,
  scope: string,
  run: (
    tx: SettlementTx,
    c: DepartureContext,
    requestHash: string
  ) => Promise<Result>,
  authorize?: (tx: SettlementTx, c: DepartureContext) => Promise<void>
) {
  const db = await database();
  return db.transaction(async tx => {
    const c = await passengerContext(tx, input, actor);
    if (authorize) await authorize(tx, c);
    const request = scopedRequest(actor, input);
    return withTransactionalIdempotency(
      {
        scope,
        key: input.idempotencyKey,
        userId: actor.userId,
        request,
        run: tx => run(tx, c, calculateRequestHash(request)),
      },
      tx
    );
  });
}

async function stationGrant(
  tx: SettlementTx,
  flight: Flight,
  staffId: number,
  lock = false
) {
  if (!flight.tenantId) return null;
  const query = tx
    .select()
    .from(dcsBagReturnGrants)
    .where(
      and(
        eq(dcsBagReturnGrants.tenantId, flight.tenantId),
        eq(dcsBagReturnGrants.airlineId, flight.airlineId),
        eq(dcsBagReturnGrants.airportId, flight.originId),
        eq(dcsBagReturnGrants.staffId, staffId)
      )
    );
  const [grant] = await (lock ? query.for("update") : query);
  return grant ?? null;
}

/** Derive the authorized tenant, operating carrier and origin from the witness flight. */
export async function setBagReturnGrant(
  raw: z.infer<typeof dcsBagReturnGrantInput>,
  actor: DcsActor
) {
  const input = dcsBagReturnGrantInput.parse(raw);
  if (!isAdmin(actor.role) && actor.role !== "airline_admin")
    reject("Airline administration is required", "FORBIDDEN");
  return database().transaction(async tx => {
    const flight = await scopedFlight(tx, input.flightId, actor, true);
    const tenantId = flight.tenantId;
    if (
      !tenantId ||
      flight.airlineId !== input.airlineId ||
      flight.originId !== input.airportId
    )
      reject("Station and carrier must match the scoped flight", "FORBIDDEN");
    await assertTenantOperational(tx, tenantId);
    const request = scopedRequest(actor, input);
    return withTransactionalIdempotency(
      {
        scope: "dcs.set_bag_return_grant",
        key: input.idempotencyKey,
        userId: actor.userId,
        request,
        run: async tx => {
          const [staff] = await tx
            .select()
            .from(users)
            .where(eq(users.id, input.staffId))
            .for("update");
          const existing = await stationGrant(tx, flight, input.staffId, true);
          if (
            input.enabled &&
            (!staff ||
              staff.tenantId !== tenantId ||
              !["ops", "airline_admin", "admin", "super_admin"].includes(
                staff.role
              ))
          )
            reject(
              "The target must be operations staff in the same airline tenant",
              "FORBIDDEN"
            );
          if (!input.enabled && !existing)
            reject("No bag handover grant exists for this station");
          const scope = {
            tenantId,
            airlineId: flight.airlineId,
            airportId: flight.originId,
            staffId: input.staffId,
          };
          if (existing)
            await tx
              .update(dcsBagReturnGrants)
              .set({ enabled: input.enabled })
              .where(eq(dcsBagReturnGrants.id, existing.id));
          else
            await tx
              .insert(dcsBagReturnGrants)
              .values({ ...scope, enabled: input.enabled });
          const eventId = await appendEvent(tx, {
            tenantId,
            flightId: flight.id,
            action: "bag_return_grant",
            fromState: existing?.enabled ? "enabled" : "disabled",
            toState: input.enabled ? "enabled" : "disabled",
            actorId: actor.userId,
            actorRole: actor.role,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            requestHash: calculateRequestHash(request),
            details: {
              staffId: input.staffId,
              airlineId: flight.airlineId,
              stationId: flight.originId,
            },
          });
          return { ...scope, enabled: input.enabled, eventId };
        },
      },
      tx
    );
  });
}

/** The operator attests a physical handover at the origin desk. Device scans stay unchanged. */
export async function returnDcsBag(
  raw: z.infer<typeof dcsReturnBagInput>,
  actor: DcsActor
) {
  const input = dcsReturnBagInput.parse(raw);
  if (!actor.tenantId)
    reject("A scoped airline operator is required", "FORBIDDEN");
  return passengerCommand(
    input,
    actor,
    "dcs.return_bag",
    async (tx, c, requestHash) => {
      assertDcsRecoveryAllowed(c);
      const leg = c.legs.find(
        leg => leg.id === input.segmentId && leg.flightId === input.flightId
      );
      if (!leg || leg.status !== "confirmed")
        reject("Bag does not belong to this passenger sector");
      const [bag] = await tx
        .select()
        .from(baggageItems)
        .where(
          and(
            eq(baggageItems.tagNumber, input.tagNumber),
            eq(baggageItems.passengerId, input.passengerId),
            eq(baggageItems.bookingId, input.bookingId),
            eq(baggageItems.flightId, input.flightId),
            eq(baggageItems.segmentId, input.segmentId)
          )
        )
        .for("update");
      if (!bag) reject("Bag does not belong to this passenger sector");
      if (bag.returnEventId != null)
        reject("This bag was already returned", "CONFLICT");
      const state = await readDcsPassengerState(tx, input);
      const seat = await passengerSeat(tx, input);
      if (
        state?.state === "boarded" ||
        seat?.status !== "checked_in" ||
        !seat.checkInNonce
      )
        reject(
          "The passenger must be checked in and deplaned before returning the bag"
        );
      const [latest] = await tx
        .select()
        .from(baggageCustodyEvents)
        .where(eq(baggageCustodyEvents.baggageId, bag.id))
        .orderBy(
          desc(baggageCustodyEvents.observedAt),
          desc(baggageCustodyEvents.id)
        )
        .limit(1);
      if (
        (latest &&
          (latest.flightId !== input.flightId ||
            latest.airportId !== c.flight.originId ||
            !["acceptance", "transfer"].includes(latest.stage))) ||
        !(
          bag.status === "checked_in" ||
          (bag.status === "loading" && latest?.stage === "transfer")
        )
      )
        reject(
          "Custody does not place this bag at the departure desk for return"
        );
      const eventId = await appendEvent(tx, {
        tenantId: actor.tenantId,
        flightId: input.flightId,
        bookingId: input.bookingId,
        passengerId: input.passengerId,
        action: "return_bag",
        fromState: bag.status,
        toState: "claimed",
        actorId: actor.userId,
        actorRole: actor.role,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        details: {
          baggageId: bag.id,
          tagNumber: bag.tagNumber,
          segmentId: leg.id,
          stationId: c.flight.originId,
        },
      });
      const location = `Airport ${c.flight.originId} departure desk`;
      await tx
        .update(baggageItems)
        .set({
          returnEventId: eventId,
          status: "claimed",
          lastLocation: location,
        })
        .where(eq(baggageItems.id, bag.id));
      await tx.insert(baggageTracking).values({
        baggageId: bag.id,
        status: "claimed",
        location,
        scannedBy: actor.userId,
        notes: `Operator-attested return to passenger, DCS event ${eventId}`,
      });
      return { eventId, tagNumber: bag.tagNumber };
    },
    async (tx, c) => {
      if (!(await stationGrant(tx, c.flight, actor.userId, true))?.enabled)
        reject(
          "Bag handover requires an active staff grant for the departure station and carrier",
          "FORBIDDEN"
        );
    }
  );
}

export async function checkInDcsPassenger(
  raw: z.infer<typeof dcsCheckInInput>,
  actor: DcsActor
) {
  const input = dcsCheckInInput.parse(raw);
  return await passengerCommand(
    input,
    actor,
    "dcs.check_in",
    async (tx, c, requestHash) => {
      const before = await readDcsPassengerState(tx, input);
      const oldSeat = await passengerSeat(tx, input);
      const wasCheckedIn =
        oldSeat?.status === "checked_in" && Boolean(oldSeat.checkInNonce);
      const [result] = await checkInPassengersTx(tx, {
        bookingId: input.bookingId,
        flightId: input.flightId,
        assignments: [
          { passengerId: input.passengerId, seatNumber: input.seatNumber },
        ],
      });
      if (!result) throw new Error("Check-in did not return a seat");
      const eventId = await appendEvent(tx, {
        tenantId: c.flight.tenantId,
        flightId: input.flightId,
        bookingId: input.bookingId,
        passengerId: input.passengerId,
        action: "check_in",
        fromState: departureState(before, wasCheckedIn),
        toState: "checked_in",
        actorId: actor.userId,
        actorRole: actor.role,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        details: {
          seatNumber: result.seat.seatNumber,
          attendanceBefore: currentAttendance(before, wasCheckedIn),
          attendanceAfter: "checked_in",
          deniedBefore: Boolean(before?.boardingDenied),
          deniedAfter: false,
        },
      });
      return {
        eventId,
        flightId: input.flightId,
        bookingId: input.bookingId,
        passengerId: input.passengerId,
        state: "checked_in" as const,
        seatNumber: result.seat.seatNumber,
        changed: !wasCheckedIn,
      };
    }
  );
}

export async function transitionDcsPassenger(
  raw: z.infer<typeof dcsTransitionInput>,
  actor: DcsActor
) {
  const input = dcsTransitionInput.parse(raw);
  if (input.boardingPassToken && input.action !== "board")
    reject("A boarding scan is only valid for a board command");
  return await passengerCommand(
    input,
    actor,
    "dcs.passenger_transition",
    async (tx, c, requestHash) => {
      if (input.action === "deplane" || input.action === "offload")
        assertDcsRecoveryAllowed(c);
      else assertDepartureOpen(c, "boarding");
      const before = await readDcsPassengerState(tx, input);
      const seat = await passengerSeat(tx, input);
      const checkedIn =
        seat?.status === "checked_in" && Boolean(seat.checkInNonce);
      const attendanceBefore = currentAttendance(before, checkedIn);
      const fromState = departureState(before, checkedIn);
      let attendance = attendanceBefore;
      let denied = Boolean(before?.boardingDenied);
      let scanFormat: string | undefined;
      if (input.action === "board") {
        await assertDcsBoardingEligibility(tx, input);
        if (input.boardingPassToken)
          scanFormat = await assertScopedBoardingPass(
            tx,
            input,
            input.boardingPassToken
          );
        attendance = "boarded";
      } else if (input.action === "deplane") {
        if (attendanceBefore !== "boarded" || !checkedIn)
          reject(
            "Only a boarded passenger with a current seat can be deplaned",
            "CONFLICT"
          );
        attendance = "checked_in";
      } else if (input.action === "deny") {
        if (attendanceBefore === "boarded")
          reject("Deplane the passenger before denying boarding", "CONFLICT");
        denied = true;
      } else if (input.action === "allow") {
        if (attendanceBefore === "boarded")
          reject(
            "Deplane the passenger before changing boarding permission",
            "CONFLICT"
          );
        denied = false;
      } else {
        if (attendanceBefore === "boarded")
          reject("Deplane the passenger before offload", "CONFLICT");
        if (!checkedIn || !seat)
          reject("Only a checked-in passenger can be offloaded", "CONFLICT");
        // Counter registration is already a physical receipt; do not wait for
        // the asynchronous custody scan or trust a mutable "claimed" label.
        await assertPassengerBaggageCanOffload(tx, input);
        await tx
          .update(seatInventory)
          .set({
            status: "occupied",
            checkedInAt: null,
            checkInNonce: null,
            boardingGroup: null,
            boardingSequence: null,
            boardingPassIssued: false,
          })
          .where(eq(seatInventory.id, seat.id));
        await setCouponCheckIn(
          tx,
          input.bookingId,
          input.passengerId,
          input.flightId,
          false
        );
        await refreshBookingCheckIn(tx, input.bookingId);
        attendance = "offloaded";
      }
      const after = await writeDcsPassengerState(tx, input, attendance, denied);
      const state = departureState(
        after,
        input.action !== "offload" && checkedIn
      );
      const eventId = await appendEvent(tx, {
        tenantId: c.flight.tenantId,
        flightId: input.flightId,
        bookingId: input.bookingId,
        passengerId: input.passengerId,
        action: input.action,
        fromState,
        toState: state,
        actorId: actor.userId,
        actorRole: actor.role,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        details: {
          seatNumber: seat?.seatNumber ?? null,
          attendanceBefore,
          attendanceAfter: attendance,
          deniedBefore: Boolean(before?.boardingDenied),
          deniedAfter: denied,
          scanFormat,
        },
      });
      return {
        eventId,
        flightId: input.flightId,
        bookingId: input.bookingId,
        passengerId: input.passengerId,
        state,
        seatNumber: seat?.seatNumber ?? null,
        changed:
          attendance !== attendanceBefore ||
          denied !== Boolean(before?.boardingDenied),
      };
    }
  );
}
