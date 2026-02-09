import { getDb } from "../db";
import {
  flightDisruptions,
  flights,
  bookings,
  passengers,
  airports,
  airlines,
  notifications,
} from "../../drizzle/schema";
import { eq, and, sql, ne, inArray, gte, lte, desc, count } from "drizzle-orm";
import { createNotification } from "./notification.service";

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
// In-memory IROPS event/action stores
// These act as lightweight schema-less tables that overlay on top of the
// existing flightDisruptions table for the IROPS-specific fields.
// In a production system these would be their own database tables.
// ============================================================================

let iropsEventIdSeq = 1;
let iropsActionIdSeq = 1;

const iropsEventsStore: Map<number, IROPSEvent> = new Map();
const iropsActionsStore: Map<number, IROPSAction> = new Map();

// ============================================================================
// IROPS Service Functions
// ============================================================================

/**
 * Get all current/active disruptions with IROPS enrichment
 */
export async function getActiveIROPSDisruptions(): Promise<IROPSEvent[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get active disruptions from the DB
  const dbDisruptions = await db
    .select({
      id: flightDisruptions.id,
      flightId: flightDisruptions.flightId,
      type: flightDisruptions.type,
      reason: flightDisruptions.reason,
      severity: flightDisruptions.severity,
      delayMinutes: flightDisruptions.delayMinutes,
      status: flightDisruptions.status,
      createdBy: flightDisruptions.createdBy,
      createdAt: flightDisruptions.createdAt,
      resolvedAt: flightDisruptions.resolvedAt,
      updatedAt: flightDisruptions.updatedAt,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flightDisruptions)
    .innerJoin(flights, eq(flightDisruptions.flightId, flights.id))
    .where(eq(flightDisruptions.status, "active"))
    .orderBy(desc(flightDisruptions.createdAt));

  // Also include in-memory active IROPS events
  const memoryEvents = Array.from(iropsEventsStore.values()).filter(
    e => e.status === "active" || e.status === "recovering"
  );

  // Map DB disruptions to IROPS events (enriching with passenger counts)
  const dbEvents: IROPSEvent[] = await Promise.all(
    dbDisruptions.map(async d => {
      const existing = Array.from(iropsEventsStore.values()).find(
        e => e.flightId === d.flightId && e.reason === d.reason
      );
      if (existing) return existing;

      const impact = await computeFlightImpact(db, d.flightId);

      // Get airport codes
      const [origin] = await db
        .select({ code: airports.code })
        .from(airports)
        .where(eq(airports.id, d.originId))
        .limit(1);

      const [destination] = await db
        .select({ code: airports.code })
        .from(airports)
        .where(eq(airports.id, d.destinationId))
        .limit(1);

      return {
        id: d.id,
        flightId: d.flightId,
        eventType: mapDisruptionType(d.type),
        severity: mapSeverity(d.severity),
        delayMinutes: d.delayMinutes,
        reason: d.reason,
        affectedPassengers: impact.totalPassengers,
        connectionsAtRisk: impact.connectionsAtRisk,
        estimatedRecoveryTime: null,
        status: "active" as IROPSEventStatus,
        escalationLevel: d.severity === "severe" ? 2 : 1,
        createdBy: d.createdBy,
        createdAt: d.createdAt,
        resolvedAt: d.resolvedAt,
        updatedAt: d.updatedAt,
        flightNumber: d.flightNumber,
        origin: origin?.code,
        destination: destination?.code,
        departureTime: d.departureTime,
      };
    })
  );

  // Merge, avoiding duplicates by id
  const seen = new Set<number>();
  const merged: IROPSEvent[] = [];

  for (const ev of dbEvents) {
    if (!seen.has(ev.id)) {
      seen.add(ev.id);
      merged.push(ev);
    }
  }
  for (const ev of memoryEvents) {
    if (!seen.has(ev.id)) {
      seen.add(ev.id);
      merged.push(ev);
    }
  }

  return merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Create a new IROPS disruption event
 */
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Verify flight exists
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) throw new Error("Flight not found");

  // Also create a record in the existing flightDisruptions table for compatibility
  const mappedType = type === "equipment_change" ? "diversion" : type;
  const mappedSeverity =
    details.severity === "low"
      ? "minor"
      : details.severity === "critical"
        ? "severe"
        : details.severity === "high"
          ? "severe"
          : "moderate";

  const [result] = await db.insert(flightDisruptions).values({
    flightId,
    type: mappedType,
    reason: details.reason,
    severity: mappedSeverity,
    originalDepartureTime: flight.departureTime,
    delayMinutes: details.delayMinutes || null,
    status: "active",
    createdBy: details.createdBy || null,
  });

  // Update flight status for cancellations
  if (type === "cancellation") {
    await db
      .update(flights)
      .set({ status: "cancelled" })
      .where(eq(flights.id, flightId));
  } else if (type === "delay") {
    await db
      .update(flights)
      .set({ status: "delayed" })
      .where(eq(flights.id, flightId));
  }

  // Compute impact
  const impact = await computeFlightImpact(db, flightId);

  // Get airport codes
  const [origin] = await db
    .select({ code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.originId))
    .limit(1);

  const [destination] = await db
    .select({ code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);

  const event: IROPSEvent = {
    id: result.insertId || iropsEventIdSeq++,
    flightId,
    eventType: type,
    severity: details.severity,
    delayMinutes: details.delayMinutes ?? null,
    reason: details.reason,
    affectedPassengers: impact.totalPassengers,
    connectionsAtRisk: impact.connectionsAtRisk,
    estimatedRecoveryTime: details.estimatedRecoveryTime ?? null,
    status: "active",
    escalationLevel: details.severity === "critical" ? 3 : 1,
    createdBy: details.createdBy ?? null,
    createdAt: new Date(),
    resolvedAt: null,
    updatedAt: new Date(),
    flightNumber: flight.flightNumber,
    origin: origin?.code,
    destination: destination?.code,
    departureTime: flight.departureTime,
  };

  iropsEventsStore.set(event.id, event);
  return event;
}

/**
 * Calculate total impact for a disrupted flight
 */
export async function getDisruptionImpact(flightId: number): Promise<{
  totalPassengers: number;
  connectionsAtRisk: number;
  estimatedCostSAR: number;
  bookingsAffected: number;
  businessClassPassengers: number;
  economyClassPassengers: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

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
    .where(
      and(eq(bookings.flightId, flightId), ne(bookings.status, "cancelled"))
    );

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
  if (!db) throw new Error("Database not available");

  // Get all active bookings for this flight
  const affectedBookings = await db
    .select({
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      cabinClass: bookings.cabinClass,
      userId: bookings.userId,
    })
    .from(bookings)
    .where(
      and(eq(bookings.flightId, flightId), ne(bookings.status, "cancelled"))
    );

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

  // Check for connecting flights: bookings by the same users on flights
  // departing from this flight's destination within 24h of arrival
  const userIds = affectedBookings.map(b => b.userId);

  const connectionMap: Map<number, string> = new Map();
  if (flight) {
    const twentyFourHoursLater = new Date(flight.arrivalTime);
    twentyFourHoursLater.setHours(twentyFourHoursLater.getHours() + 24);

    const connectingBookings = await db
      .select({
        userId: bookings.userId,
        flightNumber: flights.flightNumber,
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

    for (const cb of connectingBookings) {
      connectionMap.set(cb.userId, cb.flightNumber);
    }
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
    const connectionFlight = connectionMap.get(userId) ?? null;

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
  passengersProtected: number;
  actions: IROPSAction[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const affectedPax = await getAffectedPassengers(flightId);
  const actions: IROPSAction[] = [];

  // Find the IROPS event for this flight
  const event = Array.from(iropsEventsStore.values()).find(
    e => e.flightId === flightId && e.status !== "resolved"
  );

  const eventId = event?.id ?? 0;

  for (const pax of affectedPax) {
    // Create a rebooking action
    const rebookAction: IROPSAction = {
      id: iropsActionIdSeq++,
      eventId,
      actionType: "rebook",
      targetPassengerId: pax.passengerId,
      status: "pending",
      details: {
        passengerName: `${pax.firstName} ${pax.lastName}`,
        bookingReference: pax.bookingReference,
        cabinClass: pax.cabinClass,
        hasConnection: pax.hasConnection,
        connectionFlightNumber: pax.connectionFlightNumber,
      },
      createdAt: new Date(),
      completedAt: null,
    };
    iropsActionsStore.set(rebookAction.id, rebookAction);
    actions.push(rebookAction);

    // Create a notification action
    const notifyAction: IROPSAction = {
      id: iropsActionIdSeq++,
      eventId,
      actionType: "notification",
      targetPassengerId: pax.passengerId,
      status: "pending",
      details: {
        passengerName: `${pax.firstName} ${pax.lastName}`,
        contactEmail: pax.contactEmail,
        message: `Flight disruption - your booking ${pax.bookingReference} is being handled by our IROPS team.`,
      },
      createdAt: new Date(),
      completedAt: null,
    };
    iropsActionsStore.set(notifyAction.id, notifyAction);
    actions.push(notifyAction);

    // Create a meal voucher action
    const mealAction: IROPSAction = {
      id: iropsActionIdSeq++,
      eventId,
      actionType: "meal_voucher",
      targetPassengerId: pax.passengerId,
      status: "pending",
      details: {
        passengerName: `${pax.firstName} ${pax.lastName}`,
        voucherAmountSAR: pax.cabinClass === "business" ? 200 : 100,
      },
      createdAt: new Date(),
      completedAt: null,
    };
    iropsActionsStore.set(mealAction.id, mealAction);
    actions.push(mealAction);

    // If connecting passenger, also create hotel accommodation action
    if (pax.hasConnection) {
      const hotelAction: IROPSAction = {
        id: iropsActionIdSeq++,
        eventId,
        actionType: "hotel",
        targetPassengerId: pax.passengerId,
        status: "pending",
        details: {
          passengerName: `${pax.firstName} ${pax.lastName}`,
          connectionFlight: pax.connectionFlightNumber,
          priority: "high",
        },
        createdAt: new Date(),
        completedAt: null,
      };
      iropsActionsStore.set(hotelAction.id, hotelAction);
      actions.push(hotelAction);
    }
  }

  // Update event status to recovering
  if (event) {
    event.status = "recovering";
    event.updatedAt = new Date();
    iropsEventsStore.set(event.id, event);
  }

  return {
    actionsCreated: actions.length,
    passengersProtected: affectedPax.length,
    actions,
  };
}

/**
 * Get IROPS dashboard summary
 */
export async function getIROPSDashboard(): Promise<IROPSDashboardData> {
  const activeEvents = await getActiveIROPSDisruptions();

  const allEvents = Array.from(iropsEventsStore.values());
  const allActions = Array.from(iropsActionsStore.values());

  const totalPassengersAffected = activeEvents.reduce(
    (sum, e) => sum + e.affectedPassengers,
    0
  );

  const connectionsAtRisk = activeEvents.reduce(
    (sum, e) => sum + e.connectionsAtRisk,
    0
  );

  const totalEvents = allEvents.length;
  const resolvedEvents = allEvents.filter(e => e.status === "resolved").length;
  const recoveryRate =
    totalEvents > 0 ? Math.round((resolvedEvents / totalEvents) * 100) : 100;

  const criticalEvents = activeEvents.filter(
    e => e.severity === "critical"
  ).length;

  const severityBreakdown: Record<IROPSSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const e of activeEvents) {
    severityBreakdown[e.severity]++;
  }

  // Get recent actions sorted by creation time
  const recentActions = allActions
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20);

  return {
    activeDisruptions: activeEvents.length,
    totalPassengersAffected,
    connectionsAtRisk,
    recoveryRate,
    criticalEvents,
    recentEvents: activeEvents.slice(0, 10),
    recentActions,
    severityBreakdown,
  };
}

/**
 * Get recovery performance metrics for a date range
 */
export async function getRecoveryMetrics(dateRange: {
  start: Date;
  end: Date;
}): Promise<RecoveryMetrics> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all disruptions in the date range from the DB
  const disruptions = await db
    .select({
      id: flightDisruptions.id,
      status: flightDisruptions.status,
      createdAt: flightDisruptions.createdAt,
      resolvedAt: flightDisruptions.resolvedAt,
    })
    .from(flightDisruptions)
    .where(
      and(
        gte(flightDisruptions.createdAt, dateRange.start),
        lte(flightDisruptions.createdAt, dateRange.end)
      )
    );

  // Also include in-memory events in the range
  const memoryEvents = Array.from(iropsEventsStore.values()).filter(
    e => e.createdAt >= dateRange.start && e.createdAt <= dateRange.end
  );

  const totalEvents = disruptions.length + memoryEvents.length;
  const resolvedDB = disruptions.filter(d => d.status === "resolved");
  const resolvedMem = memoryEvents.filter(e => e.status === "resolved");
  const resolvedEvents = resolvedDB.length + resolvedMem.length;

  // Average resolution time
  let totalResolutionMs = 0;
  let resolutionCount = 0;

  for (const d of resolvedDB) {
    if (d.resolvedAt) {
      totalResolutionMs += d.resolvedAt.getTime() - d.createdAt.getTime();
      resolutionCount++;
    }
  }
  for (const e of resolvedMem) {
    if (e.resolvedAt) {
      totalResolutionMs += e.resolvedAt.getTime() - e.createdAt.getTime();
      resolutionCount++;
    }
  }

  const avgResolutionMinutes =
    resolutionCount > 0
      ? Math.round(totalResolutionMs / resolutionCount / 60000)
      : 0;

  // Count actions by type in the range
  const rangeActions = Array.from(iropsActionsStore.values()).filter(
    a => a.createdAt >= dateRange.start && a.createdAt <= dateRange.end
  );

  const rebookingSuccess = rangeActions.filter(
    a => a.actionType === "rebook" && a.status === "completed"
  ).length;

  const compensationIssued = rangeActions.filter(
    a => a.actionType === "compensation" && a.status === "completed"
  ).length;

  const passengersRecovered = rangeActions.filter(
    a =>
      (a.actionType === "rebook" || a.actionType === "hotel") &&
      a.status === "completed"
  ).length;

  const recoveryRatePercent =
    totalEvents > 0 ? Math.round((resolvedEvents / totalEvents) * 100) : 100;

  return {
    totalEvents,
    resolvedEvents,
    avgResolutionMinutes,
    rebookingSuccess,
    compensationIssued,
    passengersRecovered,
    recoveryRatePercent,
  };
}

/**
 * Send mass notification to all affected passengers on a flight
 */
export async function sendMassNotification(
  flightId: number,
  message: string
): Promise<{
  notificationsSent: number;
  failedCount: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all affected bookings and their user IDs
  const affectedBookings = await db
    .select({
      userId: bookings.userId,
      bookingReference: bookings.bookingReference,
    })
    .from(bookings)
    .where(
      and(eq(bookings.flightId, flightId), ne(bookings.status, "cancelled"))
    );

  // Get the flight number for the notification
  const [flight] = await db
    .select({ flightNumber: flights.flightNumber })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  const flightNumber = flight?.flightNumber ?? `Flight #${flightId}`;
  const uniqueUserIds = [...new Set(affectedBookings.map(b => b.userId))];

  let notificationsSent = 0;
  let failedCount = 0;

  for (const userId of uniqueUserIds) {
    try {
      await createNotification(
        userId,
        "flight",
        `IROPS Alert: ${flightNumber}`,
        message,
        { flightId, flightNumber }
      );
      notificationsSent++;
    } catch {
      failedCount++;
    }
  }

  // Log actions in the IROPS store
  const event = Array.from(iropsEventsStore.values()).find(
    e => e.flightId === flightId && e.status !== "resolved"
  );

  if (event) {
    const action: IROPSAction = {
      id: iropsActionIdSeq++,
      eventId: event.id,
      actionType: "notification",
      targetPassengerId: null,
      status: "completed",
      details: {
        message,
        recipientCount: notificationsSent,
        failedCount,
        flightNumber,
      },
      createdAt: new Date(),
      completedAt: new Date(),
    };
    iropsActionsStore.set(action.id, action);
  }

  return { notificationsSent, failedCount };
}

/**
 * Get passengers whose connections are at risk due to the disrupted flight
 */
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
  if (!db) throw new Error("Database not available");

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
    .where(
      and(eq(bookings.flightId, flightId), ne(bookings.status, "cancelled"))
    );

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
  const event = iropsEventsStore.get(disruptionId);

  if (!event) {
    // Try to find in the DB disruptions
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [dbDisruption] = await db
      .select()
      .from(flightDisruptions)
      .where(eq(flightDisruptions.id, disruptionId))
      .limit(1);

    if (!dbDisruption) throw new Error("IROPS event not found");

    // Create an in-memory event from DB disruption
    const impact = await computeFlightImpact(db, dbDisruption.flightId);

    const newEvent: IROPSEvent = {
      id: dbDisruption.id,
      flightId: dbDisruption.flightId,
      eventType: mapDisruptionType(dbDisruption.type),
      severity: level,
      delayMinutes: dbDisruption.delayMinutes,
      reason: dbDisruption.reason,
      affectedPassengers: impact.totalPassengers,
      connectionsAtRisk: impact.connectionsAtRisk,
      estimatedRecoveryTime: null,
      status: dbDisruption.status === "resolved" ? "resolved" : "active",
      escalationLevel: severityToEscalationLevel(level),
      createdBy: dbDisruption.createdBy,
      createdAt: dbDisruption.createdAt,
      resolvedAt: dbDisruption.resolvedAt,
      updatedAt: new Date(),
    };

    iropsEventsStore.set(newEvent.id, newEvent);

    // Update severity in DB
    const mappedSeverity =
      level === "low"
        ? "minor"
        : level === "critical"
          ? "severe"
          : level === "high"
            ? "severe"
            : "moderate";

    await db
      .update(flightDisruptions)
      .set({ severity: mappedSeverity })
      .where(eq(flightDisruptions.id, disruptionId));

    return newEvent;
  }

  // Update the in-memory event
  event.severity = level;
  event.escalationLevel = severityToEscalationLevel(level);
  event.updatedAt = new Date();
  iropsEventsStore.set(event.id, event);

  // Also update DB
  const db = await getDb();
  if (db) {
    const mappedSeverity =
      level === "low"
        ? "minor"
        : level === "critical"
          ? "severe"
          : level === "high"
            ? "severe"
            : "moderate";

    await db
      .update(flightDisruptions)
      .set({ severity: mappedSeverity })
      .where(eq(flightDisruptions.id, disruptionId));
  }

  return event;
}

/**
 * Resolve an IROPS event
 */
export async function resolveIROPSEvent(eventId: number): Promise<IROPSEvent> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const event = iropsEventsStore.get(eventId);
  const now = new Date();

  if (event) {
    event.status = "resolved";
    event.resolvedAt = now;
    event.updatedAt = now;
    iropsEventsStore.set(event.id, event);
  }

  // Also resolve in the DB
  await db
    .update(flightDisruptions)
    .set({ status: "resolved", resolvedAt: now })
    .where(eq(flightDisruptions.id, eventId));

  // Mark all pending actions for this event as completed
  for (const [id, action] of iropsActionsStore) {
    if (
      action.eventId === eventId &&
      (action.status === "pending" || action.status === "in_progress")
    ) {
      action.status = "completed";
      action.completedAt = now;
      iropsActionsStore.set(id, action);
    }
  }

  if (event) return event;

  // Return a synthetic event from DB data
  const [dbDisruption] = await db
    .select()
    .from(flightDisruptions)
    .where(eq(flightDisruptions.id, eventId))
    .limit(1);

  if (!dbDisruption) throw new Error("IROPS event not found");

  return {
    id: dbDisruption.id,
    flightId: dbDisruption.flightId,
    eventType: mapDisruptionType(dbDisruption.type),
    severity: mapSeverity(dbDisruption.severity),
    delayMinutes: dbDisruption.delayMinutes,
    reason: dbDisruption.reason,
    affectedPassengers: 0,
    connectionsAtRisk: 0,
    estimatedRecoveryTime: null,
    status: "resolved",
    escalationLevel: 0,
    createdBy: dbDisruption.createdBy,
    createdAt: dbDisruption.createdAt,
    resolvedAt: now,
    updatedAt: now,
  };
}

