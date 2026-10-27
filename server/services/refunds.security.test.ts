import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRefund,
  isBookingRefundable,
  type RefundActor,
} from "./refunds.service";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  refund: vi.fn(),
  listRefunds: vi.fn(),
  calculateFee: vi.fn(),
  settle: vi.fn(),
  cancel: vi.fn(),
  refundsState: [] as Array<{
    id: string;
    amount: number;
    status: string;
    metadata: Record<string, string>;
  }>,
}));

vi.mock("./payment-settlement.service", () => ({
  settleVerifiedRefund: mocks.settle,
}));
vi.mock("./booking-settlement.service", () => ({
  cancelBookingResources: mocks.cancel,
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../stripe", () => ({
  stripe: {
    charges: {
      retrieve: async () => ({
        id: "ch_test",
        amount: 10000,
        currency: "sar",
        amount_refunded: mocks.refundsState.reduce(
          (sum, refund) => sum + refund.amount,
          0
        ),
      }),
    },
    refunds: {
      create: mocks.refund,
      list: mocks.listRefunds,
    },
  },
}));
vi.mock("./email.service", () => ({ sendRefundConfirmation: vi.fn() }));
vi.mock("./cancellation-fees.service", () => ({
  calculateCancellationFee: mocks.calculateFee,
}));
vi.mock("./metrics.service", () => ({ trackRefundIssued: vi.fn() }));
vi.mock("./notification.service", () => ({ notifyRefundProcessed: vi.fn() }));

const owner = { id: 1, role: "user" };
const admin = { id: 2, role: "admin" };
const input = { bookingId: 10, userId: 1 };
const booking = {
  id: 10,
  userId: 1,
  flightId: 20,
  totalAmount: 10000,
  paymentStatus: "paid",
  status: "confirmed",
  stripePaymentIntentId: "pi_test",
  cabinClass: "economy",
  numberOfPassengers: 1,
  bookingReference: "TEST01",
};

function refundRecord(
  id: string,
  amount: number,
  metadata: Record<string, string> = {}
) {
  return {
    id,
    amount,
    status: "succeeded",
    charge: "ch_test",
    metadata,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.refundsState.length = 0;

  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    limit: mocks.limit,
  };
  mocks.limit
    .mockResolvedValueOnce([booking])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ departureTime: new Date("2030-01-01") }])
    .mockResolvedValueOnce([]) // No pending order-service refund liability.
    .mockResolvedValueOnce([{ paymentIntentId: "pi_test" }]) // Collection receipt.
    .mockResolvedValueOnce([booking]) // Locked re-read after settlement.
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  mocks.update.mockReturnValue({
    set: () => ({ where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) }),
  });
  const database = {
    select: () => query,
    update: mocks.update,
    transaction: vi.fn(),
  };
  database.transaction.mockImplementation(
    async (callback: (tx: typeof database) => unknown) => callback(database)
  );
  mocks.getDb.mockResolvedValue(database);
  mocks.calculateFee.mockReturnValue({ refundAmount: 8000 });
  mocks.listRefunds.mockImplementation(() => ({
    async *[Symbol.asyncIterator]() {
      for (const refund of mocks.refundsState) {
        yield refund;
      }
    },
  }));
  mocks.refund.mockImplementation(
    async ({
      amount,
      metadata,
    }: {
      amount: number;
      metadata: Record<string, string>;
    }) => {
      const refund = refundRecord("re_test", amount, metadata);
      mocks.refundsState.push(refund);
      return refund;
    }
  );
});

function expectNoFinancialWrites() {
  expect(mocks.refund).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.settle).not.toHaveBeenCalled();
}

