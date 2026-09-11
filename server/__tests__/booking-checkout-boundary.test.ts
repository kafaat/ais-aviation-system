import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({
  db: null as any,
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: state.create,
        retrieve: state.retrieve,
        expire: state.expire,
      },
    },
  },
}));
vi.mock("../services/email.service", () => ({}));
import {
  createBookingCheckout,
  expireBookingCheckout,
  assertInvoiceEditable,
} from "../services/booking-checkout.service";
import { initiateSplitPayment } from "../services/split-payment.service";
import { payFromWallet } from "../services/wallet.service";
let fixture: ReturnType<typeof transactionMemory>;
const owner = {
  bookingId: 7,
  userId: 9,
  email: "owner@example.test",
  appBaseUrl: "https://example.test",
};
const splitInput = {
  bookingId: 7,
  userId: 9,
  splits: [
    { email: "a@example.test", name: "A", amount: 5000 },
    { email: "b@example.test", name: "B", amount: 5000 },
  ],
};
function providerSession(request: any) {
  return {
    id: "cs_test_1",
    url: "https://checkout.stripe.com/test",
    currency: "sar",
    amount_total: 10000,
    metadata: request.metadata,
    status: "open",
    payment_status: "unpaid",
  };
}
const edit = () =>
  fixture.db.transaction((tx: any) =>
    assertInvoiceEditable(tx, fixture.rows("bookings")[0])
  );
