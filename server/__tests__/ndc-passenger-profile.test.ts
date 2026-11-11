import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({
  db: null as any,
  enterTransaction: vi.fn(async () => {
    throw new Error("Reached order transaction");
  }),
}));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../services/idempotency-v2.service", () => ({
  withTransactionalIdempotency: boundary.enterTransaction,
}));
import { createOrder } from "../services/ndc.service";

let fixture: ReturnType<typeof transactionMemory>;
const request = (offerId: string, type: "adult" | "child" | "infant") => ({
  offerId,
  userId: 1,
  channel: "direct",
  passengers: [
    { firstName: "Adult", lastName: "Passenger", type: "adult" as const },
    { firstName: "Synthetic", lastName: "Passenger", type },
  ],
  contactInfo: {
    emailAddress: "traveler@example.test",
    phoneNumber: "+966500000001",
  },
});

beforeEach(() => {
  boundary.enterTransaction.mockClear();
  fixture = transactionMemory({
    ndc_offers: [
      {
        id: 1,
        offerId: "canonical",
        offerPayload: JSON.stringify({
          pricing: { passengerCount: 2 },
          retailOfferId: "R-1",
        }),
      },
      {
        id: 2,
        offerId: "legacy",
        offerPayload: JSON.stringify({ pricing: { passengerCount: 2 } }),
      },
    ],
    bookings: [],
    passengers: [],
    inventory_locks: [],
    ndc_orders: [],
  });
  boundary.db = fixture.db;
});

describe("local NDC passenger pricing profile", () => {
  for (const offer of ["canonical", "legacy"]) {
    it.each(["child", "infant"] as const)(
      `rejects unsupported %s before writes for ${offer} offers`,
      async type => {
        await expect(createOrder(request(offer, type))).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message:
            "Local NDC shopping currently quotes adults only; request a supported passenger profile",
        });
        expect(boundary.enterTransaction).not.toHaveBeenCalled();
        for (const table of [
          "bookings",
          "passengers",
          "inventory_locks",
          "ndc_orders",
        ])
          expect(fixture.rows(table)).toEqual([]);
      }
    );
  }
  it("keeps the adult profile eligible for the existing order transaction", async () => {
    await expect(createOrder(request("canonical", "adult"))).rejects.toThrow(
      "Reached order transaction"
    );
    expect(boundary.enterTransaction).toHaveBeenCalledOnce();
  });
});
