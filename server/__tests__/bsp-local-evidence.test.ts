import { describe, expect, it } from "vitest";
import {
  normalizedHot,
  type Ret,
  type Hot,
  type Bank,
} from "../../shared/bsp-local-evidence";
import { compareBspEvidence } from "../services/bsp-local-evidence";
import { generateHOTFile } from "../services/bsp-reporting.service";

const header = {
  profile: "AIS-BSP-LOCAL-1" as const,
  day: "2026-10-10",
  tenantId: 7,
  currency: "SAR" as const,
};
const sale = {
  ledgerId: 1,
  bookingId: 3,
  agentId: 7,
  kind: "sale" as const,
  amountMinor: 1500,
};
const refund = {
  ...sale,
  ledgerId: 2,
  kind: "refund" as const,
  amountMinor: 1000,
};
const ret: Ret = {
  ...header,
  direction: "outbound_ret_draft",
  lines: [sale, refund],
};
const hot: Hot = {
  ...header,
  direction: "inbound_hot",
  settlementReference: "BSP-2026",
  lines: [refund, sale],
  transferMinor: 500,
};
const bank: Bank = {
  ...header,
  direction: "inbound_bank",
  settlementReference: "BSP-2026",
  statementLineId: "BANK-100",
  transferMinor: 500,
};

describe("BSP local evidence", () => {
  it("requires all four sides, including sale/refund direction", () => {
    expect(compareBspEvidence(ret, ret, hot, bank)).toMatchObject({
      matches: true,
      netMinor: 500,
    });
    expect(
      compareBspEvidence(
        ret,
        ret,
        { ...hot, lines: [sale, { ...refund, kind: "sale" }] },
        bank
      )
    ).toMatchObject({ matches: false, differingLedgerIds: [2] });
  });
  it("detects offsetting errors, missing/extra entries and late changes to the local journal", () => {
    expect(
      compareBspEvidence(
        ret,
        ret,
        {
          ...hot,
          lines: [
            { ...sale, amountMinor: 1499 },
            { ...refund, amountMinor: 999 },
          ],
        },
        bank
      )
    ).toMatchObject({ matches: false, differingLedgerIds: [1, 2] });
    expect(
      compareBspEvidence(
        ret,
        ret,
        { ...hot, lines: [sale, { ...refund, ledgerId: 12 }] },
        bank
      )
    ).toMatchObject({ matches: false, differingLedgerIds: [2, 12] });
    expect(
      compareBspEvidence({ ...ret, lines: [sale] }, ret, hot, bank)
    ).toMatchObject({
      matches: false,
      retMatchesLedger: false,
      differingLedgerIds: [2],
    });
  });
  it("rejects cross-settlement, cross-tenant, incorrect-day and incorrect bank amounts", () => {
    for (const bad of [
      { ...bank, settlementReference: "OTHER" },
      { ...bank, tenantId: 6 },
      { ...bank, day: "2026-10-11" },
      { ...bank, transferMinor: 501 },
    ])
      expect(compareBspEvidence(ret, ret, hot, bad).matches).toBe(false);
  });
  it("rejects duplicate, unexpected or outbound fields in normalized HOT imports", () => {
    for (const bad of [
      { ...hot, lines: [sale, sale] },
      { ...hot, passengerName: "PII" },
      { ...hot, direction: "outbound_ret_draft" },
      { ...hot, profile: "DISH" },
    ])
      expect(normalizedHot.safeParse(bad).success).toBe(false);
  });
  it("refuses the obsolete outbound HOT operation", async () => {
    await expect(generateHOTFile()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
