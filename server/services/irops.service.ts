import {
  transitionFlight,
  flightBookingCondition,
} from "./flight-state.service";
import { createHash } from "node:crypto";
import { recordEvent } from "./outbox.service";
import type { SettlementTx } from "./booking-settlement.service";
import { getDb } from "../db";
import {
  flightDisruptions,
  iropsActions,
  notifications,
  flights,
  bookings,
  bookingSegments,
  passengers,
  airports,
} from "../../drizzle/schema";
import { eq, and, sql, ne, inArray, gte, lte, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ============================================================================
// IROPS (Irregular Operations) Types
// ============================================================================

/**
 * IROPS event types extend the base disruption types with
 * equipment_change for aircraft swap scenarios.
 */
export type IROPSEventType =
  | "delay"
  | "cancellation"
  | "diversion"
  | "equipment_change";

export type IROPSSeverity = "low" | "medium" | "high" | "critical";

export type IROPSEventStatus = "active" | "recovering" | "resolved";

export type IROPSActionType =
  | "rebook"
  | "hotel"
  | "compensation"
  | "notification"
  | "meal_voucher";

export type IROPSActionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

/**
 * Represents a full IROPS event with computed fields
 */
export interface IROPSEvent {
  id: number;
  flightId: number;
  eventType: IROPSEventType;
  severity: IROPSSeverity;
  delayMinutes: number | null;
  reason: string;
  affectedPassengers: number;
  connectionsAtRisk: number;
  estimatedRecoveryTime: Date | null;
  status: IROPSEventStatus;
  escalationLevel: number;
  createdBy: number | null;
  createdAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
  // Enriched fields
  flightNumber?: string;
  origin?: string;
  destination?: string;
  departureTime?: Date;
}

/**
 * Represents an action taken for an IROPS event
 */
export interface IROPSAction {
  id: number;
  eventId: number;
  actionType: IROPSActionType;
  targetPassengerId: number | null;
  status: IROPSActionStatus;
  details: Record<string, unknown>;
  createdAt: Date;
  completedAt: Date | null;
  evidenceType: string | null;
  evidenceId: string | null;
}

/**
 * Dashboard summary data
 */
export interface IROPSDashboardData {
  activeDisruptions: number;
  totalPassengersAffected: number;
  connectionsAtRisk: number;
  recoveryRate: number;
  criticalEvents: number;
  recentEvents: IROPSEvent[];
  recentActions: IROPSAction[];
  severityBreakdown: Record<IROPSSeverity, number>;
}

/**
 * Recovery metrics for a date range
 */
export interface RecoveryMetrics {
  totalEvents: number;
  resolvedEvents: number;
  avgResolutionMinutes: number;
  rebookingSuccess: number;
  compensationIssued: number;
  passengersRecovered: number;
  recoveryRatePercent: number;
}

// ============================================================================
// Durable state uses flight_disruptions + irops_actions. No process-local authority.
async function iropsDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "IROPS storage unavailable",
    });
  return db;
}
const affectedBooking = flightBookingCondition;
async function readEvent(eventId: number): Promise<IROPSEvent | null> {
  const db = await iropsDb();
  const [row] = await db
    .select({ disruption: flightDisruptions, flight: flights })
    .from(flightDisruptions)
    .innerJoin(flights, eq(flights.id, flightDisruptions.flightId))
    .where(eq(flightDisruptions.id, eventId))
    .limit(1);
  if (!row) return null;
  const { disruption: d, flight: f } = row;
  const impact = await computeFlightImpact(db, d.flightId);
  const codes = await db
    .select({ id: airports.id, code: airports.code })
    .from(airports)
    .where(inArray(airports.id, [f.originId, f.destinationId]));
  return {
    id: d.id,
    flightId: d.flightId,
    eventType: d.iropsType ?? mapDisruptionType(d.type),
    severity: d.iropsSeverity ?? mapSeverity(d.severity),
    delayMinutes: d.delayMinutes,
    reason: d.reason,
    affectedPassengers: impact.totalPassengers,
    connectionsAtRisk: impact.connectionsAtRisk,
    estimatedRecoveryTime: d.estimatedRecoveryTime,
    status:
      d.status === "active"
        ? d.protectionStartedAt
          ? "recovering"
          : "active"
        : "resolved",
    escalationLevel: d.escalationLevel,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
    resolvedAt: d.resolvedAt,
    updatedAt: d.updatedAt,
    flightNumber: f.flightNumber,
    departureTime: f.departureTime,
    origin: codes.find(c => c.id === f.originId)?.code,
    destination: codes.find(c => c.id === f.destinationId)?.code,
  };
}
export function countProtectedPassengers(
  actions: Array<
    Pick<
      typeof iropsActions.$inferSelect,
      | "eventId"
      | "targetPassengerId"
      | "actionType"
      | "status"
      | "evidenceType"
      | "evidenceId"
    >
  >
): number {
  return new Set(
    actions
      .filter(
        a =>
          a.actionType === "rebook" &&
          a.status === "completed" &&
          a.targetPassengerId !== null &&
          a.evidenceType === "booking_reaccommodation" &&
          a.evidenceId
      )
      .map(a => `${a.eventId}:${a.targetPassengerId}`)
  ).size;
}

