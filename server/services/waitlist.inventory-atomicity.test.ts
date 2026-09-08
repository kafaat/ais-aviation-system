import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("waitlist inventory atomicity", () => {
  const source = readFileSync(
    new URL("./waitlist.service.ts", import.meta.url),
    "utf8"
  );
  it("guards seat reservation and the waiting-to-offered transition", () => {
    expect(source).toContain("gte(flights.economyAvailable, entry.seats)");
    expect(source).toContain("gte(flights.businessAvailable, entry.seats)");
    expect(source).toContain('eq(waitlist.status, "waiting")');
    expect(source).toContain("getAffectedRows(seatUpdate) !== 1");
    expect(source).toContain("getAffectedRows(offerUpdate) !== 1");
  });
});
