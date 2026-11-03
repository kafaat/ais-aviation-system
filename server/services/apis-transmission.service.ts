/**
 * Government passenger-data transmissions: queue, dispatch with retry and
 * dead-letter, acknowledgement matching, and the transmission log that is
 * the inspection evidence for API/PNR obligations.
 *
 * State machine (apis_transmissions.status):
 *   queued --dispatch--> sending --ok--> sent --ack--> acked
 *                                  \--nak-------------> rejected
 *                         \--error--> failed (nextAttemptAt, backoff)
 *   failed --retry due--> sending ... ; attempts >= MAX_ATTEMPTS -> dead_letter
 *   rejected | dead_letter --operator retry--> queued (attempts kept)
 *
 * Bodies are generated at dispatch time so the authority receives the PNR
 * state current at the push; the stored body and SHA-256 hash are what was
 * actually sent. Nothing here claims acceptance by an authority: only an
 * acknowledgement that matched a correlation id moves a row to `acked`.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  airlines,
  airports,
  apisTransmissions,
  bookingSegments,
  bookings,
  flights,
  passengers,
  payments,
  pnrgovSchedules,
  seatInventory,
  users,
} from "../../drizzle/schema";
import { apisData } from "../../drizzle/operations-schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import { isValidTimeZone } from "./civil-day";
import { generatePAXLST } from "./apis-paxlst";
import {
  generatePNRGOV,
  type PnrgovBooking,
  type PnrgovDraft,
  type PnrgovLeg,
} from "./apis-pnrgov";
import {
  computePushSchedule,
  pnrgovScheduleInputSchema,
  type PnrgovScheduleInput,
} from "./apis-pnrgov-schedule";
import { parseAcknowledgement } from "./apis-cusres";
import {
  TransportError,
  hashBody,
  newCorrelationId,
  resolveApisTransport,
  type ApisMessageType,
  type ApisTransport,
} from "./apis-transport";

export const MAX_ATTEMPTS = 5;
/** Minutes to wait after the n-th failed attempt (n = 1..). */
export const BACKOFF_MINUTES = [1, 5, 15, 60] as const;

export function backoffMinutes(attempt: number): number {
  return BACKOFF_MINUTES[
    Math.min(Math.max(attempt, 1), BACKOFF_MINUTES.length) - 1
  ];
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export async function listPnrgovSchedules(tenantId: number | null) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(pnrgovSchedules)
    .orderBy(asc(pnrgovSchedules.destinationCountry));
  return rows
    .filter(r => r.tenantId === null || r.tenantId === tenantId)
    .map(serializeSchedule);
}