/**
 * Get all current/active disruptions with IROPS enrichment
 */
export async function getActiveIROPSDisruptions(): Promise<IROPSEvent[]> {
  const db = await iropsDb();
  const rows = await db
    .select({ id: flightDisruptions.id })
    .from(flightDisruptions)
    .where(eq(flightDisruptions.status, "active"))
    .orderBy(desc(flightDisruptions.createdAt))
    .limit(5001);
  if (rows.length > 5000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "IROPS active-event limit exceeded",
    });
  const events = await Promise.all(rows.map(row => readEvent(row.id)));
  return events.filter((event): event is IROPSEvent => event !== null);
}

export async function createDisruptionEvent(
  flightId: number,
  type: IROPSEventType,
  details: {
    reason: string;
    severity: IROPSSeverity;
    delayMinutes?: number;
    estimatedRecoveryTime?: Date;
    createdBy?: number;
  }
): Promise<IROPSEvent> {
  const db = await iropsDb();
  const id = await db.transaction(async tx => {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .for("update");
    if (!flight)
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    const [result] = await tx.insert(flightDisruptions).values({
      flightId,
      type: type === "equipment_change" ? "diversion" : type,
      iropsType: type,
      reason: details.reason,
      severity:
        details.severity === "low"
          ? "minor"
          : details.severity === "medium"
            ? "moderate"
            : "severe",
      iropsSeverity: details.severity,
      escalationLevel: severityToEscalationLevel(details.severity),
      originalDepartureTime: flight.departureTime,
      delayMinutes: details.delayMinutes ?? null,
      estimatedRecoveryTime: details.estimatedRecoveryTime ?? null,
      createdBy: details.createdBy ?? null,
    });
    if (!result.insertId) throw new Error("Missing disruption identity");
    if (type === "cancellation" || type === "delay")
      await transitionFlight(tx, {
        flightId,
        status: type === "cancellation" ? "cancelled" : "delayed",
        reason: details.reason,
        delayMinutes: details.delayMinutes,
        adminUserId: details.createdBy,
        disruptionId: result.insertId,
      });
    await recordEvent(tx, {
      aggregateType: "disruption",
      aggregateId: result.insertId,
      tenantId: flight.tenantId,
      eventType: "irops.created",
      payload: { flightId, type },
    });
    return result.insertId;
  });
  const event = await readEvent(id);
  if (!event) throw new Error("Created disruption cannot be read");
  return event;
}

export async function getDisruptionImpact(flightId: number): Promise<{
  totalPassengers: number;
  connectionsAtRisk: number;
  estimatedCostSAR: number;
  bookingsAffected: number;
  businessClassPassengers: number;
  economyClassPassengers: number;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const impact = await computeFlightImpact(db, flightId);

  // Get booking-level details for cost estimation
  const affectedBookings = await db
    .select({
      id: bookings.id,
      totalAmount: bookings.totalAmount,
      cabinClass: bookings.cabinClass,
      numberOfPassengers: bookings.numberOfPassengers,
    })
    .from(bookings)
    .where(and(affectedBooking(flightId), ne(bookings.status, "cancelled")));

  let businessClassPassengers = 0;
  let economyClassPassengers = 0;
  let estimatedCostSAR = 0;

  for (const b of affectedBookings) {
    if (b.cabinClass === "business") {
      businessClassPassengers += b.numberOfPassengers;
      // Compensation estimate: 50% of ticket cost for business
      estimatedCostSAR += Math.round(b.totalAmount * 0.5);
    } else {
      economyClassPassengers += b.numberOfPassengers;
      // Compensation estimate: 30% of ticket cost for economy
      estimatedCostSAR += Math.round(b.totalAmount * 0.3);
    }
  }

  // Add hotel and meal costs estimate per passenger
  // 500 SAR hotel + 150 SAR meals per affected passenger (in cents)
  estimatedCostSAR += impact.totalPassengers * (50000 + 15000);

  return {
    totalPassengers: impact.totalPassengers,
    connectionsAtRisk: impact.connectionsAtRisk,
    estimatedCostSAR,
    bookingsAffected: affectedBookings.length,
    businessClassPassengers,
    economyClassPassengers,
  };
}

