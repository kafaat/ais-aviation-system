import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Stripe inventory oversell boundary", () => {
  const source = readFileSync(new URL("./stripe.ts", import.meta.url), "utf8");

  it("never clamps an overdrawn inventory decrement to zero", () => {
    expect(source).not.toContain("GREATEST(${flights.businessAvailable}");
    expect(source).not.toContain("GREATEST(${flights.economyAvailable}");
  });

  it("guards both cabins and fails when no inventory row was reserved", () => {
    expect(source).toContain(
      "gte(flights.businessAvailable, booking.numberOfPassengers)"
    );
    expect(source).toContain(
      "gte(flights.economyAvailable, booking.numberOfPassengers)"
    );
    expect(source).toContain("getAffectedRows(seatUpdate) !== 1");
    expect(source).toContain("Insufficient ${booking.cabinClass} inventory");
  });
});
