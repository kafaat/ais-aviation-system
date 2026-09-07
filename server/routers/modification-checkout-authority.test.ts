import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./payments.ts", import.meta.url), "utf8");
const modificationCheckout = source.match(
  /createModificationCheckout:[\s\S]*?\/\*\*\n   \* Verify payment session/
)?.[0];

if (!modificationCheckout) {
  throw new Error("createModificationCheckout source block not found");
}

describe("modification checkout authority", () => {
  it("does not accept a client supplied amount", () => {
    expect(modificationCheckout).not.toMatch(/amount:\s*z\.number/);
    expect(modificationCheckout).not.toContain("input.amount");
  });

  it("binds the modification to id, booking and authenticated user", () => {
    expect(modificationCheckout).toContain(
      "eq(bookingModifications.id, input.modificationId)"
    );
    expect(modificationCheckout).toContain(
      "eq(bookingModifications.bookingId, input.bookingId)"
    );
    expect(modificationCheckout).toContain(
      "eq(bookingModifications.userId, ctx.user.id)"
    );
  });

  it("charges the persisted totalCost only for pending positive modifications", () => {
    expect(modificationCheckout).toContain('modification.status !== "pending"');
    expect(modificationCheckout).toContain("modification.totalCost <= 0");
    expect(modificationCheckout).toContain(
      "const authoritativeAmount = modification.totalCost"
    );
    expect(modificationCheckout).toContain("unit_amount: authoritativeAmount");
    expect(modificationCheckout).toContain("amount: authoritativeAmount");
  });
});
