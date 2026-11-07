/**
 * Type B triggers.
 *
 * Two sources drive automatic messages:
 *
 *  1. Time: a PNL is queued once per flight when departure is within
 *     TYPEB_PNL_LEAD_MINUTES (default 180) and no PNL has been issued yet.
 *  2. Domain events: the transactional outbox archives every event in
 *     `event_inbox` (event-inbox.service). This service polls that archive for
 *     the event types it cares about and records one `event_deliveries`
 *     receipt per event under the consumer name "typeb-gateway", using the
 *     same lease-fenced `deliverExternalEffect` the other consumers use. No
 *     producer or dispatcher owned by another workstream is modified.
 *
 *     booking.confirmed / booking.cancelled  → ADL ADD / DEL once a PNL exists
 *     aviation.departure_actual / arrival_actual → MVT AD / AA
 *     aviation.baggage_custody (stage acceptance) → BSM
 *
 * Every tick is safe to repeat: PNLs are keyed per flight, event-driven
 * messages per event id, and receipts stop a processed event from firing twice.
 */
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import {
  aviationEvidence,
  baggageCustodyEvents,
  bookingSegments,
  bookings,
  eventDeliveries,
  eventInbox,
  flights,
} from "../../../drizzle/schema";
import { deliverExternalEffect, type InboxEvent } from "../event-inbox.service";
import { logger } from "../../_core/logger";
import {
  buildAdlPayload,
  buildBsmPayload,
  buildMvtPayload,
  buildPnlPayload,
  loadFlightContext,
} from "./builders.service";
import {
  TypeBGatewayError,
  drainTypeBQueue,
  enqueueTypeBMessage,
  ingestInboundTypeB,
  pnlIssued,
  stationsFor,
  typeBConfig,
} from "./gateway.service";
import { configuredTypeBTransport } from "./transport";

export const TYPEB_CONSUMER = "typeb-gateway";
const TRIGGER_EVENT_TYPES = [
  "booking.confirmed",
  "booking.cancelled",
  "aviation.departure_actual",
  "aviation.arrival_actual",
  "aviation.baggage_custody",
] as const;
const MAX_EVENT_ATTEMPTS = 5;
/** Events older than this are not turned into messages (stale manifest changes). */
const EVENT_LOOKBACK_MS = 3 * 86400000;

function db() {
  const handle = getDb();
  if (!handle) throw new Error("Database not available");
  return handle;
}

/** Pure: is a PNL due for this flight at `now`? */
export function pnlDue(
  flight: { departureTime: Date; status: string },
  now: Date,
  leadMinutes: number
): boolean {
  if (flight.status === "cancelled" || flight.status === "completed")
    return false;
  const lead = leadMinutes * 60000;
  const untilDeparture = flight.departureTime.getTime() - now.getTime();
  // Due inside the lead window; a flight already past departure by more than
  // the window is history, not a missing PNL.
  return untilDeparture <= lead && untilDeparture > -lead;
}

