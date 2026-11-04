import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { getTenantBookingSeatEconomics } from "../services/seat-economics-tenant.service";
import { seatEconomicsRouter } from "../routers/seat-economics";

let fixture: ReturnType<typeof transactionMemory>;
function caller(
  role: string | null = "admin",
  tenantId: number | null | undefined = 3
) {
  return seatEconomicsRouter.createCaller({
    user: role ? { id: 10, role, tenantId } : null,
    tenantId,
    authMethod: "bearer",
    req: { headers: {}, ip: "127.0.0.1" },
    res: {},
  } as unknown as TrpcContext);
}
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [
      { id: 71, tenantId: 3, totalAmount: 10001, numberOfPassengers: 1 },
      { id: 72, tenantId: 4, totalAmount: 999999, numberOfPassengers: 1 },
    ],
    passengers: [
      {
        id: 8,
        bookingId: 71,
        firstName: "Owned",
        lastName: "Passenger",
        seatNumber: "1A",
      },
      {
        id: 9,
        bookingId: 72,
        firstName: "Foreign",
        lastName: "Private",
        seatNumber: "2A",
      },
    ],
    agent_bookings: [{ id: 1, bookingId: 71, commissionAmount: 500 }],
  });
  state.db = fixture.db;
});

describe("seat economics through the mounted router and tenant service", () => {
  it("returns only the scoped booking's financial breakdown through middleware and output validation", async () => {
    const result = await caller().getByBooking({
      bookingId: 71,
      paymentFeeRate: 0.02,
      paymentFeeFixed: 10,
    });
    expect(result).toMatchObject({
      bookingId: 71,
      currency: "SAR",
      summary: {
        seatCount: 1,
        gross: 10001,
        paymentFee: 210,
        agentCommission: 500,
        netContribution: 9291,
      },
      seats: [
        { passengerId: 8, passengerName: "Owned Passenger", seatNumber: "1A" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("Foreign");
  });

  it("makes foreign and missing bookings indistinguishable before reading financial details", async () => {
    const select = vi.spyOn(fixture.db, "select");
    for (const bookingId of [72, 999]) {
      select.mockClear();
      await expect(caller().getByBooking({ bookingId })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Booking not found",
      });
      expect(select).toHaveBeenCalledTimes(1);
    }
  });

  it.each([null, undefined])(
    "fails closed without tenant context (%s), including global administrators",
    async tenantId => {
      await expect(getTenantBookingSeatEconomics(71, tenantId)).rejects.toThrow(
        "Tenant context required"
      );
      if (tenantId === null)
        await expect(
          caller("super_admin", null).getByBooking({ bookingId: 71 })
        ).rejects.toMatchObject({
          code: "INTERNAL_SERVER_ERROR",
          message: "Tenant context required",
        });
    }
  );

  it.each(["user", "finance", "airline_admin"])(
    "preserves the current admin-only route policy for %s",
    async role => {
      const select = vi.spyOn(fixture.db, "select");
      await expect(
        caller(role).getByBooking({ bookingId: 71 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(select).not.toHaveBeenCalled();
    }
  );

  it("requires authentication before financial reads", async () => {
    const select = vi.spyOn(fixture.db, "select");
    await expect(
      caller(null).getByBooking({ bookingId: 71 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(select).not.toHaveBeenCalled();
  });

  it("rejects invalid financial inputs before service execution", async () => {
    const select = vi.spyOn(fixture.db, "select");
    await expect(
      caller().getByBooking({ bookingId: 71, paymentFeeRate: 1.01 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().getByBooking({ bookingId: 0 })).rejects.toMatchObject(
      { code: "BAD_REQUEST" }
    );
    expect(select).not.toHaveBeenCalled();
  });

  it("reports database unavailability without falling back to an unscoped calculation", async () => {
    state.db = null;
    await expect(
      caller().getByBooking({ bookingId: 71 })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  });
});
