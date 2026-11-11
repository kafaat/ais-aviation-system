import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import {
  bulkUpdateServiceStatus,
  requestService,
  updateServiceStatus,
} from "./special-services.service";

let fixture: ReturnType<typeof transactionMemory>;
vi.mock("../db", () => ({ getDb: () => fixture.db }));
const service = {
  id: 6,
  bookingId: 1,
  passengerId: 5,
  bookingSegmentId: 2,
  flightId: 3,
  serviceType: "meal",
  serviceCode: "VGML",
  status: "cancelled",
};
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [
      { id: 1, userId: 4, flightId: 3, tenantId: null, status: "confirmed" },
    ],
    booking_segments: [
      {
        id: 2,
        bookingId: 1,
        flightId: 3,
        segmentOrder: 1,
        status: "confirmed",
      },
    ],
    flights: [
      {
        id: 3,
        tenantId: null,
        status: "scheduled",
        departureTime: new Date(Date.now() + 86400000),
      },
    ],
    passengers: [{ id: 5, bookingId: 1 }],
    special_services: [service],
  });
});

describe("SSR activation preserves sector uniqueness", () => {
  for (const target of ["pending", "confirmed"] as const) {
    it(`cannot restore a cancelled service to ${target} after its replacement was requested`, async () => {
      await requestService({
        bookingId: 1,
        passengerId: 5,
        flightId: 3,
        serviceType: "meal",
        serviceCode: "VGML",
      });
      await expect(updateServiceStatus(6, target)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(fixture.rows("special_services").map(row => row.status)).toEqual([
        "cancelled",
        "pending",
      ]);
    });
  }

  it("rejects competing activations in one batch atomically", async () => {
    fixture.rows("special_services").push({ ...service, id: 7 });
    await expect(
      bulkUpdateServiceStatus([6, 7], "confirmed")
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("special_services").map(row => row.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
  });

  it("counts distinct rows that exist instead of requested IDs", async () => {
    expect(await bulkUpdateServiceStatus([6, 6, 999], "rejected")).toEqual({
      success: true,
      updated: 1,
    });
  });

  it("allows confirmation of the same request without conflicting with itself", async () => {
    await updateServiceStatus(6, "pending");
    await updateServiceStatus(6, "confirmed");
    expect(fixture.rows("special_services")[0].status).toBe("confirmed");
    expect(fixture.lockedTables).toContain("bookings");
  });

  it("rejects reactivation on a cancelled sector", async () => {
    fixture.rows("booking_segments")[0].status = "cancelled";
    await expect(updateServiceStatus(6, "confirmed")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("rejects reactivation on a departed flight but permits cancellation", async () => {
    fixture.rows("flights")[0].departureTime = new Date(Date.now() - 1);
    await expect(updateServiceStatus(6, "confirmed")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(updateServiceStatus(6, "cancelled")).resolves.toEqual({
      success: true,
    });
  });

  it("refuses ambiguous legacy service sectors", async () => {
    fixture.rows("special_services")[0].flightId = null;
    await expect(updateServiceStatus(6, "confirmed")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("allows the same service type for different passengers", async () => {
    fixture.rows("passengers").push({ id: 8, bookingId: 1 });
    fixture
      .rows("special_services")
      .push({ ...service, id: 7, passengerId: 8 });
    expect(await bulkUpdateServiceStatus([6, 7], "confirmed")).toEqual({
      success: true,
      updated: 2,
    });
  });
});
