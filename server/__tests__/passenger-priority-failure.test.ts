import { expect, it, vi } from "vitest";
import { calculatePriorityScore } from "../services/passenger-priority.service";
import type { SettlementTx } from "../services/booking-settlement.service";

it("fails a priority calculation when factor reads fail instead of manufacturing a zero score", async () => {
  let reads = 0;
  const db = {
    select() {
      reads++;
      if (reads > 2) throw new Error("priority database unavailable");
      const row = reads === 1 ? { id: 1, flightId: 10, userId: 1 } : { id: 1 };
      return { from: () => ({ where: () => ({ limit: async () => [row] }) }) };
    },
  } as unknown as SettlementTx;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      calculatePriorityScore(1, 1, { db, flightId: 10 })
    ).rejects.toThrow("priority database unavailable");
  } finally {
    log.mockRestore();
  }
});
