import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import {
  approvePriceChange,
  executeApprovedPriceChange,
} from "../services/pricing-approval.service";
let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    flights: [
      {
        id: 11,
        tenantId: 3,
        economyPrice: 10000,
        status: "scheduled",
        departureTime: new Date("2030-01-01"),
      },
    ],
    revenue_optimization_logs: [
      {
        id: 1,
        flightId: 11,
        cabinClass: "economy",
        status: "suggested",
        previousPrice: 10000,
        optimizedPrice: 11000,
        factors: "{}",
        createdAt: new Date(),
      },
    ],
  });
  boundary.db = fixture.db;
});
describe("approved price execution", () => {
  it("requires a separate approval and produces exactly one execution receipt", async () => {
    await expect(executeApprovedPriceChange(1, 9, 3)).rejects.toThrow(
      /approval/
    );
    await approvePriceChange(1, 8, 3);
    const receipt = await executeApprovedPriceChange(1, 9, 3);
    expect(await executeApprovedPriceChange(1, 9, 3)).toEqual(receipt);
    expect(fixture.rows("flights")[0].economyPrice).toBe(11000);
    expect(fixture.rows("outbox")).toHaveLength(2);
  });
  it.each(["tenant", "expired", "tampered", "stale"])(
    "rejects %s execution",
    async kind => {
      await approvePriceChange(1, 8, 3);
      const log = fixture.rows("revenue_optimization_logs")[0];
      if (kind === "expired") log.approvalExpiresAt = new Date(0);
      if (kind === "tampered") log.optimizedPrice = 12000;
      if (kind === "stale") fixture.rows("flights")[0].economyPrice = 9500;
      await expect(
        executeApprovedPriceChange(1, 9, kind === "tenant" ? 4 : 3)
      ).rejects.toThrow();
      expect(log.status).toBe("approved");
    }
  );
  it("rolls the price back when its receipt cannot persist", async () => {
    await approvePriceChange(1, 8, 3);
    fixture.failInsert("outbox");
    await expect(executeApprovedPriceChange(1, 9, 3)).rejects.toThrow();
    expect(fixture.rows("flights")[0].economyPrice).toBe(10000);
    expect(fixture.rows("revenue_optimization_logs")[0].status).toBe(
      "approved"
    );
  });
});
