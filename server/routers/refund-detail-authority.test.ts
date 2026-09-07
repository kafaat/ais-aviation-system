import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("refund detail authority boundary", () => {
  it("passes the authenticated actor into refund detail lookup", () => {
    const source = readFileSync("server/routers/refunds.ts", "utf8");

    expect(source).toContain("getDetails: protectedProcedure");
    expect(source).toContain("async ({ input, ctx })");
    expect(source).toContain("getRefundDetails(input.refundId, ctx.user)");
    expect(source).toContain("z.string().min(1)");
  });

  it("binds non-admin refund reads to payment intent and booking owner", () => {
    const source = readFileSync("server/services/refunds.service.ts", "utf8");

    expect(source).toContain(
      "getRefundDetails(refundId: string, actor: RefundActor)"
    );
    expect(source).toContain('actor.role !== "admin"');
    expect(source).toContain("refund.payment_intent");
    expect(source).toContain("bookings.stripePaymentIntentId");
    expect(source).toContain("bookings.userId");
    expect(source).toContain("actor.id");
    expect(source).toContain('code: "NOT_FOUND"');
  });

  it("keeps unauthorized refund reads behind a not-found boundary", () => {
    const source = readFileSync("server/services/refunds.service.ts", "utf8");

    expect(source).toContain("if (!ownedBooking)");
    expect(source).toContain('message: "Refund not found"');
  });
});
