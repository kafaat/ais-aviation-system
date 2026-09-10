import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Wiring guard; executable command tests and live MySQL acceptance verify behavior.
describe("travel agent inventory atomicity", () => {
  const source = readFileSync(
    new URL("./travel-agent.service.ts", import.meta.url),
    "utf8"
  );
  it("delegates to the canonical booking command in its own transaction", () => {
    expect(source).toContain("return withTransactionalIdempotency(");
    expect(source).toContain("const booking = await createBooking(");
    expect(source).toMatch(/await tx\s*\.insert\(agentBookings\)/);
    expect(source).not.toContain("userId: 0");
    expect(source).not.toContain(".update(flights)");
  });
});
