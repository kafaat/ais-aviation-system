import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import type { TrpcContext } from "../_core/context";
import { paymentsRouter } from "./payments";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../stripe", () => ({
  stripe: { checkout: { sessions: { create: mocks.checkout } } },
}));
vi.mock("../services/payment-history.service", () => ({}));
vi.mock("../services/order-service-checkout.service", () => ({
  createOrderServiceCheckout: vi.fn(),
}));
vi.mock("../services/payment-providers", () => ({
  getAllProviderInfo: vi.fn(),
  getAvailableProviderInfo: vi.fn(),
  createCheckoutWithProvider: vi.fn(),
  verifyPaymentWithProvider: vi.fn(),
}));
vi.mock("../services/rbac.service", () => ({
  isAdmin: (role: string) => role === "admin",
}));

function context(): TrpcContext {
  return {
    user: {
      id: 1,
      role: "user",
      name: "Owner",
      email: "owner@example.test",
    } as NonNullable<TrpcContext["user"]>,
    authMethod: "bearer",
    tenantId: null,
    req: {
      protocol: "https",
      headers: { host: "app.example.test" },
      ip: "127.0.0.1",
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  vi.resetAllMocks();
  fixture = transactionMemory({
    bookings: [
      {
        id: 10,
        userId: 1,
        tenantId: null,
        bookingReference: "LEG001",
        pnr: "PNR001",
        status: "confirmed",
        paymentStatus: "paid",
        totalAmount: 12345,
        seatsReserved: true,
      },
    ],
    booking_modifications: [
      {
        id: 17,
        bookingId: 10,
        userId: 1,
        status: "pending",
        totalCost: 5000,
        servicingPayload: null,
      },
    ],
    payment_receipts: [],
  });
  mocks.getDb.mockReturnValue(fixture.db);
  let created = 0;
  mocks.checkout.mockImplementation(async (request: any) => ({
    id: `cs_test_${++created}`,
    url: `https://checkout.stripe.com/${created}`,
    status: "open",
    payment_status: "unpaid",
    currency: "sar",
    amount_total: request.line_items[0].price_data.unit_amount,
    metadata: request.metadata,
  }));
});

describe("legacy modification checkout idempotency", () => {
  it("keys the provider call by the modification and its quoted amount, not by the attempt", async () => {
    const caller = paymentsRouter.createCaller(context());
    const input = { bookingId: 10, modificationId: 17 };
    await caller.createModificationCheckout(input);
    await caller.createModificationCheckout(input);

    expect(mocks.checkout).toHaveBeenCalledTimes(2);
    const [firstParams, firstOptions] = mocks.checkout.mock.calls[0];
    const [secondParams, secondOptions] = mocks.checkout.mock.calls[1];
    expect(firstOptions).toEqual({
      idempotencyKey: "modification.checkout:17:5000",
      timeout: 15000,
      maxNetworkRetries: 0,
    });
    expect(secondOptions).toEqual(firstOptions);
    // The keyed body must be byte-identical across attempts; a per-attempt
    // field (trace id, timestamp) would make Stripe reject the replay.
    expect(secondParams).toEqual(firstParams);
    expect(JSON.stringify(firstParams)).not.toMatch(/traceId|attempt/);
    expect(firstParams.line_items[0].price_data.unit_amount).toBe(5000);
  });

  it("changes the key only when the authoritative amount changes", async () => {
    const caller = paymentsRouter.createCaller(context());
    await caller.createModificationCheckout({
      bookingId: 10,
      modificationId: 17,
    });
    fixture.rows("booking_modifications")[0].totalCost = 7000;
    await caller.createModificationCheckout({
      bookingId: 10,
      modificationId: 17,
    });
    expect(mocks.checkout.mock.calls[0][1].idempotencyKey).toBe(
      "modification.checkout:17:5000"
    );
    expect(mocks.checkout.mock.calls[1][1].idempotencyKey).toBe(
      "modification.checkout:17:7000"
    );
  });
});
