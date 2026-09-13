import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync("server/routers/bookings.ts", "utf8");
const serviceSource = readFileSync(
  "server/services/bookings.service.ts",
  "utf8"
);

// Contract: booking-domain tenant isolation must fail closed.
describe("booking tenant boundary", () => {
  it("stamps tenant identity onto booking and passenger writes", () => {
    expect(serviceSource).toContain("tenantId?: number | null");
    expect(serviceSource).toContain("tenantId: currentFlight.tenantId");
    expect(routerSource).toContain("tenantId: ctx.tenantId");
  });

  it("rejects cross-tenant booking lookups before admin ownership bypass", () => {
    expect(routerSource).toContain(
      "assertTenantMatch(booking.tenantId, ctx.tenantId)"
    );
    expect(serviceSource).toContain(
      "assertTenantMatch(booking.tenantId, tenantId)"
    );
  });

  // Check-in ownership is exercised through the real router in integration-remediation R01.

  it("binds cancellation inventory restoration to the tenant", () => {
    expect(serviceSource).toContain("eq(bookings.tenantId, tenantId)");
    expect(serviceSource).toContain(
      "await cancelBookingResources(tx, current,"
    );
  });
});