function serializeSchedule(r: typeof pnrgovSchedules.$inferSelect) {
  return {
    id: r.id,
    destinationCountry: r.destinationCountry,
    authorityCode: r.authorityCode,
    messageVersion: r.messageVersion,
    offsetsMinutes: r.offsetsMinutes,
    timingSource: r.timingSource,
    isActive: r.isActive,
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

export async function upsertPnrgovSchedule(
  input: PnrgovScheduleInput,
  actor: { userId: number; tenantId: number | null }
) {
  const parsed = pnrgovScheduleInputSchema.parse(input);
  const db = await requireDb();
  return db.transaction(async tx => {
    const existing = (
      await tx
        .select()
        .from(pnrgovSchedules)
        .where(
          eq(pnrgovSchedules.destinationCountry, parsed.destinationCountry)
        )
        .for("update")
    ).find(r => r.tenantId === actor.tenantId);
    const values = {
      authorityCode: parsed.authorityCode,
      messageVersion: parsed.messageVersion,
      offsetsMinutes: [...parsed.offsetsMinutes].sort((a, b) => a - b),
      timingSource: parsed.timingSource,
      isActive: parsed.isActive,
    };
    if (existing) {
      await tx
        .update(pnrgovSchedules)
        .set(values)
        .where(eq(pnrgovSchedules.id, existing.id));
      return { id: existing.id, created: false };
    }
    const [inserted] = await tx.insert(pnrgovSchedules).values({
      ...values,
      tenantId: actor.tenantId,
      destinationCountry: parsed.destinationCountry,
      createdBy: actor.userId,
    });
    return { id: Number(inserted.insertId), created: true };
  });
}

async function scheduleFor(
  tx: SettlementTx,
  destinationCountry: string,
  tenantId: number | null
) {
  const rows = await tx
    .select()
    .from(pnrgovSchedules)
    .where(
      and(
        eq(pnrgovSchedules.destinationCountry, destinationCountry),
        eq(pnrgovSchedules.isActive, true)
      )
    );
  return (
    rows.find(r => r.tenantId === tenantId) ??
    rows.find(r => r.tenantId === null) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Flight data for message generation
// ---------------------------------------------------------------------------

async function loadFlightLeg(tx: SettlementTx, flightId: number) {
  const [flight] = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  const airportRows = await tx
    .select()
    .from(airports)
    .where(inArray(airports.id, [flight.originId, flight.destinationId]));
  const origin = airportRows.find(a => a.id === flight.originId);
  const destination = airportRows.find(a => a.id === flight.destinationId);
  const [airline] = await tx
    .select()
    .from(airlines)
    .where(eq(airlines.id, flight.airlineId))
    .limit(1);
  if (
    !origin ||
    !destination ||
    !airline ||
    !isValidTimeZone(origin.timezone) ||
    !isValidTimeZone(destination.timezone)
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Government messages require carrier and route airports with valid time zones",
    });
  return {
    flight,
    airline,
    origin: {
      code: origin.code,
      country: origin.country.trim().toUpperCase(),
      timezone: origin.timezone,
    },
    destination: {
      code: destination.code,
      country: destination.country.trim().toUpperCase(),
      timezone: destination.timezone,
    },
  };
}

/** Confirmed/completed bookings carrying this flight directly or as a segment. */
async function manifestBookings(tx: SettlementTx, flightId: number) {
  const direct = await tx
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.flightId, flightId),
        inArray(bookings.status, ["confirmed", "completed"]),
        isNull(bookings.deletedAt)
      )
    );
  const segmentRows = await tx
    .select()
    .from(bookingSegments)
    .where(
      and(
        eq(bookingSegments.flightId, flightId),
        inArray(bookingSegments.status, ["confirmed", "completed"])
      )
    );
  const segmentBookingIds = [
    ...new Set(segmentRows.map(s => s.bookingId)),
  ].filter(id => !direct.some(b => b.id === id));
  const viaSegments = segmentBookingIds.length
    ? await tx
        .select()
        .from(bookings)
        .where(
          and(
            inArray(bookings.id, segmentBookingIds),
            inArray(bookings.status, ["confirmed", "completed"]),
            isNull(bookings.deletedAt)
          )
        )
    : [];
  // A booking whose primary flight is this one but whose segment list exists
  // and excludes it is not on the manifest.
  const allSegments = direct.length
    ? await tx
        .select()
        .from(bookingSegments)
        .where(
          inArray(
            bookingSegments.bookingId,
            direct.map(b => b.id)
          )
        )
    : [];
  const kept = direct.filter(b => {
    const own = allSegments.filter(s => s.bookingId === b.id);
    return (
      !own.length ||
      own.some(
        s =>
          s.flightId === flightId &&
          (s.status === "confirmed" || s.status === "completed")
      )
    );
  });
  return [...kept, ...viaSegments].sort((a, b) => a.id - b.id);
}