/**
 * Get a single IROPS event detail by ID
 */
export async function getIROPSEventDetail(eventId: number): Promise<{
  event: IROPSEvent;
  actions: IROPSAction[];
  impact: Awaited<ReturnType<typeof getDisruptionImpact>>;
} | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let event = iropsEventsStore.get(eventId);

  if (!event) {
    // Try loading from DB
    const [dbDisruption] = await db
      .select({
        id: flightDisruptions.id,
        flightId: flightDisruptions.flightId,
        type: flightDisruptions.type,
        reason: flightDisruptions.reason,
        severity: flightDisruptions.severity,
        delayMinutes: flightDisruptions.delayMinutes,
        status: flightDisruptions.status,
        createdBy: flightDisruptions.createdBy,
        createdAt: flightDisruptions.createdAt,
        resolvedAt: flightDisruptions.resolvedAt,
        updatedAt: flightDisruptions.updatedAt,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        originId: flights.originId,
        destinationId: flights.destinationId,
      })
      .from(flightDisruptions)
      .innerJoin(flights, eq(flightDisruptions.flightId, flights.id))
      .where(eq(flightDisruptions.id, eventId))
      .limit(1);

    if (!dbDisruption) return null;

    const impact = await computeFlightImpact(db, dbDisruption.flightId);

    const [origin] = await db
      .select({ code: airports.code })
      .from(airports)
      .where(eq(airports.id, dbDisruption.originId))
      .limit(1);

    const [destination] = await db
      .select({ code: airports.code })
      .from(airports)
      .where(eq(airports.id, dbDisruption.destinationId))
      .limit(1);

    event = {
      id: dbDisruption.id,
      flightId: dbDisruption.flightId,
      eventType: mapDisruptionType(dbDisruption.type),
      severity: mapSeverity(dbDisruption.severity),
      delayMinutes: dbDisruption.delayMinutes,
      reason: dbDisruption.reason,
      affectedPassengers: impact.totalPassengers,
      connectionsAtRisk: impact.connectionsAtRisk,
      estimatedRecoveryTime: null,
      status: dbDisruption.status === "resolved" ? "resolved" : "active",
      escalationLevel: severityToEscalationLevel(
        mapSeverity(dbDisruption.severity)
      ),
      createdBy: dbDisruption.createdBy,
      createdAt: dbDisruption.createdAt,
      resolvedAt: dbDisruption.resolvedAt,
      updatedAt: dbDisruption.updatedAt,
      flightNumber: dbDisruption.flightNumber,
      origin: origin?.code,
      destination: destination?.code,
      departureTime: dbDisruption.departureTime,
    };
  }

  const actions = Array.from(iropsActionsStore.values())
    .filter(a => a.eventId === eventId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const impact = await getDisruptionImpact(event.flightId);

  return { event, actions, impact };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Compute passenger and connection counts for a flight
 */
async function computeFlightImpact(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  flightId: number
): Promise<{
  totalPassengers: number;
  connectionsAtRisk: number;
}> {
  // Count passengers on active bookings
  const affectedBookings = await db
    .select({
      numberOfPassengers: bookings.numberOfPassengers,
      userId: bookings.userId,
    })
    .from(bookings)
    .where(
      and(eq(bookings.flightId, flightId), ne(bookings.status, "cancelled"))
    );

  const totalPassengers = affectedBookings.reduce(
    (sum, b) => sum + b.numberOfPassengers,
    0
  );

  // Estimate connections at risk: check if any users have another
  // booking from the same destination within 24h
  const userIds = affectedBookings.map(b => b.userId);
  if (userIds.length === 0) {
    return { totalPassengers: 0, connectionsAtRisk: 0 };
  }

  const [flight] = await db
    .select({
      arrivalTime: flights.arrivalTime,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    return { totalPassengers, connectionsAtRisk: 0 };
  }

  const twentyFourHoursLater = new Date(flight.arrivalTime);
  twentyFourHoursLater.setHours(twentyFourHoursLater.getHours() + 24);

  const connectingBookings = await db
    .select({ userId: bookings.userId })
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

  return {
    totalPassengers,
    connectionsAtRisk: connectingBookings.length,
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
