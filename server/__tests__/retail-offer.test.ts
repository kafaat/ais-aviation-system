import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getFlightById: async () => ({
    id: 11,
    origin: { id: 1 },
    destination: { id: 2 },
    tenantId: 3,
    status: "scheduled",
    departureTime: new Date("2030-01-01"),
    economyPrice: 10000,
    businessPrice: 20000,
  }),
}));
vi.mock("../services/flights.service", () => ({
  calculateFlightPrice: async (
    _flight: unknown,
    _cabin: unknown,
    _count: number,
    passengers: Array<{ type: string }>
  ) => {
    const fareLines = passengers.map(({ type }) =>
      type === "child"
        ? { type, baseFare: 6000, tax: 900, bookingFee: 600, total: 7500 }
        : { type, baseFare: 8000, tax: 1200, bookingFee: 800, total: 10000 }
    );
    return {
      price: fareLines.reduce((sum, line) => sum + line.total, 0),
      fareLines,
    };
  },
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
    expect(offer.payload).toMatchObject({
      baseAmount: 14000,
      taxesAndFees: 3500,
    });
    expect(validateRetailOffer(offer, input).fareLines).toHaveLength(2);
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
  it("rejects passenger permutations before positional initial fare attribution", async () => {
    const offer = await createRetailOffer(input);
    expect(() =>
      validateRetailOffer(offer, {
        ...input,
        passengerTypes: ["child", "adult"],
      })
    ).toThrow(/expired, consumed or changed/);
  });
  it("allows explicit servicing remapping only for the same passenger type multiset", async () => {
    const offer = await createRetailOffer(input);
    const request = {
      ...input,
      passengerTypes: ["child", "adult"],
      remapPassengerTypes: true,
    };
    expect(
      validateRetailOffer(offer, request).fareLines?.map(line => line.type)
    ).toEqual(["adult", "child"]);
    expect(() =>
      validateRetailOffer(offer, {
        ...request,
        passengerTypes: ["adult", "adult"],
      })
    ).toThrow();
  });
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
  it("prices each direct RBD fare line before tax, retaining its fixed booking fee", async () => {
    const offer = await createRetailOffer({
      ...input,
      fareClass: { fareClassId: 41, fareMultiplier: 1.25 },
    });
    expect(
      validateRetailOffer(offer, { ...input, fareClassId: 41 })
    ).toMatchObject({
      baseAmount: 17500,
      taxesAndFees: 4025,
      totalAmount: 21525,
      fareLines: [
        { baseFare: 10000, tax: 1500, bookingFee: 800, total: 12300 },
        { baseFare: 7500, tax: 1125, bookingFee: 600, total: 9225 },
      ],
    });
  });
  it("applies NDC policy to the fare without taxing the existing gross quote", async () => {
    const offer = await createRetailOffer({
      ...input,
      channel: "ndc",
      ndcPolicy: { fareMultiplier: 1.2, taxRate: 0.15 },
    });
    expect(offer.payload).toMatchObject({
      baseAmount: 16800,
      taxesAndFees: 3920,
      totalAmount: 20720,
    });
    expect(
      validateRetailOffer(offer, { ...input, channel: "ndc" }).fareLines
    ).toHaveLength(2);
  });
  it.each(["child", "infant"] as const)(
    "refuses a %s on an all-adult NDC quote without consuming it",
    async type => {
      const quoted = {
        ...input,
        channel: "ndc" as const,
        passengerTypes: ["adult", "adult"] as Array<
          "adult" | "child" | "infant"
        >,
      };
      const offer = await createRetailOffer(quoted);
      expect(validateRetailOffer(offer, quoted).passengerTypes).toEqual([
        "adult",
        "adult",
      ]);
      await expect(
        lockRetailOffer(fixture.db, offer.id, {
          ...quoted,
          passengerTypes: ["adult", type],
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(fixture.rows("retail_offers")[0].consumedBookingId).toBeNull();
      expect(fixture.rows("outbox")).toEqual([]);
    }
  );
  it("refuses positional passenger-type permutation on a typed NDC quote", async () => {
    const quoted = { ...input, channel: "ndc" as const };
    const offer = await createRetailOffer(quoted);
    expect(() =>
      validateRetailOffer(offer, {
        ...quoted,
        passengerTypes: ["child", "adult"],
      })
    ).toThrow(/expired, consumed or changed/);
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