describe("refund service authorization", () => {
  it.each([0, 1, 8000, 10000])(
    "rejects user amount override %s before any DB access",
    async amount => {
      await expect(
        createRefund({ ...input, amount }, owner)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(mocks.getDb).not.toHaveBeenCalled();
      expectNoFinancialWrites();
    }
  );

  it("rejects a user impersonating the declared booking owner", async () => {
    await expect(
      createRefund(input, { id: 99, role: "user" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expectNoFinancialWrites();
  });

  it("fails closed when a caller omits the trusted actor", async () => {
    await expect(
      createRefund(input, undefined as unknown as RefundActor)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expectNoFinancialWrites();
  });

  it.each([owner, admin])(
    "verifies the actual booking owner for actor %j",
    async actor => {
      mocks.limit.mockReset().mockResolvedValue([{ ...booking, userId: 99 }]);

      await expect(createRefund(input, actor)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      expectNoFinancialWrites();
    }
  );
});

describe("refund amount validation", () => {
  it("refuses to refund a split-funded invoice using the last payer's intent", async () => {
    mocks.limit
      .mockReset()
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([{ id: 4 }]);
    await expect(createRefund(input, owner)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expectNoFinancialWrites();
    expect(mocks.listRefunds).not.toHaveBeenCalled();
  });
  it("reports split funding as requiring per-payer refunds before calling Stripe", async () => {
    mocks.limit
      .mockReset()
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([{ id: 4 }]);
    expect(await isBookingRefundable(booking.id)).toMatchObject({
      refundable: false,
      reason: expect.stringContaining("each original payer"),
    });
    expect(mocks.listRefunds).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid admin override %s before DB access",
    async amount => {
      await expect(
        createRefund({ ...input, amount }, admin)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(mocks.getDb).not.toHaveBeenCalled();
      expectNoFinancialWrites();
    }
  );

  it("rejects an admin override above the booking total", async () => {
    await expect(
      createRefund({ ...input, amount: 10001 }, admin)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expectNoFinancialWrites();
  });

  it.each([0, -1, 1.5, 10001, NaN, Infinity])(
    "rejects invalid calculated refund %s",
    async refundAmount => {
      mocks.calculateFee.mockReturnValue({ refundAmount });

      await expect(createRefund(input, owner)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });

      expectNoFinancialWrites();
    }
  );

  it("uses the cancellation policy for an ordinary user", async () => {
    const result = await createRefund(input, owner);

    expect(result.amount).toBe(8000);
    expect(result.cumulativeRefundedAmount).toBe(8000);
    expect(result.remainingRefundableAmount).toBe(2000);
    expect(mocks.refund).toHaveBeenCalledWith(
      {
        payment_intent: "pi_test",
        amount: 8000,
        reason: "requested_by_customer",
        metadata: {
          bookingId: "10",
          refundOperationId: "booking-10-refund-8000",
        },
      },
      { idempotencyKey: "booking-10-refund-8000" }
    );
  });

  it("allows a valid override from the authenticated admin", async () => {
    const result = await createRefund({ ...input, amount: 10000 }, admin);

    expect(result.amount).toBe(10000);
    expect(result.cumulativeRefundedAmount).toBe(10000);
    expect(result.remainingRefundableAmount).toBe(0);
    expect(mocks.refund).toHaveBeenCalledWith(
      {
        payment_intent: "pi_test",
        amount: 10000,
        reason: "requested_by_customer",
        metadata: {
          bookingId: "10",
          refundOperationId: "booking-10-refund-10000",
        },
      },
      { idempotencyKey: "booking-10-refund-10000" }
    );
  });

  it("rejects a refund that exceeds the provider-confirmed remaining balance", async () => {
    mocks.refundsState.push(refundRecord("re_prior", 3000));

    await expect(createRefund(input, owner)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("remaining refundable balance of 7000"),
    });

    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("uses cumulative provider refunds to detect a full refund", async () => {
    mocks.refundsState.push(refundRecord("re_prior", 2000));

    const result = await createRefund(input, owner);

    expect(result.amount).toBe(8000);
    expect(result.cumulativeRefundedAmount).toBe(10000);
    expect(result.remainingRefundableAmount).toBe(0);
  });

  it("recovers the same provider operation without issuing money twice", async () => {
    mocks.refundsState.push(
      refundRecord("re_existing", 8000, {
        bookingId: "10",
        refundOperationId: "booking-10-refund-8000",
      })
    );

    const result = await createRefund(input, owner);

    expect(result.refundId).toBe("re_existing");
    expect(result.cumulativeRefundedAmount).toBe(8000);
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});

describe("refund cancels the itinerary", () => {
  it("cancels the booking in the settlement transaction after a fee-bearing refund", async () => {
    await createRefund({ ...input, reason: "plans changed" }, owner);
    expect(mocks.refund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000 }),
      expect.anything()
    );
    expect(mocks.settle).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 10, status: "confirmed" }),
      expect.stringContaining("cancellation-fee refund"),
      owner.id
    );
  });
  it("does not cancel twice when settlement already cancelled a fully refunded booking", async () => {
    mocks.limit.mockReset();
    mocks.limit
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ departureTime: new Date("2030-01-01") }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ paymentIntentId: "pi_test" }])
      .mockResolvedValueOnce([{ ...booking, status: "cancelled" }]);
    mocks.calculateFee.mockReturnValue({ refundAmount: 10000 });
    await createRefund(input, owner);
    expect(mocks.settle).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("refuses to move money for a paid booking whose collection has no receipt", async () => {
    mocks.limit.mockReset();
    mocks.limit
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ departureTime: new Date("2030-01-01") }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // No receipt for pi_test.
    await expect(createRefund(input, owner)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expectNoFinancialWrites();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
