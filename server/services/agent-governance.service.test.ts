import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "../db";
import {
  getAiCostBreakdown,
  overrideAgentDecision,
  recordAiUsage,
  classifyAgentAction,
  requiresApproval,
} from "./agent-governance.service";

vi.mock("../db");

/**
 * Drizzle mock. `db` itself is NOT thenable (so `await getDb()` returns it
 * intact); its query builder `q` is chainable and thenable, resolving to
 * `rows` when awaited (or via `.values()` for inserts).
 */
function mockDb(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ["from", "where", "limit", "groupBy", "orderBy", "set"]) {
    q[m] = vi.fn(chain);
  }
  q.values = vi.fn(() => Promise.resolve([{ insertId: 1 }]));
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(res, rej);

  const dbObj: Record<string, unknown> = {
    select: vi.fn(() => q),
    insert: vi.fn(() => q),
    update: vi.fn(() => q),
  };
  // transaction(cb) runs the callback with a tx exposing the same builders.
  dbObj.transaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
    cb(dbObj)
  );
  return dbObj as unknown as Awaited<ReturnType<typeof db.getDb>>;
}

beforeEach(() => vi.clearAllMocks());

describe("recordAiUsage", () => {
  it("never throws even if the DB layer fails (hot-path safe)", async () => {
    vi.mocked(db.getDb).mockRejectedValue(new Error("db down"));
    await expect(
      recordAiUsage({ requestId: "r1", modelId: "m1", costUsd: 0.01 })
    ).resolves.toBeUndefined();
  });

  it("is a no-op when there is no database", async () => {
    vi.mocked(db.getDb).mockResolvedValue(null as never);
    await expect(
      recordAiUsage({ requestId: "r1", modelId: "m1" })
    ).resolves.toBeUndefined();
  });
});

describe("getAiCostBreakdown", () => {
  it("maps and numerically coerces aggregated rows", async () => {
    vi.mocked(db.getDb).mockResolvedValue(
      mockDb([
        {
          tenantId: 7,
          feature: "ai-pricing",
          calls: "12",
          totalCostUsd: "1.234500",
          totalInputTokens: "1000",
          totalOutputTokens: "500",
        },
      ])
    );

    const rows = await getAiCostBreakdown({ tenantId: 7 });
    expect(rows).toEqual([
      {
        tenantId: 7,
        feature: "ai-pricing",
        calls: 12,
        totalCostUsd: 1.2345,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
      },
    ]);
  });
});

describe("overrideAgentDecision", () => {
  it("throws NOT_FOUND when the decision does not exist", async () => {
    vi.mocked(db.getDb).mockResolvedValue(mockDb([]));
    await expect(
      overrideAgentDecision(99, { overriddenBy: 1, reason: "bad price" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("succeeds for an existing decision", async () => {
    vi.mocked(db.getDb).mockResolvedValue(mockDb([{ id: 5 }]));
    await expect(
      overrideAgentDecision(5, {
        overriddenBy: 1,
        reason: "bad price",
        supersededBy: 6,
      })
    ).resolves.toBeUndefined();
  });
});

describe("classifyAgentAction / requiresApproval", () => {
  it("flags money/inventory/itinerary actions as requires-approval", () => {
    for (const a of [
      "price_change",
      "booking_cancel",
      "refund",
      "overbooking",
      "compensation",
    ]) {
      expect(classifyAgentAction(a)).toBe("requires-approval");
      expect(requiresApproval(a)).toBe(true);
    }
  });

  it("treats only explicit read operations as auto-safe", () => {
    for (const a of ["suggest", "analyze", "summarize"]) {
      expect(classifyAgentAction(a)).toBe("auto-safe");
      expect(requiresApproval(a)).toBe(false);
    }
  });
});

it("denies unknown and outbound notification actions", () => {
  for (const action of ["unknown", "notify", "transfer_funds"]) {
    expect(classifyAgentAction(action)).toBe("denied");
    expect(requiresApproval(action)).toBe(true);
  }
});
