import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("refund detail authority boundary", () => {
  it("passes the authenticated actor into refund detail lookup", () => {
    const source = readFileSync("server/routers/refunds.ts", "utf8");
    const start = source.indexOf("getDetails: protectedProcedure");
    const end = source.indexOf("checkRefundable: protectedProcedure", start);
    const block = source.slice(start, end);

    expect(block).toContain("async ({ input, ctx })");
    expect(block).toContain("getRefundDetails(input.refundId, ctx.user)");
    expect(block).toContain("z.string().min(1)");
  });

  it("binds non-admin refund reads to payment intent and booking owner", () => {
    const source = readFileSync("server/services/refunds.service.ts", "utf8");
    const start = source.indexOf("export async function getRefundDetails(");
    const end = source.indexOf("export async function isBookingRefundable", start);
    const block = source.slice(start, end);

    expect(block).toContain('actor.role !== "admin"');
    expect(block).toContain("refund.payment_intent");
    expect(block).toContain("bookings.stripePaymentIntentId");
    expect(block).toContain("bookings.userId");
    expect(block).toContain("actor.id");
    expect(block).toContain('code: "NOT_FOUND"');
  });

  it("preserves the not-found boundary before returning refund fields", () => {
    const source = readFileSync("server/services/refunds.service.ts", "utf8");
    const start = source.indexOf("export async function getRefundDetails(");
    const end = source.indexOf("export async function isBookingRefundable", start);
    const block = source.slice(start, end);

    expect(block.indexOf("if (!ownedBooking)")).toBeGreaterThan(-1);
    expect(block.indexOf("return {", block.indexOf("if (!ownedBooking)"))).toBeGreaterThan(
      block.indexOf("if (!ownedBooking)")
    );
  });
});
