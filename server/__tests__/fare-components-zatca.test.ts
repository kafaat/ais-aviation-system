import { afterEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  buildZatcaPreviewQr,
  composeInitialFareComponents,
  createZatcaInvoiceDraft,
} from "../services/fare-components.service";

const offer = {
  id: "00000000-0000-4000-8000-000000000001",
  flightId: 11,
  tenantId: 3,
  userId: 5,
  channel: "direct" as const,
  cabinClass: "economy" as const,
  payload: {
    version: 1 as const,
    currency: "SAR" as const,
    amountUnit: "minor" as const,
    scope: "airfare" as const,
    passengerTypes: ["adult" as const, "child" as const],
    policy: { name: "direct:v1", fareMultiplier: 1, taxRate: 0 },
    fareLines: [
      {
        type: "adult" as const,
        baseFare: 8000,
        tax: 1200,
        bookingFee: 800,
        total: 10000,
      },
      {
        type: "child" as const,
        baseFare: 6000,
        tax: 900,
        bookingFee: 600,
        total: 7500,
      },
    ],
    baseAmount: 14000,
    taxesAndFees: 3500,
    totalAmount: 17500,
  },
  digest: "digest",
  totalAmount: 17500,
  expiresAt: new Date("2030-01-01"),
  consumedBookingId: null,
  createdAt: new Date("2026-11-03"),
};

afterEach(() => vi.unstubAllEnvs());

describe("passenger and sector fare components", () => {
  it("conserves the invoice and binds each quoted line to its passenger", () => {
    const rows = composeInitialFareComponents({
      bookingId: 9,
      tenantId: 3,
      flightId: 11,
      passengerIds: [21, 22],
      totalAmount: 18000,
      offer,
      source: "retail_offer",
      sourceReference: offer.id,
      ancillaries: [{ amount: 500, code: "ANCILLARY_4" }],
    });
    expect(rows).toHaveLength(7);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(18000);
    expect(
      rows
        .filter(row => row.componentType === "tax")
        .map(row => row.passengerId)
    ).toEqual([21, 22]);
    expect(rows.every(row => row.flightId === 11)).toBe(true);
  });

  it("marks gross-only sources for reconciliation instead of inventing tax", () => {
    const rows = composeInitialFareComponents({
      bookingId: 9,
      tenantId: 3,
      flightId: 11,
      passengerIds: [21],
      totalAmount: 10000,
      source: "price_lock",
      sourceReference: "81",
    });
    expect(rows).toMatchObject([
      {
        componentType: "unclassified",
        code: "GROSS_RECONCILIATION_REQUIRED",
        amount: 10000,
      },
    ]);
  });
});

describe("ZATCA draft boundary", () => {
  it("encodes the five review fields as TLV without claiming Phase 2 signing", () => {
    const payload = buildZatcaPreviewQr({
      sellerName: "Example Airline",
      sellerVatNumber: "300000000000003",
      issueTimestamp: new Date("2026-11-03T10:00:00.000Z"),
      totalAmount: 11500,
      taxAmount: 1500,
    });
    const decoded = Buffer.from(payload, "base64");
    expect(decoded[0]).toBe(1);
    expect(decoded.includes(Buffer.from("Example Airline"))).toBe(true);
    expect(decoded.includes(Buffer.from("115.00"))).toBe(true);
  });

  it("defaults closed and refuses estimated tax classifications", async () => {
    const fixture = transactionMemory({});
    const input = {
      bookingId: 9,
      tenantId: 3,
      invoiceNumber: "AIS-9",
      issueTimestamp: new Date("2026-11-03T10:00:00.000Z"),
      supplyTimestamp: new Date("2026-11-03T10:00:00.000Z"),
      sellerName: "Example Airline",
      sellerVatNumber: "300000000000003",
      components: [
        {
          componentType: "base_fare" as const,
          code: "AIR_FARE",
          amount: 10000,
        },
        {
          componentType: "tax" as const,
          code: "OFFER_TAX_ESTIMATE",
          amount: 1500,
        },
      ],
    };
    await expect(createZatcaInvoiceDraft(fixture.db, input)).rejects.toThrow(
      /disabled/
    );
    vi.stubEnv("AIS_ZATCA_DRAFT_MODE", "true");
    await expect(createZatcaInvoiceDraft(fixture.db, input)).rejects.toThrow(
      /Approved tax classifications/
    );
  });

  it.each([null, "AIRPORT_LEVY", "OFFER_TAX_ESTIMATE"])(
    "rejects missing VAT evidence and refuses to count %s as VAT",
    async code => {
      vi.stubEnv("AIS_ZATCA_DRAFT_MODE", "true");
      const fixture = transactionMemory({});
      const input = {
        bookingId: 9,
        tenantId: 3,
        invoiceNumber: "DRAFT",
        issueTimestamp: new Date(),
        supplyTimestamp: new Date(),
        sellerName: "Synthetic",
        sellerVatNumber: "300000000000003",
      };
      const base = {
        componentType: "base_fare" as const,
        code: "AIR_FARE",
        amount: 1000,
      };
      await expect(
        createZatcaInvoiceDraft(fixture.db, { ...input, components: [base] })
      ).rejects.toThrow(/tax classifications/);
      await expect(
        createZatcaInvoiceDraft(fixture.db, {
          ...input,
          components: [
            base,
            { componentType: "tax", code: "VAT-S", amount: 150 },
            { componentType: "tax", code, amount: 10 },
          ],
        })
      ).rejects.toThrow(/tax classifications/);
      expect(fixture.rows("zatca_invoice_drafts")).toHaveLength(0);
    }
  );

  it("persists an auditable draft while leaving EGS reporting pending", async () => {
    vi.stubEnv("AIS_ZATCA_DRAFT_MODE", "true");
    const fixture = transactionMemory({});
    const draft = await createZatcaInvoiceDraft(fixture.db, {
      bookingId: 9,
      tenantId: 3,
      invoiceNumber: "AIS-9",
      issueTimestamp: new Date("2026-11-03T10:00:00.000Z"),
      supplyTimestamp: new Date("2026-11-03T10:00:00.000Z"),
      sellerName: "Example Airline",
      sellerVatNumber: "300000000000003",
      components: [
        { componentType: "base_fare", code: "AIR_FARE", amount: 10000 },
        { componentType: "tax", code: "VAT-S", amount: 1500 },
      ],
    });
    expect(draft).toMatchObject({
      taxableAmount: 10000,
      taxAmount: 1500,
      totalAmount: 11500,
      status: "draft",
      egsAcceptanceEvidenceId: null,
    });
    expect(fixture.rows("zatca_invoice_drafts")).toHaveLength(1);
  });
});
