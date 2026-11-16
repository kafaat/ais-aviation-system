import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { router } from "../_core/trpc";
import { splitPaymentsRouter } from "./split-payments";

/**
 * Review finding R1 (#355): splitPayments.initiate created the payer rows and
 * returned, while the client told the owner that the requests had been sent.
 * No request ever reached a payer unless an API consumer called sendRequest
 * by hand, which the shipped UI never did. The procedure now delivers the
 * requests after the plan is created and reports how many the provider
 * accepted, so the client can tell the owner what still needs resending.
 *
 * The service is stubbed at its module boundary: the plan transaction and the
 * provider call are not exercised here, only the procedure's ordering and its
 * reply. The middleware chain (auth, quota) is real.
 */
vi.mock("../services/cache.service", () => ({
  cacheService: { isConnected: () => false },
}));
const booking = vi.hoisted(() => ({
  row: { id: 700, userId: 9, totalAmount: 10000 } as Record<string, unknown>,
}));
vi.mock("../db", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => [booking.row],
  };
  return { getDb: async () => ({ select: () => chain }) };
});
const service = vi.hoisted(() => ({
  initiate: vi.fn(),
  sendAll: vi.fn(),
}));
vi.mock("../services/split-payment.service", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../services/split-payment.service")
  >()),
  initiateSplitPayment: service.initiate,
  sendAllPaymentRequests: service.sendAll,
}));

const app = router({ splitPayments: splitPaymentsRouter });
const owner = () =>
  ({
    user: { id: 9, role: "user", tenantId: 3, email: "owner@example.test" },
    authMethod: "session",
    tenantId: 3,
    req: { ip: "203.0.113.9", headers: {}, method: "POST" },
    res: { setHeader: vi.fn() },
  }) as unknown as TrpcContext;
const splits = [
  { email: "yara@example.test", name: "Yara", amount: 5000 },
  { email: "maha@example.test", name: "Maha", amount: 5000 },
];

beforeEach(() => {
  booking.row = { id: 700, userId: 9, totalAmount: 10000 };
  service.initiate
    .mockReset()
    .mockResolvedValue({ splitIds: [1, 2], totalAmount: 10000 });
  service.sendAll.mockReset().mockResolvedValue(2);
});

describe("splitPayments.initiate delivers the payer requests (R1)", () => {
  it("sends every pending request once the plan exists and reports the counts", async () => {
    const reply = await app
      .createCaller(owner())
      .splitPayments.initiate({ bookingId: 700, splits });
    expect(reply).toEqual({
      splitIds: [1, 2],
      totalAmount: 10000,
      requestedCount: 2,
      sentCount: 2,
    });
    expect(service.initiate).toHaveBeenCalledWith({
      bookingId: 700,
      splits,
      userId: 9,
    });
    expect(service.sendAll).toHaveBeenCalledWith(700);
    // Delivery runs after the plan, never inside its transaction.
    expect(service.initiate.mock.invocationCallOrder[0]).toBeLessThan(
      service.sendAll.mock.invocationCallOrder[0]
    );
  });

  it("reports a partial delivery instead of claiming every request was sent", async () => {
    service.sendAll.mockResolvedValue(1);
    const reply = await app
      .createCaller(owner())
      .splitPayments.initiate({ bookingId: 700, splits });
    expect(reply.requestedCount).toBe(2);
    expect(reply.sentCount).toBe(1);
  });

  it("does not attempt delivery when the plan was refused", async () => {
    service.initiate.mockRejectedValue(
      new TRPCError({ code: "BAD_REQUEST", message: "Booking is already paid" })
    );
    await expect(
      app
        .createCaller(owner())
        .splitPayments.initiate({ bookingId: 700, splits })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(service.sendAll).not.toHaveBeenCalled();
  });

  it("refuses a foreign booking before creating or sending anything", async () => {
    booking.row = { id: 700, userId: 10, totalAmount: 10000 };
    await expect(
      app
        .createCaller(owner())
        .splitPayments.initiate({ bookingId: 700, splits })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(service.initiate).not.toHaveBeenCalled();
    expect(service.sendAll).not.toHaveBeenCalled();
  });
});
