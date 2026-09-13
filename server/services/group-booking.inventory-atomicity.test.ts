import { describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { approveGroupBooking } from "./group-booking.service";
function seed() {
  const f = transactionMemory({
    users: [{ id: 8, tenantId: null }],
    group_bookings: [
      {
        id: 1,
        organizerUserId: 8,
        flightId: 1,
        cabinClass: "economy",
        groupSize: 10,
        status: "pending",
      },
    ],
    flights: [
      {
        id: 1,
        tenantId: null,
        status: "scheduled",
        economyAvailable: 10,
        economyPrice: 10000,
        departureTime: new Date(Date.now() + 86400000),
      },
    ],
  });
  state.db = f.db;
  return f;
}
describe("group booking inventory atomicity", () => {
  it("rolls allocation and approval back when the event cannot commit", async () => {
    const f = seed();
    f.failInsert("outbox");
    await expect(approveGroupBooking(1, 5, 8)).rejects.toThrow("Injected");
    expect(f.rows("group_bookings")[0].status).toBe("pending");
    expect(f.rows("inventory_locks")).toHaveLength(0);
    expect(f.rows("flights")[0].economyAvailable).toBe(10);
  });
  it("reserves one hold and prevents a repeated approval from allocating again", async () => {
    const f = seed();
    await approveGroupBooking(1, 5, 8);
    await expect(approveGroupBooking(1, 5, 8)).rejects.toThrow("not pending");
    expect(f.rows("inventory_locks")).toHaveLength(1);
    expect(f.rows("inventory_locks")[0].numberOfSeats).toBe(10);
    expect(f.rows("flights")[0].economyAvailable).toBe(10);
  });
});