/**
 * Get all affected passengers for a disrupted flight
 */
export async function getAffectedPassengers(flightId: number): Promise<
  Array<{
    passengerId: number;
    firstName: string;
    lastName: string;
    type: string;
    bookingReference: string;
    bookingId: number;
    cabinClass: string;
    seatNumber: string | null;
    ticketNumber: string | null;
    hasConnection: boolean;
    connectionFlightNumber: string | null;
    contactEmail: string | null;
  }>
> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get all active bookings for this flight
  const affectedBookings = await db
    .select({
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      cabinClass: bookings.cabinClass,
      userId: bookings.userId,
    })
    .from(bookings)
    .where(and(affectedBooking(flightId), ne(bookings.status, "cancelled")));

  if (affectedBookings.length === 0) return [];

  const bookingIds = affectedBookings.map(b => b.bookingId);

  // Get all passengers
  const affectedPassengers = await db
    .select({
      id: passengers.id,
      bookingId: passengers.bookingId,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      type: passengers.type,
      seatNumber: passengers.seatNumber,
      ticketNumber: passengers.ticketNumber,
    })
    .from(passengers)
    .where(inArray(passengers.bookingId, bookingIds));

  // Get the original flight details
  const [flight] = await db
    .select({
      arrivalTime: flights.arrivalTime,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  const userIds = affectedBookings.map(b => b.userId);
  const connectionMap = new Map<number, string>();
  if (flight) {
    const connections = await db
      .select({
        bookingId: bookingSegments.bookingId,
        flightNumber: flights.flightNumber,
      })
      .from(bookingSegments)
      .innerJoin(flights, eq(flights.id, bookingSegments.flightId))
      .where(
        and(
          inArray(bookingSegments.bookingId, bookingIds),
          ne(bookingSegments.status, "cancelled"),
          eq(flights.originId, flight.destinationId),
          gte(flights.departureTime, flight.arrivalTime),
          lte(
            flights.departureTime,
            new Date(flight.arrivalTime.getTime() + 86400000)
          ),
          sql`${bookingSegments.segmentOrder} > (SELECT bs.segmentOrder FROM booking_segments bs WHERE bs.bookingId = ${bookingSegments.bookingId} AND bs.flightId = ${flightId} ORDER BY bs.segmentOrder LIMIT 1)`
        )
      );
    for (const c of connections) connectionMap.set(c.bookingId, c.flightNumber);
  }

  // Get user emails for contact
  const userEmails = await db
    .select({
      id: sql<number>`users.id`,
      email: sql<string>`users.email`,
    })
    .from(sql`users`)
    .where(inArray(sql`users.id`, userIds));

  const emailMap = new Map<number, string | null>();
  for (const u of userEmails) {
    emailMap.set(u.id, u.email);
  }

  return affectedPassengers.map(p => {
    const booking = affectedBookings.find(b => b.bookingId === p.bookingId);
    const userId = booking?.userId ?? 0;
    const connectionFlight = connectionMap.get(p.bookingId) ?? null;

    return {
      passengerId: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      type: p.type,
      bookingReference: booking?.bookingReference ?? "",
      bookingId: p.bookingId,
      cabinClass: booking?.cabinClass ?? "economy",
      seatNumber: p.seatNumber,
      ticketNumber: p.ticketNumber,
      hasConnection: connectionFlight !== null,
      connectionFlightNumber: connectionFlight,
      contactEmail: emailMap.get(userId) ?? null,
    };
  });
}

/**
 * Automatically trigger protection actions for passengers on a disrupted flight.
 * This creates pending rebook, notification, and meal_voucher actions.
 */
export async function autoTriggerProtection(flightId: number): Promise<{
  actionsCreated: number;
  passengersAffected: number;
  passengersPlanned: number;
  passengersProtected: number;
  actions: IROPSAction[];
}> {
  const db = await iropsDb();
  const affectedPax = await getAffectedPassengers(flightId);
  return db.transaction(async tx => {
    const [event] = await tx
      .select()
      .from(flightDisruptions)
      .where(
        and(
          eq(flightDisruptions.flightId, flightId),
          eq(flightDisruptions.status, "active")
        )
      )
      .orderBy(desc(flightDisruptions.id))
      .limit(1)
      .for("update");
    if (!event)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No active disruption for this flight",
      });
    const existing = await tx
      .select()
      .from(iropsActions)
      .where(eq(iropsActions.eventId, event.id));
    const keys = new Set(existing.map(a => a.requestKey));
    let actionsCreated = 0;
    for (const pax of affectedPax) {
      const types: IROPSActionType[] = [
        "rebook",
        "notification",
        "meal_voucher",
        ...(pax.hasConnection ? ["hotel" as const] : []),
      ];
      for (const actionType of types) {
        const requestKey = `protection:${event.id}:${pax.passengerId}:${actionType}`;
        if (keys.has(requestKey)) continue;
        await tx.insert(iropsActions).values({
          eventId: event.id,
          requestKey,
          actionType,
          targetPassengerId: pax.passengerId,
          details: {
            bookingId: pax.bookingId,
            cabinClass: pax.cabinClass,
            hasConnection: pax.hasConnection,
          },
        });
        actionsCreated++;
      }
    }
    await tx
      .update(flightDisruptions)
      .set({ protectionStartedAt: event.protectionStartedAt ?? new Date() })
      .where(eq(flightDisruptions.id, event.id));
    if (actionsCreated)
      await recordEvent(tx, {
        aggregateType: "disruption",
        aggregateId: event.id,
        eventType: "irops.protection_planned",
        payload: { flightId, actionsCreated },
      });
    const actions = await tx
      .select()
      .from(iropsActions)
      .where(eq(iropsActions.eventId, event.id));
    return {
      actionsCreated,
      passengersAffected: affectedPax.length,
      passengersPlanned: new Set(
        actions
          .filter(a => a.actionType === "rebook")
          .map(a => a.targetPassengerId)
      ).size,
      passengersProtected: countProtectedPassengers(actions),
      actions,
    };
  });
}

