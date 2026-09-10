import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { scheduledTasks } from "../../drizzle/schema";
import { getDb } from "../db";

/** Cross-process lease and durable completion record for periodic jobs. */
export async function runScheduledTask(
  name: string,
  tick: string,
  run: () => Promise<void>
) {
  const db = await getDb();
  if (!db) throw new Error("Scheduler database unavailable");
  const token = randomUUID();
  const leaseMs = 15 * 60_000;
  const claimed = await db.transaction(async tx => {
    await tx
      .insert(scheduledTasks)
      .values({ name })
      .onDuplicateKeyUpdate({ set: { name: sql`${scheduledTasks.name}` } });
    const [state] = await tx
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.name, name))
      .limit(1)
      .for("update");
    if (
      state.lastTick === tick ||
      (state.leaseUntil && state.leaseUntil > new Date())
    )
      return false;
    await tx
      .update(scheduledTasks)
      .set({
        leaseToken: token,
        leaseUntil: new Date(Date.now() + leaseMs),
        lastStartedAt: new Date(),
        lastError: null,
      })
      .where(eq(scheduledTasks.name, name));
    return true;
  });
  if (!claimed) return false;
  const fence = and(
    eq(scheduledTasks.name, name),
    eq(scheduledTasks.leaseToken, token)
  );
  const renewal = setInterval(() => {
    void db
      .update(scheduledTasks)
      .set({ leaseUntil: new Date(Date.now() + leaseMs) })
      .where(fence)
      .catch(error =>
        console.error("Scheduled task lease renewal failed", { name, error })
      );
  }, 30_000);
  renewal.unref();
  try {
    await run();
    const [updated] = await db
      .update(scheduledTasks)
      .set({
        lastTick: tick,
        lastSuccessAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
        lastError: null,
      })
      .where(fence);
    if (updated.affectedRows !== 1)
      throw new Error("Scheduled task lost its lease");
    return true;
  } catch (error) {
    await db
      .update(scheduledTasks)
      .set({
        leaseToken: null,
        leaseUntil: null,
        lastError: error instanceof Error ? error.message : "Task failed",
      })
      .where(fence);
    throw error;
  } finally {
    clearInterval(renewal);
  }
}