beforeEach(() => {
  vi.resetAllMocks();
  fixture = transactionMemory({
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        cabinClass: "economy",
        numberOfPassengers: 1,
        bookingReference: "TEST07",
        pnr: "PNR007",
        totalAmount: 10000,
        status: "pending",
        paymentStatus: "pending",
        seatsReserved: false,
      },
    ],
    tenants: [{ id: 3, status: "active" }],
    wallets: [
      { id: 1, userId: 9, currency: "SAR", status: "active", balance: 20000 },
    ],
  });
  state.db = fixture.db;
  state.create.mockImplementation(async request => providerSession(request));
  state.retrieve.mockImplementation(async () =>
    providerSession(
      JSON.parse(fixture.rows("booking_checkout_requests")[0].requestPayload)
    )
  );
  state.expire.mockImplementation(async () => ({
    ...(await state.retrieve()),
    status: "expired",
    url: null,
  }));
});
describe("durable booking checkout", () => {
  it("freezes the invoice before a lost provider response and retries identical payload and key", async () => {
    state.create.mockRejectedValueOnce(new Error("response lost"));
    await expect(createBookingCheckout(owner)).rejects.toThrow("response lost");
    expect(fixture.rows("booking_checkout_requests")[0].status).toBe(
      "creating"
    );
    await expect(edit()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await createBookingCheckout({
      ...owner,
      email: "changed@example.test",
      appBaseUrl: "https://changed.test",
    });
    expect(state.create.mock.calls[0]).toEqual(state.create.mock.calls[1]);
    expect(
      fixture
        .rows("outbox")
        .filter(e => e.eventType === "booking.checkout_requested")
    ).toHaveLength(1);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      stripeCheckoutSessionId: "cs_test_1",
      paymentStatus: "pending",
    });
    await createBookingCheckout(owner);
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(state.retrieve).toHaveBeenCalledWith("cs_test_1");
  });
  it("rejects a foreign owner and a settled booking before a claim or provider call", async () => {
    await expect(
      createBookingCheckout({ ...owner, userId: 8 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    fixture.rows("bookings")[0].paymentStatus = "paid";
    await expect(createBookingCheckout(owner)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(0);
    expect(state.create).not.toHaveBeenCalled();
  });
  it("preserves a blocked claim if acknowledgement identifies another invoice", async () => {
    state.create.mockImplementationOnce(async r => ({
      ...providerSession(r),
      amount_total: 1,
    }));
    await expect(createBookingCheckout(owner)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fixture.rows("booking_checkout_requests")[0]).toMatchObject({
      status: "creating",
      sessionId: null,
    });
    await expect(edit()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("will not reuse an unresolved idempotency key outside the safe provider retry window", async () => {
    state.create.mockRejectedValueOnce(new Error("lost"));
    await expect(createBookingCheckout(owner)).rejects.toThrow("lost");
    fixture.rows("booking_checkout_requests")[0].createdAt = new Date(
      Date.now() - 24 * 3600_000
    );
    await expect(createBookingCheckout(owner)).rejects.toThrow(
      "safe retry window"
    );
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it("unlocks only after verified unpaid expiry and uses a fresh identity for the next invoice", async () => {
    await createBookingCheckout(owner);
    const first = fixture.rows("booking_checkout_requests")[0].requestId;
    state.expire.mockRejectedValueOnce(new Error("timeout"));
    await expect(expireBookingCheckout(7, 9)).rejects.toThrow("timeout");
    await expect(edit()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(expireBookingCheckout(7, 9)).resolves.toEqual({
      status: "expired",
    });
    await edit();
    await createBookingCheckout(owner);
    expect(fixture.rows("booking_checkout_requests")[0].requestId).not.toBe(
      first
    );
    expect(
      fixture
        .rows("outbox")
        .filter(e => e.eventType === "booking.checkout_expired")
    ).toHaveLength(1);
  });
  it("retains the freeze when a retrieved checkout has already been paid", async () => {
    await createBookingCheckout(owner);
    state.retrieve.mockImplementationOnce(async () => ({
      ...providerSession(
        JSON.parse(fixture.rows("booking_checkout_requests")[0].requestPayload)
      ),
      status: "complete",
      payment_status: "paid",
    }));
    await expect(expireBookingCheckout(7, 9)).rejects.toThrow("unpaid expired");
    expect(state.expire).not.toHaveBeenCalled();
    await expect(edit()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("never expires a provider session whose metadata belongs to another invoice", async () => {
    await createBookingCheckout(owner);
    state.retrieve.mockResolvedValueOnce({
      id: "cs_test_1",
      status: "open",
      payment_status: "unpaid",
      amount_total: 10000,
      currency: "sar",
      metadata: { bookingId: "999" },
    });
    await expect(expireBookingCheckout(7, 9)).rejects.toThrow(
      "identity or invoice mismatch"
    );
    expect(state.expire).not.toHaveBeenCalled();
    expect(fixture.rows("booking_checkout_requests")[0].status).toBe("ready");
  });
  it("does not call the provider when the transactional outbox fails", async () => {
    fixture.failInsert("outbox");
    await expect(createBookingCheckout(owner)).rejects.toThrow(
      "Injected insert failure"
    );
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(0);
    expect(state.create).not.toHaveBeenCalled();
  });
  it("blocks wallet and split collection while a provider result remains unknown", async () => {
    state.create.mockRejectedValueOnce(new Error("unknown"));
    await expect(createBookingCheckout(owner)).rejects.toThrow("unknown");
    await expect(payFromWallet(9, 7)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(initiateSplitPayment(splitInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fixture.rows("wallets")[0].balance).toBe(20000);
    expect(fixture.rows("payment_splits")).toHaveLength(0);
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
  });
  it("creates split IDs atomically and freezes the invoice for that plan", async () => {
    const result = await initiateSplitPayment(splitInput);
    expect(result.splitIds).toEqual([1, 2]);
    expect(fixture.rows("payment_splits").map(s => s.amount)).toEqual([
      5000, 5000,
    ]);
    expect(fixture.lockedTables[0]).toBe("bookings");
    await expect(edit()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(createBookingCheckout(owner)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(state.create).not.toHaveBeenCalled();
  });
  it("rolls back every split if the final outbox write fails", async () => {
    fixture.failInsert("outbox");
    await expect(initiateSplitPayment(splitInput)).rejects.toThrow(
      "Injected insert failure"
    );
    expect(fixture.rows("payment_splits")).toHaveLength(0);
  });
  it("rejects foreign, fractional and terminal split plans before inserts", async () => {
    await expect(
      initiateSplitPayment({ ...splitInput, userId: 8 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      initiateSplitPayment({
        ...splitInput,
        splits: splitInput.splits.map((s, i) => ({
          ...s,
          amount: i ? 4999.5 : 5000.5,
        })),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    fixture.rows("bookings")[0].status = "cancelled";
    await expect(initiateSplitPayment(splitInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(fixture.rows("payment_splits")).toHaveLength(0);
  });
});
