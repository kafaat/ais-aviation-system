import { beforeEach, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import { getFlightEconomics } from "../services/seat-economics.service";
let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [
      {
        id: 1,
        tenantId: 1,
        flightId: 10,
        paymentStatus: "paid",
        totalAmount: 10000,
        numberOfPassengers: 2,
      },
    ],
    booking_segments: [
      {
        id: 1,
        bookingId: 1,
        flightId: 10,
        segmentOrder: 0,
        segmentAmount: 4000,
        status: "confirmed",
      },
      {
        id: 2,
        bookingId: 1,
        flightId: 20,
        segmentOrder: 1,
        segmentAmount: 6000,
        status: "confirmed",
      },
    ],
  });
  boundary.db = fixture.db;
});
it("attributes a multi-sector invoice to every flown sector, conserving costs", async () => {
  const a = await getFlightEconomics(10, { tenantId: 1 });
  const b = await getFlightEconomics(20, { tenantId: 1 });
  expect(a).toMatchObject({ gross: 4000, seatCount: 2, bookingCount: 1 });
  expect(b).toMatchObject({ gross: 6000, seatCount: 2, bookingCount: 1 });
  expect(a.totalCost + b.totalCost).toBe(390);
  expect(a.netContribution + b.netContribution).toBe(9610);
});
it("fails closed for historical sectors without proven revenue allocation", async () => {
  fixture.rows("booking_segments")[1].segmentAmount = null;
  await expect(getFlightEconomics(10, { tenantId: 1 })).rejects.toThrow(
    /allocation/i
  );
});
it("does not include a cancelled sector or another tenant's booking", async () => {
  fixture.rows("booking_segments")[1].status = "cancelled";
  expect(await getFlightEconomics(20, { tenantId: 1 })).toMatchObject({
    gross: 0,
    bookingCount: 0,
    seatCount: 0,
  });
  expect(await getFlightEconomics(10, { tenantId: 2 })).toMatchObject({
    gross: 0,
    bookingCount: 0,
  });
});
it("retains legacy single-flight invoice reporting without segment rows", async () => {
  fixture.rows("booking_segments").splice(0);
  expect(await getFlightEconomics(10, { tenantId: 1 })).toMatchObject({
    gross: 10000,
    totalCost: 390,
    seatCount: 2,
  });
});