export async function getIROPSDashboard(): Promise<IROPSDashboardData> {
  const db = await iropsDb();
  const activeEvents = await getActiveIROPSDisruptions();
  const [counts] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      resolved: sql<number>`COALESCE(SUM(${flightDisruptions.status} = 'resolved'), 0)`,
    })
    .from(flightDisruptions);
  const recentActions = await db
    .select()
    .from(iropsActions)
    .orderBy(desc(iropsActions.createdAt), desc(iropsActions.id))
    .limit(20);
  const severityBreakdown: Record<IROPSSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const event of activeEvents) severityBreakdown[event.severity]++;
  return {
    activeDisruptions: activeEvents.length,
    totalPassengersAffected: activeEvents.reduce(
      (n, e) => n + e.affectedPassengers,
      0
    ),
    connectionsAtRisk: activeEvents.reduce(
      (n, e) => n + e.connectionsAtRisk,
      0
    ),
    recoveryRate: Number(counts.total)
      ? (Number(counts.resolved) / Number(counts.total)) * 100
      : 0,
    criticalEvents: severityBreakdown.critical,
    recentEvents: activeEvents.slice(0, 10),
    recentActions,
    severityBreakdown,
  };
}

export async function getRecoveryMetrics(dateRange: {
  start: Date;
  end: Date;
}): Promise<RecoveryMetrics> {
  const db = await iropsDb();
  if (
    !Number.isFinite(dateRange.start.getTime()) ||
    !Number.isFinite(dateRange.end.getTime()) ||
    dateRange.start > dateRange.end
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid recovery period",
    });
  const events = await db
    .select()
    .from(flightDisruptions)
    .where(
      and(
        gte(flightDisruptions.createdAt, dateRange.start),
        lte(flightDisruptions.createdAt, dateRange.end)
      )
    )
    .limit(50001);
  if (events.length > 50000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Narrow the recovery period",
    });
  const rows = events.length
    ? await db
        .select()
        .from(iropsActions)
        .where(
          inArray(
            iropsActions.eventId,
            events.map(e => e.id)
          )
        )
    : [];
  const resolved = events.filter(e => e.status === "resolved" && e.resolvedAt);
  return {
    totalEvents: events.length,
    resolvedEvents: resolved.length,
    avgResolutionMinutes: resolved.length
      ? resolved.reduce(
          (n, e) =>
            n +
            ((e.resolvedAt?.getTime() ?? e.createdAt.getTime()) -
              e.createdAt.getTime()) /
              60000,
          0
        ) / resolved.length
      : 0,
    rebookingSuccess: countProtectedPassengers(rows),
    passengersRecovered: countProtectedPassengers(rows),
    compensationIssued: rows.filter(
      a =>
        a.actionType === "compensation" &&
        a.status === "completed" &&
        a.evidenceId
    ).length,
    recoveryRatePercent: events.length
      ? (resolved.length / events.length) * 100
      : 0,
  };
}

