import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BookingConfirmationData,
  FlightStatusChangeData,
  RefundConfirmationData,
} from "../services/email.service";

interface TestJob {
  id: string;
  timestamp: number;
  data: {
    type: string;
    to: string;
    subject: string;
    templateData: Record<string, unknown>;
    correlationId: string;
  };
}
type Processor = (
  job: TestJob
) => Promise<{ success: boolean; sentAt: string }>;
const state = vi.hoisted(() => ({
  processor: null as Processor | null,
  construct: vi.fn(),
  close: vi.fn<() => Promise<void>>(),
  handlers: new Map<string, (...args: unknown[]) => void>(),
  redis: true,
  queue: true,
  add: vi.fn(),
  booking: vi.fn<(data: BookingConfirmationData) => Promise<boolean>>(),
  flight: vi.fn<(data: FlightStatusChangeData) => Promise<boolean>>(),
  refund: vi.fn<(data: RefundConfirmationData) => Promise<boolean>>(),
  generic: vi.fn<(...args: string[]) => Promise<boolean>>(),
}));
vi.mock("bullmq", () => ({
  Worker: class {
    close = state.close;
    constructor(name: string, processor: Processor, options: unknown) {
      state.construct(name, options);
      state.processor = processor;
    }
    on(event: string, callback: (...args: unknown[]) => void) {
      state.handlers.set(event, callback);
      return this;
    }
  },
}));
vi.mock("../queue/queues", () => ({
  getRedisConnection: () => (state.redis ? { fixtureConnection: true } : null),
  get emailQueue() {
    return state.queue ? { add: state.add } : null;
  },
}));
vi.mock("../services/email.service", () => ({
  sendBookingConfirmation: state.booking,
  sendFlightStatusChange: state.flight,
  sendRefundConfirmation: state.refund,
  sendNotificationEmail: state.generic,
}));
import {
  closeEmailWorker,
  getEmailWorker,
  queueBookingConfirmationEmail,
  queueBookingCancellationEmail,
  queueFlightReminderEmail,
  queueFlightStatusChangeEmail,
} from "../queue/workers/email.worker";

const template = {
  passengerName: "Fixture Passenger",
  bookingReference: "TEST11",
  pnr: "PNR111",
  flightNumber: "SV031",
  origin: "RUH",
  destination: "JED",
  departureTime: "2026-11-05T10:00:00.000Z",
  arrivalTime: "2026-11-05T12:00:00.000Z",
  cabinClass: "business",
  numberOfPassengers: 2,
  totalAmount: 50000,
  oldStatus: "scheduled",
  newStatus: "delayed",
  delayMinutes: 20,
  reason: "Weather",
  refundAmount: 12000,
  refundReason: "Cancellation",
  processingDays: 4,
  attachments: [{ filename: "ticket.pdf", content: "JVBERg==" }],
};
function job(
  type: string,
  fields: Record<string, unknown> = template
): TestJob {
  return {
    id: "job-42",
    timestamp: Date.parse("2026-11-04T12:00:00Z"),
    data: {
      type,
      to: "passenger@example.test",
      subject: "Fixture subject",
      templateData: fields,
      correlationId: "trace-fixture",
    },
  };
}
async function processJob(input: TestJob) {
  getEmailWorker();
  if (!state.processor) throw new Error("Email processor was not registered");
  return state.processor(input);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.redis = true;
  state.queue = true;
  state.processor = null;
  state.handlers.clear();
  state.close.mockReset().mockResolvedValue();
  state.add.mockReset().mockResolvedValue({ id: "queued-1" });
  for (const send of [state.booking, state.flight, state.refund, state.generic])
    send.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await closeEmailWorker();
  vi.restoreAllMocks();
});

