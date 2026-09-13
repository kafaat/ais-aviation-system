import { operationsDashboard } from "../contracts/operations";
import {
  readOperationsDashboard,
  retryEventDelivery,
  retryCancellationPlanning,
} from "../services/operations-dashboard.service";
import { acknowledgeOperationalAlert } from "../services/operational-observations.service";
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
    .output(z.object({ acknowledged: z.boolean() }))
    .mutation(({ ctx, input }) =>
      acknowledgeOperationalAlert(input.key, ctx.user.id)
    ),
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