export async function loadPnrgovInput(
  tx: SettlementTx,
  flightId: number
): Promise<{
  leg: Awaited<ReturnType<typeof loadFlightLeg>>;
  pushFlight: PnrgovLeg;
  bookings: PnrgovBooking[];
  paxlst: {
    passengers: Array<{
      passengerId: number;
      firstName: string;
      lastName: string;
      bookingReference: string;
    }>;
    apisMap: Map<number, Record<string, unknown>>;
  };
}> {
  const leg = await loadFlightLeg(tx, flightId);
  const rows = await manifestBookings(tx, flightId);
  const bookingIds = rows.map(b => b.id);
  // A flight without confirmed bookings yields EQN+0; the transmission log
  // shows pnrCount 0 so an empty push is visible rather than an error loop.
  const paxRows = bookingIds.length
    ? await tx
        .select()
        .from(passengers)
        .where(inArray(passengers.bookingId, bookingIds))
        .orderBy(asc(passengers.id))
    : [];
  const paxIds = paxRows.map(p => p.id);
  const apisRows = paxIds.length
    ? await tx
        .select()
        .from(apisData)
        .where(inArray(apisData.passengerId, paxIds))
    : [];
  const paymentRows = bookingIds.length
    ? await tx
        .select()
        .from(payments)
        .where(inArray(payments.bookingId, bookingIds))
    : [];
  const seatRows = paxIds.length
    ? await tx
        .select()
        .from(seatInventory)
        .where(
          and(
            eq(seatInventory.flightId, flightId),
            inArray(seatInventory.passengerId, paxIds)
          )
        )
    : [];
  const segmentRows = bookingIds.length
    ? await tx
        .select()
        .from(bookingSegments)
        .where(inArray(bookingSegments.bookingId, bookingIds))
        .orderBy(asc(bookingSegments.segmentOrder))
    : [];
  const otherFlightIds = [
    ...new Set(segmentRows.map(s => s.flightId).filter(id => id !== flightId)),
  ];
  const otherLegs = new Map<number, PnrgovLeg>();
  for (const id of otherFlightIds) {
    const other = await loadFlightLeg(tx, id);
    otherLegs.set(id, toLeg(other));
  }
  const userIds = [...new Set(rows.map(b => b.userId))];
  const userRows = userIds.length
    ? await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];
  const pushFlight = toLeg(leg);
  const apisMap = new Map<number, Record<string, unknown>>();
  for (const a of apisRows)
    if (a.status === "validated" || a.status === "submitted")
      apisMap.set(a.passengerId, {
        surname: a.surname,
        given_names: a.givenNames,
        date_of_birth: a.dateOfBirth,
        gender: a.gender,
        nationality: a.nationality,
        document_type: a.documentType,
        document_number: a.documentNumber,
        issuing_country: a.issuingCountry,
        expiry_date: a.expiryDate,
        residence_country: a.residenceCountry,
      });
  const pnrBookings: PnrgovBooking[] = rows.map(b => {
    const own = segmentRows.filter(s => s.bookingId === b.id);
    const legs = own.length
      ? own
          .filter(s => s.status === "confirmed" || s.status === "completed")
          .map(s =>
            s.flightId === flightId
              ? pushFlight
              : (otherLegs.get(s.flightId) ?? pushFlight)
          )
      : [pushFlight];
    return {
      recordLocator: b.pnr,
      createdAt: new Date(b.createdAt),
      updatedAt: new Date(b.updatedAt),
      status: b.status,
      cabinClass: b.cabinClass,
      totalAmountMinor: b.totalAmount,
      currency: "SAR",
      contactEmail: userRows.find(u => u.id === b.userId)?.email ?? null,
      payments: paymentRows
        .filter(p => p.bookingId === b.id)
        .map(p => ({
          method: p.method,
          status: p.status,
          amountMinor: p.amount,
          currency: p.currency,
        })),
      legs,
      passengers: paxRows
        .filter(p => p.bookingId === b.id)
        .map(p => {
          const apis = apisRows.find(a => a.passengerId === p.id);
          const seat = seatRows.find(
            s =>
              s.passengerId === p.id &&
              (s.status === "checked_in" || s.status === "occupied")
          );
          return {
            passengerId: p.id,
            surname: p.lastName,
            givenNames: p.firstName,
            type: p.type,
            ticketNumber: p.ticketNumber,
            seatNumber: seat?.seatNumber ?? p.seatNumber ?? null,
            checkedIn: seat?.status === "checked_in",
            document:
              apis &&
              (apis.status === "validated" || apis.status === "submitted")
                ? {
                    documentType: apis.documentType,
                    documentNumber: apis.documentNumber,
                    issuingCountry: apis.issuingCountry,
                    nationality: apis.nationality,
                    dateOfBirth: apis.dateOfBirth,
                    gender: apis.gender,
                    expiryDate: apis.expiryDate,
                    surname: apis.surname,
                    givenNames: apis.givenNames,
                    residenceCountry: apis.residenceCountry,
                    residenceAddress: apis.residenceAddress,
                    destinationAddress: apis.destinationAddress,
                  }
                : null,
          };
        }),
    };
  });
  return {
    leg,
    pushFlight,
    bookings: pnrBookings,
    paxlst: {
      passengers: paxRows.map(p => ({
        passengerId: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        bookingReference:
          rows.find(b => b.id === p.bookingId)?.bookingReference ?? "",
      })),
      apisMap,
    },
  };
}

