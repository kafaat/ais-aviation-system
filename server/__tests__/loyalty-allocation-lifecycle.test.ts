import { describe, it, expect } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  postApprovedBookingGrant,
  recordLotMovement,
} from "../services/loyalty-liability-ledger.service";
import type { ApprovedLoyaltyPolicy } from "../services/loyalty-accounting-policy";

const sale = new Date("2026-10-01T00:00:00Z");
const policy: ApprovedLoyaltyPolicy = {
  id: 3,
  tenantId: 1,
  version: "operator-1",
  status: "approved",
  expiryMode: "none",
  expiryMonths: null,
  mileStandaloneValueMinor: 1,
  expectedBreakageBasisPoints: 100,
  currency: "SAR",
  effectiveAt: sale,
  approvedAt: sale,
  approvedBy: 2,
  sourceReferences: {
    loyaltyAllocations: [
      {
        bookingId: 4,
        currency: "SAR",
        transactionPriceMinor: 10000,
        travelStandalonePriceMinor: 12000,
        reference: "signed-valuation",
      },
    ],
  },
};
const input = {
  bookingId: 4,
  userId: 2,
  lotId: 7,
  awardedMiles: 100,
  totalAmount: 11500,
  occurredAt: sale,
  contractAt: sale,
  policy,
  settlementReferences: ["receipt:original"],
};
const lot = {
  transactionId: 7,
  loyaltyAccountId: 2,
  bookingId: 4,
  creditedMiles: 100,
  remainingMiles: 100,
  spentMiles: 0,
  expiredMiles: 0,
  reversedMiles: 0,
  expiresAt: null,
};
function fixture() {
  return transactionMemory({
    booking_fare_components: [
      {
        bookingId: 4,
        tenantId: 1,
        currency: "SAR",
        componentType: "base_fare",
        amount: 10000,
      },
      {
        bookingId: 4,
        tenantId: 1,
        currency: "SAR",
        componentType: "tax",
        amount: 1500,
      },
    ],
  });
}
describe("authorized lot allocation and refunds", () => {
  it("posts no liability without an approved booking valuation, or against a different transaction price", async () => {
    const db = fixture();
    await db.db.transaction(async (tx: typeof db.db) => {
      await postApprovedBookingGrant(tx, {
        ...input,
        policy: { ...policy, sourceReferences: [] },
      });
      await postApprovedBookingGrant(tx, { ...input, totalAmount: 10000 });
    });
    expect(db.rows("loyalty_contract_liability_events")).toHaveLength(0);
  });
  it("retains the obligation on conversion into credit, including a later refund", async () => {
    const db = fixture();
    const redeemed = { ...lot, remainingMiles: 60, spentMiles: 40 };
    await db.db.transaction(async (tx: typeof db.db) => {
      await postApprovedBookingGrant(tx, input);
      await recordLotMovement(tx, 2, lot, redeemed, 8, {
        type: "redeem",
        creditId: 9,
      });
      await recordLotMovement(
        tx,
        2,
        redeemed,
        { ...lot, remainingMiles: 0, reversedMiles: 100 },
        10,
        { type: "reverse", fullyRefunded: true }
      );
    });
    const [, conversion, refund] = db.rows("loyalty_contract_liability_events");
    expect(conversion.evidence.creditId).toBe(9);
    expect(
      [conversion, refund].map(row => [
        row.recognizedAmountMinor,
        row.deferredAmountAfterMinor,
      ])
    ).toEqual([
      [0, 83],
      [0, 83],
    ]);
    expect(refund.evidence.disposition).toBe("finance_review");
  });
  it("offsets the original allocation exactly once on fully funded refund of all unused miles", async () => {
    const db = fixture();
    await db.db.transaction(async (tx: typeof db.db) => {
      await postApprovedBookingGrant(tx, input);
      for (let i = 0; i < 2; i++)
        await recordLotMovement(
          tx,
          2,
          lot,
          { ...lot, remainingMiles: 0, reversedMiles: 100 },
          8,
          { type: "reverse", fullyRefunded: true }
        );
    });
    const rows = db.rows("loyalty_contract_liability_events");
    expect(
      rows.map(r => [
        r.eventType,
        r.allocatedAmountMinor,
        r.deferredAmountAfterMinor,
      ])
    ).toEqual([
      ["allocate", 83, 83],
      ["reverse", -83, 0],
    ]);
  });
});
