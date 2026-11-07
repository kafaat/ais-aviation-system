/**
 * Inbound HOT parsing.
 *
 * The HOT fixtures below are constructed with the AIS layout table to look
 * like a billing file from a BSP processing centre: header, one office with
 * a sale and a refund, office totals, country totals, trailer. They are not
 * real BSP files and prove the parser's behaviour, not certification.
 */
import { describe, expect, it } from "vitest";
import { formatRecord } from "../services/bsp/dish-records";
import { hotFixture } from "./fixtures/bsp-hot";
import { HotParseError, parseHotFile } from "../services/bsp/hot-parser";

describe("HOT parser", () => {
  it("produces typed rows with signed nets and remittance totals", () => {
    const result = parseHotFile(hotFixture());
    expect(result.header).toEqual({
      reportingPeriodEnd: "2026-11-03",
      handbookRevision: "231",
      testMode: false,
      processingDate: "2026-11-05",
      processingTime: "0230",
      countryCode: "SA",
      reportingSystemId: "DPC1",
      fileSequence: 42,
      airlineNumericCode: "065",
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      transactionNumber: 1,
      transactionCode: "TKTT",
      agentCode: "71234567",
      issueDate: "2026-11-03",
      currency: "SAR",
      documentNumber: "0651234567890",
      passengerName: "ALHARBI/AHMED MR",
      fareAmount: 50000,
      taxes: [{ type: "VAT", amount: 9500 }],
      taxAmount: 9500,
      documentTotal: 59500,
      commissionRateBps: 500,
      commissionAmount: 2500,
      formOfPayment: { type: "CA", amount: 59500 },
      netAmount: 57000,
    });
    expect(result.transactions[1]).toMatchObject({
      transactionCode: "RFND",
      relatedDocumentNumber: "0651234567891",
      netAmount: -22000,
    });
    expect(result.officeTotals).toEqual([
      {
        agentCode: "71234567",
        currency: "SAR",
        transactionCount: 2,
        fareTotal: 70000,
        taxTotal: 12500,
        commissionTotal: 3500,
        remittance: 35000,
      },
    ]);
    expect(result.countryTotals[0].netRemittance).toBe(35000);
    expect(result.netRemittance).toBe(35000);
    expect(result.recordCount).toBe(15);
    expect(result.warnings).toEqual([]);
  });

  it("tolerates unknown record types with a warning and still checks the trailer", () => {
    const unknown = "BKI63" + "0".repeat(250);
    const result = parseHotFile(hotFixture({ extra: [unknown] }));
    expect(result.warnings).toEqual([
      "Line 13: unknown record type BKI63 skipped",
    ]);
    expect(result.transactions).toHaveLength(2);
    expect(result.recordCount).toBe(15);
  });

  it("rejects a trailer that disagrees with the record count", () => {
    expect(() => parseHotFile(hotFixture({ trailerRecords: 99 }))).toThrow(
      HotParseError
    );
    expect(() => parseHotFile(hotFixture({ trailerRecords: 99 }))).toThrow(
      /BFT99\.RCNT/
    );
  });

  it("rejects malformed records instead of repairing them", () => {
    const lines = hotFixture().split("\r\n");
    lines[4] = lines[4].slice(0, 200); // short BKS30
    expect(() => parseHotFile(lines.join("\r\n"))).toThrow(/200 characters/);
    const detached = hotFixture().split("\r\n");
    detached.splice(2, 1); // drop BCH02 of transaction 1
    expect(() => parseHotFile(detached.join("\r\n"))).toThrow(
      /before any BCH02/
    );
    expect(() => parseHotFile("")).toThrow(/empty/);
  });

  it("warns when the country totals disagree with the detail", () => {
    const lines = hotFixture().split("\r\n");
    const bct = lines.findIndex(l => l.startsWith("BCT95"));
    lines[bct] = formatRecord("BCT95", {
      CUTP: "SAR2",
      TCNT: 2,
      TFAR: 70000,
      TTAX: 12500,
      TCOM: 3500,
      TNSG: "+",
      TNET: 35001,
      TSAL: 59500,
      TRFD: 23000,
    });
    const result = parseHotFile(lines.join("\r\n"));
    expect(result.warnings).toEqual([
      "BCT95 SAR: net remittance 35001 differs from detail 35000",
    ]);
  });
});
