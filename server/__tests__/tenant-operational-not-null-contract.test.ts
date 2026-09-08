import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("drizzle/schema.ts", "utf8");

describe("operational tenant nullability contract", () => {
  it("requires bookings and passengers to carry a tenant id", () => {
    const bookingBlock = schema.slice(
      schema.indexOf("export const bookings = mysqlTable("),
      schema.indexOf("export type Booking =")
    );
    const passengerBlock = schema.slice(
      schema.indexOf("export const passengers = mysqlTable("),
      schema.indexOf("export type Passenger =")
    );
    expect(bookingBlock).toContain('tenantId: int("tenantId").notNull()');
    expect(passengerBlock).toContain('tenantId: int("tenantId").notNull()');
  });

  it("binds every active booking writer to a trusted tenant source", () => {
    const canonical = readFileSync(
      "server/services/bookings.service.ts",
      "utf8"
    );
    const multiCity = readFileSync(
      "server/services/multi-city.service.ts",
      "utf8"
    );
    const ndc = readFileSync("server/services/ndc.service.ts", "utf8");
    const rebooking = readFileSync(
      "server/services/rebooking.service.ts",
      "utf8"
    );
    const agent = readFileSync(
      "server/services/travel-agent.service.ts",
      "utf8"
    );
    expect(canonical).toContain("tenantId: effectiveTenantId");
    expect(multiCity).toContain("const tenantIds = new Set");
    expect(multiCity).toContain("tenantId,\n        userId: input.userId");
    expect(ndc).toContain("NDC offer flights must belong to one tenant");
    expect(rebooking).toContain("newFlight.tenantId !== rebookData.tenantId");
    expect(agent).toContain("tenantId: flight.tenantId");
  });
});
