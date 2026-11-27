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
    const bookingHistory = db.slice(
      db.indexOf("export async function getBookingsByUserId("),
      db.indexOf("export async function getBookingByPNR(")
    );
    expect(router).toContain("ctx.tenantId");
    expect(service).toContain("db.getBookingsByUserId(userId, tenantId)");
    expect(bookingHistory).toContain("eq(bookings.tenantId, tenantId)");
    expect(bookingHistory).toContain("eq(passengers.tenantId, tenantId)");
    // Pagination can compose additional filters, but account scope must remain
    // in WHERE; its declaration alone does not prove that it is applied.
    expect(bookingHistory).toMatch(
      /\.where\(\s*(?:bookingWhere\s*\)|and\(\s*bookingWhere\s*,)/
    );
    expect(bookingHistory).toContain(".where(passengerWhere)");
  });
});
