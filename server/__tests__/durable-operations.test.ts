import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { consumeLocalEvent } from "../services/event-inbox.service";
import { runScheduledTask } from "../services/scheduled-task.service";
import { readExportContent } from "../services/data-warehouse.service";
import {
  weighBag,
  printBagTag,
  confirmBagDrop,
  processPayment,
} from "../services/bag-drop.service";
import { listCapabilities } from "../services/capability-catalog.service";
import { getProvider, getAllProviderInfo } from "../services/payment-providers";
let fixture: ReturnType<typeof transactionMemory>;
const event = {
  eventId: "6169330f-40d2-484f-b12a-507f1d22217a",
  eventType: "booking.created",
  aggregateType: "booking",
  aggregateId: "1",
  tenantId: 3,
  payload: { bookingId: 1 },
};
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [
      {
        id: 1,
        tenantId: 3,
        userId: 8,
        flightId: 1,
        bookingReference: "AB1234",
      },
    ],
    flights: [{ id: 1, destinationId: 1 }],
    airports: [{ id: 1, code: "RUH" }],
    bag_drop_sessions: [
      {
        id: 1,
        bookingId: 1,
        passengerId: 1,
        unitId: 0,
        version: 0,
        bagWeights: [],
        totalBags: 0,
        totalWeight: 0,
        allowanceWeight: 23000,
        excessWeight: 0,
        excessFee: 0,
        paymentStatus: "none",
        status: "started",
        startedAt: new Date(),
      },
    ],
  });
  state.db = fixture.db;
});
afterEach(() => vi.unstubAllEnvs());
describe("durable integration effects", () => {
  it("deduplicates receipt and owned notification, rejects identity reuse", async () => {
    expect(await consumeLocalEvent(event)).toMatchObject({ duplicate: false });
    expect(await consumeLocalEvent(event)).toMatchObject({ duplicate: true });
    expect(fixture.rows("event_inbox")).toHaveLength(1);
    expect(fixture.rows("notifications")).toHaveLength(1);
    expect(fixture.rows("notifications")[0].userId).toBe(8);
    await expect(
      consumeLocalEvent({ ...event, payload: { bookingId: 2 } })
    ).rejects.toThrow("conflicts");
  });
  it("records failure without claiming that the local effect committed", async () => {
    fixture.failInsert("notifications");
    await expect(consumeLocalEvent(event)).rejects.toThrow(
      "Local event consumers failed"
    );
    expect(fixture.rows("event_inbox")[0].processedAt).toBeNull();
    expect(
      fixture.rows("event_deliveries").every(r => r.status !== "processed")
    ).toBe(true);
    expect(fixture.rows("notifications")).toHaveLength(0);
  });
  it("does not consume a missing or foreign aggregate", async () => {
    await expect(consumeLocalEvent({ ...event, tenantId: 9 })).rejects.toThrow(
      "Local event consumers failed"
    );
    await expect(
      consumeLocalEvent({
        ...event,
        eventId: "7169330f-40d2-484f-b12a-507f1d22217a",
        aggregateId: "99",
      })
    ).rejects.toThrow("Local event consumers failed");
    expect(fixture.rows("event_inbox")[0].processedAt).toBeNull();
    expect(
      fixture.rows("event_deliveries").every(r => r.status !== "processed")
    ).toBe(true);
    expect(fixture.rows("notifications")).toHaveLength(0);
  });
  it("records completed ticks and retries failures without false success", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    expect(await runScheduledTask("test", "1", run)).toBe(true);
    expect(await runScheduledTask("test", "1", run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    const completed = fixture.rows("scheduled_tasks")[0].lastSuccessAt;
    await expect(
      runScheduledTask("test", "2", async () => {
        throw new Error("provider failed");
      })
    ).rejects.toThrow("provider failed");
    expect(fixture.rows("scheduled_tasks")[0]).toMatchObject({
      lastTick: "1",
      lastSuccessAt: completed,
      lastError: "provider failed",
      leaseToken: null,
    });
    expect(await runScheduledTask("test", "2", run)).toBe(true);
  });
  it("validates the exported bytes, not only metadata", async () => {
    const content = '{"flights":[]}';
    fixture.rows("warehouse_exports");
    state.db = transactionMemory({
      warehouse_exports: [
        {
          id: 1,
          status: "completed",
          format: "json",
          content,
          checksum: createHash("sha256").update(content).digest("hex"),
        },
      ],
    }).db;
    expect((await readExportContent(1)).content).toBe(content);
    state.db = transactionMemory({
      warehouse_exports: [
        {
          id: 1,
          status: "completed",
          format: "json",
          content: "tampered",
          checksum: createHash("sha256").update(content).digest("hex"),
        },
      ],
    }).db;
    await expect(readExportContent(1)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
describe("bag-drop persistence and evidence", () => {
  it("keeps individual measurements, retries tags, and completes once", async () => {
    vi.stubEnv("AIS_ENABLE_DEMOS", "true");
    await weighBag(1, 8000, 1);
    await weighBag(1, 10000, 2);
    await weighBag(1, 8000, 1);
    await expect(weighBag(1, 9000, 1)).rejects.toThrow("changed");
    expect(fixture.rows("bag_drop_sessions")[0]).toMatchObject({
      totalBags: 2,
      totalWeight: 18000,
      bagWeights: [8000, 10000],
    });
    const first = await printBagTag(1, 1);
    expect(await printBagTag(1, 1)).toEqual(first);
    const second = await printBagTag(1, 2);
    expect([first.weight, second.weight]).toEqual([8000, 10000]);
    await confirmBagDrop(1);
    await confirmBagDrop(1);
    expect(fixture.rows("bag_drop_tags")).toHaveLength(2);
    expect(fixture.rows("bag_drop_sessions")[0].status).toBe("complete");
    await expect(weighBag(1, 1000, 3)).rejects.toThrow("terminal");
  });
  it("requires verified payment for excess weight and rolls back failed printing", async () => {
    vi.stubEnv("AIS_ENABLE_DEMOS", "true");
    await weighBag(1, 25000, 1);
    await expect(printBagTag(1, 1)).rejects.toThrow("not been paid");
    expect(() => processPayment(1, 1)).toThrow("not installed");
    fixture.rows("bag_drop_sessions")[0].excessFee = 0;
    fixture.failInsert("bag_drop_tags");
    await expect(printBagTag(1, 1)).rejects.toThrow("Injected");
    expect(fixture.rows("bag_drop_sessions")[0].status).toBe("weighing");
  });
  it("never enables hardware simulation or unverified PSPs in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AIS_ENABLE_DEMOS", "true");
    await expect(weighBag(1, 1000)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(
      listCapabilities()
        .filter(c => c.implementation !== "implemented")
        .every(c => !c.available)
    ).toBe(true);
    for (const info of getAllProviderInfo().filter(p => p.id !== "stripe")) {
      expect(info.enabled).toBe(false);
      expect(() => getProvider(info.id)).toThrow("before activation");
    }
  });
});
