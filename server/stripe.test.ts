import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { TrpcContext } from "./_core/context";
import { transactionMemory } from "./__tests__/helpers/transaction-memory";

const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof transactionMemory>["db"] | null,
  create: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: () => state.db }));
vi.mock("./stripe", () => ({
  stripe: { checkout: { sessions: { create: state.create } } },
}));
vi.mock("./_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: () => Promise.resolve(),
}));
import { paymentsRouter } from "./routers/payments";
let fixture: ReturnType<typeof transactionMemory>;
function caller(userId = 1) {
  return paymentsRouter.createCaller({
    user: {
      id: userId,
      openId: "synthetic-checkout",
      email: "synthetic@example.invalid",
      name: "Synthetic",
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: { origin: "https://example.invalid" },
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  fixture = transactionMemory({
    bookings: [
      {
        id: 7,
        userId: 1,
        tenantId: null,
        flightId: 1,
        bookingReference: "STEST1",
        pnr: "STEST2",
        totalAmount: 50000,
        numberOfPassengers: 1,
        cabinClass: "economy",
        status: "pending",
        paymentStatus: "pending",
        seatsReserved: false,
      },
    ],
  });
  state.db = fixture.db;
  state.create.mockImplementation(
    async (request: Stripe.Checkout.SessionCreateParams) => ({
      id: "cs_test_synthetic",
      url: "https://checkout.stripe.com/synthetic",
      mode: "payment",
      status: "open",
      payment_status: "unpaid",
      amount_total: 50000,
      currency: "sar",
      metadata: request.metadata,
    })
  );
});
// These are offline API boundary tests. Real provider acceptance lives in the explicit sandbox workflow.
describe("Stripe checkout API boundary without provider credentials", () => {
  it("uses the persisted invoice amount and returns the provider checkout", async () => {
    const result = await caller().createCheckoutSession({
      bookingId: 7,
      ...{ amount: 1 },
    });
    expect(result).toEqual({
      provider: "stripe",
      sessionId: "cs_test_synthetic",
      url: "https://checkout.stripe.com/synthetic",
    });
    expect(
      state.create.mock.calls[0][0].line_items[0].price_data.unit_amount
    ).toBe(50000);
  });
  it("rejects a paid booking before contacting a provider", async () => {
    fixture.rows("bookings")[0].paymentStatus = "paid";
    await expect(
      caller().createCheckoutSession({ bookingId: 7 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.create).not.toHaveBeenCalled();
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(0);
  });
  it("rejects a foreign owner before disclosing or creating a checkout", async () => {
    await expect(
      caller(999).createCheckoutSession({ bookingId: 7 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.create).not.toHaveBeenCalled();
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(0);
  });
});
