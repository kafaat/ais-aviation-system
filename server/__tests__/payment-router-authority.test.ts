import { TRPCError } from "@trpc/server";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

const state = vi.hoisted(() => ({
  db: null as unknown,
  wallet: {
    getWalletBalance: vi.fn(),
    topUpWallet: vi.fn(),
    payFromWallet: vi.fn(),
    getWalletTransactions: vi.fn(),
  },
  split: {
    initiateSplitPayment: vi.fn(),
    getSplitPaymentStatus: vi.fn(),
    sendPaymentRequest: vi.fn(),
    resendPaymentRequest: vi.fn(),
    sendAllPaymentRequests: vi.fn(),
    cancelSplit: vi.fn(),
    cancelAllSplits: vi.fn(),
    getPayerPaymentDetails: vi.fn(),
    processPayerPayment: vi.fn(),
    checkAllPaid: vi.fn(),
  },
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/wallet.service", () => state.wallet);
vi.mock("../services/split-payment.service", () => state.split);
vi.mock("../services/rate-limit.service", () => ({
  rateLimitService: {
    checkStrictRateLimit: vi.fn(),
    getRateLimitHeaders: vi.fn(),
  },
}));
import { walletRouter } from "../routers/wallet";
import { splitPaymentsRouter } from "../routers/split-payments";
import { router } from "../_core/trpc";

const payments = router({
  wallet: walletRouter,
  splitPayments: splitPaymentsRouter,
});
const requestKey = "b56d8209-4614-4d2f-a6f8-57d4ed7dc589";
const token = "a".repeat(64);
const booking = { id: 10, userId: 101, tenantId: 9, totalAmount: 10000 };
const split = { id: 20, bookingId: 10 };
const input = {
  bookingId: booking.id,
  splits: [
    { name: "First", email: "first@example.test", amount: 4000 },
    { name: "Second", email: "second@example.test", amount: 6000 },
  ],
};
let bookingExists: boolean;
let splitExists: boolean;

function context(
  id: number | null = 101,
  role: User["role"] = "user"
): TrpcContext {
  // In-process router calls exercise the real auth/input/output middleware.
  // HTTP rate limiting has its own transported-procedure regression suite.
  return {
    user: id == null ? null : ({ id, role, tenantId: 9 } as User),
    tenantId: 9,
    authMethod: id == null ? null : "bearer",
    req: undefined as unknown as TrpcContext["req"],
    res: undefined as unknown as TrpcContext["res"],
  };
}
const caller = (id: number | null = 101, role: User["role"] = "user") =>
  payments.createCaller(context(id, role));

beforeEach(() => {
  vi.resetAllMocks();
  bookingExists = true;
  splitExists = true;
  const dialect = new MySqlDialect();
  // Only the ownership SELECT boundary is doubled; the real access-control
  // helpers and every router authorization/input/output check execute.
  state.db = {
    select: () => {
      let table = "";
      let id: unknown;
      const query = {
        from(value: Parameters<typeof getTableName>[0]) {
          table = getTableName(value);
          return query;
        },
        innerJoin: () => query,
        where(predicate: Parameters<typeof dialect.sqlToQuery>[0]) {
          id = dialect.sqlToQuery(predicate).params[0];
          return query;
        },
        limit: () => {
          if (table === "bookings")
            return Promise.resolve(
              bookingExists && id === booking.id ? [{ ...booking }] : []
            );
          if (table === "payment_splits")
            return Promise.resolve(
              bookingExists && splitExists && id === split.id
                ? [{ bookingId: booking.id, ownerId: booking.userId }]
                : []
            );
          throw new Error(`Unexpected ownership table: ${table}`);
        },
      };
      return query;
    },
  };
  state.wallet.getWalletBalance.mockResolvedValue({
    balance: 15000,
    currency: "SAR",
    status: "active",
  });
  state.wallet.topUpWallet.mockResolvedValue({
    status: "pending",
    sessionId: "cs_fixture",
    url: "https://checkout.example.test/session",
  });
  state.wallet.payFromWallet.mockResolvedValue({
    balance: 5000,
    amountPaid: 10000,
  });
  state.wallet.getWalletTransactions.mockResolvedValue([]);
  state.split.initiateSplitPayment.mockResolvedValue({
    splitIds: [20, 21],
    totalAmount: 10000,
  });
  state.split.getSplitPaymentStatus.mockResolvedValue(null);
  state.split.sendPaymentRequest.mockResolvedValue(true);
  state.split.resendPaymentRequest.mockResolvedValue(false);
  state.split.sendAllPaymentRequests.mockResolvedValue(2);
  state.split.cancelSplit.mockResolvedValue(undefined);
  state.split.cancelAllSplits.mockResolvedValue(undefined);
  state.split.getPayerPaymentDetails.mockResolvedValue(null);
  state.split.processPayerPayment.mockResolvedValue({
    sessionId: "cs_share",
    url: null,
  });
  state.split.checkAllPaid.mockResolvedValue(false);
});

describe("wallet API authority and payment contracts", () => {
  it("derives every wallet owner from authenticated context and preserves checkout idempotency", async () => {
    const wallet = caller().wallet;
    expect(await wallet.balance()).toMatchObject({ balance: 15000 });
    expect(
      await wallet.topUp({
        amount: 2000,
        idempotencyKey: requestKey,
        userId: 999,
      } as never)
    ).toMatchObject({ status: "pending" });
    expect(
      await wallet.pay({
        bookingId: 10,
        expectedAmount: 10000,
        userId: 999,
      } as never)
    ).toEqual({ balance: 5000, amountPaid: 10000 });
    await wallet.transactions();
    await wallet.transactions({ limit: 5, offset: 10 });
    expect(state.wallet.getWalletBalance).toHaveBeenCalledWith(101);
    expect(state.wallet.topUpWallet).toHaveBeenCalledWith(
      101,
      2000,
      "Wallet top-up",
      requestKey
    );
    expect(state.wallet.payFromWallet).toHaveBeenCalledWith(101, 10, 10000);
    expect(state.wallet.getWalletTransactions.mock.calls).toEqual([
      [101, 20, 0],
      [101, 5, 10],
    ]);
  });

  it("rejects unauthenticated reads and mutations before invoking financial services", async () => {
    const wallet = caller(null).wallet;
    for (const request of [
      () => wallet.balance(),
      () => wallet.transactions(),
      () => wallet.topUp({ amount: 2000, idempotencyKey: requestKey }),
      () => wallet.pay({ bookingId: 10 }),
    ])
      await expect(request()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const service of Object.values(state.wallet))
      expect(service).not.toHaveBeenCalled();
  });

  it.each([999, 1000001, 1000.5, -1, Number.NaN])(
    "rejects invalid top-up amount %s before creating checkout",
    async amount => {
      await expect(
        caller().wallet.topUp({ amount, idempotencyKey: requestKey })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(state.wallet.topUpWallet).not.toHaveBeenCalled();
    }
  );

  it("rejects malformed keys and invalid booking or expected amounts", async () => {
    await expect(
      caller().wallet.topUp({ amount: 2000, idempotencyKey: "not-a-key" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const input of [
      { bookingId: -1 },
      { bookingId: 10, expectedAmount: 0 },
      { bookingId: 1.5 },
    ])
      await expect(caller().wallet.pay(input)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    expect(state.wallet.topUpWallet).not.toHaveBeenCalled();
    expect(state.wallet.payFromWallet).not.toHaveBeenCalled();
  });

  it.each(["topUp", "pay"] as const)(
    "preserves the %s service's refusal code and normalizes unexpected failures",
    async action => {
      const service =
        action === "topUp"
          ? state.wallet.topUpWallet
          : state.wallet.payFromWallet;
      const execute = () =>
        action === "topUp"
          ? caller().wallet.topUp({ amount: 2000, idempotencyKey: requestKey })
          : caller().wallet.pay({ bookingId: 10 });
      service.mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "Owner mismatch" })
      );
      await expect(execute()).rejects.toMatchObject({ code: "FORBIDDEN" });
      service.mockRejectedValueOnce(new Error("Wallet unavailable"));
      await expect(execute()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Wallet unavailable",
      });
      service.mockRejectedValueOnce(null);
      await expect(execute()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  );

  it("does not accept a top-up response claiming immediate completion", async () => {
    state.wallet.topUpWallet.mockResolvedValue({
      status: "completed",
      sessionId: "cs_fixture",
      url: null,
    });
    await expect(
      caller().wallet.topUp({ amount: 2000, idempotencyKey: requestKey })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("split-payment API ownership before disclosure or side effects", () => {
  const protectedCalls = (client: ReturnType<typeof caller>) => [
    () => client.splitPayments.getStatus({ bookingId: 10 }),
    () => client.splitPayments.sendRequest({ splitId: 20 }),
    () => client.splitPayments.resendRequest({ splitId: 20 }),
    () => client.splitPayments.sendAllRequests({ bookingId: 10 }),
    () => client.splitPayments.cancelSplit({ splitId: 20 }),
    () => client.splitPayments.cancelAll({ bookingId: 10 }),
    () => client.splitPayments.checkAllPaid({ bookingId: 10 }),
  ];

  it.each(["user", "airline_admin"] as const)(
    "refuses a different booking owner with role %s on every protected operation",
    async role => {
      const client = caller(202, role);
      await expect(client.splitPayments.initiate(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      for (const request of protectedCalls(client))
        await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
      for (const service of Object.values(state.split))
        expect(service).not.toHaveBeenCalled();
    }
  );

  it("refuses anonymous access before disclosing payer details or sending email", async () => {
    const client = caller(null);
    await expect(client.splitPayments.initiate(input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    for (const request of protectedCalls(client))
      await expect(request()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const service of Object.values(state.split))
      expect(service).not.toHaveBeenCalled();
  });

  it("carries the verified owner's identity into initiation and cancellation", async () => {
    const client = caller();
    expect(
      await client.splitPayments.initiate({ ...input, userId: 999 } as never)
    ).toEqual({ splitIds: [20, 21], totalAmount: 10000 });
    const results = [];
    for (const request of protectedCalls(client)) results.push(await request());
    expect(results).toEqual([
      null,
      { sent: true },
      { sent: false },
      { sentCount: 2 },
      { cancelled: true },
      { cancelled: true },
      { allPaid: false },
    ]);
    expect(state.split.initiateSplitPayment).toHaveBeenCalledWith({
      ...input,
      userId: 101,
    });
    expect(state.split.cancelSplit).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ id: 101 })
    );
    expect(state.split.cancelAllSplits).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ id: 101 })
    );
  });

  it("retains the explicit platform support override without giving it to airline administrators", async () => {
    expect(
      await caller(202, "admin").splitPayments.getStatus({ bookingId: 10 })
    ).toBeNull();
    expect(
      await caller(202, "super_admin").splitPayments.cancelSplit({
        splitId: 20,
      })
    ).toEqual({ cancelled: true });
  });

  it("rejects missing bookings and splits without invoking their services", async () => {
    bookingExists = false;
    await expect(caller().splitPayments.initiate(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller().splitPayments.getStatus({ bookingId: 10 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    bookingExists = true;
    splitExists = false;
    await expect(
      caller().splitPayments.sendRequest({ splitId: 20 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.split.sendPaymentRequest).not.toHaveBeenCalled();
  });

  it("rejects totals that differ from the booking's authoritative amount", async () => {
    const changed = {
      ...input,
      splits: input.splits.map((payer, i) => ({
        ...payer,
        amount: payer.amount + i,
      })),
    };
    await expect(
      caller().splitPayments.initiate(changed)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.split.initiateSplitPayment).not.toHaveBeenCalled();
  });

  it("fails closed when the ownership database is unavailable", async () => {
    state.db = null;
    await expect(caller().splitPayments.initiate(input)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    await expect(
      caller().splitPayments.getStatus({ bookingId: 10 })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(state.split.initiateSplitPayment).not.toHaveBeenCalled();
  });

  it("uses only the public capability token for payer details and checkout", async () => {
    const client = caller(null);
    expect(
      await client.splitPayments.getPayerDetails({ paymentToken: token })
    ).toBeNull();
    expect(
      await client.splitPayments.createPayerCheckout({
        paymentToken: token,
        userId: 999,
      } as never)
    ).toEqual({ sessionId: "cs_share", url: null });
    expect(state.split.getPayerPaymentDetails).toHaveBeenCalledWith(token);
    expect(state.split.processPayerPayment).toHaveBeenCalledWith(token);
  });

  it.each(["", "short", "a".repeat(63), "a".repeat(65)])(
    "rejects an invalid capability token %s",
    async paymentToken => {
      await expect(
        caller(null).splitPayments.getPayerDetails({ paymentToken })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller(null).splitPayments.createPayerCheckout({ paymentToken })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(state.split.getPayerPaymentDetails).not.toHaveBeenCalled();
      expect(state.split.processPayerPayment).not.toHaveBeenCalled();
    }
  );
});