function toLeg(data: Awaited<ReturnType<typeof loadFlightLeg>>): PnrgovLeg {
  return {
    flightNumber: data.flight.flightNumber,
    carrierCode: data.airline.code,
    origin: { code: data.origin.code, timezone: data.origin.timezone },
    destination: {
      code: data.destination.code,
      timezone: data.destination.timezone,
    },
    departureTime: new Date(data.flight.departureTime),
    arrivalTime: new Date(data.flight.arrivalTime),
    status: data.flight.status,
  };
}

export async function buildTransmissionBody(
  tx: SettlementTx,
  input: {
    flightId: number;
    messageType: ApisMessageType;
    authorityCode: string;
    messageVersion: string;
    correlationId: string;
    now: Date;
  }
): Promise<{
  body: string;
  pnrCount: number;
  passengerCount: number;
  draft: PnrgovDraft | null;
}> {
  const data = await loadPnrgovInput(tx, input.flightId);
  if (input.messageType === "PAXLST") {
    const body = generatePAXLST({
      flight: {
        id: data.leg.flight.id,
        flightNumber: data.leg.flight.flightNumber,
        departureTime: new Date(data.leg.flight.departureTime),
        arrivalTime: new Date(data.leg.flight.arrivalTime),
      },
      origin: data.leg.origin,
      destination: data.leg.destination,
      airline: { code: data.leg.airline.code, name: data.leg.airline.name },
      passengers: data.paxlst.passengers,
      apisMap: data.paxlst.apisMap,
    });
    return {
      body,
      pnrCount: data.bookings.length,
      passengerCount: data.paxlst.apisMap.size,
      draft: null,
    };
  }
  const draft = generatePNRGOV({
    sender: {
      carrierCode: data.leg.airline.code,
      locationCode: data.leg.origin.code,
    },
    recipient: input.authorityCode,
    interchangeControlReference: input.correlationId,
    messageReference: "1",
    messageVersion: input.messageVersion,
    flight: data.pushFlight,
    bookings: data.bookings,
    generatedAt: input.now,
  });
  return {
    body: draft.message,
    pnrCount: draft.pnrCount,
    passengerCount: draft.passengerCount,
    draft,
  };
}

// ---------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------

