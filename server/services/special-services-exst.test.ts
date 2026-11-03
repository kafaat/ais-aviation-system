import { beforeEach, expect, it, vi } from "vitest";
import { specialServicesRouter } from "../routers/special-services";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";

let fixture: ReturnType<typeof transactionMemory>;
vi.mock("../db", () => ({ getDb: () => fixture.db }));
const caller = specialServicesRouter.createCaller({
  user: { id: 4, role: "admin" },
  tenantId: null,
} as TrpcContext);
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [{ id: 1, userId: 4, flightId: 3, tenantId: null }],
    booking_segments: [{ id: 2, bookingId: 1, flightId: 3, segmentOrder: 1 }],
    passengers: [{ id: 5, bookingId: 1 }],
    special_services: [
      {
        id: 6,
        bookingId: 1,
        passengerId: 5,
        serviceType: "extra_legroom",
        serviceCode: "EXST",
        status: "pending",
      },
      {
        id: 7,
        bookingId: 1,
        passengerId: 5,
        serviceType: "meal",
        serviceCode: "VGML",
        status: "pending",
      },
    ],
  });
});
it("excludes legroom from SSR sales and rejects the old EXST request", async () => {
  expect((await caller.getAvailableServices()).extra_legroom).toEqual([]);
  await expect(
    caller.requestService({
      bookingId: 1,
      passengerId: 5,
      serviceType: "extra_legroom",
      serviceCode: "EXST",
    })
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringContaining("Extra seats cannot be reserved"),
  });
  expect(fixture.rows("special_services")).toHaveLength(2);
  expect(fixture.rows("seat_inventory")).toHaveLength(0);
});
it("refuses single and mixed-batch confirmation of historical EXST, while allowing cancellation", async () => {
  await expect(
    caller.adminUpdateStatus({ serviceId: 6, status: "confirmed" })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.adminBulkUpdateStatus({ serviceIds: [7, 6], status: "confirmed" })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(fixture.rows("special_services").map(r => r.status)).toEqual([
    "pending",
    "pending",
  ]);
  await caller.adminUpdateStatus({ serviceId: 6, status: "cancelled" });
  expect(fixture.rows("special_services")[0].status).toBe("cancelled");
});
