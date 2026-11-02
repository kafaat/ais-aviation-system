import { describe, expect, it, vi } from "vitest";

const { add, engine, worker } = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue({ id: "test-job" }),
  engine: vi.fn().mockResolvedValue({ details: [], errors: 0 }),
  worker: vi.fn(),
}));

vi.mock("../services/stripe/stripe-reconciliation.service", () => ({
  runStripeReconciliation: engine,
}));
vi.mock("../queue/queues", () => ({
  getRedisConnection: () => ({}),
  reconciliationQueue: { add },
}));
vi.mock("bullmq", () => ({
  Worker: class {
    constructor(name: string, process: unknown) {
      worker(name, process);
    }
    on() {}
  },
}));

import { triggerReconciliation } from "../queue/workers/reconciliation.worker";

describe("reconciliation job mode", () => {
  it.each([true, false, undefined])(
    "preserves dryRun=%s from manual submission through the worker to settlement",
    async dryRun => {
      await triggerReconciliation({ limit: 17, dryRun });
      const [name, data] = add.mock.lastCall!;
      expect(name).toBe("manual-reconciliation");
      const [, process] = worker.mock.calls[0];
      await process({ id: "test-job", data, updateProgress: vi.fn() });
      expect(engine).toHaveBeenLastCalledWith({
        limit: 17,
        dryRun: dryRun ?? false,
      });
    }
  );
});
