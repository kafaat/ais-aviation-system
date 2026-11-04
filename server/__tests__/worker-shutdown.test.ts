import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  ping: vi.fn(),
  closePool: vi.fn(),
  startCron: vi.fn(),
  stopCron: vi.fn(),
  stopWorkers: vi.fn(),
  stopV2: vi.fn(),
  closeQueues: vi.fn(),
  closeV2: vi.fn(),
  stopTracing: vi.fn(),
  record: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("node:fs", async importOriginal => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  writeFileSync: state.write,
  rmSync: state.remove,
  renameSync: state.rename,
}));
vi.mock("../db", () => ({
  getDb: () => ({ execute: state.execute }),
  closePool: state.closePool,
}));
vi.mock("../_core/logger", () => ({ createServiceLogger: () => state.log }));
vi.mock("../_core/telemetry", () => ({
  initTracing: () => {},
  stopTracing: state.stopTracing,
}));
vi.mock("../services/integration-config.service", () => ({
  assertIntegrationConfiguration: () => ({}),
}));
vi.mock("../_core/provider-boundary", () => ({
  assertProviderBoundary: () => ({}),
}));
vi.mock("../services/operational-observations.service", () => ({
  observationInstanceId: "worker-test-instance",
  recordOperationalSample: state.record,
}));
vi.mock("../queue/queues", () => ({
  getRedisConnection: () => ({ ping: state.ping }),
  initializeQueues: async () => {},
  closeQueues: state.closeQueues,
}));
vi.mock("../queue/workers/index", () => ({
  startWorkers: async () => {},
  stopWorkers: state.stopWorkers,
  getWorkersStatus: () => ({ email: { running: true, paused: false } }),
}));
vi.mock("../services/queue-v2.service", () => ({
  startAllWorkers: async () => {},
  stopAllWorkers: state.stopV2,
  closeAllQueues: state.closeV2,
  scheduleReconciliation: async () => {},
  scheduleCleanupJobs: async () => {},
  areV2WorkersHealthy: () => true,
}));
vi.mock("../services/cron.service", () => ({
  startCronJobs: state.startCron,
  stopCronJobs: state.stopCron,
}));

const signals = new Map<string, () => Promise<void>>();
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "test");
  signals.clear();
  const on = process.on.bind(process);
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (
      ["SIGTERM", "SIGINT", "uncaughtException", "unhandledRejection"].includes(
        event
      )
    ) {
      signals.set(event, listener as () => Promise<void>);
      return process;
    }
    return on(event, listener);
  });
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("actual worker entry-point lifecycle with controlled dependencies", () => {
  it.each(["SIGTERM", "SIGINT"])(
    "%s removes readiness immediately and drains cron before queues and database",
    async signal => {
      let release!: () => void;
      state.stopCron.mockImplementation(
        () =>
          new Promise<void>(resolve => {
            release = resolve;
          })
      );
      await import("../worker");
      await vi.waitFor(() => expect(state.rename).toHaveBeenCalledOnce());
      expect(state.startCron).toHaveBeenCalledOnce();
      const shutdown = signals.get(signal)!();
      expect(state.remove).toHaveBeenLastCalledWith("/tmp/ais-worker-ready", {
        force: true,
      });
      expect(state.remove.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
        state.rename.mock.invocationCallOrder[0]
      );
      expect(state.closePool).not.toHaveBeenCalled();
      expect(state.stopWorkers).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(state.record).toHaveBeenCalledTimes(1);
      expect(state.rename).toHaveBeenCalledTimes(1);
      release();
      await shutdown;
      expect(state.stopV2).toHaveBeenCalledOnce();
      expect(state.closeV2).toHaveBeenCalledOnce();
      expect(state.stopWorkers).toHaveBeenCalledOnce();
      expect(state.closeQueues).toHaveBeenCalledOnce();
      expect(state.record).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "stopped" })
      );
      expect(state.closeQueues.mock.invocationCallOrder[0]).toBeLessThan(
        state.record.mock.invocationCallOrder.at(-1)!
      );
      expect(state.record.mock.invocationCallOrder.at(-1)).toBeLessThan(
        state.closePool.mock.invocationCallOrder[0]
      );
      expect(state.closePool.mock.invocationCallOrder[0]).toBeLessThan(
        state.stopTracing.mock.invocationCallOrder[0]
      );
      expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("propagates a pool-close failure to an unsuccessful exit without reporting shutdown success", async () => {
    await import("../worker");
    await vi.waitFor(() => expect(state.rename).toHaveBeenCalledOnce());
    const error = new Error("pool close failed");
    state.closePool.mockRejectedValueOnce(error);
    await signals.get("SIGTERM")!();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(state.log.error).toHaveBeenCalledWith(
      { error },
      "Error during shutdown"
    );
    expect(state.log.info).not.toHaveBeenCalledWith(
      {},
      "Graceful shutdown completed"
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never publishes readiness or starts cron after the database probe fails", async () => {
    state.execute.mockRejectedValueOnce(new Error("database unavailable"));
    await import("../worker");
    await vi.waitFor(() =>
      expect(process.exit).toHaveBeenCalledExactlyOnceWith(1)
    );
    expect(state.remove).toHaveBeenCalledWith("/tmp/ais-worker-ready", {
      force: true,
    });
    expect(state.rename).not.toHaveBeenCalled();
    expect(state.startCron).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
