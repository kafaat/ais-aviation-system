import { operationsDashboard } from "../contracts/operations";
import {
  readOperationsDashboard,
  retryEventDelivery,
  retryCancellationPlanning,
} from "../services/operations-dashboard.service";
import { acknowledgeOperationalAlert } from "../services/operational-observations.service";
import { readAlertDispatches } from "../services/on-call.service";
import { readLineageRuns } from "../services/lineage.service";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { scheduledTasks } from "../../drizzle/schema";
import { getDb } from "../db";
export const operationsRouter = router({
  dashboard: adminProcedure
    .output(operationsDashboard)
    .query(({ ctx }) => readOperationsDashboard(ctx.tenantId)),
  replayEvent: adminProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        reason: z.string().min(5).max(500),
      })
    )
    .output(z.object({ receiptId: z.string() }))
    .mutation(({ ctx, input }) =>
      retryEventDelivery(input.eventId, ctx.user.id, ctx.tenantId, input.reason)
    ),
  retryCancellation: adminProcedure
    .input(
      z.object({
        jobId: z.number().int().positive(),
        reason: z.string().min(5).max(500),
      })
    )
    .output(z.object({ receiptId: z.string() }))
    .mutation(({ ctx, input }) =>
      retryCancellationPlanning(
        input.jobId,
        ctx.user.id,
        ctx.tenantId,
        input.reason
      )
    ),
  acknowledgeAlert: adminProcedure
    .input(z.object({ key: z.string().max(100) }))
    .output(z.object({ acknowledged: z.boolean(), closeQueued: z.boolean() }))
    .mutation(({ ctx, input }) =>
      acknowledgeOperationalAlert(input.key, ctx.user.id)
    ),
  /** Delivery receipts for operational alerts. `delivered` means the provider
   * accepted the page; it is never a statement that a person was reached. */
  alertDispatches: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .output(
      z.array(
        z.object({
          id: z.number(),
          alertKey: z.string(),
          action: z.enum(["raise", "close"]),
          status: z.enum([
            "pending",
            "outcome_unknown",
            "delivered",
            "failed",
            "cancelled",
          ]),
          attempts: z.number(),
          deliveredAt: z.string().nullable(),
          nextAttemptAt: z.string().nullable(),
          lastError: z.string().nullable(),
          providerMode: z.enum(["sandbox", "live"]),
        })
      )
    )
    .query(({ input }) => readAlertDispatches(input.limit)),
  capabilities: adminProcedure
    .output(
      z.array(
        z.object({
          id: z.string(),
          implementation: z.enum(["blocked", "demo", "implemented"]),
          owner: z.string(),
          consumer: z.string(),
          requirement: z.string(),
          available: z.boolean(),
          deploymentReady: z.boolean().nullable(),
          evidence: z.string(),
        })
      )
    )
    .query(async ({ ctx }) =>
      (await readOperationsDashboard(ctx.tenantId)).capabilities.map(c => ({
        ...c,
        available: c.deploymentReady === true,
      }))
    ),
  /** Recorded data-job lineage. Stored locally in OpenLineage shape; no
   * lineage backend is configured, so nothing here has been transmitted. */
  lineageRuns: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .output(
      z.array(
        z.object({
          runId: z.string(),
          jobName: z.string(),
          startedAt: z.string().nullable(),
          finishedAt: z.string().nullable(),
          outcome: z.enum(["running", "complete", "failed"]),
          traceId: z.string().nullable(),
          inputs: z.array(z.string()),
          outputs: z.array(z.string()),
        })
      )
    )
    .query(({ input }) => readLineageRuns(input.limit)),
  scheduledTasks: adminProcedure
    .output(
      z.array(
        z.object({
          name: z.string(),
          lastTick: z.string().nullable(),
          leaseUntil: z.date().nullable(),
          lastStartedAt: z.date().nullable(),
          lastSuccessAt: z.date().nullable(),
          lastError: z.string().nullable(),
        })
      )
    )
    .query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Scheduler database unavailable");
      return db
        .select({
          name: scheduledTasks.name,
          lastTick: scheduledTasks.lastTick,
          leaseUntil: scheduledTasks.leaseUntil,
          lastStartedAt: scheduledTasks.lastStartedAt,
          lastSuccessAt: scheduledTasks.lastSuccessAt,
          lastError: scheduledTasks.lastError,
        })
        .from(scheduledTasks);
    }),
});
