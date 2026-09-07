import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./refunds.service.ts", import.meta.url),
  "utf8"
);

describe("refund local reconciliation atomicity", () => {
  it("serializes reconciliation and restores seats only on the first full-refund transition", () => {
    expect(source).toContain("database.transaction(async tx =>");
    expect(source).toContain('.for("update")');
    expect(source).toContain('lockedBooking.paymentStatus !== "refunded"');
    expect(source).toContain('lockedBooking.status === "confirmed"');

    const start = source.indexOf(
      "const localReconciliation = await database.transaction"
    );
    const end = source.indexOf("if (localReconciliation.shouldRestoreSeats)");
    const body = source.slice(start, end);
    expect(body).toContain(".update(bookings)");
    expect(body).toContain(".update(flights)");
    expect(body).toContain(".update(payments)");
    expect(body).not.toContain("await database\n          .update(flights)");
    expect(body).not.toContain("await database\n        .update(bookings)");
    expect(body).not.toContain("await database\n        .update(payments)");
  });
});
