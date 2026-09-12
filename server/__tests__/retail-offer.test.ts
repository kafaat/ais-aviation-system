import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getFlightById: async () => ({
    id: 11,
    tenantId: 3,
    status: "scheduled",
    departureTime: new Date("2030-01-01"),
    economyPrice: 10000,
    businessPrice: 20000,
  }),
}));
vi.mock("../services/flights.service", () => ({
  calculateFlightPrice: async () => ({ price: 17500 }),
}));
import {
  createRetailOffer,
  validateRetailOffer,
  lockRetailOffer,
  consumeRetailOffer,
  composeOfferPolicy,
} from "../services/retail-offer.service";
let fixture: ReturnType<typeof transactionMemory>;
const input = {
  flightId: 11,
  tenantId: 3,
  userId: 1,
  channel: "direct" as const,
  cabinClass: "economy" as const,
  passengerTypes: ["adult", "child"] as Array<"adult" | "child">,
};
beforeEach(() => {
  fixture = transactionMemory({});
  boundary.db = fixture.db;
});
describe("retail offer authority", () => {
  it("preserves the quoted fare and consumes it with the durable receipt", async () => {
    const offer = await createRetailOffer(input);
    expect(offer.totalAmount).toBe(17500);
    await fixture.db.transaction(async (tx: any) => {
      const held = await lockRetailOffer(tx, offer.id, input);
      await consumeRetailOffer(tx, held, 7);
    });
    expect(fixture.rows("retail_offers")[0].consumedBookingId).toBe(7);
    await expect(lockRetailOffer(fixture.db, offer.id, input)).rejects.toThrow(
      /expired, consumed or changed/
    );
  });
  it.each(["owner", "tenant", "passengers", "expired", "tampered"])(
    "refuses %s changes",
    async kind => {
      const offer = await createRetailOffer(input);
      const request = { ...input };
      if (kind === "owner") request.userId = 2;
      if (kind === "tenant") request.tenantId = 4;
      if (kind === "passengers") request.passengerTypes = ["adult", "adult"];
      if (kind === "expired") offer.expiresAt = new Date(0);
      if (kind === "tampered") offer.payload.totalAmount = 1;
      expect(() => validateRetailOffer(offer, request)).toThrow();
    }
  );
  it("rolls offer consumption back if event persistence fails", async () => {
    const offer = await createRetailOffer(input);
    fixture.failInsert("outbox");
    await expect(
      fixture.db.transaction(async (tx: any) =>
        consumeRetailOffer(tx, await lockRetailOffer(tx, offer.id, input), 7)
      )
    ).rejects.toThrow();
    expect(fixture.rows("retail_offers")[0].consumedBookingId).toBeNull();
  });
  it("makes channel taxes explicit and rejects unsafe amounts", () => {
    expect(
      composeOfferPolicy(10001, {
        name: "ndc",
        fareMultiplier: 1.2,
        taxRate: 0.15,
      })
    ).toEqual({ baseAmount: 12001, taxesAndFees: 1800, totalAmount: 13801 });
    expect(() =>
      composeOfferPolicy(1.5, { name: "bad", fareMultiplier: 1, taxRate: 0 })
    ).toThrow();
  });
});
