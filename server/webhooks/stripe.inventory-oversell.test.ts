import { describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
vi.mock("../db", () => ({ getDb: vi.fn() }));
import { reserveSeats } from "../services/booking-settlement.service";

describe("Stripe inventory oversell boundary", () => {
  it.each(["economy", "business"] as const)(
    "rejects exhausted %s inventory without decrementing",
    async cabin => {
      const fixture = transactionMemory({
        flights: [
          {
            id: 1,
            status: "scheduled",
            economyAvailable: 0,
            businessAvailable: 0,
          },
        ],
      });
      await expect(reserveSeats(fixture.db, 1, cabin, 1)).rejects.toThrow(
        "Insufficient"
      );
      expect(fixture.rows("flights")[0].economyAvailable).toBe(0);
      expect(fixture.rows("flights")[0].businessAvailable).toBe(0);
    }
  );
  it("does not take seats held by another purchase", async () => {
    const fixture = transactionMemory({
      flights: [{ id: 1, status: "scheduled", economyAvailable: 1 }],
      inventory_locks: [
        {
          id: 2,
          flightId: 1,
          cabinClass: "economy",
          numberOfSeats: 1,
          status: "active",
          expiresAt: new Date(Date.now() + 300000),
        },
      ],
    });
    await expect(reserveSeats(fixture.db, 1, "economy", 1)).rejects.toThrow(
      "Insufficient"
    );
    await expect(
      reserveSeats(fixture.db, 1, "economy", 1, 2)
    ).resolves.toBeUndefined();
    expect(fixture.rows("flights")[0].economyAvailable).toBe(0);
  });
});
