import { describe, expect, it, vi } from "vitest";
import { payoutEvidence } from "../../shared/payout-comparison";
import { comparePayoutEvidence } from "./payout-comparison.service";

const result = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({ leftJoin: () => ({ where: result }) }),
      }),
    }),
  }),
}));
const capture = { paymentIntentId: "pi_1", grossMinor: 1505, feeMinor: 100 };
const evidence = {
  payout: {
    reference: "po_9",
    currency: "SAR" as const,
    netMinor: 1405,
    captureCount: 1,
    captures: [capture],
  },
  bank: {
    statementLineId: "statement_7",
    payoutReference: "po_9",
    currency: "SAR" as const,
    creditedMinor: 1405,
  },
};
const receipt = {
  intent: "pi_1",
  bookingId: 3,
  kind: "modification",
  targetId: 15,
  receiptMinor: 1505,
  currency: "SAR",
  collectionState: "applied",
  ledgerId: 44,
  ledgerMajor: "15.05",
  ledgerCurrency: "SAR",
};
describe("payout evidence comparison", () => {
  it("requires every capture exactly once and rejects unsupported adjustments", () => {
    expect(
      payoutEvidence.safeParse({
        ...evidence,
        payout: { ...evidence.payout, captureCount: 2 },
      }).success
    ).toBe(false);
    expect(
      payoutEvidence.safeParse({
        ...evidence,
        payout: {
          ...evidence.payout,
          captureCount: 2,
          captures: [capture, capture],
        },
      }).success
    ).toBe(false);
    expect(
      payoutEvidence.safeParse({
        ...evidence,
        payout: { ...evidence.payout, refunds: [{ amount: 500 }] },
      }).success
    ).toBe(false);
  });
  it("separates the fee, gross, batch reference and bank credit", async () => {
    result.mockResolvedValue([receipt]);
    const matched = await comparePayoutEvidence(evidence, 12);
    expect(matched).toMatchObject({
      basis: "operator_supplied_statements",
      matched: true,
      calculatedNetMinor: 1405,
      lines: [{ modificationId: 15, ledgerEntryId: 44 }],
    });
    expect(
      (
        await comparePayoutEvidence(
          {
            ...evidence,
            bank: { ...evidence.bank, payoutReference: "po_other" },
          },
          12
        )
      ).matched
    ).toBe(false);
    expect(
      (
        await comparePayoutEvidence(
          {
            ...evidence,
            payout: {
              ...evidence.payout,
              captures: [{ ...capture, feeMinor: 0 }],
            },
          },
          12
        )
      ).payoutNetMatches
    ).toBe(false);
  });
  it("does not report a match for duplicate or absent ledger evidence", async () => {
    for (const rows of [
      [],
      [receipt, receipt],
      [{ ...receipt, ledgerId: null }],
      [{ ...receipt, ledgerMajor: "14.05" }],
      [{ ...receipt, currency: "EUR" }],
    ]) {
      result.mockResolvedValue(rows);
      expect((await comparePayoutEvidence(evidence, 12)).matched).toBe(false);
    }
  });
});