export async function sendMassNotification(
  flightId: number,
  message: string
): Promise<{ notificationsSent: number; failedCount: number }> {
  const db = await iropsDb();
  const affected = await db
    .select({ userId: bookings.userId })
    .from(bookings)
    .where(and(affectedBooking(flightId), ne(bookings.status, "cancelled")));
  const digest = createHash("sha256").update(message).digest("hex");
  return db.transaction(async tx => {
    const [event] = await tx
      .select()
      .from(flightDisruptions)
      .where(
        and(
          eq(flightDisruptions.flightId, flightId),
          eq(flightDisruptions.status, "active")
        )
      )
      .orderBy(desc(flightDisruptions.id))
      .limit(1)
      .for("update");
    if (!event)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No active disruption",
      });
    for (const userId of new Set(affected.map(b => b.userId))) {
      const requestKey = `notify:${event.id}:${userId}:${digest}`;
      const [old] = await tx
        .select({ id: iropsActions.id })
        .from(iropsActions)
        .where(eq(iropsActions.requestKey, requestKey))
        .limit(1);
      if (old) continue;
      const [notice] = await tx.insert(notifications).values({
        userId,
        type: "flight",
        title: "Flight disruption",
        message,
        data: JSON.stringify({ flightId, eventId: event.id }),
      });
      if (!notice.insertId) throw new Error("Missing notification receipt");
      await tx.insert(iropsActions).values({
        eventId: event.id,
        requestKey,
        actionType: "notification",
        status: "completed",
        details: { userId },
        evidenceType: "in_app_notification",
        evidenceId: String(notice.insertId),
        completedAt: new Date(),
      });
      await recordEvent(tx, {
        aggregateType: "notification",
        aggregateId: notice.insertId,
        eventType: "irops.notification_created",
        payload: { userId, flightId },
      });
    }
    // This is creation in the user's inbox, not an email delivery receipt.
    return {
      notificationsSent: new Set(affected.map(b => b.userId)).size,
      failedCount: 0,
    };
  });
}

export async function getConnectionsAtRisk(flightId: number): Promise<
  Array<{
    passengerId: number;
    passengerName: string;
    bookingReference: string;
    connectionFlightNumber: string;
    connectionDepartureTime: Date;
    connectionOrigin: string;
    connectionDestination: string;
    minutesUntilConnection: number;
    riskLevel: "low" | "medium" | "high" | "critical";
  }>
> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get the disrupted flight details
  const [flight] = await db
    .select({
      arrivalTime: flights.arrivalTime,
      destinationId: flights.destinationId,
      status: flights.status,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) return [];

  // Get disruption info for delay
  const [disruption] = await db
    .select({ delayMinutes: flightDisruptions.delayMinutes })
    .from(flightDisruptions)
    .where(
      and(
        eq(flightDisruptions.flightId, flightId),
        eq(flightDisruptions.status, "active")
      )
    )
    .orderBy(desc(flightDisruptions.createdAt))
    .limit(1);

  const delayMinutes = disruption?.delayMinutes ?? 0;
  const estimatedArrival = new Date(flight.arrivalTime);
  estimatedArrival.setMinutes(estimatedArrival.getMinutes() + delayMinutes);

  // Get all affected user IDs
  const affectedBookings = await db
    .select({
      userId: bookings.userId,
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
    })
    .from(bookings)
    .where(and(affectedBooking(flightId), ne(bookings.status, "cancelled")));

  if (affectedBookings.length === 0) return [];

  const userIds = affectedBookings.map(b => b.userId);

  // Find connecting flights within 24h from destination
  const twentyFourHoursLater = new Date(flight.arrivalTime);
  twentyFourHoursLater.setHours(twentyFourHoursLater.getHours() + 24);

  const connectingFlights = await db
    .select({
      userId: bookings.userId,
      bookingId: bookings.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(
      and(
        inArray(bookings.userId, userIds),
        eq(flights.originId, flight.destinationId),
        ne(bookings.status, "cancelled"),
        gte(flights.departureTime, flight.arrivalTime),
        lte(flights.departureTime, twentyFourHoursLater)
      )
    );

  if (connectingFlights.length === 0) return [];

  // Get airport codes for all connections
  const connectionDestIds = [
    ...new Set(connectingFlights.map(c => c.destinationId)),
  ];
  const allAirportIds = [flight.destinationId, ...connectionDestIds];

  const airportResults = await db
    .select({ id: airports.id, code: airports.code })
    .from(airports)
    .where(inArray(airports.id, allAirportIds));

  const airportCodeMap = new Map<number, string>();
  for (const a of airportResults) {
    airportCodeMap.set(a.id, a.code);
  }

  // Get passenger names for the affected bookings
  const bookingIds = affectedBookings.map(b => b.bookingId);
  const paxList = await db
    .select({
      id: passengers.id,
      bookingId: passengers.bookingId,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
    })
    .from(passengers)
    .where(inArray(passengers.bookingId, bookingIds));

  const results: Array<{
    passengerId: number;
    passengerName: string;
    bookingReference: string;
    connectionFlightNumber: string;
    connectionDepartureTime: Date;
    connectionOrigin: string;
    connectionDestination: string;
    minutesUntilConnection: number;
    riskLevel: "low" | "medium" | "high" | "critical";
  }> = [];

  for (const conn of connectingFlights) {
    const booking = affectedBookings.find(b => b.userId === conn.userId);
    if (!booking) continue;

    const pax = paxList.filter(p => p.bookingId === booking.bookingId);

    // Calculate minutes between estimated arrival and connection departure
    const minutesUntilConnection = Math.round(
      (conn.departureTime.getTime() - estimatedArrival.getTime()) / 60000
    );

    // Minimum connection time is ~90 minutes
    let riskLevel: "low" | "medium" | "high" | "critical";
    if (minutesUntilConnection < 0) {
      riskLevel = "critical";
    } else if (minutesUntilConnection < 60) {
      riskLevel = "critical";
    } else if (minutesUntilConnection < 90) {
      riskLevel = "high";
    } else if (minutesUntilConnection < 120) {
      riskLevel = "medium";
    } else {
      riskLevel = "low";
    }

    for (const p of pax) {
      results.push({
        passengerId: p.id,
        passengerName: `${p.firstName} ${p.lastName}`,
        bookingReference: booking.bookingReference,
        connectionFlightNumber: conn.flightNumber,
        connectionDepartureTime: conn.departureTime,
        connectionOrigin: airportCodeMap.get(conn.originId) ?? "???",
        connectionDestination: airportCodeMap.get(conn.destinationId) ?? "???",
        minutesUntilConnection,
        riskLevel,
      });
    }
  }

  // Sort by risk level priority: critical > high > medium > low
  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return results.sort(
    (a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]
  );
}

/**
 * Escalate a disruption event to a higher severity level
 */
export async function escalateDisruption(
  disruptionId: number,
  level: IROPSSeverity
): Promise<IROPSEvent> {
  const db = await iropsDb();
  await db.transaction(async tx => {
    const [event] = await tx
      .select()
      .from(flightDisruptions)
      .where(eq(flightDisruptions.id, disruptionId))
      .for("update");
    if (!event)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "IROPS event not found",
      });
    if (event.status !== "active")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Disruption is closed",
      });
    await tx
      .update(flightDisruptions)
      .set({
        severity:
          level === "low"
            ? "minor"
            : level === "medium"
              ? "moderate"
              : "severe",
        iropsSeverity: level,
        escalationLevel: severityToEscalationLevel(level),
      })
      .where(eq(flightDisruptions.id, disruptionId));
    await recordEvent(tx, {
      aggregateType: "disruption",
      aggregateId: disruptionId,
      eventType: "irops.escalated",
      payload: { level },
    });
  });
  const event = await readEvent(disruptionId);
  if (!event) throw new Error("Disruption unavailable");
  return event;
}

