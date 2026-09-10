import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any, refund: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../stripe", () => ({
  stripe: { refunds: { create: boundary.refund } },
}));
import { paymentsRouter } from "../routers/payments";

let fixture: ReturnType<typeof transactionMemory>;
const caller = (role: string, id = 4) =>
  paymentsRouter.createCaller({ user: { id, role }, tenantId: null } as any);
beforeEach(() => {
  fixture = transactionMemory({
    payment_receipts: [
      {
        paymentIntentId: "pi_review",
        kind: "booking",
        bookingId: 1,
        amount: 10000,
        refundedAmount: 0,
        settlementStatus: "review_required",
      },
    ],
  });
  boundary.db = fixture.db;
  boundary.refund
    .mockReset()
    .mockResolvedValue({ id: "re_1", status: "pending" });
});
describe("settlement review operator boundary", () => {
  it.each(["user", "airline_admin"])(
    "rejects %s before provider or receipt access",
    async role => {
      await expect(
        caller(role).refundSettlementReview({ paymentIntentId: "pi_review" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller(role).settlementReviews({ limit: 50 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(boundary.refund).not.toHaveBeenCalled();
    }
  );
  it("keeps review open until a verified webhook and uses identical retry parameters across operators", async () => {
    expect(await caller("admin").settlementReviews({ limit: 50 })).toHaveLength(
      1
    );
    expect(
      await caller("admin").refundSettlementReview({
        paymentIntentId: "pi_review",
      })
    ).toEqual({ state: "awaiting_webhook", refundId: "re_1" });
    await caller("admin", 5).refundSettlementReview({
      paymentIntentId: "pi_review",
    });
    expect(boundary.refund.mock.calls[0]).toEqual(
      boundary.refund.mock.calls[1]
    );
    expect(boundary.refund.mock.calls[0][1]).toEqual({
      idempotencyKey: "ais-review-refund:pi_review",
    });
    expect(fixture.rows("payment_receipts")[0].settlementStatus).toBe(
      "review_required"
    );
    expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(0);
  });
  it("cannot use this route to refund an applied payment", async () => {
    fixture.rows("payment_receipts")[0].settlementStatus = "applied";
    await expect(
      caller("admin").refundSettlementReview({ paymentIntentId: "pi_review" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(boundary.refund).not.toHaveBeenCalled();
  });
  it("retains failed provider requests for review", async () => {
    boundary.refund.mockResolvedValue({ id: "re_failed", status: "failed" });
    await expect(
      caller("admin").refundSettlementReview({ paymentIntentId: "pi_review" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("payment_receipts")[0].settlementStatus).toBe(
      "review_required"
    );
  });
});