/** Queue PNLs for flights entering the lead window. */
export async function queueDuePnls(now = new Date()) {
  const { pnlLeadMinutes } = typeBConfig();
  const lead = pnlLeadMinutes * 60000;
  const rows = await db()
    .select({
      id: flights.id,
      tenantId: flights.tenantId,
      departureTime: flights.departureTime,
      status: flights.status,
    })
    .from(flights)
    .where(
      and(
        gte(flights.departureTime, new Date(now.getTime() - lead)),
        lte(flights.departureTime, new Date(now.getTime() + lead)),
        ne(flights.status, "cancelled")
      )
    )
    .orderBy(asc(flights.departureTime))
    .limit(200);
  let queued = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const row of rows) {
    if (!pnlDue(row, now, pnlLeadMinutes)) continue;
    if (await pnlIssued(row.id)) continue;
    try {
      const flight = await loadFlightContext(row.id, null);
      const stations = stationsFor("PNL", flight.origin, flight.destination);
      const result = await enqueueTypeBMessage({
        payload: await buildPnlPayload(flight),
        tenantId: flight.tenantId,
        flightId: flight.id,
        stations,
        dedupKey: `PNL:${flight.id}`,
      });
      if (result.duplicates === result.ids.length) skipped += 1;
      else queued += 1;
    } catch (error) {
      if (
        error instanceof TypeBGatewayError &&
        /No enabled Type B address/.test(error.message)
      ) {
        skipped += 1;
        continue;
      }
      errors.push(
        `flight ${row.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { queued, skipped, errors };
}

const bookingPayload = z.object({ bookingId: z.number().int().positive() });
const evidencePayload = z.object({ evidenceId: z.number().int().positive() });
const timePayload = z.object({ time: z.iso.datetime() });

async function flightsOfBooking(bookingId: number) {
  const handle = db();
  const [b] = await handle
    .select({ flightId: bookings.flightId, tenantId: bookings.tenantId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!b) return { tenantId: null, flightIds: [] as number[] };
  const segments = await handle
    .select({ flightId: bookingSegments.flightId })
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, bookingId));
  const ids = segments.length ? segments.map(s => s.flightId) : [b.flightId];
  return { tenantId: b.tenantId, flightIds: [...new Set(ids)] };
}

/** Effect for one archived event. Returns a short description for the log. */
export async function typeBEffect(event: InboxEvent): Promise<string> {
  switch (event.eventType) {
    case "booking.confirmed":
    case "booking.cancelled": {
      const bookingId =
        event.aggregateType === "booking"
          ? Number(event.aggregateId)
          : bookingPayload.parse(event.payload).bookingId;
      const { tenantId, flightIds } = await flightsOfBooking(bookingId);
      const notes: string[] = [];
      for (const flightId of flightIds) {
        if (!(await pnlIssued(flightId))) {
          notes.push(
            `flight ${flightId}: no PNL yet, change is in the full list`
          );
          continue;
        }
        const flight = await loadFlightContext(flightId, tenantId);
        const payload = await buildAdlPayload(
          flight,
          bookingId,
          event.eventType === "booking.confirmed" ? "ADD" : "DEL"
        );
        if (!payload) {
          notes.push(`flight ${flightId}: booking has no names`);
          continue;
        }
        const result = await enqueueTypeBMessage({
          payload,
          tenantId: flight.tenantId,
          flightId,
          stations: stationsFor("ADL", flight.origin, flight.destination),
          dedupKey: `ADL:${flightId}:${event.eventId}`,
        });
        notes.push(`flight ${flightId}: ADL ${result.ids.join(",")}`);
      }
      return notes.join("; ") || "booking has no flights";
    }
    case "aviation.departure_actual":
    case "aviation.arrival_actual": {
      const { evidenceId } = evidencePayload.parse(event.payload);
      const [evidence] = await db()
        .select()
        .from(aviationEvidence)
        .where(eq(aviationEvidence.id, evidenceId))
        .limit(1);
      if (!evidence?.flightId)
        throw new Error("Evidence has no flight instance");
      const time = new Date(timePayload.parse(evidence.payload).time);
      const flight = await loadFlightContext(
        evidence.flightId,
        evidence.tenantId
      );
      if (!flight.registration)
        return `flight ${flight.id}: no registration assigned, MVT not generated`;
      const departure = event.eventType === "aviation.departure_actual";
      const delayMinutes = departure
        ? Math.max(
            0,
            Math.round(
              (time.getTime() - flight.departureTime.getTime()) / 60000
            )
          )
        : 0;
      const remarks = departure
        ? [
            "OFF BLOCKS TIME ONLY AIRBORNE NOT RECORDED",
            ...(delayMinutes > 0
              ? [`DEP DELAY ${delayMinutes} MIN REASON NOT CODED`]
              : []),
          ]
        : ["ON BLOCKS TIME ONLY TOUCHDOWN NOT RECORDED"];
      const payload = buildMvtPayload(
        flight,
        departure
          ? {
              kind: "AD",
              offBlocks: time,
              estimatedArrival: new Date(
                flight.arrivalTime.getTime() + delayMinutes * 60000
              ),
              destination: flight.destination,
            }
          : { kind: "AA", onBlocks: time },
        { remarks }
      );
      const result = await enqueueTypeBMessage({
        payload,
        tenantId: flight.tenantId,
        flightId: flight.id,
        stations: stationsFor("MVT", flight.origin, flight.destination),
        dedupKey: `MVT:${flight.id}:${event.eventId}`,
      });
      return `flight ${flight.id}: MVT ${payload.movement.kind} ${result.ids.join(",")}`;
    }
    case "aviation.baggage_custody": {
      const { evidenceId } = evidencePayload.parse(event.payload);
      const [custody] = await db()
        .select()
        .from(baggageCustodyEvents)
        .where(eq(baggageCustodyEvents.evidenceId, evidenceId))
        .limit(1);
      if (!custody) throw new Error("Custody event not found for evidence");
      if (custody.stage !== "acceptance")
        return `bag ${custody.baggageId}: ${custody.stage} scan, BSM is sent on acceptance only`;
      const built = await buildBsmPayload(custody.baggageId, custody.flightId);
      if ("skipped" in built) return built.skipped;
      const flight = await loadFlightContext(built.flightId, built.tenantId);
      const result = await enqueueTypeBMessage({
        payload: built.payload,
        tenantId: built.tenantId,
        flightId: built.flightId,
        stations: stationsFor("BSM", flight.origin, flight.destination),
        dedupKey: `BSM:${custody.baggageId}:${event.eventId}`,
      });
      return `bag ${custody.baggageId}: BSM ${result.ids.join(",")}`;
    }
    default:
      return "ignored";
  }
}

/** Archived events not yet (successfully) consumed by this gateway. */
export async function pendingTriggerEvents(now = new Date(), limit = 100) {
  return await db()
    .select({
      event: eventInbox,
      receiptStatus: eventDeliveries.status,
      attempts: eventDeliveries.attempts,
    })
    .from(eventInbox)
    .leftJoin(
      eventDeliveries,
      and(
        eq(eventDeliveries.eventId, eventInbox.eventId),
        eq(eventDeliveries.consumer, TYPEB_CONSUMER)
      )
    )
    .where(
      and(
        inArray(eventInbox.eventType, [...TRIGGER_EVENT_TYPES]),
        gte(eventInbox.createdAt, new Date(now.getTime() - EVENT_LOOKBACK_MS)),
        or(
          isNull(eventDeliveries.id),
          and(
            eq(eventDeliveries.status, "failed"),
            lt(eventDeliveries.attempts, MAX_EVENT_ATTEMPTS)
          )
        )
      )
    )
    .orderBy(asc(eventInbox.createdAt))
    .limit(limit);
}

export async function consumeTriggerEvents(now = new Date()) {
  const rows = await pendingTriggerEvents(now);
  let processed = 0;
  let duplicates = 0;
  const errors: string[] = [];
  for (const { event } of rows) {
    const inbox: InboxEvent = {
      eventId: event.eventId,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      tenantId: event.tenantId,
      payload: event.payload,
      schemaVersion: event.schemaVersion,
      traceId: event.traceId,
      spanId: event.spanId,
    };
    try {
      const outcome = await deliverExternalEffect(
        inbox,
        TYPEB_CONSUMER,
        async () => {
          const note = await typeBEffect(inbox);
          logger.debug({ eventId: event.eventId, note }, "Type B trigger");
        }
      );
      if (outcome.duplicate) duplicates += 1;
      else processed += 1;
    } catch (error) {
      // No address subscribed is a configuration state, not a fault; the
      // receipt stays failed and is retried until the station file changes
      // or the attempt budget is spent.
      errors.push(
        `${event.eventType} ${event.eventId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { processed, duplicates, errors };
}

/** One scheduler tick: drain outbound, poll inbound, run both trigger sources. */
export async function runTypeBGatewayTick(now = new Date()) {
  const transport = configuredTypeBTransport();
  const result = {
    transport: transport?.id ?? null,
    outbound: { sent: 0, failed: 0 },
    inbound: 0,
    pnl: { queued: 0, skipped: 0, errors: [] as string[] },
    events: { processed: 0, duplicates: 0, errors: [] as string[] },
  };
  const { originAddress } = typeBConfig();
  if (originAddress) {
    result.pnl = await queueDuePnls(now);
    result.events = await consumeTriggerEvents(now);
  }
  if (transport) {
    result.outbound = await drainTypeBQueue(transport);
    if (transport.receive)
      for (const message of await transport.receive()) {
        await ingestInboundTypeB({
          raw: message.raw,
          transportReference: message.transportReference,
          transportId: transport.id,
          tenantId: null,
          now,
        });
        result.inbound += 1;
      }
  }
  const failures = [...result.pnl.errors, ...result.events.errors];
  if (failures.length)
    logger.warn(
      { failures: failures.slice(0, 10) },
      "Type B gateway tick had failures"
    );
  if (result.outbound.failed)
    throw new Error(`${result.outbound.failed} Type B deliveries failed`);
  return result;
}

export const triggerEventTypes = TRIGGER_EVENT_TYPES;
