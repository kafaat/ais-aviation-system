import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestJob {
  id?: string;
  timestamp: number;
  data: {
    type: string;
    to: string;
    subject: string;
    templateData: Record<string, unknown>;
  };
}
const state = vi.hoisted(() => ({
  processor: null as null | ((job: TestJob) => Promise<unknown>),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("bullmq", () => ({
  Worker: class {
    constructor(_name: string, processor: (job: TestJob) => Promise<unknown>) {
      state.processor = processor;
    }
    on() {
      return this;
    }
    async close() {}
  },
}));
vi.mock("../queue/queues", () => ({
  getRedisConnection: () => ({}),
  emailQueue: null,
}));
import {
  getEmailWorker,
  closeEmailWorker,
} from "../queue/workers/email.worker";

function job(type: string): TestJob {
  return {
    id: "job-42",
    timestamp: Date.parse("2026-11-04T12:00:00Z"),
    data: {
      type,
      to: "passenger@example.test",
      subject: "Fixture subject",
      templateData: {
        passengerName: "Fixture Passenger",
        bookingReference: "TEST11",
        pnr: "PNR111",
        flightNumber: "SV031",
        origin: "RUH",
        destination: "JED",
        departureTime: "2026-11-05T10:00:00Z",
        arrivalTime: "2026-11-05T12:00:00Z",
        cabinClass: "economy",
        numberOfPassengers: 1,
        totalAmount: 10000,
        oldStatus: "scheduled",
        newStatus: "delayed",
        delayMinutes: 20,
        refundAmount: 10000,
        refundReason: "Cancellation",
        processingDays: 5,
      },
    },
  };
}
async function processJob(input: TestJob) {
  getEmailWorker();
  if (!state.processor) throw new Error("No registered processor");
  return state.processor(input);
}
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "synthetic-provider-key");
  vi.stubEnv("EMAIL_FROM", "fixture@example.test");
  state.fetch.mockReset().mockImplementation(
    async () =>
      new Response(JSON.stringify({ id: "provider-fixture-receipt" }), {
        status: 200,
      })
  );
  vi.stubGlobal("fetch", state.fetch);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await closeEmailWorker();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("email worker to real templates and controlled provider transport", () => {
  it.each([
    "booking_confirmation",
    "flight_reminder",
    "payment_receipt",
    "flight_status_change",
    "booking_cancellation",
    "refund_confirmation",
    "password_reset",
    "welcome",
  ])(
    "reuses a provider key and identical body for %s after an ambiguous transport failure",
    async type => {
      state.fetch.mockRejectedValueOnce(
        new Error("Provider response was lost")
      );
      const input = job(type);
      await expect(processJob(input)).rejects.toThrow(
        "Provider response was lost"
      );
      await expect(processJob(input)).resolves.toMatchObject({ success: true });
      const options = state.fetch.mock.calls.map(([, init]) => init!);
      const keys = options.map(init =>
        new Headers(init.headers).get("Idempotency-Key")
      );
      expect(keys[0]).toEqual(
        expect.stringMatching(/^ais-email-[0-9a-f]{64}$/)
      );
      expect(keys[1]).toBe(keys[0]);
      expect(options[1].body).toBe(options[0].body);
      expect(keys[0]).not.toContain(input.data.to);
    }
  );

  it("uses distinct keys for distinct jobs or recipients even when queue IDs are reused", async () => {
    const input = job("welcome");
    await processJob(input);
    await processJob({ ...input, id: "job-43" });
    await processJob({
      ...input,
      data: { ...input.data, to: "other@example.test" },
    });
    await processJob({
      ...input,
      data: {
        ...input.data,
        templateData: {
          ...input.data.templateData,
          message: "Updated content",
        },
      },
    });
    const keys = state.fetch.mock.calls.map(([, init]) =>
      new Headers(init!.headers).get("Idempotency-Key")
    );
    expect(keys.every(key => /^ais-email-[0-9a-f]{64}$/.test(key ?? ""))).toBe(
      true
    );
    expect(new Set(keys).size).toBe(4);
  });

  it("uses the enqueue timestamp for a minimal payment receipt so retries do not change its content", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T13:00:00Z"));
    const input = job("payment_receipt");
    input.data.templateData = {
      passengerName: "Fixture Passenger",
      bookingReference: "TEST11",
    };
    await processJob(input);
    vi.setSystemTime(new Date("2026-11-04T14:00:00Z"));
    await processJob(input);
    expect(state.fetch.mock.calls[1][1]?.body).toBe(
      state.fetch.mock.calls[0][1]?.body
    );
  });

  it("does not send an invalid arrival date when an older booking job contains only departureDate", async () => {
    const input = job("booking_confirmation");
    delete input.data.templateData.departureTime;
    delete input.data.templateData.arrivalTime;
    input.data.templateData.departureDate = "2026-11-05T10:00:00Z";
    await processJob(input);
    expect(String(state.fetch.mock.calls[0][1]?.body)).not.toContain(
      "Invalid Date"
    );
  });

  it("refuses an unidentified job before contacting the provider", async () => {
    await expect(
      processJob({ ...job("welcome"), id: undefined })
    ).rejects.toThrow("Email job ID is required");
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
