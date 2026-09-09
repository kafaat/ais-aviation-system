import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("seat economics tenant boundary", () => {
  it("binds booking reads to ctx.tenantId", () => {
    const router = read("server/routers/seat-economics.ts");

    expect(router).toContain("getTenantBookingSeatEconomics");
    expect(router).toMatch(
      /getTenantBookingSeatEconomics\(\s*input\.bookingId,\s*ctx\.tenantId,/
    );
    expect(router).not.toMatch(/getBookingSeatEconomics\(\s*input\.bookingId/);
  });

  it("checks booking id and tenant before computing financial details", () => {
    const service = read("server/services/seat-economics-tenant.service.ts");

    expect(service).toContain("tenantCondition(bookings.tenantId, tenantId)");
    expect(service).toContain("eq(bookings.id, bookingId)");
    expect(service).toContain('code: "NOT_FOUND"');
    expect(service).toContain("getBookingSeatEconomics(ownedBooking.id, opts)");
  });
});
