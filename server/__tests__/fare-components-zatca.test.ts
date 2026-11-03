import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  bookings,
  bookingSegments,
  passengers,
  paymentReceipts,
} from "../../drizzle/schema";

const boundary = vi.hoisted(() => ({
  db: null as any,
  getFlight: vi.fn(),
  reference: 0,
}));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getFlightById: boundary.getFlight,
  generateBookingReference: () => `Z${++boundary.reference}`,
}));
vi.mock("../services/metrics.service", () => ({
  trackBookingStarted: vi.fn(),
  trackBookingCancelled: vi.fn(),
}));
vi.mock("../services/flights.service", () => ({
  calculateFlightPrice: async () => ({
    price: 10000,
    fareLines: [
      {
        type: "adult",
        baseFare: 8000,
        tax: 1200,
        bookingFee: 800,
        total: 10000,
      },
    ],
  }),
}));

import { createBooking } from "../services/bookings.service";
import { confirmFundedBooking } from "../services/booking-settlement.service";
import { settleVerifiedRefund } from "../services/payment-settlement.service";
import {
  buildSaleComponents,
  ensureSaleFareComponents,
  listFareComponents,
  recordExchangeComponents,
  recordReversalComponents,
  sumComponents,
  vatOfComponents,
  FareComponentsUnbalancedError,
} from "../services/fare-components.service";
import {
  resolveSegmentVat,
  splitGross,
  normalizeCountry,
} from "../services/tax-rules";
import {
  encodeZatcaQr,
  decodeZatcaQr,
  GENESIS_PREVIOUS_INVOICE_HASH,
  hashInvoiceDocument,
  issueTaxDocument,
  resolveZatcaSeller,
  submitTaxInvoice,
  TaxInvoiceConfigurationError,
  verifyInvoiceChain,
} from "../services/tax-invoice.service";
import {
  issueRefundCreditNote,
  issueServicingTaxDocuments,
} from "../services/tax-credit-note.service";

let fixture: ReturnType<typeof transactionMemory>;
const seller = {
  ZATCA_SELLER_NAME: "Test Carrier LLC",
  ZATCA_VAT_NUMBER: "310122393500003",
  ZATCA_ISSUING_UNIT: "unit-a",
};
const saved: Record<string, string | undefined> = {};
const domesticInput = {
  userId: 1,
  tenantId: 3,
  flightId: 11,
  cabinClass: "economy" as const,
  sessionId: "zatca-1",
  passengers: [{ type: "adult" as const, firstName: "Ali", lastName: "Saleh" }],
};

