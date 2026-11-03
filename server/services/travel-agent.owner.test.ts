import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import { assignAgentOwner } from "./travel-agent.service";

let fixture: ReturnType<typeof transactionMemory>;
vi.mock("../db", () => ({ getDb: () => fixture.db }));

describe("assigning an agency owner", () => {
  beforeEach(() => {
    fixture = transactionMemory({
      users: [
        { id: 7, tenantId: 11 },
        { id: 8, tenantId: 12 },
        { id: 9, tenantId: 11 },
      ],
      tenants: [
        { id: 11, status: "active" },
        { id: 12, status: "active" },
      ],
      travel_agents: [{ id: 3, ownerUserId: 7 }],
    });
  });
  it("rejects a cross-tenant transfer without recording or changing ownership", async () => {
    await expect(assignAgentOwner(3, 8, 1)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.rows("travel_agents")[0].ownerUserId).toBe(7);
    expect(fixture.rows("outbox")).toHaveLength(0);
  });
  it("keeps an owner linked concurrently while a stale repair form was open", async () => {
    await expect(assignAgentOwner(3, 9, 1, true)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(fixture.rows("travel_agents")[0].ownerUserId).toBe(7);
  });
  it("allows the existing administrative transfer within a tenant", async () => {
    await assignAgentOwner(3, 9, 1);
    expect(fixture.rows("travel_agents")[0].ownerUserId).toBe(9);
    expect(fixture.rows("outbox")).toHaveLength(1);
  });
});
