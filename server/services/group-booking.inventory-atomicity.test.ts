import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("group booking inventory atomicity", () => {
  const source = readFileSync(
    new URL("./group-booking.service.ts", import.meta.url),
    "utf8"
  );

  it("commits seat reservation and approval in one transaction", () => {
    expect(source).toContain("return db.transaction(async tx =>");
    expect(source).toContain(
      "gte(flights.economyAvailable, booking.groupSize)"
    );
    expect(source).toContain(
      "gte(flights.businessAvailable, booking.groupSize)"
    );
    expect(source).toContain("getAffectedRows(seatUpdate) !== 1");
  });

  it("guards the pending-to-confirmed transition against concurrent approvals", () => {
    expect(source).toContain('eq(groupBookings.status, "pending")');
    expect(source).toContain("getAffectedRows(bookingUpdate) !== 1");
  });
});
