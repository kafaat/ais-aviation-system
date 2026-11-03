import { beforeEach, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import { requestService } from "../services/special-services.service";
const state = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
const input = {
  bookingId: 10,
  passengerId: 8,
  serviceType: "wheelchair" as const,
  serviceCode: "WCHR",
};
let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [{ id: 10, status: "confirmed", flightId: 2, tenantId: 1 }],
    passengers: [
      { id: 8, bookingId: 10 },
      { id: 9, bookingId: 10 },
    ],
    flights: [2, 4, 6].map(id => ({
      id,
      tenantId: 1,
      status: "scheduled",
      departureTime: new Date(Date.now() + 86400000),
    })),
    booking_segments: [
      { id: 22, bookingId: 10, flightId: 2, status: "confirmed" },
      { id: 24, bookingId: 10, flightId: 4, status: "confirmed" },
    ],
    special_services: [],
  });
  state.db = fixture.db;
});
it("locks the booking, rejects ambiguous and foreign legs, and allows the same type independently per passenger and sector", async () => {
  for (const flightId of [undefined, 6])
    await expect(requestService({ ...input, flightId })).rejects.toThrow(
      /unique active flight/
    );
  const first = await requestService({ ...input, flightId: 2 });
  const second = await requestService({ ...input, flightId: 4 });
  expect(
    [first, second].map(row => [row.flightId, row.bookingSegmentId])
  ).toEqual([
    [2, 22],
    [4, 24],
  ]);
  await expect(requestService({ ...input, flightId: 2 })).rejects.toThrow(
    /already exists/
  );
  await expect(
    requestService({ ...input, passengerId: 9, flightId: 2 })
  ).resolves.toMatchObject({ passengerId: 9, flightId: 2 });
  expect(fixture.lockedTables).toContain("bookings");
});
it("retains unresolved legacy requests, and never attaches them to the last active sector", async () => {
  fixture.rows("booking_segments")[0].status = "cancelled";
  await expect(requestService(input)).rejects.toThrow(/unique active flight/);
  await expect(requestService({ ...input, flightId: 2 })).rejects.toThrow(
    /unique active flight/
  );
  fixture.rows("special_services").push({
    ...input,
    id: 3,
    flightId: null,
    bookingSegmentId: null,
    status: "pending",
  });
  await expect(requestService({ ...input, flightId: 4 })).rejects.toThrow(
    /no verified flight sector/
  );
  expect(fixture.rows("special_services")).toHaveLength(1);
  expect(fixture.rows("special_services")[0].flightId).toBeNull();
});
it("keeps single-flight clients compatible, preserves the original request after a rebooking, and refuses cancelled flights", async () => {
  fixture.rows("booking_segments").splice(0);
  expect(await requestService(input)).toMatchObject({
    flightId: 2,
    bookingSegmentId: null,
  });
  fixture.rows("bookings")[0].flightId = 4;
  const next = await requestService(input);
  expect(next.flightId).toBe(4);
  expect(fixture.rows("special_services")[0].flightId).toBe(2);
  fixture.rows("flights").find(f => f.id === 4)!.status = "cancelled";
  await expect(requestService({ ...input, passengerId: 9 })).rejects.toThrow(
    /no longer available/
  );
});
