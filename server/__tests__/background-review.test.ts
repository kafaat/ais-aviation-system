/**
 * Background-processing rules closed by the October 2026 review.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import { scheduledTasks } from "../../drizzle/schema";

const state = vi.hoisted(() => ({ db: null as any, add: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("bullmq", () => ({
  Queue: class {
    add = state.add;
    async close() {}
    async getJobCounts() {
      return {};
    }
  },
  Worker: class {},
  Job: class {},
  UnrecoverableError: class extends Error {},
}));
vi.mock("../queue/redis-config", () => ({
  redisConnectionOptions: () => ({}),
}));

import { runScheduledTask } from "../services/scheduled-task.service";
import { queueWebhookRetry } from "../services/queue-v2.service";

describe("scheduled task failure visibility", () => {
  beforeEach(() => {
    state.db = transactionMemory({ scheduled_tasks: [] }).db;
  });

  it("keeps lastError until the next successful run", async () => {
    await expect(
      runScheduledTask("relay", "1", async () => {
        throw new Error("relay exploded");
      })
    ).rejects.toThrow("relay exploded");
    const after = () => state.db.select().from(scheduledTasks);
    let [row] = await after();
    expect(row.lastError).toBe("relay exploded");
    expect(row.leaseToken).toBeNull();

    // The next tick claims the task; the previous failure stays visible
    // while it runs, so an every-other-tick failure can no longer hide.
    let seenDuringRun: string | null | undefined;
    await runScheduledTask("relay", "2", async () => {
      [row] = await after();
      seenDuringRun = row.lastError;
    });
    expect(seenDuringRun).toBe("relay exploded");
    [row] = await after();
    expect(row.lastError).toBeNull();
    expect(row.lastTick).toBe("2");
  });
});

describe("webhook retry queueing", () => {
  beforeEach(() => state.add.mockReset());

  it("uses a fresh job id per enqueue so an exhausted event can be re-queued", async () => {
    await queueWebhookRetry({ eventId: "evt_1", delay: 0 });
    await queueWebhookRetry({ eventId: "evt_1", delay: 0 });
    const ids = state.add.mock.calls.map(call => call[2].jobId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^webhook-retry-evt_1-[0-9a-f-]{36}$/);
    expect(new Set(ids).size).toBe(2);
  });
});
