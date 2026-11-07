/**
 * Outbound RET: record formatting, exact widths and control totals.
 *
 * Fixtures are constructed here from the AIS layout table; they are not
 * real BSP files. The DISH handbook is distributed to BSP participants only,
 * so these tests prove internal consistency of the profile, not certification.
 */
import { describe, expect, it } from "vitest";
import {
  DISH_RECORD_WIDTH,
  assertLayoutIntegrity,
  dishLayouts,
  dishRecordNames,
  retRecordNames,
} from "../services/bsp/dish-layouts";
import {
  DishFormatError,
  formatRecord,
  parseRecord,
  splitRecords,
} from "../services/bsp/dish-records";
import {
  buildRetFile,
  computeControlTotals,
  couponUseIndicator,
  handbookRevision,
  validateRetFile,
  type RetDocument,
  type RetSpecification,
} from "../services/bsp/dish-ret";

const spec: RetSpecification = {
  bspCountry: "SA",
  dishVersion: "23.1",
  airlineNumericCode: "065",
  reportingSystemId: "AIS",
  currency: "SAR",
  timeZone: "Asia/Riyadh",
  testMode: true,
};

const sale = (over: Partial<RetDocument> = {}): RetDocument => ({
  transactionCode: "TKTT",
  documentNumber: "0651234567890",
  couponsIssued: [true, true],
  passengerName: "ALHARBI/AHMED MR",
  statisticalCode: "DOM",
  agentCode: "71234567",
  issuedAt: new Date("2026-11-03T08:15:00Z"),
  fareAmount: 50000,
  taxes: [
    { type: "VAT", amount: 7500 },
    { type: "YQ", amount: 2000 },
  ],
  commissionRateBps: 500,
  commissionAmount: 2500,
  formOfPayment: { type: "CA", amount: 59500 },
  ...over,
});

const refund = (): RetDocument =>
  sale({
    transactionCode: "RFND",
    documentNumber: "0651234567891",
    relatedDocumentNumber: "0651234567891",
    fareAmount: 20000,
    taxes: [{ type: "VAT", amount: 3000 }],
    commissionAmount: 1000,
    formOfPayment: { type: "CA", amount: 23000 },
  });

describe("DISH layout table", () => {
  it.each(dishRecordNames)("%s fields are contiguous and fit 255", name => {
    expect(() => assertLayoutIntegrity(name)).not.toThrow();
    expect(dishLayouts[name][0].code).toBe("RNAM");
  });

  it("places the key elements at the documented offsets", () => {
    const at = (record: keyof typeof dishLayouts, code: string) => {
      const f = dishLayouts[record].find(x => x.code === code)!;
      return [f.start, f.length];
    };
    expect(at("BCH02", "TRNN")).toEqual([6, 6]);
    expect(at("BCH02", "TRNC")).toEqual([12, 4]);
    expect(at("BCH02", "AGTN")).toEqual([16, 8]);
    expect(at("BKT06", "TDNR")).toEqual([12, 15]);
    expect(at("BKT06", "PXNM")).toEqual([34, 49]);
    expect(at("BKS30", "COBL")).toEqual([27, 11]);
    expect(at("BKS30", "TDAM")).toEqual([95, 11]);
    expect(at("BKS39", "COAM")).toEqual([38, 11]);
    expect(at("BKP84", "FPAM")).toEqual([37, 11]);
    expect(at("BCT95", "TNET")).toEqual([64, 15]);
    expect(at("BFT99", "RCNT")).toEqual([6, 8]);
  });
});

describe("record formatting", () => {
  it("pads alphanumerics right and numerics left to exactly 255 characters", () => {
    const record = formatRecord("BCH02", {
      TRNN: 7,
      TRNC: "TKTT",
      AGTN: "71234567",
      DAIS: "261103",
      TACN: "065",
      CUTP: "SAR2",
      TRCN: 5,
    });
    expect(record).toHaveLength(DISH_RECORD_WIDTH);
    expect(record.slice(0, 5)).toBe("BCH02");
    expect(record.slice(5, 11)).toBe("000007");
    expect(record.slice(11, 15)).toBe("TKTT");
    expect(record.slice(36, 40)).toBe("0005");
    expect(record.slice(40)).toBe(" ".repeat(DISH_RECORD_WIDTH - 40));
    expect(parseRecord(1, record).values).toMatchObject({
      TRNN: "000007",
      TRNC: "TKTT",
      AGTN: "71234567",
    });
  });

  it("refuses values that do not fit, are negative or are not printable", () => {
    expect(() => formatRecord("BKS30", { TRNN: 1, COBL: 10 ** 11 })).toThrow(
      DishFormatError
    );
    expect(() => formatRecord("BKS30", { TRNN: 1, COBL: -1 })).toThrow(
      /non-negative/
    );
    expect(() =>
      formatRecord("BKT06", { TRNN: 1, PXNM: "A".repeat(50) })
    ).toThrow(/exceeds 49/);
    expect(() => formatRecord("BKT06", { TRNN: 1, PXNM: "نص" })).toThrow(
      /non-printable/
    );
  });

  it("maps DISH version and coupon use", () => {
    expect(handbookRevision("23.1")).toBe("231");
    expect(handbookRevision("9.0")).toBe("090");
    expect(couponUseIndicator([true, true])).toBe("FFVV");
    expect(couponUseIndicator([true, false, true, true])).toBe("FVFF");
    expect(() => couponUseIndicator([])).toThrow();
  });
});

