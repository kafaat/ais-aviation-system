import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("my bookings tenant isolation contract", () => {
  it("threads tenant context into SQL-scoped booking and passenger queries", () => {
    const root = process.cwd();
    const router = readFileSync(
      join(root, "server/routers/bookings.ts"),
      "utf8"
    );
    const service = readFileSync(
      join(root, "server/services/bookings.service.ts"),
      "utf8"
    );
    const db = readFileSync(join(root, "server/db.ts"), "utf8");
    expect(router).toContain("ctx.tenantId");
    expect(service).toContain("db.getBookingsByUserId(userId, tenantId)");
    expect(db).toContain("eq(bookings.tenantId, tenantId)");
    expect(db).toContain("eq(passengers.tenantId, tenantId)");
    expect(db).toContain(".where(bookingWhere)");
    expect(db).toContain(".where(passengerWhere)");
  });
});
