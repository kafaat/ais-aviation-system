import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRefund, type RefundActor } from "./refunds.service";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  refund: vi.fn(),
  listRefunds: vi.fn(),
  calculateFee: vi.fn(),
  refundsState: [] as Array<{
    id: string;
    amount: number;
    status: string;
    metadata: Record<string, string>;
  }>,
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../stripe", () => ({
  stripe: {
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
    .mockResolvedValueOnce([{ departureTime: new Date("2030-01-01") }])
    .mockResolvedValueOnce([booking])
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
