import { describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { offerSeat } from "./waitlist.service";
describe("waitlist inventory atomicity", () => {
  it("rolls the hold and offered state back when the event cannot commit", async () => {
    const f = transactionMemory({
      waitlist: [
        {
          id: 1,
          flightId: 1,
          userId: 8,
          cabinClass: "economy",
          seats: 1,
          status: "waiting",
        },
      ],
      flights: [
        {
          id: 1,
          status: "scheduled",
          economyAvailable: 1,
          departureTime: new Date(Date.now() + 86400000),
        },
      ],
    });
    state.db = f.db;
    f.failInsert("outbox");
    await expect(offerSeat(1)).rejects.toThrow("Injected");
    expect(f.rows("waitlist")[0].status).toBe("waiting");
    expect(f.rows("inventory_locks")).toHaveLength(0);
    expect(f.rows("flights")[0].economyAvailable).toBe(1);
  });
});
