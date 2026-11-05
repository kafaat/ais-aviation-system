import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { refundsRouter } from "./refunds";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  createRefund: vi.fn(),
  auditRefund: vi.fn(),
  listSplitRefundCancellations: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../services/refunds.service", () => ({
  createRefund: mocks.createRefund,
}));
vi.mock("../services/audit.service", () => ({
  auditRefund: mocks.auditRefund,
}));
vi.mock("../services/refunds-stats.service", () => ({
  getRefundStats: vi.fn(),
  getRefundHistory: vi.fn(),
  getRefundTrends: vi.fn(),
}));
vi.mock("../services/access-control.service", () => ({
  assertBookingOwnership: vi.fn(),
}));
vi.mock("../services/split-refund.service", () => ({
  getSplitRefundCancellation: vi.fn(),
  reserveSplitRefundCancellation: vi.fn(),
  resumeSplitRefundCancellation: vi.fn(),
  listSplitRefundCancellations: mocks.listSplitRefundCancellations,
}));

function context(
  role:
    | "user"
    | "finance"
    | "airline_admin"
    | "admin"
    | "super_admin"
    | null = "user"
): TrpcContext {
  return {
    user: role ? ({ id: 1, role } as NonNullable<TrpcContext["user"]>) : null,
    authMethod: role ? "bearer" : null,
    tenantId: null,
    req: { headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDb.mockResolvedValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([{ bookingReference: "TEST01" }]),
        }),
      }),
    }),
  });
  mocks.createRefund.mockResolvedValue({
    success: true,
    refundId: "re_test",
    amount: 8000,
    cumulativeRefundedAmount: 8000,
    remainingRefundableAmount: 2000,
    status: "succeeded",
  });
  mocks.listSplitRefundCancellations.mockResolvedValue({
    items: [],
    nextCursor: null,
  });
});

describe("refund router authorization", () => {
  it("rejects an ordinary user's manual amount before DB access", async () => {
    const caller = refundsRouter.createCaller(context());

    await expect(
      caller.create({ bookingId: 10, amount: 10000 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.createRefund).not.toHaveBeenCalled();
    expect(mocks.auditRefund).not.toHaveBeenCalled();
  });

  it.each(["user", "finance", "airline_admin"] as const)(
    "rejects %s on privileged refund reads and commands",
    async role => {
      const caller = refundsRouter.createCaller(context(role));

      await expect(
        caller.adminCreate({ bookingId: 10, userId: 99, amount: 10000 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.splitCancellationQueue({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.create({ bookingId: 10, amount: 10000 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(mocks.getDb).not.toHaveBeenCalled();
      expect(mocks.createRefund).not.toHaveBeenCalled();
      expect(mocks.listSplitRefundCancellations).not.toHaveBeenCalled();
      expect(mocks.auditRefund).not.toHaveBeenCalled();
    }
  );

  it("rejects anonymous refund requests", async () => {
    const caller = refundsRouter.createCaller(context(null));

    await expect(caller.create({ bookingId: 10 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  it("forwards the authenticated actor, not supplied authority", async () => {
    const ctx = context();
    const caller = refundsRouter.createCaller(ctx);
    const untrustedInput = {
      bookingId: 10,
      userId: 99,
      actor: { id: 99, role: "admin" },
      role: "admin",
    };

    await caller.create(untrustedInput);

    expect(mocks.createRefund).toHaveBeenCalledWith(
      { bookingId: 10, userId: 1, reason: undefined, amount: undefined },
      ctx.user
    );
    expect(mocks.createRefund.mock.calls[0][1]).toBe(ctx.user);
  });

  it.each(["admin", "super_admin"] as const)(
    "allows platform administrator %s to read the queue and act for the booking owner",
    async role => {
      const ctx = context(role);
      const caller = refundsRouter.createCaller(ctx);
      const input = { bookingId: 10, userId: 99, amount: 10000 };

      await caller.adminCreate(input);
      await expect(caller.splitCancellationQueue({})).resolves.toEqual({
        items: [],
        nextCursor: null,
      });

      expect(mocks.createRefund).toHaveBeenCalledWith(input, ctx.user);
      expect(mocks.createRefund.mock.calls[0][1]).toBe(ctx.user);
      expect(mocks.listSplitRefundCancellations).toHaveBeenCalledWith(
        {},
        ctx.user
      );
    }
  );

  it.each(["admin", "super_admin"] as const)(
    "allows platform administrator %s to override their own refund amount",
    async role => {
      const ctx = context(role);
      await refundsRouter
        .createCaller(ctx)
        .create({ bookingId: 10, amount: 9000 });
      expect(mocks.createRefund).toHaveBeenCalledWith(
        { bookingId: 10, userId: 1, amount: 9000, reason: undefined },
        ctx.user
      );
    }
  );

  it.each([0, -1, 1.5])("rejects invalid admin amount %s", async amount => {
    const caller = refundsRouter.createCaller(context("admin"));

    await expect(
      caller.adminCreate({ bookingId: 10, userId: 99, amount })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });
});
