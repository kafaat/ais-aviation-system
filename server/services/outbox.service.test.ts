import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "../db";
import {
  processEvents,
  relayOutbox,
  recordEvent,
  loggingPublisher,
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

/**
 * Minimal fake of the drizzle handle used by the relay: a transaction whose
 * SELECT ... FOR UPDATE SKIP LOCKED returns `rows`, plus top-level update()
 * so markPublished/markFailed can be observed.
 */
function fakeDb(rows: OutboxEvent[]) {
  const forUpdate = vi.fn(() => Promise.resolve(rows));
  const selectChain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) {
    selectChain[m] = () => selectChain;
  }
  selectChain.for = forUpdate;

  const txSets: unknown[] = [];
  const txWhere = vi.fn(() => Promise.resolve());
  const txUpdate = vi.fn(() => ({
    set: (v: unknown) => {
      txSets.push(v);
      return { where: txWhere };
    },
  }));

  const rootSets: unknown[] = [];
  const rootWhere = vi.fn(() => Promise.resolve());
  const rootUpdate = vi.fn(() => ({
    set: (v: unknown) => {
      rootSets.push(v);
      return { where: rootWhere };
    },
  }));

  const handle = {
    transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        await fn({ select: () => selectChain, update: txUpdate })
    ),
    update: rootUpdate,
  };
  vi.mocked(db.getDb).mockReturnValue(handle as never);
  return { handle, forUpdate, txUpdate, txSets, rootUpdate, rootSets };
}

describe("relayOutbox", () => {
  it("is a no-op when there are no pending events", async () => {
    const { txUpdate, rootUpdate } = fakeDb([]);

    const publisher = vi.fn();
    const result = await relayOutbox(publisher as never);
    expect(result).toEqual({ published: 0, failed: 0 });
    expect(publisher).not.toHaveBeenCalled();
    // Nothing to claim → no status writes at all.
    expect(txUpdate).not.toHaveBeenCalled();
    expect(rootUpdate).not.toHaveBeenCalled();
  });

  it("claims rows (SKIP LOCKED + status=processing) before publishing", async () => {
    const { forUpdate, txUpdate, txSets, rootSets } = fakeDb([
      event(1),
      event(2),
    ]);

    const order: string[] = [];
    txUpdate.mockImplementation(() => {
      order.push("claim");
      return {
        set: (v: unknown) => {
          txSets.push(v);
          return { where: () => Promise.resolve() };
        },
      };
    });
    const publisher: OutboxPublisher = async e => {
      order.push(`publish:${e.id}`);
    };

    const result = await relayOutbox(publisher);

    expect(result).toEqual({ published: 2, failed: 0 });
    // Row-level lock with SKIP LOCKED so concurrent relays get disjoint sets.
    expect(forUpdate).toHaveBeenCalledWith("update", { skipLocked: true });
    // Claim happens once, inside the tx, and strictly BEFORE any publish.
    expect(order).toEqual(["claim", "publish:1", "publish:2"]);
    expect(txSets[0]).toMatchObject({ status: "processing" });
    expect((txSets[0] as { lockedAt: unknown }).lockedAt).toBeInstanceOf(Date);
    // Successful publish releases the claim.
    expect(rootSets[0]).toMatchObject({ status: "published", lockedAt: null });
  });

  it("releases the claim on failure so the event can be retried", async () => {
    const { rootSets } = fakeDb([event(7)]);
    const publisher: OutboxPublisher = async () => {
      throw new Error("bus down");
    };

    const result = await relayOutbox(publisher);

    expect(result).toEqual({ published: 0, failed: 1 });
    const failedSet = rootSets[0] as Record<string, unknown>;
    expect(failedSet.lockedAt).toBeNull();
    expect(failedSet.lastError).toBe("bus down");
  });
});

describe("loggingPublisher", () => {
  it("publishes (logs) without throwing", async () => {
    await expect(loggingPublisher(event(1))).resolves.toBeUndefined();
  });
});