export async function queueFlightTransmissions(input: {
  flightId: number;
  messageType: ApisMessageType;
  /** Queue one push now in addition to (or instead of) the schedule. */
  immediate?: boolean;
  requestedBy: number | null;
  tenantId: number | null;
  now?: Date;
}) {
  const db = await requireDb();
  const now = input.now ?? new Date();
  return db.transaction(async tx => {
    const leg = await loadFlightLeg(tx, input.flightId);
    if (
      input.tenantId !== null &&
      leg.flight.tenantId !== null &&
      leg.flight.tenantId !== input.tenantId
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Flight outside tenant",
      });
    const schedule = await scheduleFor(
      tx,
      leg.destination.country,
      leg.flight.tenantId
    );
    if (!schedule)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `No PNRGOV schedule is configured for destination country ${leg.destination.country}; configure the authority code and push offsets first`,
      });
    const existing = await tx
      .select()
      .from(apisTransmissions)
      .where(
        and(
          eq(apisTransmissions.flightId, input.flightId),
          eq(apisTransmissions.messageType, input.messageType)
        )
      );
    const live = existing.filter(
      t => t.status !== "dead_letter" && t.status !== "rejected"
    );
    const pushes = input.immediate
      ? []
      : computePushSchedule(
          new Date(leg.flight.departureTime),
          leg.origin.timezone,
          schedule.offsetsMinutes
        ).filter(p => p.scheduledAt.getTime() >= now.getTime());
    const planned: Array<{
      offset: number | null;
      scheduledFor: Date;
    }> = pushes.map(p => ({
      offset: p.offsetMinutes,
      scheduledFor: p.scheduledAt,
    }));
    if (input.immediate) planned.push({ offset: null, scheduledFor: now });
    const created: number[] = [];
    let skipped = 0;
    for (const plan of planned) {
      if (
        plan.offset !== null &&
        live.some(t => t.scheduleOffsetMinutes === plan.offset)
      ) {
        skipped++;
        continue;
      }
      const [inserted] = await tx.insert(apisTransmissions).values({
        tenantId: leg.flight.tenantId,
        flightId: input.flightId,
        messageType: input.messageType,
        destinationCountry: leg.destination.country,
        authorityCode: schedule.authorityCode,
        messageVersion: schedule.messageVersion,
        scheduleOffsetMinutes: plan.offset,
        scheduledFor: plan.scheduledFor,
        correlationId: newCorrelationId(),
        status: "queued",
        attempts: 0,
        requestedBy: input.requestedBy,
      });
      created.push(Number(inserted.insertId));
    }
    return {
      flightId: input.flightId,
      destinationCountry: leg.destination.country,
      authorityCode: schedule.authorityCode,
      created,
      skipped,
      missedOffsets: input.immediate
        ? []
        : computePushSchedule(
            new Date(leg.flight.departureTime),
            leg.origin.timezone,
            schedule.offsetsMinutes
          )
            .filter(p => p.scheduledAt.getTime() < now.getTime())
            .map(p => p.offsetMinutes),
    };
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchDueTransmissions(input: {
  transport: ApisTransport | null;
  now?: Date;
  limit?: number;
}) {
  const db = await requireDb();
  const now = input.now ?? new Date();
  const candidates = (
    await db
      .select()
      .from(apisTransmissions)
      .where(inArray(apisTransmissions.status, ["queued", "failed"]))
      .orderBy(asc(apisTransmissions.scheduledFor), asc(apisTransmissions.id))
  )
    .filter(
      t =>
        new Date(t.scheduledFor).getTime() <= now.getTime() &&
        (!t.nextAttemptAt ||
          new Date(t.nextAttemptAt).getTime() <= now.getTime())
    )
    .slice(0, input.limit ?? 20);
  const summary = { dispatched: 0, failed: 0, deadLettered: 0, waiting: 0 };
  if (!input.transport) {
    summary.waiting = candidates.length;
    return summary;
  }
  for (const candidate of candidates) {
    const outcome = await dispatchOne(db, candidate.id, input.transport, now);
    summary[outcome]++;
  }
  return summary;
}

