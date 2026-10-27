/**
 * Operations rules closed by the October 2026 review: waitlist priority is
 * monotonic, and a disruption is resolved only through the IROPS resolver.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as any, resolve: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/irops.service", () => ({
  resolveIROPSEvent: state.resolve,
}));

import { addToWaitlist } from "../services/inventory/inventory.service";
import { resolveDisruption } from "../services/disruption.service";

describe("waitlist priority", () => {
  it("issues the next number after the highest ever issued, not COUNT(waiting) + 1", async () => {
    const fixture = transactionMemory({
      waitlist: [
        {
          id: 1,
          flightId: 4,
          cabinClass: "economy",
          priority: 1,
          status: "offered",
        },
        {
          id: 2,
          flightId: 4,
          cabinClass: "economy",
          priority: 2,
          status: "expired",
        },
        {
          id: 3,
          flightId: 4,
          cabinClass: "economy",
          priority: 3,
          status: "waiting",
        },
        {
          id: 9,
          flightId: 5,
          cabinClass: "economy",
          priority: 7,
          status: "waiting",
        },
      ],
    });
    state.db = fixture.db;
    const entry = await addToWaitlist(4, "economy", 1, 42);
    // COUNT(waiting) + 1 would have been 2, ahead of the entry at 3.
    expect(entry.priority).toBe(4);
    expect(fixture.rows("waitlist").find(r => r.userId === 42)?.priority).toBe(
      4
    );
  });

  it("starts at 1 for an empty queue", async () => {
    const fixture = transactionMemory({ waitlist: [] });
    state.db = fixture.db;
    expect((await addToWaitlist(4, "business", 2, 42)).priority).toBe(1);
  });
});

describe("disruption resolution", () => {
  beforeEach(() => {
    // A hook that returns the mock would register it as a cleanup callback.
    state.resolve.mockReset();
  });

  it("delegates to the IROPS resolver, which refuses pending actions", async () => {
    state.resolve.mockResolvedValue({ id: 11, status: "resolved" });
    expect(await resolveDisruption(11)).toEqual({ success: true });
    expect(state.resolve).toHaveBeenCalledWith(11);
  });

  it("propagates the resolver's refusal instead of flipping the status", async () => {
    state.resolve.mockImplementation(() =>
      Promise.reject(new Error("Recovery actions are pending"))
    );
    let caught: unknown;
    try {
      await resolveDisruption(11);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Recovery actions are pending");
  });
});
