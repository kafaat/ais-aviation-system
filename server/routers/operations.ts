import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { scheduledTasks } from "../../drizzle/schema";
import { getDb } from "../db";
import { listCapabilities } from "../services/capability-catalog.service";
export const operationsRouter = router({
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
          evidence: z.string(),
        })
      )
    )
    .query(() => listCapabilities()),
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