async function dispatchOne(
  db: Db,
  id: number,
  transport: ApisTransport,
  now: Date
): Promise<"dispatched" | "failed" | "deadLettered"> {
  // Claim and generate inside one transaction; send outside it so a slow
  // bridge never holds row locks.
  const prepared = await db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(apisTransmissions)
      .where(eq(apisTransmissions.id, id))
      .for("update");
    if (!row || (row.status !== "queued" && row.status !== "failed"))
      return null;
    try {
      const built = await buildTransmissionBody(tx, {
        flightId: row.flightId,
        messageType: row.messageType,
        authorityCode: row.authorityCode,
        messageVersion: row.messageVersion,
        correlationId: row.correlationId,
        now,
      });
      const bodyHash = hashBody(built.body);
      await tx
        .update(apisTransmissions)
        .set({
          status: "sending",
          body: built.body,
          bodyHash,
          pnrCount: built.pnrCount,
          passengerCount: built.passengerCount,
          transportName: transport.name,
        })
        .where(eq(apisTransmissions.id, id));
      return { row, body: built.body, bodyHash };
    } catch (error) {
      // Generation faults (e.g. non-UNOA names) are retryable once corrected.
      await recordFailure(tx, row, now, describe(error), true);
      return { row, body: null, bodyHash: null, error };
    }
  });
  if (!prepared) return "failed";
  if (prepared.body === null || prepared.bodyHash === null)
    return prepared.row.attempts + 1 >= MAX_ATTEMPTS
      ? "deadLettered"
      : "failed";
  try {
    const receipt = await transport.send({
      transmissionId: id,
      messageType: prepared.row.messageType,
      authorityCode: prepared.row.authorityCode,
      correlationId: prepared.row.correlationId,
      flightId: prepared.row.flightId,
      body: prepared.body,
      bodyHash: prepared.bodyHash,
    });
    await db
      .update(apisTransmissions)
      .set({
        status: "sent",
        attempts: prepared.row.attempts + 1,
        sentAt: receipt.deliveredAt,
        transportReference: receipt.transportReference,
        nextAttemptAt: null,
        lastError: null,
      })
      .where(eq(apisTransmissions.id, id));
    if (receipt.immediateResponse)
      await applyAcknowledgement({
        body: receipt.immediateResponse,
        source: `${transport.name}:sync`,
        correlationId: prepared.row.correlationId,
      });
    return "dispatched";
  } catch (error) {
    const retryable = error instanceof TransportError ? error.retryable : true;
    return db.transaction(async tx => {
      const [row] = await tx
        .select()
        .from(apisTransmissions)
        .where(eq(apisTransmissions.id, id))
        .for("update");
      if (!row) return "failed";
      return (await recordFailure(tx, row, now, describe(error), retryable)) ===
        "dead_letter"
        ? "deadLettered"
        : "failed";
    });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function recordFailure(
  tx: SettlementTx,
  row: typeof apisTransmissions.$inferSelect,
  now: Date,
  message: string,
  retryable: boolean
): Promise<"failed" | "dead_letter"> {
  const attempts = row.attempts + 1;
  const dead = !retryable || attempts >= MAX_ATTEMPTS;
  await tx
    .update(apisTransmissions)
    .set({
      status: dead ? "dead_letter" : "failed",
      attempts,
      nextAttemptAt: dead
        ? null
        : new Date(now.getTime() + backoffMinutes(attempts) * 60_000),
      lastError: message.slice(0, 2000),
    })
    .where(eq(apisTransmissions.id, row.id));
  return dead ? "dead_letter" : "failed";
}

// ---------------------------------------------------------------------------
// Acknowledgements
// ---------------------------------------------------------------------------

export async function applyAcknowledgement(input: {
  body: string;
  source: string;
  /** Known correlation id when the transport returned the response synchronously. */
  correlationId?: string;
}) {
  const parsed = parseAcknowledgement(input.body);
  const db = await requireDb();
  const references = [
    ...new Set(
      [input.correlationId, ...parsed.references].filter((r): r is string =>
        Boolean(r)
      )
    ),
  ];
  if (!references.length)
    return { matched: false as const, disposition: parsed.disposition, parsed };
  const rows = await db
    .select()
    .from(apisTransmissions)
    .where(inArray(apisTransmissions.correlationId, references));
  const row = rows.find(r => r.status === "sent") ?? rows[0];
  if (!row)
    return { matched: false as const, disposition: parsed.disposition, parsed };
  if (parsed.disposition === "unknown")
    return {
      matched: true as const,
      transmissionId: row.id,
      disposition: parsed.disposition,
      parsed,
      applied: false as const,
    };
  const code =
    parsed.disposition === "ack"
      ? "ACK"
      : parsed.errors
          .map(e => e.code)
          .join(",")
          .slice(0, 40) || "NAK";
  await db
    .update(apisTransmissions)
    .set({
      status: parsed.disposition === "ack" ? "acked" : "rejected",
      acknowledgedAt: new Date(),
      acknowledgementBody: input.body.slice(0, 60000),
      acknowledgementCode: code,
      lastError:
        parsed.disposition === "nak"
          ? parsed.errors
              .map(
                e =>
                  `${e.code}${e.point ? `@${e.point}` : ""}${e.text ? ` ${e.text}` : ""}`
              )
              .join("; ")
              .slice(0, 2000)
          : null,
    })
    .where(eq(apisTransmissions.id, row.id));
  return {
    matched: true as const,
    transmissionId: row.id,
    disposition: parsed.disposition,
    parsed,
    applied: true as const,
  };
}

export async function pollAcknowledgements(transport: ApisTransport | null) {
  if (!transport?.pollAcknowledgements) return { received: 0, matched: 0 };
  const inbound = await transport.pollAcknowledgements();
  let matched = 0;
  for (const ack of inbound) {
    try {
      const result = await applyAcknowledgement(ack);
      if (result.matched) matched++;
    } catch (error) {
      console.error("Acknowledgement could not be parsed", {
        source: ack.source,
        error: describe(error),
      });
    }
  }
  return { received: inbound.length, matched };
}

// ---------------------------------------------------------------------------
// Operator actions and log
// ---------------------------------------------------------------------------

export async function retryTransmission(input: {
  transmissionId: number;
  tenantId: number | null;
  requestedBy: number;
}) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(apisTransmissions)
      .where(eq(apisTransmissions.id, input.transmissionId))
      .for("update");
    if (!row)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Transmission not found",
      });
    if (input.tenantId !== null && row.tenantId !== input.tenantId)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Transmission outside tenant",
      });
    if (!["failed", "dead_letter", "rejected"].includes(row.status))
      throw new TRPCError({
        code: "CONFLICT",
        message: `Only failed, dead-letter or rejected transmissions can be retried (status ${row.status})`,
      });
    // A rejected message gets a new interchange reference: the authority
    // already answered the old one.
    const correlationId =
      row.status === "rejected" ? newCorrelationId() : row.correlationId;
    await tx
      .update(apisTransmissions)
      .set({
        status: "queued",
        nextAttemptAt: null,
        scheduledFor: new Date(),
        correlationId,
        requestedBy: input.requestedBy,
        lastError: null,
      })
      .where(eq(apisTransmissions.id, row.id));
    return { transmissionId: row.id, correlationId, status: "queued" as const };
  });
}

