import ownership from "../../docs/architecture/service-ownership.json";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  outbox,
  eventDeliveries,
  eventInbox,
  aviationEvidence,
  flightCancellationJobs,
  bookings,
  orderServiceRefunds,
  operationsAlerts,
  scheduledTasks,
} from "../../drizzle/schema";
import { readDurableHealth } from "./operational-observations.service";
import { getAviationSources } from "./aviation-evidence.service";
import { recordEvent, OUTBOX_CLAIM_TIMEOUT_MS } from "./outbox.service";
import { listCapabilities } from "./capability-catalog.service";
export async function readOperationsDashboard(tenantId: number | null) {
  const db = getDb();
  if (!db) throw new Error("Operations database unavailable");
  const events = await db
    .select({
      id: outbox.id,
      eventId: outbox.eventId,
      eventType: outbox.eventType,
      status: outbox.status,
      attempts: outbox.attempts,
      createdAt: outbox.createdAt,
      lockedAt: outbox.lockedAt,
    })
    .from(outbox)
    .where(
      and(
        tenantId === null ? undefined : eq(outbox.tenantId, tenantId),
        inArray(outbox.status, ["pending", "processing", "failed"])
      )
    )
    .orderBy(asc(outbox.createdAt))
    .limit(100);
  const deliveries = events.length
    ? await db
        .select({
          eventId: eventDeliveries.eventId,
          consumer: eventDeliveries.consumer,
          status: eventDeliveries.status,
          attempts: eventDeliveries.attempts,
          processedAt: eventDeliveries.processedAt,
          leaseUntil: eventDeliveries.leaseUntil,
        })
        .from(eventDeliveries)
        .where(
          inArray(
            eventDeliveries.eventId,
            events.map(e => e.eventId)
          )
        )
    : [];
  const refunds = await db
    .select({
      id: flightCancellationJobs.id,
      flightId: flightCancellationJobs.flightId,
      bookingId: flightCancellationJobs.bookingId,
      status: flightCancellationJobs.status,
      errorCode: flightCancellationJobs.errorCode,
      updatedAt: flightCancellationJobs.updatedAt,
    })
    .from(flightCancellationJobs)
    .innerJoin(bookings, eq(bookings.id, flightCancellationJobs.bookingId))
    .where(
      and(
        tenantId === null ? undefined : eq(bookings.tenantId, tenantId),
        sql`${flightCancellationJobs.status} <> 'completed'`
      )
    )
    .orderBy(asc(flightCancellationJobs.createdAt))
    .limit(100);
  const sources = [];
  for (const source of getAviationSources().filter(
    s => tenantId === null || s.tenantId === tenantId
  )) {
    const [last] = await db
      .select({
        observedAt: aviationEvidence.observedAt,
        receivedAt: aviationEvidence.receivedAt,
        kind: aviationEvidence.kind,
      })
      .from(aviationEvidence)
      .where(
        and(
          eq(aviationEvidence.sourceId, source.sourceId),
          sql`${aviationEvidence.tenantId} <=> ${source.tenantId}`
        )
      )
      .orderBy(desc(aviationEvidence.receivedAt))
      .limit(1);
    sources.push({
      sourceId: source.sourceId,
      capabilities: source.capabilities,
      validUntil: source.validUntil,
      authorized:
        Date.parse(source.validUntil) > Date.now() &&
        (process.env[source.secretEnv]?.length ?? 0) >= 32,
      lastObservedAt: last?.observedAt ?? null,
      lastReceivedAt: last?.receivedAt ?? null,
    });
  }
  const observations = await readDurableHealth();
  const tasks = await db.select().from(scheduledTasks);
  const { PERIODIC_JOB_CATALOG } = await import("./cron.service");
  const [inbox] = await db
    .select({ count: sql<number>`count(*)` })
    .from(eventDeliveries)
    .innerJoin(eventInbox, eq(eventInbox.eventId, eventDeliveries.eventId))
    .where(
      and(
        eq(eventDeliveries.status, "processed"),
        tenantId === null ? undefined : eq(eventInbox.tenantId, tenantId)
      )
    );
  const capabilities = listCapabilities().map(c => {
    let ready: boolean | null = null;
    if (c.implementation !== "implemented") ready = false;
    else if (c.id === "scheduledTasks")
      ready = PERIODIC_JOB_CATALOG.every(job => {
        const t = tasks.find(t => t.name === job.name);
        return (
          t?.lastSuccessAt &&
          !t.lastError &&
          Date.now() - t.lastSuccessAt.getTime() <= job.periodMs * 2 + 60000
        );
      });
    else if (c.id === "eventInbox")
      ready =
        Number(inbox.count) > 0 && events.every(e => e.status !== "failed");
    else if (c.id === "slaObservations")
      ready = observations.instances.some(
        i => i.component === "api" && i.status === "healthy"
      );
    return { ...c, deploymentReady: ready };
  });
  const alerts = await db
    .select()
    .from(operationsAlerts)
    .where(eq(operationsAlerts.status, "active"))
    .orderBy(desc(operationsAlerts.updatedAt))
    .limit(100);
  return {
    ownership: ownership.domains.map(d => ({
      domain: d.id,
      accountableOwner: d.accountableOwner,
      onCall: d.onCall,
    })),
    observations,
    events: events.map(e => ({
      ...e,
      consumers: deliveries.filter(d => d.eventId === e.eventId),
    })),
    refunds,
    sources,
    capabilities,
    alerts,
    scheduledTasks: tasks.map(t => ({
      name: t.name,
      lastSuccessAt: t.lastSuccessAt,
      lastStartedAt: t.lastStartedAt,
      lastError: t.lastError,
      leaseUntil: t.leaseUntil,
    })),
  };
}
export async function retryEventDelivery(
  eventId: string,
  actorId: number,
  tenantId: number | null,
  reason: string
) {
  const db = getDb();
  if (!db) throw new Error("Operations database unavailable");
  if (reason.trim().length < 5 || reason.length > 500)
    throw new Error("A review reason is required");
  return await db.transaction(async tx => {
    const [event] = await tx
      .select()
      .from(outbox)
      .where(eq(outbox.eventId, eventId))
      .for("update");
    if (!event || (tenantId !== null && event.tenantId !== tenantId))
      throw new Error("Event not found");
    if (
      event.status !== "failed" &&
      !(
        event.status === "processing" &&
        event.lockedAt &&
        Date.now() - event.lockedAt.getTime() > OUTBOX_CLAIM_TIMEOUT_MS
      )
    )
      throw new Error("Only failed or expired event claims can be replayed");
    // Consumer receipts are retained so effects that already succeeded stay deduplicated.
    await tx
      .update(outbox)
      .set({
        status: "pending",
        attempts: 0,
        lockedAt: null,
        leaseToken: null,
        lastError: null,
      })
      .where(eq(outbox.id, event.id));
    const receiptId = await recordEvent(tx, {
      aggregateType: "outbox",
      aggregateId: event.id,
      tenantId: event.tenantId,
      eventType: "operations.event_replay_requested",
      payload: { eventId, actorId, reason, previousAttempts: event.attempts },
    });
    return { receiptId };
  });
}
export async function retryCancellationPlanning(
  jobId: number,
  actorId: number,
  tenantId: number | null,
  reason: string
) {
  const db = getDb();
  if (!db) throw new Error("Operations database unavailable");
  if (reason.trim().length < 5 || reason.length > 500)
    throw new Error("A review reason is required");
  const [hint] = await db
    .select()
    .from(flightCancellationJobs)
    .where(eq(flightCancellationJobs.id, jobId));
  if (!hint) throw new Error("Cancellation job not found");
  return await db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, hint.bookingId))
      .for("update");
    const [job] = await tx
      .select()
      .from(flightCancellationJobs)
      .where(eq(flightCancellationJobs.id, jobId))
      .for("update");
    if (
      !booking ||
      !job ||
      (tenantId !== null && booking.tenantId !== tenantId) ||
      job.status !== "review_required"
    )
      throw new Error("Reviewable cancellation job not found");
    const [existing] = await tx
      .select({ id: orderServiceRefunds.id })
      .from(orderServiceRefunds)
      .where(eq(orderServiceRefunds.bookingId, booking.id))
      .limit(1);
    if (existing)
      throw new Error(
        "Existing provider refund requests require receipt reconciliation; a new plan is forbidden"
      );
    await tx
      .update(flightCancellationJobs)
      .set({ status: "queued", errorCode: null })
      .where(eq(flightCancellationJobs.id, jobId));
    const receiptId = await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: booking.id,
      tenantId: booking.tenantId,
      eventType: "operations.cancellation_retry_requested",
      payload: { jobId, actorId, reason },
    });
    return { receiptId };
  });
}
