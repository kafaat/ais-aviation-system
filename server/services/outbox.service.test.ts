import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "../db";
import {
  processEvents,
  relayOutbox,
  recordEvent,
  type OutboxPublisher,
} from "./outbox.service";
import type { OutboxEvent } from "../../drizzle/schema";

vi.mock("../db");

function event(id: number): OutboxEvent {
  return {
    id,
    eventId: `evt-${id}`,
    aggregateType: "agentDecision",
    aggregateId: String(id),
    eventType: "AgentDecisionOverridden",
    tenantId: null,
    payload: { decisionId: id },
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: new Date(),
    publishedAt: null,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("processEvents (pure relay core)", () => {
  it("publishes all events when the publisher succeeds", async () => {
    const published: number[] = [];
    const publisher: OutboxPublisher = async e => {
      published.push(e.id);
    };
    const result = await processEvents([event(1), event(2)], publisher);
    expect(result.publishedIds).toEqual([1, 2]);
    expect(result.failed).toEqual([]);
    expect(published).toEqual([1, 2]);
  });

  it("partitions failures without aborting the batch", async () => {
    const publisher: OutboxPublisher = async e => {
      if (e.id === 2) throw new Error("bus down");
    };
    const result = await processEvents(
      [event(1), event(2), event(3)],
      publisher
    );
    expect(result.publishedIds).toEqual([1, 3]);
    expect(result.failed).toEqual([{ id: 2, error: "bus down" }]);
  });
});

describe("recordEvent", () => {
  it("inserts a pending row and returns a generated eventId", async () => {
    const values = vi.fn(() => Promise.resolve([{ insertId: 1 }]));
    const tx = { insert: vi.fn(() => ({ values })) };
    const eventId = await recordEvent(tx as never, {
      aggregateType: "booking",
      aggregateId: 42,
      eventType: "BookingConfirmed",
      payload: { bookingId: 42 },
    });
    expect(typeof eventId).toBe("string");
    expect(eventId.length).toBeGreaterThan(0);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    const inserted = values.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.aggregateId).toBe("42"); // stringified
    expect(inserted.status).toBe("pending");
    expect(inserted.eventId).toBe(eventId);
  });
});

describe("relayOutbox", () => {
  it("is a no-op when there are no pending events", async () => {
    // getPendingEvents -> db.select()...limit() resolves to []
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
    chain.limit = () => Promise.resolve([]);
    vi.mocked(db.getDb).mockReturnValue({
      select: () => chain,
    } as never);

    const publisher = vi.fn();
    const result = await relayOutbox(publisher as never);
    expect(result).toEqual({ published: 0, failed: 0 });
    expect(publisher).not.toHaveBeenCalled();
  });
});