export async function listTransmissions(input: {
  flightId?: number;
  tenantId: number | null;
  limit?: number;
}) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(apisTransmissions)
    .where(
      input.flightId
        ? eq(apisTransmissions.flightId, input.flightId)
        : undefined
    )
    .orderBy(desc(apisTransmissions.id))
    .limit(input.limit ?? 100);
  return rows
    .filter(r => input.tenantId === null || r.tenantId === input.tenantId)
    .map(serializeTransmission);
}

export function serializeTransmission(
  r: typeof apisTransmissions.$inferSelect
) {
  const iso = (d: Date | string | null | undefined) =>
    d ? new Date(d).toISOString() : null;
  return {
    id: r.id,
    flightId: r.flightId,
    messageType: r.messageType,
    destinationCountry: r.destinationCountry,
    authorityCode: r.authorityCode,
    messageVersion: r.messageVersion,
    scheduleOffsetMinutes: r.scheduleOffsetMinutes ?? null,
    scheduledFor: iso(r.scheduledFor) ?? new Date(0).toISOString(),
    correlationId: r.correlationId,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: iso(r.nextAttemptAt),
    bodyHash: r.bodyHash ?? null,
    bodyLength: r.body?.length ?? null,
    pnrCount: r.pnrCount ?? null,
    passengerCount: r.passengerCount ?? null,
    transportName: r.transportName ?? null,
    transportReference: r.transportReference ?? null,
    sentAt: iso(r.sentAt),
    acknowledgedAt: iso(r.acknowledgedAt),
    acknowledgementCode: r.acknowledgementCode ?? null,
    acknowledgementBody: r.acknowledgementBody ?? null,
    lastError: r.lastError ?? null,
    createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
  };
}

