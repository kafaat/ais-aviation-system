import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
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

let fixture: ReturnType<typeof transactionMemory>;
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
  fixture = transactionMemory({ bookings: [booking] });
  mocks.getDb.mockReturnValue(fixture.db);
  mocks.checkout.mockImplementation(async (request: any) => ({
    id: "cs_test_owner",
    url: "https://checkout.stripe.com/test",
    status: "open",
    payment_status: "unpaid",
    currency: "sar",
    amount_total: request.line_items[0].price_data.unit_amount,
    metadata: request.metadata,
  }));
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

  it("creates Stripe checkout from the stored total without settling the booking", async () => {
    const result = await paymentsRouter
      .createCaller(context())
      .createCheckoutSession({ bookingId: 10 });
    expect(result.sessionId).toBe("cs_test_owner");
    expect(
      mocks.checkout.mock.calls[0][0].line_items[0].price_data.unit_amount
    ).toBe(12345);
    expect(fixture.rows("booking_checkout_requests")[0].status).toBe("ready");
    expect(fixture.rows("bookings")[0].paymentStatus).toBe("pending");
  });
  it("rejects a provider without integrated settlement before external calls", async () => {
    await expect(
      paymentsRouter
        .createCaller(context())
        .createCheckoutSession({ bookingId: 10, provider: "hyperpay" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoPaymentSideEffects();
  });
  it("blocks another checkout while verified funds await review", async () => {
    fixture = transactionMemory({
      bookings: [booking],
      payment_receipts: [
        {
          bookingId: 10,
          paymentIntentId: "pi_review",
          settlementStatus: "review_required",
        },
      ],
    });
    mocks.getDb.mockReturnValue(fixture.db);
    await expect(
      paymentsRouter
        .createCaller(context())
        .createCheckoutSession({ bookingId: 10 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(0);
  });
  it("rejects checkout of another user's booking without a provider call", async () => {
    fixture.rows("bookings")[0].userId = 2;
    await expect(
      paymentsRouter
        .createCaller(context())
        .createCheckoutSession({ bookingId: 10 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(0);
  });
});
