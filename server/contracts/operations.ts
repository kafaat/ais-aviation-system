import { z } from "zod";
const nullableDate = z.date().nullable();
export const operationsDashboard = z.object({
  ownership: z.array(
    z.object({
      domain: z.string(),
      accountableOwner: z.string().nullable(),
      onCall: z.string().nullable(),
    })
  ),
  observations: z.object({
    windowStart: z.date(),
    windowEnd: z.date(),
    requests: z.number(),
    errors: z.number(),
    errorRate: z.number().nullable(),
    meanResponseMs: z.number().nullable(),
    scope: z.string(),
    instances: z.array(
      z.object({
        instanceId: z.string(),
        component: z.enum(["api", "worker"]),
        lastSeenAt: z.date(),
        status: z.enum(["healthy", "degraded", "stopped", "unknown"]),
      })
    ),
  }),
  events: z.array(
    z.object({
      id: z.number(),
      eventId: z.string(),
      eventType: z.string(),
      status: z.string(),
      attempts: z.number(),
      createdAt: z.date(),
      lockedAt: nullableDate,
      consumers: z.array(
        z.object({
          eventId: z.string(),
          consumer: z.string(),
          status: z.string(),
          attempts: z.number(),
          processedAt: nullableDate,
          leaseUntil: nullableDate,
        })
      ),
    })
  ),
  refunds: z.array(
    z.object({
      id: z.number(),
      flightId: z.number(),
      bookingId: z.number(),
      status: z.string(),
      errorCode: z.string().nullable(),
      updatedAt: z.date(),
    })
  ),
  sources: z.array(
    z.object({
      sourceId: z.string(),
      capabilities: z.array(z.string()),
      validUntil: z.string(),
      authorized: z.boolean(),
      lastObservedAt: nullableDate,
      lastReceivedAt: nullableDate,
    })
  ),
  capabilities: z.array(
    z.object({
      id: z.string(),
      implementation: z.string(),
      requirement: z.string(),
      deploymentReady: z.boolean().nullable(),
    })
  ),
  alerts: z.array(
    z.object({
      key: z.string(),
      status: z.string(),
      message: z.string(),
      acknowledgedBy: z.number().nullable(),
      acknowledgedAt: nullableDate,
      firstObservedAt: z.date(),
      updatedAt: z.date(),
    })
  ),
  scheduledTasks: z.array(
    z.object({
      name: z.string(),
      lastSuccessAt: nullableDate,
      lastStartedAt: nullableDate,
      lastError: z.string().nullable(),
      leaseUntil: nullableDate,
    })
  ),
});