export async function getTransmissionBody(input: {
  transmissionId: number;
  tenantId: number | null;
}) {
  const db = await requireDb();
  const [row] = await db
    .select()
    .from(apisTransmissions)
    .where(eq(apisTransmissions.id, input.transmissionId))
    .limit(1);
  if (!row || (input.tenantId !== null && row.tenantId !== input.tenantId))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Transmission not found",
    });
  return { id: row.id, body: row.body ?? null, bodyHash: row.bodyHash ?? null };
}

// ---------------------------------------------------------------------------
// Periodic job
// ---------------------------------------------------------------------------

/** Queues scheduled pushes for upcoming international flights with a
 * configured schedule, dispatches due transmissions and polls for
 * acknowledgements. Runs every minute from the periodic job catalog. */
export async function processApisTransmissions(options?: {
  transport?: ApisTransport | null;
  now?: Date;
  horizonHours?: number;
}) {
  const now = options?.now ?? new Date();
  const transport =
    options?.transport === undefined
      ? resolveApisTransport()
      : options.transport;
  const db = await requireDb();
  const schedules = await db
    .select()
    .from(pnrgovSchedules)
    .where(eq(pnrgovSchedules.isActive, true));
  let queued = 0;
  if (schedules.length) {
    const horizon = new Date(
      now.getTime() + (options?.horizonHours ?? 48) * 3600_000
    );
    const upcoming = (
      await db
        .select()
        .from(flights)
        .where(inArray(flights.status, ["scheduled", "delayed"]))
    ).filter(f => {
      const dep = new Date(f.departureTime).getTime();
      return dep >= now.getTime() && dep <= horizon.getTime();
    });
    const destinationIds = [...new Set(upcoming.map(f => f.destinationId))];
    const airportRows = destinationIds.length
      ? await db
          .select({ id: airports.id, country: airports.country })
          .from(airports)
          .where(inArray(airports.id, destinationIds))
      : [];
    const countryOf = new Map(
      airportRows.map(a => [a.id, a.country.trim().toUpperCase()])
    );
    for (const flight of upcoming) {
      const country = countryOf.get(flight.destinationId);
      if (
        !country ||
        !schedules.some(
          s =>
            s.destinationCountry === country &&
            (s.tenantId === null || s.tenantId === flight.tenantId)
        )
      )
        continue;
      try {
        const result = await queueFlightTransmissions({
          flightId: flight.id,
          messageType: "PNRGOV",
          requestedBy: null,
          tenantId: null,
          now,
        });
        queued += result.created.length;
      } catch (error) {
        // A flight without confirmed passengers or route data is skipped; the
        // operator sees it when queueing manually.
        if (!(error instanceof TRPCError)) throw error;
      }
    }
  }
  const dispatch = await dispatchDueTransmissions({ transport, now });
  const acks = await pollAcknowledgements(transport);
  return { queued, ...dispatch, acknowledgements: acks };
}
