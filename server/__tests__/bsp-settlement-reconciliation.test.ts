import { describe, expect, it } from "vitest";
import {
  classifySettlement,
  settlementGate,
  type LedgerExpectation,
} from "../services/bsp/settlement-reconciliation";
import {
  majorToMinor,
  parseBankStatementCsv,
} from "../services/bsp/bank-statement-csv";
import {
  localTimeToUtc,
  periodWindow,
  reportingDateOf,
  retReportingWindow,
} from "../services/bsp/reporting-period";

const expectation = (
  documentNumber: string,
  expectedAmount: number,
  transactionCode = "TKTT",
  retLineId: number | null = 1
): LedgerExpectation => ({
  documentNumber,
  transactionCode,
  ledgerEntryId: 10,
  bookingId: 20,
  expectedAmount,
  retLineId,
});

describe("reconciliation classification matrix", () => {
  it("classifies every combination of ledger, HOT and remittance", () => {
    const result = classifySettlement({
      expectations: [
        expectation("D1", 47500), // in HOT, same amount → matched
        expectation("D2", 47500), // in HOT, different amount → amount_mismatch
        expectation("D3", 47500, "TKTT", null), // never reported, not in HOT → missing_in_hot
        expectation("D4", -22000, "RFND"), // refund matched
      ],
      hotLines: [
        {
          hotLineId: 1,
          documentNumber: "D1",
          transactionCode: "TKTT",
          netAmount: 47500,
        },
        {
          hotLineId: 2,
          documentNumber: "D2",
          transactionCode: "TKTT",
          netAmount: 47000,
        },
        {
          hotLineId: 3,
          documentNumber: "D4",
          transactionCode: "RFND",
          netAmount: -22000,
        },
        {
          hotLineId: 4,
          documentNumber: "D9",
          transactionCode: "TKTT",
          netAmount: 1000,
        },
      ],
      // HOT net = 47500 + 47000 − 22000 + 1000 = 73500
      remittances: [{ id: 7, amount: 73500 }],
    });
    expect(result.items.map(i => [i.documentNumber, i.classification])).toEqual(
      [
        ["D1", "matched"],
        ["D2", "amount_mismatch"],
        ["D3", "missing_in_hot"],
        ["D4", "matched"],
        ["D9", "unexpected_in_hot"],
      ]
    );
    expect(result.items[0]).toMatchObject({
      retLineId: 1,
      hotLineId: 1,
      remittanceId: 7,
      expectedAmount: 47500,
      hotAmount: 47500,
    });
    expect(result.items[1]).toMatchObject({
      hotAmount: 47000,
      remittanceId: null,
    });
    expect(result.items[4]).toMatchObject({
      ledgerEntryId: null,
      expectedAmount: null,
      hotAmount: 1000,
      retLineId: null,
    });
    expect(result.summary).toEqual({
      counts: {
        matched: 2,
        missing_in_hot: 1,
        amount_mismatch: 1,
        missing_remittance: 0,
        unexpected_in_hot: 1,
      },
      itemCount: 5,
      expectedNet: 120500,
      hotNet: 73500,
      remittedAmount: 73500,
      remittanceCovered: true,
      notReportedInRet: 1,
    });
  });

  it("turns matched items into missing_remittance until the bank credit covers the HOT net", () => {
    const input = {
      expectations: [expectation("D1", 47500)],
      hotLines: [
        {
          hotLineId: 1,
          documentNumber: "D1",
          transactionCode: "TKTT",
          netAmount: 47500,
        },
      ],
    };
    expect(
      classifySettlement({ ...input, remittances: [] }).items[0].classification
    ).toBe("missing_remittance");
    expect(
      classifySettlement({ ...input, remittances: [{ id: 1, amount: 47499 }] })
        .items[0].classification
    ).toBe("missing_remittance");
    const covered = classifySettlement({
      ...input,
      remittances: [
        { id: 1, amount: 40000 },
        { id: 2, amount: 7500 },
      ],
    });
    expect(covered.items[0].classification).toBe("matched");
    expect(covered.items[0].remittanceId).toBeNull(); // two credits: no single id
  });

  it("treats a duplicated HOT line as unexpected", () => {
    const result = classifySettlement({
      expectations: [expectation("D1", 100)],
      hotLines: [
        {
          hotLineId: 1,
          documentNumber: "D1",
          transactionCode: "TKTT",
          netAmount: 100,
        },
        {
          hotLineId: 2,
          documentNumber: "D1",
          transactionCode: "TKTT",
          netAmount: 100,
        },
      ],
      remittances: [{ id: 1, amount: 200 }],
    });
    expect(result.items.map(i => i.classification)).toEqual([
      "matched",
      "unexpected_in_hot",
    ]);
  });

  it("blocks settlement until exceptions are matched or dispositioned", () => {
    const items = [
      { classification: "matched" as const, dispositionReason: null },
      { classification: "missing_in_hot" as const, dispositionReason: null },
      { classification: "amount_mismatch" as const, dispositionReason: "   " },
    ];
    expect(settlementGate(items)).toEqual({
      status: "blocked",
      openItems: 2,
      dispositionedItems: 0,
      matchedItems: 1,
    });
    expect(
      settlementGate([
        items[0],
        { ...items[1], dispositionReason: "Reported in next RET" },
        { ...items[2], dispositionReason: "ADM 123 raised" },
      ])
    ).toEqual({
      status: "complete",
      openItems: 0,
      dispositionedItems: 2,
      matchedItems: 1,
    });
    expect(settlementGate([]).status).toBe("complete");
  });
});

