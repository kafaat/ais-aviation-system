import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any, refund: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../stripe", () => ({
  stripe: { refunds: { create: boundary.refund } },
}));
import { orderServiceRefunds } from "../../drizzle/schema";
import { paymentsRouter } from "../routers/payments";
import { DepartureReleaseError } from "../services/booking-settlement.service";

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
        targetId: 1,
        userId: 4,
        currency: "SAR",
        settlementError: null,
        createdAt: new Date(),
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
  it.each(["user", "support", "airline_admin", "finance", "ops"])(
    "rejects %s before provider or receipt access",
    async role => {
      await expect(
        caller(role).refundSettlementReview({ paymentIntentId: "pi_review" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller(role).settlementReviews({ limit: 50 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller(role).settlementReview({ paymentIntentId: "pi_review" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(boundary.refund).not.toHaveBeenCalled();
    }
  );
  it.each(["admin", "super_admin"])(
    "lets %s observe pending and completed review evidence",
    async role => {
      expect(
        await caller(role).settlementReview({ paymentIntentId: "pi_review" })
      ).toMatchObject({
        settlementStatus: "review_required",
        refundedAmount: 0,
      });
      fixture.rows("payment_receipts")[0].settlementStatus = "review_refunded";
      fixture.rows("payment_receipts")[0].refundedAmount = 10000;
      expect(await caller(role).settlementReviews({ limit: 50 })).toEqual([]);
      expect(
        await caller(role).settlementReview({ paymentIntentId: "pi_review" })
      ).toMatchObject({
        settlementStatus: "review_refunded",
        refundedAmount: 10000,
      });
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
    await expect(
      caller("admin").settlementReview({ paymentIntentId: "pi_review" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
  it.each(DepartureReleaseError.reasons)(
    "requires physical departure reconciliation before further provider requests: %s",
    async reason => {
      Object.assign(fixture.rows("payment_receipts")[0], {
        refundedAmount: 5000,
        settlementError: reason,
      });
      await expect(
        caller("admin").refundSettlementReview({ paymentIntentId: "pi_review" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: reason });
      expect(boundary.refund).not.toHaveBeenCalled();
      expect(fixture.rows("payment_receipts")[0]).toMatchObject({
        refundedAmount: 5000,
        settlementStatus: "review_required",
        settlementError: reason,
      });
    }
  );
  // Settlement ignores other refunds of an intent while a servicing refund
  // on it is unfinished, so the review refund waits for the booking's
  // servicing refunds, as the other refund commands do.
  const servicingRefund = (overrides: Record<string, unknown>) => ({
    id: "osr_1",
    bookingId: 1,
    modificationId: 9001,
    paymentIntentId: "pi_review",
    amount: 2000,
    baseRefundedAmount: 0,
    status: "queued",
    ...overrides,
  });
  it.each(["queued", "requesting", "pending", "failed", "review_required"])(
    "waits while a %s order-service refund on the booking is unfinished, before any provider request",
    async status => {
      await fixture.db
        .insert(orderServiceRefunds)
        .values(servicingRefund({ status, paymentIntentId: "pi_other" }));
      await expect(
        caller("admin").refundSettlementReview({ paymentIntentId: "pi_review" })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message:
          "An order-service refund on this booking is unfinished; the settlement review refund can be requested once it has been reconciled",
      });
      expect(boundary.refund).not.toHaveBeenCalled();
      expect(fixture.rows("payment_receipts")[0]).toMatchObject({
        refundedAmount: 0,
        settlementStatus: "review_required",
      });
    }
  );
  it("does not wait for a succeeded order-service refund or one on another booking", async () => {
    await fixture.db.insert(orderServiceRefunds).values([
      servicingRefund({ id: "osr_done", status: "succeeded" }),
      servicingRefund({
        id: "osr_elsewhere",
        bookingId: 2,
        paymentIntentId: "pi_elsewhere",
      }),
    ]);
    expect(
      await caller("admin").refundSettlementReview({
        paymentIntentId: "pi_review",
      })
    ).toEqual({ state: "awaiting_webhook", refundId: "re_1" });
    expect(boundary.refund).toHaveBeenCalledTimes(1);
  });
  it("control: a wallet top-up review has no booking servicing refund to wait for", async () => {
    Object.assign(fixture.rows("payment_receipts")[0], {
      kind: "wallet_topup",
      bookingId: null,
      targetId: 7,
    });
    await fixture.db.insert(orderServiceRefunds).values(servicingRefund({}));
    expect(
      await caller("admin").refundSettlementReview({
        paymentIntentId: "pi_review",
      })
    ).toEqual({ state: "awaiting_webhook", refundId: "re_1" });
    expect(boundary.refund).toHaveBeenCalledTimes(1);
  });
});
