import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Wiring guards complement agent-portal.security.test.ts, which executes the
// owner check, idempotent replay and booking/hold/ledger writes in one transaction.
describe("travel agent inventory atomicity", () => {
  const source = readFileSync(
    new URL("./travel-agent.service.ts", import.meta.url),
    "utf8"
  );
  const command = source.slice(
    source.indexOf("export async function createAgentBooking("),
    source.indexOf("\nasync function validateAgentOwner(")
  );

  it("shares the idempotency transaction with the canonical booking command and agency ledger", () => {
    expect(command).toMatch(
      /const execute = \(transaction: SettlementTx\) =>\s*withTransactionalIdempotency\(/
    );
    expect(command).toMatch(/\},\s*transaction\s*\);/);
    expect(command).toMatch(
      /const booking = await createBooking\(\s*\{[\s\S]*?userId: owner\.id,[\s\S]*?tenantId: owner\.tenantId,[\s\S]*?\},\s*tx\s*\)/
    );
    expect(command).toMatch(/await tx\s*\.insert\(agentBookings\)/);
    expect(command).not.toContain("userId: 0");
    expect(command).not.toContain(".update(flights)");
  });

  it("checks credential and session ownership before executing or replaying in the same transaction", () => {
    expect(command).not.toContain("return execute();");
    expect(command).toMatch(
      /return db\.transaction\(async tx => \{\s*await requireOwnedAgency\(tx, bookingOwner, agentId, true\);[\s\S]*?return execute\(tx\);\s*\}, inventoryTransactionConfig\)/
    );
    expect(command).toContain(
      "ne(idempotencyRequests.userId, bookingOwner.userId)"
    );
    expect(command).toMatch(
      /if \(previousOwner\)\s*throw new TRPCError\(\{\s*code: "CONFLICT"/
    );
  });
});
