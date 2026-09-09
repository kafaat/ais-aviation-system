import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { paymentsRouter } from "./payments";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getBookingByIdWithDetails: vi.fn(),
  createPayment: vi.fn(),
  updatePaymentStatus: vi.fn(),
  updateBookingStatus: vi.fn(),
  auditPayment: vi.fn(),
  checkout: vi.fn(),
  providerCheckout: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: mocks.getDb,
  getBookingByIdWithDetails: mocks.getBookingByIdWithDetails,
  createPayment: mocks.createPayment,
  updatePaymentStatus: mocks.updatePaymentStatus,
  updateBookingStatus: mocks.updateBookingStatus,
}));
vi.mock("../stripe", () => ({
  stripe: { checkout: { sessions: { create: mocks.checkout } } },
}));
vi.mock("../services/audit.service", () => ({
  auditPayment: mocks.auditPayment,
}));
vi.mock("../services/payment-history.service", () => ({}));
vi.mock("../services/payment-providers", () => ({
  getAllProviderInfo: vi.fn(),
  getAvailableProviderInfo: vi.fn(),
  createCheckoutWithProvider: mocks.providerCheckout,
  verifyPaymentWithProvider: vi.fn(),
}));
vi.mock("../services/rbac.service", () => ({
  isAdmin: (role: string) => role === "admin",
}));

function context(role: "user" | "admin" | null = "user"): TrpcContext {
  return {
    user: role
      ? ({
          id: 1,
          role,
          name: "Test User",
          email: "owner@example.test",
        } as NonNullable<TrpcContext["user"]>)
      : null,
    authMethod: role ? "bearer" : null,
    tenantId: null,
    req: {
      protocol: "https",
      headers: { origin: "https://example.test" },
      ip: "127.0.0.1",
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const booking = {
  status: "pending",
  id: 10,
  userId: 1,
  bookingReference: "TEST01",
  pnr: "PNR001",
  totalAmount: 12345,
  paymentStatus: "pending",
  numberOfPassengers: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getBookingByIdWithDetails.mockResolvedValue(booking);
  mocks.createPayment.mockResolvedValue([{ insertId: 99 }]);
  mocks.limit.mockResolvedValue([booking]);
  mocks.getDb.mockResolvedValue({
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.limit }) }),
    }),
  });
  mocks.providerCheckout.mockResolvedValue({
    provider: "hyperpay",
    sessionId: "test-session",
    url: "https://payments.example.test/checkout",
  });
});

function expectNoPaymentSideEffects() {
  expect(mocks.getDb).not.toHaveBeenCalled();
  expect(mocks.getBookingByIdWithDetails).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
  expect(mocks.updatePaymentStatus).not.toHaveBeenCalled();
  expect(mocks.updateBookingStatus).not.toHaveBeenCalled();
  expect(mocks.auditPayment).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
  expect(mocks.providerCheckout).not.toHaveBeenCalled();
}

describe.each(["user", "admin"] as const)("legacy payment by %s", role => {
  it.each(["card", "wallet", "bank_transfer"] as const)(
    "refuses unverified %s settlement without side effects",
    async method => {
      const caller = paymentsRouter.createCaller(context(role));

      await expect(
        caller.create({ bookingId: 10, amount: 0, method })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      expectNoPaymentSideEffects();
    }
  );
});

describe("payment authority boundary", () => {
  it("still requires authentication on the retired endpoint", async () => {
    const caller = paymentsRouter.createCaller(context(null));

    await expect(
      caller.create({ bookingId: 10, amount: 12345, method: "card" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expectNoPaymentSideEffects();
  });

  it("rejects arbitrary booking IDs and positive amounts too", async () => {
    const caller = paymentsRouter.createCaller(context());

    await expect(
      caller.create({ bookingId: 999, amount: 1, method: "card" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expectNoPaymentSideEffects();
  });

  it("preserves provider checkout using the stored booking total", async () => {
    mocks.limit.mockResolvedValueOnce([booking]).mockResolvedValueOnce([]);
    const caller = paymentsRouter.createCaller(context());

    const result = await caller.createCheckoutSession({
      bookingId: booking.id,
      provider: "hyperpay",
    });

    expect(result.sessionId).toBe("test-session");
    expect(mocks.providerCheckout).toHaveBeenCalledWith(
      "hyperpay",
      expect.objectContaining({
        bookingId: booking.id,
        userId: 1,
        amount: booking.totalAmount,
      })
    );
    expect(mocks.updateBookingStatus).not.toHaveBeenCalled();
  });

  it("blocks another checkout while verified funds await review", async () => {
    mocks.limit
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([{ id: "pi_review" }]);
    await expect(
      paymentsRouter
        .createCaller(context())
        .createCheckoutSession({ bookingId: booking.id, provider: "hyperpay" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.providerCheckout).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("rejects checkout of another user's booking", async () => {
    mocks.limit.mockResolvedValue([{ ...booking, userId: 2 }]);
    const caller = paymentsRouter.createCaller(context());

    await expect(
      caller.createCheckoutSession({ bookingId: 10, provider: "hyperpay" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.providerCheckout).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.auditPayment).not.toHaveBeenCalled();
  });
});
