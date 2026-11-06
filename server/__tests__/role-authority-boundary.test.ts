import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const state = vi.hoisted(() => ({ lookup: vi.fn(), passengers: vi.fn() }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("../db", () => ({
  getBookingByPNR: state.lookup,
  getBookingByIdWithDetails: state.lookup,
  getPassengersByBookingId: state.passengers,
}));
vi.mock("../services/bookings.service", () => ({}));
vi.mock("../services/departure-control.service", () => ({}));
vi.mock("../services/dcs-state.service", () => ({}));
vi.mock("../services/audit.service", () => ({}));
vi.mock("../services/notification.service", () => ({}));
vi.mock("../services/baggage-entitlement.service", () => ({}));
import { bookingsRouter } from "../routers/bookings";
import {
  adminProcedure,
  airlineAdminProcedure,
  airlineFinanceProcedure,
  airlineOpsProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import {
  createRBACMiddleware,
  getAllRoles,
  isAuthorized,
  type UserRole,
} from "../services/rbac.service";
const gates = router({
  user: protectedProcedure.query(() => true),
  admin: adminProcedure.query(() => true),
  airline_admin: airlineAdminProcedure.query(() => true),
  ops: airlineOpsProcedure.query(() => true),
  finance: airlineFinanceProcedure.query(() => true),
});
const context = (
  role: UserRole,
  tenantId: number | null = 7,
  userTenant: number | null = 7,
  id = 11
) =>
  ({
    user: { id, role, tenantId: userTenant },
    tenantId,
    req: { headers: {} },
    res: {},
  }) as TrpcContext;
const booking = {
  id: 5,
  tenantId: 7,
  userId: 99,
  flightId: 7,
  bookingReference: "AUDIT1",
  pnr: "AUDIT1",
  status: "confirmed",
  inventoryLockId: null,
  seatsReserved: true,
  totalAmount: 100,
  paymentStatus: "paid",
  stripePaymentIntentId: null,
  stripeCheckoutSessionId: null,
  idempotencyKey: null,
  cabinClass: "economy",
  numberOfPassengers: 1,
  checkedIn: false,
  checkInReminderSentAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
beforeEach(() => {
  vi.clearAllMocks();
  state.lookup.mockResolvedValue(booking);
  state.passengers.mockResolvedValue([]);
});
describe("procedure-aligned role matrix", () => {
  it.each(getAllRoles())(
    "matches the real procedure gates for %s",
    async role => {
      const caller = gates.createCaller(context(role));
      for (const required of [
        "user",
        "ops",
        "finance",
        "airline_admin",
        "admin",
      ] as const) {
        const result = caller[required]();
        if (isAuthorized(role, [required]))
          await expect(result).resolves.toBe(true);
        else await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
  );
  it.each(["ops", "finance", "airline_admin"] as const)(
    "requires a tenant for %s middleware",
    role => {
      for (const [tenant, assigned] of [
        [null, 7],
        [8, 7],
        [null, null],
      ]) {
        const next = vi.fn();
        expect(() =>
          createRBACMiddleware([role])({
            ctx: context(role, tenant, assigned),
            next,
          })
        ).toThrow("Valid tenant context required");
        expect(next).not.toHaveBeenCalled();
      }
      const next = vi.fn();
      createRBACMiddleware([role])({ ctx: context(role), next });
      expect(next).toHaveBeenCalledOnce();
    }
  );
  it.each(["admin", "super_admin"] as const)(
    "allows platform %s without a tenant",
    async role => {
      const caller = gates.createCaller(context(role, null, null));
      await expect(caller.ops()).resolves.toBe(true);
      await expect(caller.finance()).resolves.toBe(true);
    }
  );
});
describe("intended booking administrator bypass", () => {
  it.each(["admin", "super_admin"] as const)(
    "allows non-owning %s",
    async role => {
      const caller = bookingsRouter.createCaller(context(role, null, null));
      await expect(caller.getByPNR({ pnr: "AUDIT1" })).resolves.toMatchObject({
        id: 5,
      });
      await expect(caller.getPassengers({ bookingId: 5 })).resolves.toEqual([]);
    }
  );
  it.each(["user", "support", "ops", "finance", "airline_admin"] as const)(
    "denies an unrelated %s",
    async role => {
      const caller = bookingsRouter.createCaller(context(role));
      await expect(caller.getByPNR({ pnr: "AUDIT1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.getPassengers({ bookingId: 5 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );
  it("retains owner access and the existing explicit tenant restriction", async () => {
    await expect(
      bookingsRouter
        .createCaller(context("user", 7, 7, 99))
        .getByPNR({ pnr: "AUDIT1" })
    ).resolves.toMatchObject({ id: 5 });
    for (const role of ["admin", "super_admin"] as const) {
      await expect(
        bookingsRouter
          .createCaller(context(role, 8, 8))
          .getByPNR({ pnr: "AUDIT1" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});