beforeEach(() => {
  for (const key of Object.keys(seller)) {
    saved[key] = process.env[key];
    process.env[key] = seller[key as keyof typeof seller];
  }
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    users: [{ id: 1, tenantId: 3 }],
    airports: [
      { id: 1, code: "RUH", country: "Saudi Arabia" },
      { id: 2, code: "JED", country: "SA" },
      { id: 3, code: "DXB", country: "AE" },
    ],
    flights: [
      { id: 11, originId: 1, destinationId: 2 },
      { id: 12, originId: 1, destinationId: 3 },
    ].map(f => ({
      ...f,
      tenantId: 3,
      airlineId: 1,
      status: "scheduled",
      economyAvailable: 5,
      businessAvailable: 5,
      economyPrice: 8000,
      businessPrice: 16000,
      departureTime: new Date("2030-01-01T10:00:00Z"),
      arrivalTime: new Date("2030-01-01T12:00:00Z"),
    })),
    ancillary_services: [
      { id: 1, available: true, currency: "SAR", price: 500 },
    ],
  });
  boundary.db = fixture.db;
  boundary.getFlight.mockImplementation(async (id: number) =>
    fixture.rows("flights").find(f => f.id === id)
  );
});
afterEach(() => {
  for (const key of Object.keys(seller)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const components = (bookingId: number) =>
  fixture
    .rows("booking_fare_components")
    .filter(c => c.bookingId === bookingId);
const booking = (id: number) => fixture.rows("bookings").find(b => b.id === id);
async function settle(id: number, pi = `pi_${id}`) {
  await fixture.db.transaction((tx: any) =>
    confirmFundedBooking(tx, booking(id), pi)
  );
}

describe("tax rules by itinerary", () => {
  it("applies 15% to domestic KSA segments and zero-rates international ones", () => {
    expect(
      resolveSegmentVat({
        originCountry: "Saudi Arabia",
        destinationCountry: "SA",
      })
    ).toMatchObject({
      applicability: "domestic_standard",
      jurisdiction: "SA",
      rateBasisPoints: 1500,
      confirmed: false,
    });
    expect(
      resolveSegmentVat({ originCountry: "SA", destinationCountry: "AE" })
    ).toMatchObject({
      applicability: "international_zero_rated",
      jurisdiction: "SA",
      rateBasisPoints: 0,
    });
    expect(
      resolveSegmentVat({ originCountry: "AE", destinationCountry: "GB" })
    ).toMatchObject({ applicability: "out_of_scope", rateBasisPoints: 0 });
    expect(
      resolveSegmentVat({ originCountry: null, destinationCountry: "SA" })
    ).toMatchObject({ applicability: "unresolved", jurisdiction: null });
    expect(normalizeCountry("Test")).toBeNull();
    expect(splitGross(11500, { rateBasisPoints: 1500 })).toEqual({
      net: 10000,
      vat: 1500,
    });
    expect(splitGross(11500, { rateBasisPoints: 0 })).toEqual({
      net: 11500,
      vat: 0,
    });
  });
  it("builds zero VAT rows for an international leg and 15% rows for a domestic one", () => {
    const rules = new Map([
      [
        11,
        resolveSegmentVat({ originCountry: "SA", destinationCountry: "SA" }),
      ],
      [
        12,
        resolveSegmentVat({ originCountry: "SA", destinationCountry: "AE" }),
      ],
    ]);
    const base = {
      booking: { id: 1, tenantId: 3 },
      passengers: [{ id: 5, type: "adult" }],
      reference: "test",
    };
    const international = buildSaleComponents(
      { ...base, legs: [{ flightId: 12, amount: 10000 }] },
      rules
    );
    expect(international.map(r => [r.code, r.amount])).toEqual([
      ["FARE", 10000],
      ["VAT", 0],
    ]);
    const domestic = buildSaleComponents(
      {
        ...base,
        legs: [{ flightId: 11, amount: 10000 }],
        ancillaries: [{ amount: 1150 }],
      },
      rules
    );
    expect(domestic.map(r => [r.code, r.amount, r.rateBasisPoints])).toEqual([
      ["FARE", 8696, null],
      ["VAT", 1304, 1500],
      ["ANC", 1000, null],
      ["VAT", 150, 1500],
    ]);
    expect(sumComponents(domestic)).toBe(11150);
  });
});

describe("fare component ledger", () => {
  it("persists quoted lines at booking creation and keeps the sum equal to totalAmount", async () => {
    const created = await createBooking({
      ...domesticInput,
      ancillaries: [
        { ancillaryServiceId: 1, quantity: 1, unitPrice: 500, totalPrice: 500 },
      ],
    });
    expect(created.totalAmount).toBe(10500);
    const rows = components(created.bookingId);
    expect(sumComponents(rows)).toBe(booking(created.bookingId).totalAmount);
    // 800 booking fee is VAT inclusive under the domestic rule: 696 net + 104 VAT.
    expect(rows.map(r => [r.code, r.amount, r.basis])).toEqual([
      ["FARE", 8000, "fare_line"],
      ["VAT", 1304, "fare_line"],
      ["BKF", 696, "fare_line"],
      ["ANC", 435, "derived"],
      ["VAT", 65, "derived"],
    ]);
    expect(rows.filter(r => r.code === "VAT")).toEqual(
      rows
        .filter(r => r.code === "VAT")
        .map(r => ({ ...r, jurisdiction: "SA", rateBasisPoints: 1500 }))
    );
    expect(rows[0].passengerId).toBe(fixture.rows("passengers")[0].id);
    expect(rows[3].passengerId).toBeNull();
  });
  it("derives a booking-level decomposition at settlement for bookings created without the hook", async () => {
    await fixture.db.insert(bookings).values({
      id: 40,
      userId: 1,
      tenantId: 3,
      flightId: 11,
      bookingReference: "LEGACY",
      status: "pending",
      paymentStatus: "pending",
      totalAmount: 23000,
      cabinClass: "economy",
      numberOfPassengers: 2,
      seatsReserved: false,
    });
    await fixture.db.insert(passengers).values([
      { id: 71, bookingId: 40, type: "adult" },
      { id: 72, bookingId: 40, type: "child" },
    ]);
    await fixture.db.insert(bookingSegments).values([
      {
        id: 1,
        bookingId: 40,
        flightId: 11,
        segmentOrder: 1,
        segmentAmount: 11500,
        status: "pending",
      },
      {
        id: 2,
        bookingId: 40,
        flightId: 12,
        segmentOrder: 2,
        segmentAmount: 11500,
        status: "pending",
      },
    ]);
    await settle(40);
    const rows = components(40);
    expect(sumComponents(rows)).toBe(23000);
    expect(vatOfComponents(rows)).toBe(1500); // only the domestic leg carries VAT
    expect(
      rows.filter(r => r.flightId === 12 && r.code === "VAT").map(r => r.amount)
    ).toEqual([0, 0]);
    expect(new Set(rows.map(r => r.passengerId))).toEqual(new Set([71, 72]));
    expect(booking(40)).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
    });
  });
  it("rejects settlement when the ledger disagrees with the invoice total", async () => {
    const created = await createBooking(domesticInput);
    fixture
      .rows("bookings")
      .find(b => b.id === created.bookingId)!.totalAmount = 9999;
    await expect(settle(created.bookingId)).rejects.toBeInstanceOf(
      FareComponentsUnbalancedError
    );
    expect(fixture.rows("tax_invoices")).toEqual([]);
  });
});

describe("ZATCA simplified documents", () => {
  it("encodes the QR TLV exactly as the ZATCA sample vector", () => {
    // Bytes: tag(1) len(1) value: 01 0C "Bobs Records" | 02 0F "310122393500003"
    // | 03 14 "2022-04-25T15:30:00Z" | 04 07 "1000.00" | 05 06 "150.00".
    const expectedHex =
      "010c" +
      Buffer.from("Bobs Records").toString("hex") +
      "020f" +
      Buffer.from("310122393500003").toString("hex") +
      "0314" +
      Buffer.from("2022-04-25T15:30:00Z").toString("hex") +
      "0407" +
      Buffer.from("1000.00").toString("hex") +
      "0506" +
      Buffer.from("150.00").toString("hex");
    const payload = encodeZatcaQr({
      sellerName: "Bobs Records",
      vatNumber: "310122393500003",
      timestamp: "2022-04-25T15:30:00Z",
      totalWithVat: "1000.00",
      vatTotal: "150.00",
    });
    expect(Buffer.from(payload, "base64").toString("hex")).toBe(expectedHex);
    expect(payload).toBe(
      "AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA=="
    );
    expect([...decodeZatcaQr(payload)]).toEqual([
      [1, "Bobs Records"],
      [2, "310122393500003"],
      [3, "2022-04-25T15:30:00Z"],
      [4, "1000.00"],
      [5, "150.00"],
    ]);
    expect(
      encodeZatcaQr({
        ...{ sellerName: "x", vatNumber: "3", timestamp: "t" },
        totalWithVat: 100000,
        vatTotal: 15000,
      })
    ).toBe(
      encodeZatcaQr({
        sellerName: "x",
        vatNumber: "3",
        timestamp: "t",
        totalWithVat: "1000.00",
        vatTotal: "150.00",
      })
    );
  });
  it("starts the chain from the hash of '0' and links every document to its predecessor", async () => {
    expect(GENESIS_PREVIOUS_INVOICE_HASH).toBe(
      Buffer.from(createHash("sha256").update("0").digest("hex")).toString(
        "base64"
      )
    );
    const first = await createBooking(domesticInput);
    await settle(first.bookingId);
    const second = await createBooking({
      ...domesticInput,
      sessionId: "zatca-2",
    });
    await settle(second.bookingId);
    const [a, b] = fixture.rows("tax_invoices");
    expect(a).toMatchObject({
      sequence: 1,
      invoiceNumber: "unit-a-00000001",
      documentType: "simplified_invoice",
      previousInvoiceHash: GENESIS_PREVIOUS_INVOICE_HASH,
      totalIncludingVat: 10000,
      vatAmount: 1304,
      totalExcludingVat: 8696,
      status: "generated",
      sellerVatNumber: "310122393500003",
    });
    expect(b).toMatchObject({
      sequence: 2,
      previousInvoiceHash: a.invoiceHash,
    });
    expect(a.invoiceHash).toBe(hashInvoiceDocument(a.document));
    expect([...decodeZatcaQr(a.qrPayload)]).toEqual([
      [1, "Test Carrier LLC"],
      [2, "310122393500003"],
      [3, a.issuedAt.toISOString().replace(/\.\d{3}Z$/, "Z")],
      [4, "100.00"],
      [5, "13.04"],
    ]);
    expect(await verifyInvoiceChain(fixture.db, "unit-a")).toEqual({
      issuingUnit: "unit-a",
      count: 2,
      valid: true,
      brokenAt: null,
    });
    a.document.totals.vat = 0;
    expect(await verifyInvoiceChain(fixture.db, "unit-a")).toMatchObject({
      valid: false,
      brokenAt: "unit-a-00000001",
    });
    expect(
      fixture.rows("outbox").filter(e => e.eventType === "tax_invoice.issued")
    ).toHaveLength(2);
    // Replaying settlement for the same payment intent (natural key
    // booking + document type + reference) issues no second invoice, allocates
    // no ICV and leaves the chain intact.
    a.document.totals.vat = 1304;
    booking(first.bookingId).status = "pending";
    booking(first.bookingId).paymentStatus = "pending";
    booking(first.bookingId).seatsReserved = false;
    await settle(first.bookingId);
    expect(fixture.rows("tax_invoices").map(i => i.invoiceNumber)).toEqual([
      "unit-a-00000001",
      "unit-a-00000002",
    ]);
    expect(
      fixture.rows("tax_invoices").filter(i => i.bookingId === first.bookingId)
    ).toHaveLength(1);
    expect(await verifyInvoiceChain(fixture.db, "unit-a")).toMatchObject({
      valid: true,
      count: 2,
    });
    expect(
      fixture.rows("outbox").filter(e => e.eventType === "tax_invoice.issued")
    ).toHaveLength(2);
  });
  it("fails closed in production without a seller identity and skips outside it", async () => {
    const unconfigured = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    expect(resolveZatcaSeller(unconfigured)).toMatchObject({
      configured: false,
    });
    expect(
      resolveZatcaSeller({ ...seller, ZATCA_VAT_NUMBER: "123456789012345" })
    ).toMatchObject({ configured: false });
    const target = {
      booking: { id: 1, tenantId: 3, bookingReference: "X" },
      documentType: "simplified_invoice" as const,
      totalIncludingVat: 1000,
      vatAmount: 130,
      reference: "t",
    };
    await expect(
      issueTaxDocument(fixture.db, { ...target, env: unconfigured })
    ).rejects.toBeInstanceOf(TaxInvoiceConfigurationError);
    expect(
      await issueTaxDocument(fixture.db, {
        ...target,
        env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      })
    ).toBeNull();
  });
  it("records that submission needs operator credentials instead of fabricating a report", async () => {
    const created = await createBooking(domesticInput);
    await settle(created.bookingId);
    const result = await submitTaxInvoice(fixture.rows("tax_invoices")[0].id);
    expect(result.status).toBe("generated");
    expect(result.message).toMatch(/CSID/);
    expect(fixture.rows("tax_invoices")[0].submissionError).toMatch(
      /no submission/
    );
  });
});

describe("servicing and refunds", () => {
  it("reverses components at the charged rates and issues a credit note on refund", async () => {
    const created = await createBooking(domesticInput);
    await settle(created.bookingId, "pi_refund");
    const paid = booking(created.bookingId);
    await fixture.db.insert(paymentReceipts).values({
      paymentIntentId: "pi_refund",
      bookingId: paid.id,
      targetId: paid.id,
      userId: 1,
      kind: "booking",
      amount: 10000,
      refundedAmount: 0,
      currency: "SAR",
      settlementStatus: "applied",
    });
    await fixture.db.transaction((tx: any) =>
      settleVerifiedRefund(tx, {
        paymentIntentId: "pi_refund",
        chargeId: "ch_1",
        amount: 10000,
        amountRefunded: 5000,
        currency: "sar",
        eventId: "evt_refund_1",
        refundId: "re_1",
      })
    );
    const rows = components(paid.id);
    const reversal = rows.filter(r => r.entryKind === "reversal");
    expect(sumComponents(reversal)).toBe(-5000);
    expect(reversal.map(r => [r.code, r.amount])).toEqual([
      ["FARE", -4000],
      ["VAT", -652],
      ["BKF", -348],
    ]);
    expect(reversal.every(r => r.reference === "refund:pi_refund:re_1")).toBe(
      true
    );
    expect(sumComponents(rows)).toBe(5000);
    const [invoice, creditNote] = fixture.rows("tax_invoices");
    expect(creditNote).toMatchObject({
      documentType: "simplified_credit_note",
      referencedInvoiceId: invoice.id,
      sequence: 2,
      previousInvoiceHash: invoice.invoiceHash,
      totalIncludingVat: 5000,
      vatAmount: 652,
    });
    // The remainder can be refunded once; nothing beyond the net ledger.
    await issueRefundCreditNote(fixture.db, paid, 5000, "refund:rest");
    expect(sumComponents(components(paid.id))).toBe(0);
    await expect(
      recordReversalComponents(fixture.db, paid, 1, "refund:over")
    ).rejects.toBeInstanceOf(FareComponentsUnbalancedError);
  });
  it("cancels and reissues on itinerary exchange so the ledger follows the new total", async () => {
    const created = await createBooking(domesticInput);
    await settle(created.bookingId);
    const paid = booking(created.bookingId);
    const pax = fixture.rows("passengers").filter(p => p.bookingId === paid.id);
    const ledger = await recordExchangeComponents(fixture.db, paid, {
      passengers: pax.map(p => ({ id: p.id, type: p.type })),
      legs: [
        { flightId: 12, amount: 7000, fareLines: null }, // international replacement
      ],
      modificationFee: 1000,
      newAmount: 8000,
      reference: "modification:9",
    });
    expect(sumComponents(ledger.reversal)).toBe(-10000);
    expect(sumComponents(ledger.sale)).toBe(8000);
    expect(ledger.sale.map(r => [r.code, r.amount, r.entryKind])).toEqual([
      ["FARE", 7000, "adjustment"],
      ["VAT", 0, "adjustment"],
      ["MOD", 1000, "adjustment"],
      ["VAT", 0, "adjustment"],
    ]);
    expect(sumComponents(components(paid.id))).toBe(8000);
    const documents = await issueServicingTaxDocuments(
      fixture.db,
      paid,
      ledger,
      "modification:9"
    );
    expect(documents.creditNote).toMatchObject({
      documentType: "simplified_credit_note",
      totalIncludingVat: 10000,
      vatAmount: 1304,
    });
    expect(documents.invoice).toMatchObject({
      documentType: "simplified_invoice",
      totalIncludingVat: 8000,
      vatAmount: 0,
      sequence: 3,
      previousInvoiceHash: documents.creditNote!.invoiceHash,
    });
    expect(await ensureSaleFareComponents(fixture.db, paid)).toHaveLength(
      (await listFareComponents(fixture.db, paid.id)).length
    );
  });
});
