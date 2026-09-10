import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";

const boundary = vi.hoisted(() => ({
  ownerId: 101,
  exists: true,
  available: true,
  submit: vi.fn(),
  status: vi.fn(),
  hotels: vi.fn(),
  segments: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: () =>
    boundary.available
      ? {
          select() {
            let table: string;
            const query: any = {
              from(value: Parameters<typeof getTableName>[0]) {
                table = getTableName(value);
                return query;
              },
              innerJoin: () => query,
              where: () => query,
              limit: () =>
                Promise.resolve(
                  !boundary.exists
                    ? []
                    : table === "bookings"
                      ? [{ userId: boundary.ownerId }]
                      : [{ bookingId: 800, ownerId: boundary.ownerId }]
                ),
            };
            return query;
          },
        }
      : null,
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("../services/apis.service", () => ({
  collectPassengerInfo: boundary.submit,
  getPassengerAPISStatus: boundary.status,
}));
vi.mock("../services/emergency-hotel.service", () => ({
  getHotelBookingsByPassenger: boundary.hotels,
}));
vi.mock("../services/multi-city.service", () => ({
  getBookingSegments: boundary.segments,
}));
vi.mock("../services/audit.service", () => ({ auditBookingChange: vi.fn() }));

import { apisRouter } from "../routers/apis";
import { emergencyHotelRouter } from "../routers/emergency-hotel";
import { multiCityRouter } from "../routers/multi-city";

function context(role: string | null = "user"): TrpcContext {
  return {
    user: role ? { id: 101, role, tenantId: 1 } : null,
    tenantId: 1,
    req: { headers: {} },
    res: {},
  } as TrpcContext;
}

const cases = [
  {
    name: "APIS document write",
    call: (ctx: TrpcContext) =>
      apisRouter.createCaller(ctx).submitInfo({
        passengerId: 700,
        documentType: "passport",
        documentNumber: "SYNTHETIC123",
        issuingCountry: "ZZ",
        nationality: "ZZ",
        dateOfBirth: "1990-01-01",
        gender: "U",
        expiryDate: "2035-01-01",
        givenNames: "Synthetic",
        surname: "Fixture",
      }),
    result: {
      id: 1,
      passengerId: 700,
      bookingId: 800,
      status: "complete",
      message: "Saved",
    },
    target: boundary.submit,
    id: 700,
  },
  {
    name: "APIS status read",
    call: (ctx: TrpcContext) =>
      apisRouter.createCaller(ctx).getMyAPISStatus({ passengerId: 700 }),
    result: {
      passengerId: 700,
      passengerName: "Fixture",
      bookingId: 800,
      hasData: false,
      status: "incomplete",
      data: null,
      completeness: 0,
      missingFields: [],
    },
    target: boundary.status,
    id: 700,
  },
  {
    name: "passenger hotel read",
    call: (ctx: TrpcContext) =>
      emergencyHotelRouter
        .createCaller(ctx)
        .getMyHotelBookings({ passengerId: 700 }),
    result: [],
    target: boundary.hotels,
    id: 700,
  },
  {
    name: "multi-city itinerary read",
    call: (ctx: TrpcContext) =>
      multiCityRouter.createCaller(ctx).getSegments({ bookingId: 800 }),
    result: [],
    target: boundary.segments,
    id: 800,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  boundary.ownerId = 101;
  boundary.exists = true;
  boundary.available = true;
  for (const entry of cases) entry.target.mockResolvedValue(entry.result);
});

describe.each(cases)(
  "$name ownership boundary",
  ({ call, target, id, result }) => {
    it("allows the booking owner before calling the domain service", async () => {
      await expect(call(context())).resolves.toEqual(result);
      expect(target).toHaveBeenCalledTimes(1);
      expect(target.mock.calls[0][0]).toBe(id);
    });

    it.each(["user", "airline_admin"])(
      "rejects a different owner with role %s",
      async role => {
        boundary.ownerId = 202;
        await expect(call(context(role))).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(target).not.toHaveBeenCalled();
      }
    );

    it("preserves the existing platform-admin support permission", async () => {
      boundary.ownerId = 202;
      await expect(call(context("admin"))).resolves.toEqual(result);
      expect(target).toHaveBeenCalledTimes(1);
    });

    it("rejects missing resources before domain reads or writes", async () => {
      boundary.exists = false;
      await expect(call(context())).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(target).not.toHaveBeenCalled();
    });

    it("fails closed when the ownership database is unavailable", async () => {
      boundary.available = false;
      await expect(call(context())).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
      expect(target).not.toHaveBeenCalled();
    });

    it("requires authentication", async () => {
      await expect(call(context(null))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(target).not.toHaveBeenCalled();
    });
  }
);
