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
  getBookingCheckoutState,
} from "../services/booking-checkout.service";
import { applyVoucher, useCredit } from "../services/voucher.service";
import { initiateSplitPayment } from "../services/split-payment.service";
import { payCorporateInvoice } from "../services/corporate-settlement.service";
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
    amount_total: request.line_items[0].price_data.unit_amount,
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
    users: [{ id: 9, tenantId: 3 }],
    tenants: [{ id: 3, status: "active" }],
    vouchers: [],
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
  it("requires the corporate approver's current airline before discounting an invoice", async () => {
    const { approveCorporateBooking } =
      await import("../services/corporate.service");
    const { users, corporateAccounts, corporateUsers, corporateBookings } =
      await import("../../drizzle/schema");
    await fixture.db.insert(users).values({ id: 10, tenantId: 4 });
    await fixture.db
      .insert(corporateAccounts)
      .values({ id: 20, status: "active", discountPercent: 10 });
    await fixture.db.insert(corporateUsers).values({
      userId: 10,
      corporateAccountId: 20,
      role: "admin",
      isActive: true,
    });
    await fixture.db.insert(corporateBookings).values({
      id: 1,
      bookingId: 7,
      corporateAccountId: 20,
      bookedByUserId: 9,
      approvalStatus: "pending",
    });
    await expect(approveCorporateBooking(1, 10)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fixture.rows("corporate_bookings")[0].approvalStatus).toBe(
      "pending"
    );
    expect(fixture.rows("bookings")[0].totalAmount).toBe(10000);
    expect(fixture.rows("notifications")).toHaveLength(0);
  });

  it.each([9, 10])(
    "denies a corporate receipt replay when account user %i changes airlines",
    async changedId => {
      const {
        users,
        corporateAccounts,
        corporateUsers,
        corporateBookings,
        financialLedger,
      } = await import("../../drizzle/schema");
      await fixture.db.insert(users).values({ id: 10, tenantId: 3 });
      await fixture.db.insert(corporateAccounts).values({
        id: 20,
        status: "active",
        balance: -10000,
        creditLimit: 50000,
      });
      await fixture.db.insert(corporateUsers).values({
        userId: 10,
        corporateAccountId: 20,
        role: "admin",
        isActive: true,
      });
      await fixture.db.insert(corporateBookings).values({
        bookingId: 7,
        corporateAccountId: 20,
        bookedByUserId: 9,
        approvalStatus: "approved",
      });
      await fixture.db
        .insert(financialLedger)
        .values({ id: 30, stripeEventId: "corporate-credit:7", bookingId: 7 });
      await expect(payCorporateInvoice(7, 10)).resolves.toEqual({
        settled: true,
        receiptId: 30,
      });
      fixture.rows("users").find(row => row.id === changedId).tenantId = 4;
      await expect(payCorporateInvoice(7, 10)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(fixture.rows("financial_ledger")).toHaveLength(1);
      expect(fixture.rows("corporate_accounts")[0].balance).toBe(-10000);
    }
  );

  it("refuses former-tenant invoices on every purchaser payment rail before side effects", async () => {
    fixture.rows("users")[0].tenantId = 4;
    const attempts = [
      () => getBookingCheckoutState(7, 9),
      () => createBookingCheckout(owner),
      () => expireBookingCheckout(7, 9),
      () => initiateSplitPayment(splitInput),
      () => payFromWallet(9, 7),
      () => applyVoucher("TEST", 7, 9, 10000),
      () => useCredit(9, 10000, 7),
    ];
    for (const attempt of attempts)
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const table of [
      "booking_checkout_requests",
      "payment_splits",
      "financial_ledger",
      "outbox",
      "credit_usage",
      "voucher_usage",
      "wallet_transactions",
    ])
      expect(fixture.rows(table)).toHaveLength(0);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "pending",
      paymentStatus: "pending",
      totalAmount: 10000,
    });
    expect(fixture.rows("wallets")[0].balance).toBe(20000);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.retrieve).not.toHaveBeenCalled();
    expect(state.expire).not.toHaveBeenCalled();
  });

  it("refuses a previously authorized checkout replay after tenant reassignment", async () => {
    await createBookingCheckout(owner);
    const claims = structuredClone(fixture.rows("booking_checkout_requests"));
    fixture.rows("users")[0].tenantId = 4;
    await expect(createBookingCheckout(owner)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.retrieve).not.toHaveBeenCalled();
    expect(fixture.rows("booking_checkout_requests")).toEqual(claims);
  });

  it("keeps owner-only access for a purchaser without an airline assignment", async () => {
    fixture.rows("users")[0].tenantId = null;
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "pending",
    });
    await expect(getBookingCheckoutState(7, 8)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns cancelled checkout to the owned booking resume route, not a flight booking form", async () => {
    await createBookingCheckout(owner);
    const request = state.create.mock.calls[0][0];
    expect(fixture.rows("bookings")[0].flightId).toBe(4);
    expect(request.cancel_url).toBe(
      "https://example.test/checkout/7?canceled=true"
    );
    expect(request.metadata.bookingId).toBe("7");
  });

  it("returns from the provider with the trusted booking id beside the session id", async () => {
    await createBookingCheckout(owner);
    const request = state.create.mock.calls[0][0];
    expect(request.success_url).toBe(
      "https://example.test/my-bookings?session_id={CHECKOUT_SESSION_ID}&success=true&booking_id=7"
    );
    // The id is only a lookup key; the read still enforces ownership.
    await expect(getBookingCheckoutState(7, 8)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("reads a pending invoice without a claim, provider request or financial write", async () => {
    await expect(getBookingCheckoutState(7, 9)).resolves.toEqual({
      bookingId: 7,
      bookingReference: "TEST07",
      bookingStatus: "pending",
      totalAmount: 10000,
      currency: "SAR",
      state: "pending",
      invoiceEditable: true,
      appliedVoucher: null,
    });
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(0);
    expect(fixture.rows("payments")).toHaveLength(0);
    expect(fixture.rows("outbox")).toHaveLength(0);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.retrieve).not.toHaveBeenCalled();
  });

  it("resumes the same frozen checkout after returning, without a second booking or provider session", async () => {
    await createBookingCheckout(owner);
    const frozen = structuredClone(
      fixture.rows("booking_checkout_requests")[0]
    );
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "pending",
      invoiceEditable: false,
    });
    expect(state.retrieve).not.toHaveBeenCalled();
    expect(fixture.rows("booking_checkout_requests")[0]).toEqual(frozen);
    await createBookingCheckout(owner);
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.retrieve).toHaveBeenCalledOnce();
    expect(fixture.rows("bookings")).toHaveLength(1);
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(1);
    expect(fixture.rows("booking_checkout_requests")[0].requestPayload).toBe(
      frozen.requestPayload
    );
    expect(fixture.rows("booking_checkout_requests")[0].requestId).toBe(
      frozen.requestId
    );
    expect(fixture.rows("payments")).toHaveLength(0);
  });

  it("preserves the original request of an existing legacy claim when replayed", async () => {
    state.create.mockRejectedValueOnce(new Error("response lost"));
    await expect(createBookingCheckout(owner)).rejects.toThrow("response lost");
    const claim = fixture.rows("booking_checkout_requests")[0];
    const request = JSON.parse(claim.requestPayload);
    request.cancel_url = "https://example.test/booking/7?canceled=true";
    claim.requestPayload = JSON.stringify(request);
    await createBookingCheckout(owner);
    expect(state.create.mock.calls[1][0].cancel_url).toBe(request.cancel_url);
    expect(state.create.mock.calls[1][1].idempotencyKey).toBe(
      state.create.mock.calls[0][1].idempotencyKey
    );
  });

  it("does not disclose a missing, foreign-owned or deleted booking on the return page", async () => {
    await expect(getBookingCheckoutState(7, 8)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getBookingCheckoutState(700, 9)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    fixture.rows("bookings")[0].deletedAt = new Date();
    await expect(getBookingCheckoutState(7, 9)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(createBookingCheckout(owner)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(state.create).not.toHaveBeenCalled();
  });

  it.each([
    ["confirmed", "paid", "paid"],
    ["cancelled", "refunded", "refunded"],
    ["cancelled", "pending", "cancelled"],
    ["pending", "failed", "failed"],
    // A failed flag on a non-pending booking is an inconsistency, answered
    // neutrally rather than as a failed payment (review of #392).
    ["confirmed", "failed", "unavailable"],
    ["completed", "failed", "unavailable"],
    ["confirmed", "pending", "unavailable"],
  ])(
    "shows authoritative %s/%s state and disables further collection",
    async (status, paymentStatus, expected) => {
      Object.assign(fixture.rows("bookings")[0], { status, paymentStatus });
      await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
        state: expected,
        invoiceEditable: false,
      });
      await expect(createBookingCheckout(owner)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(state.create).not.toHaveBeenCalled();
      expect(state.retrieve).not.toHaveBeenCalled();
    }
  );

  it("keeps an unknown checkout frozen and permits only the same safe replay", async () => {
    state.create.mockRejectedValueOnce(new Error("response lost"));
    await expect(createBookingCheckout(owner)).rejects.toThrow("response lost");
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "pending",
      invoiceEditable: false,
    });
    expect(fixture.rows("booking_checkout_requests")[0].status).toBe(
      "creating"
    );
    fixture.rows("booking_checkout_requests")[0].createdAt = new Date(
      Date.now() - 24 * 3600_000
    );
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "unavailable",
      invoiceEditable: false,
    });
    expect(fixture.rows("booking_checkout_requests")).toHaveLength(1);
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.retrieve).not.toHaveBeenCalled();
  });

  it("does not offer a retry for an altered frozen invoice or collected funds awaiting review", async () => {
    await createBookingCheckout(owner);
    fixture.rows("bookings")[0].totalAmount = 9000;
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "unavailable",
      invoiceEditable: false,
    });
    fixture.rows("bookings")[0].totalAmount = 10000;
    fixture.rows("payment_receipts").push({
      bookingId: 7,
      settlementStatus: "review_required",
      paymentIntentId: "pi_review",
    });
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "unavailable",
      invoiceEditable: false,
    });
    await expect(createBookingCheckout(owner)).rejects.toThrow(
      "awaiting review"
    );
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.retrieve).not.toHaveBeenCalled();
  });

  it("answers a recorded failure as needing attention while a collected payment awaits review", async () => {
    // Review of #392: money that may have been captured is never reported as
    // "failed"; the review state wins and no collection is offered.
    Object.assign(fixture.rows("bookings")[0], {
      status: "pending",
      paymentStatus: "failed",
    });
    // Without a receipt the recorded failure is answered as such.
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "failed",
      invoiceEditable: false,
    });
    fixture.rows("payment_receipts").push({
      bookingId: 7,
      settlementStatus: "review_required",
      paymentIntentId: "pi_review_failed",
    });
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "unavailable",
      invoiceEditable: false,
    });
    await expect(createBookingCheckout(owner)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("offers a new checkout only after provider-verified expiry while retaining the same booking", async () => {
    await createBookingCheckout(owner);
    const originalRequestId = fixture.rows("booking_checkout_requests")[0]
      .requestId;
    state.retrieve.mockImplementationOnce(async () => ({
      ...providerSession(
        JSON.parse(fixture.rows("booking_checkout_requests")[0].requestPayload)
      ),
      status: "expired",
      url: null,
    }));
    await expect(createBookingCheckout(owner)).rejects.toThrow(
      "Previous checkout expired"
    );
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "expired",
      invoiceEditable: true,
    });
    expect(state.create).toHaveBeenCalledOnce();
    await createBookingCheckout(owner);
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(fixture.rows("booking_checkout_requests")[0].requestId).not.toBe(
      originalRequestId
    );
    expect(fixture.rows("bookings")).toHaveLength(1);
    expect(fixture.rows("bookings")[0].totalAmount).toBe(10000);
    expect(state.expire).not.toHaveBeenCalled();
  });

  it("returns the persisted voucher total, replays the discount once and freezes it for checkout", async () => {
    fixture.rows("vouchers").push({
      id: 5,
      code: "SAVE10",
      type: "percentage",
      value: 10,
      minPurchase: 0,
      maxDiscount: null,
      maxUses: 10,
      usedCount: 0,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 60_000),
      isActive: true,
    });
    await applyVoucher("SAVE10", 7, 9, 1); // Client amount cannot set the discount base.
    await applyVoucher("SAVE10", 7, 9, 1000000); // Lost-response retry.
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      totalAmount: 9000,
      invoiceEditable: true,
      appliedVoucher: { code: "SAVE10", discountAmount: 1000 },
    });
    expect(fixture.rows("voucher_usage")).toHaveLength(1);
    expect(fixture.rows("vouchers")[0].usedCount).toBe(1);
    await createBookingCheckout(owner);
    expect(
      state.create.mock.calls[0][0].line_items[0].price_data.unit_amount
    ).toBe(9000);
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      totalAmount: 9000,
      invoiceEditable: false,
    });
    await expect(applyVoucher("ANOTHER", 7, 9, 10000)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fixture.rows("bookings")[0].totalAmount).toBe(9000);
    expect(fixture.rows("voucher_usage")).toHaveLength(1);
  });

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
    await expect(getBookingCheckoutState(7, 9)).resolves.toMatchObject({
      state: "split",
      invoiceEditable: false,
    });
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
