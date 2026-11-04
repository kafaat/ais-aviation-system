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

const auditJobs = vi.hoisted(() => ({
  weather: vi.fn(),
  privacy: vi.fn(),
  checkIn: vi.fn(),
  hotel: vi.fn(),
  observations: vi.fn(),
  onCall: vi.fn(),
  cancellations: vi.fn(),
  waitlist: vi.fn(),
  groups: vi.fn(),
  splitRefunds: vi.fn(),
  bagDrop: vi.fn(),
  cleanup: vi.fn(),
  reminders: vi.fn(),
  loyalty: vi.fn(),
  priceAlerts: vi.fn(),
  warehouse: vi.fn(),
  reports: vi.fn(),
  error: vi.fn(),
}));
vi.mock("./hotel-fulfillment.service", () => ({
  processHotelFulfillment: auditJobs.hotel,
}));
vi.mock("./operational-observations.service", () => ({
  refreshOperationalAlerts: auditJobs.observations,
}));
vi.mock("./on-call.service", () => ({
  processOnCallDeliveries: auditJobs.onCall,
}));
vi.mock("./flight-cancellation.service", () => ({
  processFlightCancellations: auditJobs.cancellations,
}));
vi.mock("./waitlist.service", () => ({
  processExpiredOffers: auditJobs.waitlist,
}));
vi.mock("./group-booking.service", () => ({
  expireGroupAllocations: auditJobs.groups,
}));
vi.mock("./split-refund.service", () => ({
  processPendingSplitRefunds: auditJobs.splitRefunds,
}));
vi.mock("./bag-drop.service", () => ({
  expireBagDropSessions: auditJobs.bagDrop,
}));
vi.mock("./inventory-lock.service", () => ({
  releaseExpiredLocks: auditJobs.cleanup,
}));
vi.mock("../jobs/check-in-reminder.job", () => ({
  runCheckInReminderJob: auditJobs.reminders,
}));
vi.mock("../jobs/loyalty-cleanup.job", () => ({
  runMilesExpirationJob: auditJobs.loyalty,
}));
vi.mock("./price-alerts.service", () => ({
  checkAlerts: auditJobs.priceAlerts,
}));
vi.mock("./data-warehouse.service", () => ({
  processScheduledExports: auditJobs.warehouse,
}));
vi.mock("./standard-report-schedules.service", () => ({
  processStandardReportSchedules: auditJobs.reports,
}));
vi.mock("../_core/logger", async importOriginal => ({
  ...(await importOriginal<typeof import("../_core/logger")>()),
  logError: auditJobs.error,
}));
vi.mock("./weather-operations.service", () => ({
  refreshWeatherOperations: auditJobs.weather,
}));
vi.mock("./gdpr.service", () => ({
  processPrivacyRequests: auditJobs.privacy,
}));
vi.mock("./travel-scenarios.service", () => ({
  processAutoCheckIns: auditJobs.checkIn,
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
import { runScheduledTask } from "./scheduled-task.service";

beforeEach(() => {
  scheduled.length = 0;
  vi.clearAllMocks();
  auditJobs.reminders.mockResolvedValue({ errors: [] });
  auditJobs.loyalty.mockResolvedValue({ success: true });
});

afterEach(async () => {
  await stopCronJobs();
});

describe("cron.service scheduler", () => {
  it("schedules the outbox relay every minute and lock cleanup every 5 minutes", () => {
    startCronJobs();
    expect(scheduled.map(t => t.expr)).toEqual(
      PERIODIC_JOB_CATALOG.map(j => j.cron)
    );
    expect(
      PERIODIC_JOB_CATALOG.find(j => j.name === "relayOutboxEvents")?.cron
    ).toBe("* * * * *");
    expect(
      PERIODIC_JOB_CATALOG.find(j => j.name === "cleanupExpiredLocks")?.cron
    ).toBe("*/5 * * * *");
    expect(PERIODIC_JOB_CATALOG.map(j => j.name)).toEqual(
      expect.arrayContaining([
        "flightCancellationRefunds",
        "channelAllocationExpiry",
        "operationalAlerts",
      ])
    );
  });

  it("is idempotent — a second start does not double-schedule", () => {
    startCronJobs();
    startCronJobs();
    expect(scheduled).toHaveLength(PERIODIC_JOB_CATALOG.length);
  });

  it("stop() halts every scheduled task and allows a clean restart", async () => {
    startCronJobs();
    const tasks = [...scheduled];
    await stopCronJobs();
    for (const t of tasks) expect(t.stop).toHaveBeenCalledTimes(1);

    startCronJobs();
    expect(scheduled).toHaveLength(PERIODIC_JOB_CATALOG.length * 2); // every task can restart
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
  it.each([
    ["weatherRefresh", "*/10 * * * *", auditJobs.weather],
    ["privacyRequests", "* * * * *", auditJobs.privacy],
    ["autoCheckIn", "* * * * *", auditJobs.checkIn],
  ] as const)(
    "invokes %s through its durable scheduled tick",
    async (name, cron, run) => {
      startCronJobs();
      const index = PERIODIC_JOB_CATALOG.findIndex(job => job.name === name);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(scheduled[index].expr).toBe(cron);
      await scheduled[index].fn();
      expect(run).toHaveBeenCalledTimes(1);
    }
  );
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

  it.each([
    ["hotelFulfillment", auditJobs.hotel],
    ["operationalAlerts", auditJobs.observations],
    ["onCallDelivery", auditJobs.onCall],
    ["flightCancellationRefunds", auditJobs.cancellations],
    ["channelAllocationExpiry", auditJobs.waitlist],
    ["splitRefunds", auditJobs.splitRefunds],
    ["bagDropExpiry", auditJobs.bagDrop],
    ["cleanupExpiredLocks", auditJobs.cleanup],
    ["checkInReminders", auditJobs.reminders],
    ["loyaltyExpiry", auditJobs.loyalty],
    ["priceAlerts", auditJobs.priceAlerts],
    ["warehouseExports", auditJobs.warehouse],
    ["standardReports", auditJobs.reports],
  ] as const)(
    "executes the %s callback through the registered durable tick",
    async (name, run) => {
      startCronJobs();
      await scheduled[
        PERIODIC_JOB_CATALOG.findIndex(job => job.name === name)
      ].fn();
      expect(run).toHaveBeenCalledTimes(1);
      expect(runScheduledTask).toHaveBeenCalledWith(
        name,
        expect.any(String),
        expect.any(Function)
      );
      expect(auditJobs.error).not.toHaveBeenCalled();
      if (name === "channelAllocationExpiry")
        expect(auditJobs.groups).toHaveBeenCalledOnce();
    }
  );

  it("waits for the durable tick's final receipt before resolving shutdown", async () => {
    let release!: () => void;
    let entered!: () => void;
    const finishedWork = new Promise<void>(resolve => {
      entered = resolve;
    });
    vi.mocked(runScheduledTask).mockImplementationOnce(
      async (_name, _tick, run) => {
        await run();
        entered();
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return true;
      }
    );
    startCronJobs();
    const pending =
      scheduled[
        PERIODIC_JOB_CATALOG.findIndex(job => job.name === "relayOutboxEvents")
      ].fn();
    await finishedWork;
    let stopped = false;
    const stop = stopCronJobs().then(() => {
      stopped = true;
    });
    await vi.waitFor(() =>
      expect(scheduled.every(task => task.stop.mock.calls.length === 1)).toBe(
        true
      )
    );
    expect(stopped).toBe(false);
    release();
    await Promise.all([pending, stop]);
    expect(stopped).toBe(true);
  });

  it.each(["loyaltyExpiry", "checkInReminders", "relayOutboxEvents"] as const)(
    "records %s failure while allowing another scheduled job to execute",
    async name => {
      if (name === "loyaltyExpiry")
        auditJobs.loyalty.mockResolvedValueOnce({
          success: false,
          error: "expiry failed",
        });
      if (name === "checkInReminders")
        auditJobs.reminders.mockResolvedValueOnce({
          errors: ["reminder failed"],
        });
      if (name === "relayOutboxEvents")
        vi.mocked(runOutboxRelay).mockResolvedValueOnce({
          published: 0,
          failed: 1,
        });
      startCronJobs();
      await scheduled[
        PERIODIC_JOB_CATALOG.findIndex(job => job.name === name)
      ].fn();
      expect(auditJobs.error).toHaveBeenCalledWith(expect.any(Error), {
        operation: name,
      });
      await scheduled[
        PERIODIC_JOB_CATALOG.findIndex(job => job.name === "standardReports")
      ].fn();
      expect(auditJobs.reports).toHaveBeenCalledOnce();
    }
  );

  it("attempts both allocation expiry operations and exposes either failure", async () => {
    const failure = new Error("waitlist expiry failed");
    auditJobs.waitlist.mockRejectedValueOnce(failure);
    startCronJobs();
    await scheduled[
      PERIODIC_JOB_CATALOG.findIndex(
        job => job.name === "channelAllocationExpiry"
      )
    ].fn();
    expect(auditJobs.groups).toHaveBeenCalledOnce();
    expect(auditJobs.error).toHaveBeenCalledWith(
      expect.objectContaining({ errors: [failure] }),
      { operation: "channelAllocationExpiry" }
    );
  });
});
