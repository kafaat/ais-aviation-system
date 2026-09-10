import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import { sendEmail } from "../services/email.service";
import { configuredPublisher, markPublished } from "../services/outbox.service";
import {
  getLoadPlan,
  assignCompartment,
} from "../services/load-planning.service";
import { triggerBackup } from "../services/disaster-recovery.service";
import { testConnection } from "../services/gds.service";

const message = {
  to: "synthetic@example.test",
  subject: "Test",
  html: "<p>Test</p>",
  idempotencyKey: "test-message",
};
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("OUTBOX_PUBLISH_URL", "");
  vi.stubEnv("OUTBOX_PUBLISH_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("operational truth", () => {
  it("does not announce email delivery without provider acceptance", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(sendEmail(message)).rejects.toThrow("requires");
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("RESEND_API_KEY", "synthetic-key");
    vi.stubEnv("EMAIL_FROM", "test@example.test");
    fetch.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await expect(sendEmail(message)).rejects.toThrow("HTTP 503");
    fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(sendEmail(message)).rejects.toThrow("message ID");
    fetch.mockResolvedValueOnce(
      new Response('{"id":"provider-receipt"}', { status: 200 })
    );
    await expect(sendEmail(message)).resolves.toBe(true);
    expect(fetch.mock.calls.at(-1)?.[1].headers["Idempotency-Key"]).toBe(
      "test-message"
    );
  });

  it("requires receiver acceptance before acknowledging a generic outbox event", async () => {
    const event = {
      eventId: "stable-event-id",
      eventType: "booking.modified",
      aggregateId: "7",
    } as any;
    await expect(configuredPublisher(event)).rejects.toThrow("not configured");
    vi.stubEnv("OUTBOX_PUBLISH_URL", "https://receiver.example.test/events");
    vi.stubEnv("OUTBOX_PUBLISH_TOKEN", "synthetic-key");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    await expect(configuredPublisher(event)).rejects.toThrow("HTTP 503");
    await expect(configuredPublisher(event)).resolves.toBeUndefined();
    expect(fetch.mock.calls.at(-1)?.[1].headers["Idempotency-Key"]).toBe(
      event.eventId
    );
  });

  it("a stale worker cannot acknowledge a reclaimed outbox lease", async () => {
    const fixture = transactionMemory({
      outbox: [{ id: 1, status: "processing", leaseToken: "new-owner" }],
    });
    boundary.db = fixture.db;
    expect(await markPublished([{ id: 1, leaseToken: "old-owner" }])).toBe(0);
    expect(fixture.rows("outbox")[0].status).toBe("processing");
    expect(await markPublished([{ id: 1, leaseToken: "new-owner" }])).toBe(1);
    expect(fixture.rows("outbox")[0].status).toBe("published");
  });

  it("never enables simulated backup or GDS success in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AIS_ENABLE_DEMOS", "true");
    expect(() => triggerBackup("full", "database", 1)).toThrow(
      "no verified production adapter"
    );
    await expect(testConnection(1)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("reads and writes load plans through persistence, rejecting concurrent stale writes", async () => {
    const compartment = {
      id: 10,
      maxWeight: 10000,
      maxVolume: 10000,
      compartmentCode: "FWD",
    };
    const plan = {
      id: 4,
      flightId: 4,
      status: "draft",
      items: [
        {
          id: 1,
          itemType: "cargo",
          status: "active",
          weight: 100,
          volume: 100,
          compartmentId: null,
        },
      ],
      compartments: [
        { compartment, totalWeight: 0, totalVolume: 0, items: [] },
      ],
    };
    const fixture = transactionMemory({
      load_plan_details: [
        { flightId: 4, version: 1, data: { plan, nextItemId: 2 } },
      ],
    });
    boundary.db = fixture.db;
    // Model only the atomic CAS boundary: a failed CAS has no changes to roll back.
    fixture.db.transaction = (fn: any) => fn(fixture.db);
    const results = await Promise.allSettled([
      assignCompartment(4, 1, 10),
      assignCompartment(4, 1, 10),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const reloaded = await getLoadPlan(4);
    expect(reloaded?.items[0].compartmentId).toBe(10);
  });
});