describe("bank statement CSV", () => {
  it("reads date, amount and reference in any column order and converts to minor units", () => {
    const lines = parseBankStatementCsv(
      [
        "Reference,Amount,Value_Date,Counterparty",
        '"BSP SA REMIT 2026-11","73,500.00",2026-11-10,"IATA BSP, Saudi Arabia"',
        "ADM CLAWBACK,-12.5,2026-11-11,",
      ].join("\n"),
      "SAR"
    );
    expect(lines).toEqual([
      {
        lineNumber: 2,
        valueDate: "2026-11-10",
        amount: 7350000,
        currency: "SAR",
        reference: "BSP SA REMIT 2026-11",
        counterparty: "IATA BSP, Saudi Arabia",
      },
      {
        lineNumber: 3,
        valueDate: "2026-11-11",
        amount: -1250,
        currency: "SAR",
        reference: "ADM CLAWBACK",
        counterparty: null,
      },
    ]);
    expect(majorToMinor("0.5", 1)).toBe(50);
  });

  it("rejects missing columns, bad dates and over-precise amounts", () => {
    expect(() =>
      parseBankStatementCsv("date,amount\n2026-11-10,1", "SAR")
    ).toThrow(/reference/);
    expect(() =>
      parseBankStatementCsv("date,amount,reference\n10/11/2026,1,R", "SAR")
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      parseBankStatementCsv("date,amount,reference\n2026-11-10,1.005,R", "SAR")
    ).toThrow(/two places/);
    expect(() =>
      parseBankStatementCsv("date,amount,reference\n2026-11-10,1,", "SAR")
    ).toThrow(/reference is required/);
  });
});

describe("reporting period cut-off in the BSP country's local time", () => {
  it("cuts the Riyadh day at the configured local time, not at UTC midnight", () => {
    const window = retReportingWindow("2026-11-03", "23:59", "Asia/Riyadh");
    expect(window.start.toISOString()).toBe("2026-11-02T20:59:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-03T20:59:00.000Z");
    // 23:58 local on 3 Nov belongs to 3 Nov; 23:59 local opens 4 Nov.
    expect(
      reportingDateOf(new Date("2026-11-03T20:58:59Z"), "23:59", "Asia/Riyadh")
    ).toBe("2026-11-03");
    expect(
      reportingDateOf(new Date("2026-11-03T20:59:00Z"), "23:59", "Asia/Riyadh")
    ).toBe("2026-11-04");
    // A UTC-midnight sale (03:00 local) is on the local day, not the previous one.
    expect(
      reportingDateOf(new Date("2026-11-03T00:00:00Z"), "23:59", "Asia/Riyadh")
    ).toBe("2026-11-03");
  });

  it("supports an afternoon cut-off and a period of several days", () => {
    const window = retReportingWindow("2026-11-03", "17:00", "Asia/Riyadh");
    expect(window.start.toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-03T14:00:00.000Z");
    expect(
      reportingDateOf(new Date("2026-11-03T14:30:00Z"), "17:00", "Asia/Riyadh")
    ).toBe("2026-11-04");
    const period = periodWindow(
      "2026-11-01",
      "2026-11-03",
      "17:00",
      "Asia/Riyadh"
    );
    expect(period.start.toISOString()).toBe("2026-10-31T14:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-11-03T14:00:00.000Z");
    expect(() =>
      periodWindow("2026-11-04", "2026-11-03", "17:00", "Asia/Riyadh")
    ).toThrow();
  });

  it("honours a daylight-saving change on the cut-off day", () => {
    // London moves to BST at 01:00 UTC on 29 March 2026.
    expect(
      localTimeToUtc("2026-03-28", "02:30", "Europe/London").toISOString()
    ).toBe("2026-03-28T02:30:00.000Z");
    expect(
      localTimeToUtc("2026-03-29", "02:30", "Europe/London").toISOString()
    ).toBe("2026-03-29T01:30:00.000Z");
    expect(() =>
      localTimeToUtc("2026-03-29", "24:00", "Europe/London")
    ).toThrow(/HH:MM/);
  });
});