describe("actual email worker processor with queue/provider boundary doubles", () => {
  it.each([
    ["booking_confirmation", "booking"],
    ["flight_reminder", "booking"],
    ["payment_receipt", "booking"],
    ["flight_status_change", "flight"],
    ["booking_cancellation", "refund"],
    ["refund_confirmation", "refund"],
    ["password_reset", "generic"],
    ["welcome", "generic"],
  ] as const)(
    "routes %s to the %s provider function and returns acceptance only after success",
    async (type, provider) => {
      expect(await processJob(job(type))).toMatchObject({
        success: true,
        sentAt: expect.any(String),
      });
      expect(state[provider]).toHaveBeenCalledOnce();
      if (provider === "generic")
        expect(state.generic).toHaveBeenCalledWith(
          "passenger@example.test",
          "Fixture subject",
          "Fixture subject",
          "ar",
          expect.stringMatching(/^ais-email-[0-9a-f]{64}$/)
        );
      else
        expect(state[provider]).toHaveBeenCalledWith(
          expect.objectContaining({
            passengerEmail: "passenger@example.test",
            bookingReference: "TEST11",
            flightNumber: "SV031",
          })
        );
      expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
        "passenger@example.test"
      );
    }
  );

  it("preserves booking dates, prices and attachments for the provider", async () => {
    await processJob(job("booking_confirmation"));
    expect(state.booking).toHaveBeenCalledWith(
      expect.objectContaining({
        pnr: "PNR111",
        departureTime: new Date(template.departureTime),
        arrivalTime: new Date(template.arrivalTime),
        cabinClass: "business",
        numberOfPassengers: 2,
        totalAmount: 50000,
        attachments: template.attachments,
      })
    );
  });

  it.each([
    "booking_confirmation",
    "flight_status_change",
    "refund_confirmation",
    "welcome",
  ])("rejects provider refusal for %s so the queue can retry", async type => {
    for (const send of [
      state.booking,
      state.flight,
      state.refund,
      state.generic,
    ])
      send.mockResolvedValueOnce(false);
    const input = job(type);
    await expect(processJob(input)).rejects.toThrow(
      `Failed to send ${type} email`
    );
    await expect(processJob(input)).resolves.toMatchObject({ success: true });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      input.data.to
    );
  });

  it("propagates a provider rejection to the queue rather than converting it to acceptance", async () => {
    const error = new Error("provider transport timed out");
    state.flight.mockRejectedValueOnce(error);
    await expect(processJob(job("flight_status_change"))).rejects.toBe(error);
    expect(
      vi
        .mocked(console.info)
        .mock.calls.some(([entry]) =>
          String(entry).includes("Email sent successfully")
        )
    ).toBe(false);
  });

  it.each([
    [{ message: "Direct message", body: "Backup body" }, "Direct message"],
    [{ body: "Backup body" }, "Backup body"],
    [{}, "Fixture subject"],
  ] as const)(
    "selects the generic message from %j",
    async (fields, expected) => {
      await processJob(job("welcome", fields));
      expect(state.generic).toHaveBeenCalledWith(
        "passenger@example.test",
        "Fixture subject",
        expected,
        "ar",
        expect.stringMatching(/^ais-email-[0-9a-f]{64}$/)
      );
    }
  );

  it("constructs one worker and refuses construction without Redis", async () => {
    state.redis = false;
    expect(() => getEmailWorker()).toThrow(
      "Redis connection required for email worker"
    );
    expect(state.construct).not.toHaveBeenCalled();
    state.redis = true;
    const first = getEmailWorker();
    expect(getEmailWorker()).toBe(first);
    expect(state.construct).toHaveBeenCalledExactlyOnceWith("email", {
      connection: { fixtureConnection: true },
      concurrency: 5,
    });
    expect([...state.handlers.keys()]).toEqual([
      "completed",
      "failed",
      "error",
    ]);
  });

  it("waits for active worker jobs to close before discarding the worker instance", async () => {
    let release!: () => void;
    state.close.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    const first = getEmailWorker();
    let finished = false;
    const pending = closeEmailWorker().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(getEmailWorker()).toBe(first);
    release();
    await pending;
    expect(getEmailWorker()).not.toBe(first);
    expect(state.construct).toHaveBeenCalledTimes(2);
  });
});

const queueData = {
  ...template,
  to: "passenger@example.test",
  userId: 1,
  bookingId: 11,
  correlationId: "trace-fixture",
};
const producers = [
  ["booking_confirmation", 2, () => queueBookingConfirmationEmail(queueData)],
  ["booking_cancellation", 2, () => queueBookingCancellationEmail(queueData)],
  ["flight_status_change", 1, () => queueFlightStatusChangeEmail(queueData)],
  ["flight_reminder", 3, () => queueFlightReminderEmail(queueData)],
] as const;
describe("email enqueue retry contract", () => {
  it.each(producers)(
    "enqueues %s with priority %i and bounded exponential retries",
    async (name, priority, enqueue) => {
      expect(await enqueue()).toBe("queued-1");
      expect(state.add).toHaveBeenCalledWith(
        name,
        expect.objectContaining({
          type: name,
          to: queueData.to,
          correlationId: queueData.correlationId,
        }),
        {
          priority,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );
      expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
        queueData.to
      );
    }
  );

  it.each(producers)(
    "returns no queue receipt for %s when the queue is unavailable",
    async (_name, _priority, enqueue) => {
      state.queue = false;
      expect(await enqueue()).toBeNull();
      expect(state.add).not.toHaveBeenCalled();
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
        queueData.to
      );
    }
  );

  it("propagates an enqueue failure and does not log a successful queue receipt", async () => {
    const failure = new Error("queue unavailable");
    state.add.mockRejectedValueOnce(failure);
    await expect(queueBookingConfirmationEmail(queueData)).rejects.toBe(
      failure
    );
    expect(console.info).not.toHaveBeenCalled();
  });
});
