import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof import("../db").getDb>,
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { runScheduledTask } from "../services/scheduled-task.service";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { resolve, promise };
}

let memory: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
  memory = transactionMemory({ scheduled_tasks: [] });
  state.db = memory.db;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("durable scheduler lease lifecycle (relational boundary double)", () => {
  it("renews a long-running task every 30 seconds and clears renewal after completion", async () => {
    const entered = deferred();
    const gate = deferred();
    const pending = runScheduledTask("long-task", "tick-1", async () => {
      entered.resolve();
      await gate.promise;
    });
    await entered.promise;
    const row = memory.rows("scheduled_tasks")[0];
    const token = row.leaseToken;
    expect(row.leaseUntil).toEqual(new Date("2026-11-04T00:15:00Z"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(row.leaseToken).toBe(token);
    expect(row.leaseUntil).toEqual(new Date("2026-11-04T00:16:00Z"));
    expect(row.lastSuccessAt).toBeUndefined();
    gate.resolve();
    expect(await pending).toBe(true);
    expect(row.lastTick).toBe("tick-1");
    expect(row.lastSuccessAt).toEqual(new Date("2026-11-04T00:01:00Z"));
    expect(row.leaseToken).toBeNull();
    expect(row.leaseUntil).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(row.leaseUntil).toBeNull();
  });

  it("does not overwrite a replacement owner or record success after losing its lease", async () => {
    const entered = deferred();
    const gate = deferred();
    const pending = runScheduledTask("fenced-task", "tick-1", async () => {
      entered.resolve();
      await gate.promise;
    });
    await entered.promise;
    const row = memory.rows("scheduled_tasks")[0];
    row.leaseToken = "replacement-owner";
    row.leaseUntil = new Date("2026-11-04T00:20:00Z");
    row.lastError = "replacement owner's previous error";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(row.leaseUntil).toEqual(new Date("2026-11-04T00:20:00Z"));
    const rejected = expect(pending).rejects.toThrow(
      "Scheduled task lost its lease"
    );
    gate.resolve();
    await rejected;
    expect(row.leaseToken).toBe("replacement-owner");
    expect(row.lastError).toBe("replacement owner's previous error");
    expect(row.lastSuccessAt).toBeUndefined();
    expect(row.lastTick).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("observes a renewal failure without unhandled rejection and retries on the next interval", async () => {
    const entered = deferred();
    const gate = deferred();
    const pending = runScheduledTask("renewal-retry", "tick-1", async () => {
      entered.resolve();
      await gate.promise;
    });
    await entered.promise;
    const error = new Error("temporary renewal failure");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(memory.db, "update").mockReturnValueOnce({
      set: () => ({ where: () => Promise.reject(error) }),
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(log).toHaveBeenCalledWith("Scheduled task lease renewal failed", {
      name: "renewal-retry",
      error,
    });
    expect(memory.rows("scheduled_tasks")[0].lastSuccessAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(memory.rows("scheduled_tasks")[0].leaseUntil).toEqual(
      new Date("2026-11-04T00:16:00Z")
    );
    gate.resolve();
    expect(await pending).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops renewal and records a failed long-running callback without claiming success", async () => {
    const entered = deferred();
    const gate = deferred();
    const pending = runScheduledTask("failed-task", "tick-1", async () => {
      entered.resolve();
      await gate.promise;
      throw new Error("report export failed");
    });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(30_000);
    const rejected = expect(pending).rejects.toThrow("report export failed");
    gate.resolve();
    await rejected;
    expect(memory.rows("scheduled_tasks")[0]).toMatchObject({
      leaseToken: null,
      leaseUntil: null,
      lastError: "report export failed",
    });
    expect(memory.rows("scheduled_tasks")[0].lastSuccessAt).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips an active lease, then reclaims it after expiry and executes only once for the completed tick", async () => {
    memory = transactionMemory({
      scheduled_tasks: [
        {
          name: "restart-task",
          leaseToken: "old-process",
          leaseUntil: new Date(Date.now() + 30_000),
        },
      ],
    });
    state.db = memory.db;
    const run = vi.fn(async () => {});
    expect(await runScheduledTask("restart-task", "tick-1", run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(await runScheduledTask("restart-task", "tick-1", run)).toBe(true);
    expect(await runScheduledTask("restart-task", "tick-1", run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not execute a callback or create a renewal timer without the database", async () => {
    state.db = null;
    const run = vi.fn(async () => {});
    await expect(runScheduledTask("no-db", "tick-1", run)).rejects.toThrow(
      "Scheduler database unavailable"
    );
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