describe("RET file", () => {
  it("writes header, five records per transaction, control totals and trailer", () => {
    const built = buildRetFile({
      specification: spec,
      reportingDate: "2026-11-03",
      processingAt: new Date("2026-11-03T21:05:00Z"), // 00:05 on 4 Nov in Riyadh
      sequenceNumber: 1,
      documents: [sale(), refund()],
    });
    const lines = splitRecords(built.content);
    expect(lines).toHaveLength(1 + 2 * 5 + 1 + 1);
    expect(lines.every(l => l.length === DISH_RECORD_WIDTH)).toBe(true);
    expect(lines.map(l => l.slice(0, 5))).toEqual([
      "BFH01",
      ...["BCH02", "BKT06", "BKS30", "BKS39", "BKP84"],
      ...["BCH02", "BKT06", "BKS30", "BKS39", "BKP84"],
      "BCT95",
      "BFT99",
    ]);
    expect(
      lines
        .map(l => l.slice(0, 5))
        .every(n => retRecordNames.includes(n as never))
    ).toBe(true);
    const header = parseRecord(1, lines[0]).values;
    expect(header).toMatchObject({
      SPED: "261103",
      REVN: "231",
      TPST: "TEST",
      PRDA: "261104",
      PRTM: "0005",
      ISOC: "SA",
      RSID: "AIS",
      FSEQ: "000001",
      TACN: "065",
    });
    const amounts = parseRecord(4, lines[3]).values;
    expect(amounts).toMatchObject({
      COBL: "00000050000",
      TMFT1: "VAT",
      TMFA1: "00000007500",
      TMFT2: "YQ",
      TMFA2: "00000002000",
      TMFT3: "",
      TMFA3: "00000000000",
      TDAM: "00000059500",
      CUTP: "SAR2",
    });
    expect(parseRecord(2, lines[1]).values.DAIS).toBe("261103");
    expect(parseRecord(7, lines[6]).values.TRNC).toBe("RFND");
    expect(parseRecord(8, lines[7]).values.RTDN).toBe("0651234567891");
    const totals = parseRecord(12, lines[11]).values;
    // sales net 59500-2500 = 57000; refund net 23000-1000 = 22000; net 35000
    expect(totals).toMatchObject({
      TCNT: "00000002",
      TFAR: "000000000070000",
      TTAX: "000000000012500",
      TCOM: "000000000003500",
      TNSG: "+",
      TNET: "000000000035000",
      TSAL: "000000000059500",
      TRFD: "000000000023000",
    });
    expect(parseRecord(13, lines[12]).values).toMatchObject({
      RCNT: "00000013",
      TCNT: "00000002",
      CCNT: "00000001",
    });
    expect(built.controlTotals).toEqual(
      computeControlTotals("SAR", [sale(), refund()])
    );
    expect(built.recordCount).toBe(13);
    expect(validateRetFile(built.content)).toMatchObject({
      ok: true,
      errors: [],
      transactionCount: 2,
    });
  });

  it("signs a net refund position and validates an empty file", () => {
    const only = buildRetFile({
      specification: spec,
      reportingDate: "2026-11-03",
      processingAt: new Date("2026-11-04T05:00:00Z"),
      sequenceNumber: 2,
      documents: [refund()],
    });
    expect(only.controlTotals.netRemittance).toBe(-22000);
    const totals = parseRecord(1, splitRecords(only.content)[6]).values;
    expect(totals.TNSG).toBe("-");
    expect(totals.TNET).toBe("000000000022000");
    const empty = buildRetFile({
      specification: spec,
      reportingDate: "2026-11-03",
      processingAt: new Date("2026-11-04T05:00:00Z"),
      sequenceNumber: 3,
      documents: [],
    });
    expect(empty.recordCount).toBe(3);
    expect(validateRetFile(empty.content).ok).toBe(true);
  });

  it("detects a tampered detail amount through the control totals", () => {
    const built = buildRetFile({
      specification: spec,
      reportingDate: "2026-11-03",
      processingAt: new Date("2026-11-04T05:00:00Z"),
      sequenceNumber: 1,
      documents: [sale()],
    });
    const lines = splitRecords(built.content);
    lines[3] = lines[3].slice(0, 26) + "00000050001" + lines[3].slice(37);
    const result = validateRetFile(lines.join("\n"));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/TDAM is not fare plus tax/);
    expect(result.errors.join(" ")).toMatch(/BCT95\.TFAR/);
    const truncated = validateRetFile(lines.slice(0, -1).join("\n"));
    expect(truncated.ok).toBe(false);
    expect(truncated.errors).toContain("File must end with BFT99");
  });

  it("rejects inconsistent documents before any record is written", () => {
    const build = (doc: RetDocument) =>
      buildRetFile({
        specification: spec,
        reportingDate: "2026-11-03",
        processingAt: new Date(),
        sequenceNumber: 1,
        documents: [doc],
      });
    expect(() =>
      build(sale({ formOfPayment: { type: "CA", amount: 1 } }))
    ).toThrow(/form of payment/);
    expect(() => build(sale({ commissionAmount: 60000 }))).toThrow(
      /commission exceeds/
    );
    expect(() => build(sale({ agentCode: "1234" }))).toThrow(/eight digits/);
    expect(() =>
      build(sale({ transactionCode: "RFND", relatedDocumentNumber: undefined }))
    ).toThrow(/original document/);
    expect(() =>
      build(
        sale({
          taxes: [
            { type: "A", amount: 1 },
            { type: "B", amount: 1 },
            { type: "C", amount: 1 },
            { type: "D", amount: 1 },
          ],
          formOfPayment: { type: "CA", amount: 50004 },
        })
      )
    ).toThrow(/at most three/);
  });
});