export async function resolveIROPSEvent(eventId: number): Promise<IROPSEvent> {
  const db = await iropsDb();
  await db.transaction(async tx => {
    const [event] = await tx
      .select()
      .from(flightDisruptions)
      .where(eq(flightDisruptions.id, eventId))
      .for("update");
    if (!event)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "IROPS event not found",
      });
    if (event.status === "resolved") return;
    const [pending] = await tx
      .select({ id: iropsActions.id })
      .from(iropsActions)
      .where(
        and(
          eq(iropsActions.eventId, eventId),
          ne(iropsActions.status, "completed")
        )
      )
      .limit(1);
    if (pending)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Unconfirmed recovery actions remain",
      });
    await tx
      .update(flightDisruptions)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(eq(flightDisruptions.id, eventId));
    await recordEvent(tx, {
      aggregateType: "disruption",
      aggregateId: eventId,
      eventType: "irops.resolved",
      payload: {},
    });
  });
  const event = await readEvent(eventId);
  if (!event) throw new Error("Disruption unavailable");
  return event;
}

export async function getIROPSEventDetail(eventId: number): Promise<{
  event: IROPSEvent;
  actions: IROPSAction[];
  impact: Awaited<ReturnType<typeof getDisruptionImpact>>;
} | null> {
  const db = await iropsDb();
  const event = await readEvent(eventId);
  if (!event) return null;
  const actions = await db
    .select()
    .from(iropsActions)
    .where(eq(iropsActions.eventId, eventId))
    .orderBy(desc(iropsActions.createdAt));
  return { event, actions, impact: await getDisruptionImpact(event.flightId) };
}

/** Called by the inventory/booking authority in its own successful transaction.
 * There is deliberately no public 'mark completed' endpoint. */
export async function recordReaccommodation(
  tx: SettlementTx,
  actionId: number,
  bookingId: number
) {
  const [action] = await tx
    .select()
    .from(iropsActions)
    .where(eq(iropsActions.id, actionId))
    .for("update");
  if (
    !action ||
    action.actionType !== "rebook" ||
    action.details.bookingId !== bookingId
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Recovery action does not own this booking",
    });
  if (action.status === "completed") return;
  await tx
    .update(iropsActions)
    .set({
      status: "completed",
      evidenceType: "booking_reaccommodation",
      evidenceId: String(bookingId),
      completedAt: new Date(),
    })
    .where(eq(iropsActions.id, actionId));
  await recordEvent(tx, {
    aggregateType: "irops_action",
    aggregateId: actionId,
    eventType: "irops.reaccommodation_confirmed",
    payload: { bookingId },
  });
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Compute passenger and connection counts for a flight
 */
async function computeFlightImpact(
  _db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  flightId: number
): Promise<{
  totalPassengers: number;
  connectionsAtRisk: number;
}> {
  const affected = await getAffectedPassengers(flightId);
  return {
    totalPassengers: affected.length,
    connectionsAtRisk: affected.filter(p => p.hasConnection).length,
  };
}

/**
 * Map base disruption types to IROPS event types
 */
function mapDisruptionType(
  type: "delay" | "cancellation" | "diversion"
): IROPSEventType {
  return type;
}

/**
 * Map base severity to IROPS severity
 */
function mapSeverity(severity: "minor" | "moderate" | "severe"): IROPSSeverity {
  switch (severity) {
    case "minor":
      return "low";
    case "moderate":
      return "medium";
    case "severe":
      return "high";
    default:
      return "medium";
  }
}

/**
 * Map severity to escalation level number
 */
function severityToEscalationLevel(severity: IROPSSeverity): number {
  switch (severity) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "critical":
      return 4;
    default:
      return 1;
  }
}
