import { beforeEach, describe, it, expect, vi } from "vitest";
import { and, asc, desc, eq, gt, lt, lte } from "drizzle-orm";
import { stripeEvents } from "../../drizzle/schema";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
const state = vi.hoisted(() => ({
  db: null as any,
  add: vi.fn(),
  process: null as any,
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../queue/redis-config", () => ({
  redisConnectionOptions: () => ({}),
}));
vi.mock("bullmq", () => ({
  Queue: class {
    add = state.add;
  },
  Worker: class {
    constructor(_name: string, process: unknown) {
      state.process = process;
    }
  },
  UnrecoverableError: class extends Error {},
}));
import { queueWebhookRetry, startScheduledWorker } from "./queue-v2.service";
beforeEach(() => {
  state.add.mockReset();
});
describe("eligible webhook reconciliation", () => {
  it("keeps delay zero and rejects invalid delays", async () => {
    for (const delay of [undefined, 0, 123])
      await queueWebhookRetry({ eventId: "evt", delay });
    expect(state.add.mock.calls.map(call => call[2].delay)).toEqual([
      60000, 0, 123,
    ]);
    for (const delay of [-1, NaN, Infinity])
      await expect(
        queueWebhookRetry({ eventId: "evt", delay })
      ).rejects.toThrow();
  });
  it("passes an exhausted backlog and reaches more than one page of eligible events", async () => {
    const rows = Array.from({ length: 251 }, (_, i) => ({
      id: `evt_${String(i).padStart(4, "0")}`,
      processed: false,
      retryCount: i < 100 ? 5 : 0,
      createdAt: new Date(),
    }));
    const memory = transactionMemory({ stripe_events: rows });
    state.db = {
      query: {
        stripeEvents: {
          findMany: async (opts: any) => {
            let query = memory.db
              .select()
              .from(stripeEvents)
              .where(opts.where?.(stripeEvents, { and, eq, gt, lt, lte }));
            if (opts.orderBy)
              query = query.orderBy(
                ...opts.orderBy(stripeEvents, { asc, desc })
              );
            return query.limit(opts.limit ?? 1000);
          },
        },
      },
    };
    startScheduledWorker();
    await state.process({ name: "reconciliation", data: {} });
    expect(state.add.mock.calls.map(call => call[1].eventId)).toEqual(
      rows.slice(100).map(r => r.id)
    );
    expect(
      memory
        .rows("stripe_events")
        .filter(r => r.retryCount === 5 && !r.processed)
    ).toHaveLength(100);
  });
});
