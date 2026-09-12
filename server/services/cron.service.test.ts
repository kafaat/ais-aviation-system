import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const scheduled: Array<{
  expr: string;
  fn: () => Promise<void> | void;
  stop: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn((expr: string, fn: () => Promise<void> | void) => {
      const task = { expr, fn, stop: vi.fn() };
      scheduled.push(task);
      return task;
    }),
  },
}));

vi.mock("../db");
vi.mock("./order-refunds.service", () => ({
  processPendingOrderRefunds: vi.fn(async () => ({ processed: 0 })),
}));
vi.mock("./scheduled-task.service", () => ({
  runScheduledTask: vi.fn(async (_name, _tick, run) => {
    await run();
    return true;
  }),
}));
vi.mock("./outbox.service", () => ({
  runOutboxRelay: vi.fn(() => Promise.resolve({ published: 0, failed: 0 })),
}));

import {
  startCronJobs,
  stopCronJobs,
  PERIODIC_JOB_CATALOG,
} from "./cron.service";
import { processPendingOrderRefunds } from "./order-refunds.service";
import { runOutboxRelay } from "./outbox.service";

beforeEach(() => {
  scheduled.length = 0;
  vi.clearAllMocks();
});

afterEach(async () => {
  await stopCronJobs();
});

describe("cron.service scheduler", () => {
  it("schedules the outbox relay every minute and lock cleanup every 5 minutes", () => {
    startCronJobs();
    expect(scheduled.map(t => t.expr).sort()).toEqual(
      [
        "* * * * *",
        "* * * * *",
        "* * * * *",
        "*/5 * * * *",
        "* * * * *",
        "0 * * * *",
        "0 0 * * *",
        "*/15 * * * *",
        "* * * * *",
      ].sort()
    );
  });

  it("is idempotent — a second start does not double-schedule", () => {
    startCronJobs();
    startCronJobs();
    expect(scheduled).toHaveLength(9);
  });

  it("stop() halts every scheduled task and allows a clean restart", async () => {
    startCronJobs();
    const tasks = [...scheduled];
    await stopCronJobs();
    for (const t of tasks) expect(t.stop).toHaveBeenCalledTimes(1);

    startCronJobs();
    expect(scheduled).toHaveLength(18); // every task can restart
  });

  it("runs durable order refund work from its scheduled tick", async () => {
    startCronJobs();
    const index = PERIODIC_JOB_CATALOG.findIndex(
      j => j.name === "orderServiceRefunds"
    );
    expect(index).toBeGreaterThanOrEqual(0);
    await scheduled[index].fn();
    expect(processPendingOrderRefunds).toHaveBeenCalledTimes(1);
  });
  it("the relay tick actually invokes the outbox relay", async () => {
    startCronJobs();
    const relayTask =
      scheduled[
        PERIODIC_JOB_CATALOG.findIndex(j => j.name === "relayOutboxEvents")
      ];
    await relayTask.fn();
    expect(runOutboxRelay).toHaveBeenCalledTimes(1);
  });

  it("skips an overlapping tick while the previous relay is still running", async () => {
    let release!: () => void;
    vi.mocked(runOutboxRelay).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () => resolve({ published: 0, failed: 0 });
        })
    );
    startCronJobs();
    const relayTask =
      scheduled[
        PERIODIC_JOB_CATALOG.findIndex(j => j.name === "relayOutboxEvents")
      ];

    const first = relayTask.fn(); // in-flight
    await relayTask.fn(); // overlapping tick → skipped
    expect(runOutboxRelay).toHaveBeenCalledTimes(1);

    release();
    await first;
    await relayTask.fn(); // after completion → runs again
    expect(runOutboxRelay).toHaveBeenCalledTimes(2);
  });
});
