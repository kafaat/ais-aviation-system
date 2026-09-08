import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("travel agent inventory atomicity", () => {
  const source = readFileSync(
    new URL("./travel-agent.service.ts", import.meta.url),
    "utf8"
  );
  it("reserves inventory inside the booking transaction", () => {
    expect(source).toContain("return db.transaction(async tx =>");
    expect(source).toContain("gte(flights.economyAvailable, seatCount)");
    expect(source).toContain("gte(flights.businessAvailable, seatCount)");
    expect(source).toContain("getAffectedRows(seatUpdate) !== 1");
    expect(source).toContain("await tx.insert(bookings)");
    expect(source).toContain("await tx.insert(agentBookings)");
  });
});
