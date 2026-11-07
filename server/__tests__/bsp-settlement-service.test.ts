/**
 * BSP settlement service against the in-memory relational double:
 * RET generation from the ledger with the local cut-off, the transmission
 * gate (confirmed link specification, fare components, transport), HOT
 * ingestion, bank import and the reconciliation gate with dispositions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import { hotFixture } from "./fixtures/bsp-hot";
const boundary = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import {
  acknowledgeRetFile,
  confirmLinkSpecification,
  dispositionReconciliationItem,
  generateRetFile,
  getRetFile,
  importBankStatement,
  ingestHotFile,
  runReconciliation,
  saveLinkSpecification,
  transmitRetFile,
} from "../services/bsp-settlement.service";
import { splitRecords, parseRecord } from "../services/bsp/dish-records";
import type { RetTransport } from "../services/bsp/ret-transport";
import type { FareComponentSource } from "../services/bsp/fare-components";

const ACTOR = 9;
const specification = {
  id: 1,
  tenantId: null,
  bspCountry: "SA",
  settlementPlan: "bsp",
  linkType: "ndclink",
  dishVersion: "23.1",
  airlineNumericCode: "065",
  reportingSystemId: "AIS",
  currency: "SAR",
  timeZone: "Asia/Riyadh",
  retCutoffLocalTime: "23:59",
  hotCutoffLocalTime: "23:59",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  confirmationStatus: "draft",
  confirmationReference: null,
  confirmedBy: null,
  confirmedAt: null,
  createdBy: ACTOR,
};

function seed() {
  return transactionMemory({
    settlement_link_specifications: [specification],
    airports: [
      { id: 1, code: "RUH", country: "Saudi Arabia" },
      { id: 2, code: "JED", country: "Saudi Arabia" },
    ],
    flights: [{ id: 5, originId: 1, destinationId: 2 }],
    bookings: [
      { id: 20, flightId: 5, pnr: "ABC123", totalAmount: 100000 },
      { id: 21, flightId: 5, pnr: "DIRECT", totalAmount: 30000 },
      { id: 22, flightId: 5, pnr: "LATE01", totalAmount: 10000 },
    ],
    passengers: [
      {
        id: 100,
        bookingId: 20,
        firstName: "Ahmed",
        lastName: "Alharbi",
        ticketNumber: "0651234567890",
      },
      {
        id: 101,
        bookingId: 20,
        firstName: "Sara",
        lastName: "Alharbi",
        ticketNumber: "0651234567891",
      },
      {
        id: 102,
        bookingId: 21,
        firstName: "Direct",
        lastName: "Buyer",
        ticketNumber: "0659999999999",
      },
      {
        id: 103,
        bookingId: 22,
        firstName: "Next",
        lastName: "Day",
        ticketNumber: "0651111111111",
      },
    ],
    travel_agents: [
      { id: 3, iataNumber: "71234567", agencyName: "Riyadh Travel" },
    ],
    agent_bookings: [
      {
        id: 1,
        agentId: 3,
        bookingId: 20,
        commissionRate: "5.00",
        commissionAmount: 5000,
        bookingAmount: 100000,
      },
      {
        id: 2,
        agentId: 3,
        bookingId: 22,
        commissionRate: "5.00",
        commissionAmount: 500,
        bookingAmount: 10000,
      },
    ],
    booking_fare_components: [],
    financial_ledger: [
      // Agency sale inside the 3 Nov window (13:00 Riyadh).
      {
        id: 10,
        bookingId: 20,
        type: "charge",
        amount: "1000.00",
        currency: "SAR",
        transactionDate: new Date("2026-11-03T10:00:00Z"),
        stripePaymentIntentId: null,
      },
      // Direct sale: not a BSP transaction.
      {
        id: 11,
        bookingId: 21,
        type: "charge",
        amount: "300.00",
        currency: "SAR",
        transactionDate: new Date("2026-11-03T11:00:00Z"),
        stripePaymentIntentId: "pi_1",
      },
      // 00:30 Riyadh on 4 Nov: after the 23:59 cut-off, belongs to the next RET.
      {
        id: 12,
        bookingId: 22,
        type: "charge",
        amount: "100.00",
        currency: "SAR",
        transactionDate: new Date("2026-11-03T21:30:00Z"),
        stripePaymentIntentId: null,
      },
    ],
  });
}

const memoryTransport = () => {
  const sent: Array<{ fileName: string; sha256: string }> = [];
  const transport: RetTransport = {
    kind: "memory",
    async transmit(file) {
      sent.push({ fileName: file.fileName, sha256: file.sha256 });
      return {
        reference: `memo-${sent.length}`,
        transmittedAt: new Date("2026-11-04T06:00:00Z"),
      };
    },
  };
  return { transport, sent };
};

const componentsFor20: FareComponentSource = {
  read: async bookingId =>
    bookingId === 20
      ? [
          {
            passengerId: 100,
            baseAmount: 40000,
            feeAmount: 0,
            taxes: [{ type: "VAT", amount: 5000 }],
          },
          {
            passengerId: 101,
            baseAmount: 50000,
            feeAmount: 0,
            taxes: [{ type: "VAT", amount: 5000 }],
          },
        ]
      : null,
};

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = seed();
  boundary.db = fixture.db;
});

describe("outbound RET from the ledger", () => {
  it("reports agency documents issued before the local cut-off and skips the rest", async () => {
    const result = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
      now: new Date("2026-11-03T21:10:00Z"),
    });
    expect(result).toMatchObject({
      reportingDate: "2026-11-03",
      sequenceNumber: 1,
      transactionCount: 2,
      recordCount: 1 + 2 * 5 + 2,
      fallbackLineCount: 2,
      skipped: { directSales: 1, unticketedPassengers: 0, foreignCurrency: 0 },
      specificationStatus: "draft",
    });
    expect(result.window.start.toISOString()).toBe("2026-11-02T20:59:00.000Z");
    expect(result.window.end.toISOString()).toBe("2026-11-03T20:59:00.000Z");
    // 100000 split over two documents; 5% commission on each.
    expect(result.controlTotals).toMatchObject({
      fareTotal: 100000,
      taxTotal: 0,
      commissionTotal: 5000,
      netRemittance: 95000,
      grossSales: 100000,
      grossRefunds: 0,
    });
    const { file, lines } = await getRetFile(result.fileId);
    expect(file.status).toBe("generated");
    expect(file.sha256).toBe(result.sha256);
    expect(file.fileName).toBe("RET_065_SA_20261103_001.txt");
    expect(
      lines.map(l => [l.documentNumber, l.netAmount, l.componentsSource])
    ).toEqual([
      ["0651234567890", 47500, "booking_total_fallback"],
      ["0651234567891", 47500, "booking_total_fallback"],
    ]);
    const records = splitRecords(file.content);
    expect(parseRecord(1, records[0]).values.TPST).toBe("TEST");
    expect(parseRecord(2, records[1]).values).toMatchObject({
      AGTN: "71234567",
      DAIS: "261103",
    });
    expect(parseRecord(3, records[2]).values.PXNM).toBe("ALHARBI/AHMED");
    // The late sale lands in the next reporting date.
    const next = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-04",
      actorId: ACTOR,
    });
    expect(next.transactionCount).toBe(1);
    expect(next.controlTotals.netRemittance).toBe(9500);
    const again = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
    });
    expect(again.sequenceNumber).toBe(2);
  });

  it("uses fare components when they cover the ticketed passengers and sum to the ledger", async () => {
    const result = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
      fareComponents: componentsFor20,
    });
    expect(result.fallbackLineCount).toBe(0);
    expect(result.controlTotals).toMatchObject({
      fareTotal: 90000,
      taxTotal: 10000,
      commissionTotal: 4500,
    });
    const { lines } = await getRetFile(result.fileId);
    expect(
      lines.map(l => [
        l.fareAmount,
        l.taxAmount,
        l.commissionAmount,
        l.componentsSource,
      ])
    ).toEqual([
      [40000, 5000, 2000, "fare_components"],
      [50000, 5000, 2500, "fare_components"],
    ]);
  });

  it("reads booking_fare_components by default and folds them per passenger", async () => {
    fixture.rows("booking_fare_components").push(
      {
        id: 1,
        bookingId: 20,
        passengerId: 100,
        flightId: 5,
        componentType: "base_fare",
        code: null,
        amount: 42000,
        currency: "SAR",
        reversedAt: null,
      },
      {
        id: 2,
        bookingId: 20,
        passengerId: 100,
        flightId: 5,
        componentType: "discount",
        code: "PROMO",
        amount: -2000,
        currency: "SAR",
        reversedAt: null,
      },
      {
        id: 3,
        bookingId: 20,
        passengerId: 100,
        flightId: 5,
        componentType: "tax",
        code: "vat",
        amount: 5000,
        currency: "SAR",
        reversedAt: null,
      },
      {
        id: 4,
        bookingId: 20,
        passengerId: 101,
        flightId: 5,
        componentType: "base_fare",
        code: null,
        amount: 48000,
        currency: "SAR",
        reversedAt: null,
      },
      {
        id: 5,
        bookingId: 20,
        passengerId: 101,
        flightId: 5,
        componentType: "carrier_surcharge",
        code: "YQ",
        amount: 2000,
        currency: "SAR",
        reversedAt: null,
      },
      {
        id: 6,
        bookingId: 20,
        passengerId: 101,
        flightId: 5,
        componentType: "tax",
        code: "VAT",
        amount: 5000,
        currency: "SAR",
        reversedAt: null,
      },
      // Reversed rows are ignored.
      {
        id: 7,
        bookingId: 20,
        passengerId: 101,
        flightId: 5,
        componentType: "tax",
        code: "XX",
        amount: 999,
        currency: "SAR",
        reversedAt: new Date(),
      }
    );
    const result = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
    });
    expect(result.fallbackLineCount).toBe(0);
    const { lines } = await getRetFile(result.fileId);
    expect(
      lines.map(l => [
        l.fareAmount,
        l.taxAmount,
        l.commissionAmount,
        l.componentsSource,
      ])
    ).toEqual([
      [40000, 5000, 2000, "fare_components"],
      [50000, 5000, 2500, "fare_components"],
    ]);
    // An ancillary row makes the booking fall back: EMD matter is not ticket fare.
    fixture.rows("booking_fare_components").push({
      id: 8,
      bookingId: 20,
      passengerId: 100,
      flightId: 5,
      componentType: "ancillary",
      code: "BAG",
      amount: 0,
      currency: "SAR",
      reversedAt: null,
    });
    const again = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
    });
    expect(again.fallbackLineCount).toBe(2);
  });

  it("refuses generation without a link specification and for stub plans", async () => {
    await expect(
      generateRetFile({
        bspCountry: "AE",
        reportingDate: "2026-11-03",
        actorId: ACTOR,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    fixture.rows("settlement_link_specifications")[0].settlementPlan = "arc";
    await expect(
      generateRetFile({
        bspCountry: "SA",
        reportingDate: "2026-11-03",
        actorId: ACTOR,
      })
    ).rejects.toThrow(/ARC reporting is a labelled stub/);
  });
});

describe("transmission gate", () => {
  it("blocks transmission while the link specification is unconfirmed and never calls the transport", async () => {
    const { fileId } = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
      fareComponents: componentsFor20,
    });
    const { transport, sent } = memoryTransport();
    await expect(transmitRetFile(fileId, ACTOR, transport)).rejects.toThrow(
      /is draft; the BSP link agreement must be confirmed/
    );
    expect(sent).toEqual([]);
    expect(fixture.rows("bsp_ret_files")[0].status).toBe("generated");
  });

  it("blocks fallback files even under a confirmed link, then transmits a complete file once", async () => {
    await confirmLinkSpecification(1, "BSP-SA/NDCLINK/2026-0042", ACTOR);
    const fallback = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
    });
    const { transport, sent } = memoryTransport();
    await expect(
      transmitRetFile(fallback.fileId, ACTOR, transport)
    ).rejects.toThrow(/without fare components/);
    const complete = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
      fareComponents: componentsFor20,
    });
    expect(complete.specificationStatus).toBe("confirmed");
    const receipt = await transmitRetFile(complete.fileId, ACTOR, transport);
    expect(receipt).toMatchObject({
      status: "transmitted",
      reference: "memo-1",
    });
    expect(sent).toEqual([
      { fileName: complete.fileName, sha256: complete.sha256 },
    ]);
    const stored = fixture
      .rows("bsp_ret_files")
      .find(f => f.id === complete.fileId);
    expect(stored.status).toBe("transmitted");
    expect(stored.transportReference).toBe("memory|memo-1|by:9");
    await expect(
      transmitRetFile(complete.fileId, ACTOR, transport)
    ).rejects.toThrow(/already transmitted/);
    await acknowledgeRetFile({
      fileId: complete.fileId,
      outcome: "accepted",
      reason: "DPC ack 7781",
    });
    expect(stored.status).toBe("accepted");
    await expect(
      acknowledgeRetFile({
        fileId: fallback.fileId,
        outcome: "rejected",
        reason: "x",
      })
    ).rejects.toThrow(/Only transmitted files/);
  });

  it("re-opens the gate when the confirmed specification is edited or revoked", async () => {
    await confirmLinkSpecification(1, "ref", ACTOR);
    const file = await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
      fareComponents: componentsFor20,
    });
    await saveLinkSpecification(
      {
        ...specification,
        settlementPlan: "bsp",
        linkType: "ifg",
        effectiveTo: null,
      },
      ACTOR
    );
    expect(fixture.rows("settlement_link_specifications")[0]).toMatchObject({
      linkType: "ifg",
      confirmationStatus: "draft",
      confirmationReference: null,
    });
    await expect(
      transmitRetFile(file.fileId, ACTOR, memoryTransport().transport)
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(confirmLinkSpecification(1, "", ACTOR)).rejects.toThrow(
      /confirmation reference/
    );
  });
});

describe("inbound HOT, bank remittance and the reconciliation gate", () => {
  it("stores the HOT verbatim with its hash and refuses duplicates", async () => {
    const content = hotFixture();
    const result = await ingestHotFile({
      bspCountry: "SA",
      fileName: "HOT_SA_261105.txt",
      content,
      actorId: ACTOR,
    });
    expect(result).toMatchObject({
      transactionCount: 2,
      recordCount: 15,
      netRemittance: 35000,
      processingDate: "2026-11-05",
      remittancePeriodEnd: "2026-11-03",
      warnings: [],
    });
    expect(fixture.rows("bsp_hot_files")[0].content).toBe(content);
    expect(
      fixture
        .rows("bsp_hot_lines")
        .map(l => [l.documentNumber, l.transactionCode, l.netAmount])
    ).toEqual([
      ["0651234567890", "TKTT", 57000],
      ["0651234567891", "RFND", -22000],
    ]);
    await expect(
      ingestHotFile({
        bspCountry: "SA",
        fileName: "again.txt",
        content,
        actorId: ACTOR,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      ingestHotFile({
        bspCountry: "AE",
        fileName: "x.txt",
        content: hotFixture({ trailerRecords: 1 }),
        actorId: ACTOR,
      })
    ).rejects.toThrow(/HOT file rejected/);
  });

  it("matches ledger, RET, HOT and bank credit per document and blocks until dispositioned", async () => {
    await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
    });
    // HOT bills 0651234567890 at 57000 (ledger expects 47500), refunds a document the
    // ledger never refunded, and misses 0651234567891 entirely.
    await ingestHotFile({
      bspCountry: "SA",
      fileName: "hot.txt",
      content: hotFixture(),
      actorId: ACTOR,
    });
    await importBankStatement({
      bspCountry: "SA",
      currency: "SAR",
      csv: "date,amount,reference\n2026-11-03,350.00,BSP SA 2026-11-03\n",
      actorId: ACTOR,
    });
    const report = await runReconciliation({
      bspCountry: "SA",
      periodStart: "2026-11-03",
      periodEnd: "2026-11-03",
      actorId: ACTOR,
    });
    expect(report.gate).toEqual({
      status: "blocked",
      openItems: 3,
      dispositionedItems: 0,
      matchedItems: 0,
    });
    expect(
      report.items.map(i => [
        i.documentNumber,
        i.transactionCode,
        i.classification,
        i.retLineId !== null,
      ])
    ).toEqual([
      ["0651234567890", "TKTT", "amount_mismatch", true],
      ["0651234567891", "TKTT", "missing_in_hot", true],
      ["0651234567891", "RFND", "unexpected_in_hot", false],
    ]);
    expect(report.run.summary).toMatchObject({
      hotNet: 35000,
      remittedAmount: 35000,
      remittanceCovered: true,
      expectedNet: 95000,
    });
    expect(report.run.status).toBe("open");
    const [mismatch, missing, unexpected] = report.items;
    await expect(
      dispositionReconciliationItem({
        itemId: mismatch.id,
        reason: "ADM",
        actorId: ACTOR,
      })
    ).rejects.toThrow(/at least five/);
    expect(
      await dispositionReconciliationItem({
        itemId: mismatch.id,
        reason: "ADM 4471 raised for tax difference",
        actorId: ACTOR,
      })
    ).toMatchObject({ status: "blocked", openItems: 2 });
    await dispositionReconciliationItem({
      itemId: missing.id,
      reason: "Carried to next billing period",
      actorId: ACTOR,
    });
    const gate = await dispositionReconciliationItem({
      itemId: unexpected.id,
      reason: "Agency refund via BSP; ledger refund pending",
      actorId: ACTOR,
    });
    expect(gate).toEqual({
      status: "complete",
      openItems: 0,
      dispositionedItems: 3,
      matchedItems: 0,
    });
    expect(fixture.rows("bsp_reconciliation_runs")[0]).toMatchObject({
      status: "complete",
    });
    expect(
      fixture
        .rows("bsp_reconciliation_items")
        .every(i => i.dispositionedBy === ACTOR)
    ).toBe(true);
    await expect(
      dispositionReconciliationItem({
        itemId: missing.id,
        reason: "late change",
        actorId: ACTOR,
      })
    ).rejects.toThrow(/already complete/);
  });

  it("completes immediately when every document matches and the wire covers the HOT net", async () => {
    await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
      fareComponents: componentsFor20,
    });
    // Ledger expects 40000+5000-2000 = 43000 and 50000+5000-2500 = 52500.
    const { formatRecord } = await import("../services/bsp/dish-records");
    const tx = (
      n: number,
      tdnr: string,
      fare: number,
      tax: number,
      com: number
    ) => [
      formatRecord("BCH02", {
        TRNN: n,
        TRNC: "TKTT",
        AGTN: "71234567",
        DAIS: "261103",
        TACN: "065",
        CUTP: "SAR2",
        TRCN: 5,
      }),
      formatRecord("BKT06", {
        TRNN: n,
        TDNR: tdnr,
        CPUI: "FVVV",
        CJCP: "",
        PXNM: "X",
        STAT: "DOM",
        DAIS: "261103",
        AGTN: "71234567",
        RTDN: "",
      }),
      formatRecord("BKS30", {
        TRNN: n,
        TDNR: tdnr,
        COBL: fare,
        TMFT1: "VAT",
        TMFA1: tax,
        TMFT2: "",
        TMFA2: 0,
        TMFT3: "",
        TMFA3: 0,
        TDAM: fare + tax,
        CUTP: "SAR2",
      }),
      formatRecord("BKS39", {
        TRNN: n,
        TDNR: tdnr,
        COTP: "STD",
        CORT: 500,
        COAM: com,
        SPAM: 0,
        TOCA: 0,
      }),
      formatRecord("BKP84", {
        TRNN: n,
        TDNR: tdnr,
        FPTP: "CA",
        FPAM: fare + tax,
        FPAC: "",
        CUTP: "SAR2",
      }),
    ];
    const records = [
      formatRecord("BFH01", {
        SPED: "261103",
        REVN: "231",
        TPST: "PROD",
        PRDA: "261103",
        PRTM: "2359",
        ISOC: "SA",
        RSID: "DPC1",
        FSEQ: 1,
        TACN: "065",
      }),
      ...tx(1, "0651234567890", 40000, 5000, 2000),
      ...tx(2, "0651234567891", 50000, 5000, 2500),
      formatRecord("BCT95", {
        CUTP: "SAR2",
        TCNT: 2,
        TFAR: 90000,
        TTAX: 10000,
        TCOM: 4500,
        TNSG: "+",
        TNET: 95500,
        TSAL: 100000,
        TRFD: 0,
      }),
    ];
    records.push(
      formatRecord("BFT99", { RCNT: records.length + 1, TCNT: 2, CCNT: 1 })
    );
    await ingestHotFile({
      bspCountry: "SA",
      fileName: "hot.txt",
      content: records.join("\n"),
      actorId: ACTOR,
    });
    await importBankStatement({
      bspCountry: "SA",
      currency: "SAR",
      csv: "date,amount,reference\n2026-11-03,955.00,BSP\n",
      actorId: ACTOR,
    });
    const report = await runReconciliation({
      bspCountry: "SA",
      periodStart: "2026-11-03",
      periodEnd: "2026-11-03",
      actorId: ACTOR,
    });
    expect(report.items.map(i => i.classification)).toEqual([
      "matched",
      "matched",
    ]);
    expect(report.items[0].remittanceId).toBe(
      fixture.rows("bsp_bank_remittances")[0].id
    );
    expect(report.gate.status).toBe("complete");
    expect(report.run.status).toBe("complete");
    expect(report.run.completedAt).toBeInstanceOf(Date);
    await expect(
      runReconciliation({
        bspCountry: "SA",
        periodStart: "2026-11-03",
        periodEnd: "2026-11-03",
        actorId: ACTOR,
        settlementPlan: "arc",
      })
    ).rejects.toThrow(/ARC settlement reconciliation is a labelled stub/);
  });

  it("marks matched documents as missing_remittance until the bank credit arrives", async () => {
    await generateRetFile({
      bspCountry: "SA",
      reportingDate: "2026-11-03",
      actorId: ACTOR,
      fareComponents: componentsFor20,
    });
    const { formatRecord } = await import("../services/bsp/dish-records");
    const n = 1;
    const tdnr = "0651234567890";
    const records = [
      formatRecord("BFH01", {
        SPED: "261103",
        REVN: "231",
        TPST: "PROD",
        PRDA: "261103",
        PRTM: "2359",
        ISOC: "SA",
        RSID: "DPC1",
        FSEQ: 1,
        TACN: "065",
      }),
      formatRecord("BCH02", {
        TRNN: n,
        TRNC: "TKTT",
        AGTN: "71234567",
        DAIS: "261103",
        TACN: "065",
        CUTP: "SAR2",
        TRCN: 5,
      }),
      formatRecord("BKT06", {
        TRNN: n,
        TDNR: tdnr,
        CPUI: "FVVV",
        CJCP: "",
        PXNM: "X",
        STAT: "DOM",
        DAIS: "261103",
        AGTN: "71234567",
        RTDN: "",
      }),
      formatRecord("BKS30", {
        TRNN: n,
        TDNR: tdnr,
        COBL: 40000,
        TMFT1: "VAT",
        TMFA1: 5000,
        TMFT2: "",
        TMFA2: 0,
        TMFT3: "",
        TMFA3: 0,
        TDAM: 45000,
        CUTP: "SAR2",
      }),
      formatRecord("BKS39", {
        TRNN: n,
        TDNR: tdnr,
        COTP: "STD",
        CORT: 500,
        COAM: 2000,
        SPAM: 0,
        TOCA: 0,
      }),
      formatRecord("BKP84", {
        TRNN: n,
        TDNR: tdnr,
        FPTP: "CA",
        FPAM: 45000,
        FPAC: "",
        CUTP: "SAR2",
      }),
      formatRecord("BCT95", {
        CUTP: "SAR2",
        TCNT: 1,
        TFAR: 40000,
        TTAX: 5000,
        TCOM: 2000,
        TNSG: "+",
        TNET: 43000,
        TSAL: 45000,
        TRFD: 0,
      }),
    ];
    records.push(
      formatRecord("BFT99", { RCNT: records.length + 1, TCNT: 1, CCNT: 1 })
    );
    await ingestHotFile({
      bspCountry: "SA",
      fileName: "hot.txt",
      content: records.join("\n"),
      actorId: ACTOR,
    });
    const report = await runReconciliation({
      bspCountry: "SA",
      periodStart: "2026-11-03",
      periodEnd: "2026-11-03",
      actorId: ACTOR,
    });
    expect(report.items.map(i => [i.documentNumber, i.classification])).toEqual(
      [
        ["0651234567890", "missing_remittance"],
        ["0651234567891", "missing_in_hot"],
      ]
    );
    expect(report.run.summary).toMatchObject({
      remittanceCovered: false,
      remittedAmount: 0,
      hotNet: 43000,
    });
    expect(report.gate.status).toBe("blocked");
  });
});
