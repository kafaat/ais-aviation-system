import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  taxInvoices,
  type Booking,
  type TaxInvoice,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { getDb } from "../db";
import { recordEvent } from "./outbox.service";

/**
 * ZATCA phase 2 simplified (B2C) tax documents.
 *
 * Generates the local record of a simplified tax invoice or credit note per the
 * Fatoora technical specification: an issuing-unit sequence (ICV), a UUID, the
 * QR TLV payload (tags 1-5) and a SHA-256 hash chain (PIH). Reporting to the
 * Fatoora API is behind `FatooraAdapter`; the shipped adapter is a mock because
 * reporting needs the operator's compliance CSID from onboarding. Nothing here
 * invents a seller identity: the VAT number and legal name come from
 * configuration and production fails closed when they are absent.
 *
 * Spec references (operator to confirm against the current revision):
 * - E-invoicing technical specifications / QR code specification:
 *   https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/default.aspx
 * - Wave 25 integration deadline announcement:
 *   https://www.zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx
 */

export class TaxInvoiceConfigurationError extends Error {}

export type SellerConfig =
  | {
      configured: true;
      sellerName: string;
      vatNumber: string;
      issuingUnit: string;
    }
  | { configured: false; reason: string };

/** KSA VAT registration numbers are 15 digits starting and ending with 3. */
export const VAT_NUMBER_PATTERN = /^3\d{13}3$/;

export function resolveZatcaSeller(
  env: NodeJS.ProcessEnv = process.env
): SellerConfig {
  const sellerName = env.ZATCA_SELLER_NAME?.trim() ?? "";
  const vatNumber = env.ZATCA_VAT_NUMBER?.trim() ?? "";
  const production = env.NODE_ENV === "production";
  const issuingUnit =
    env.ZATCA_ISSUING_UNIT?.trim() || (production ? "" : "dev-unit");
  const missing = [
    !sellerName && "ZATCA_SELLER_NAME",
    !vatNumber && "ZATCA_VAT_NUMBER",
    !issuingUnit && "ZATCA_ISSUING_UNIT",
  ].filter((v): v is string => Boolean(v));
  if (missing.length)
    return {
      configured: false,
      reason: `Missing ZATCA seller configuration: ${missing.join(", ")}`,
    };
  if (!VAT_NUMBER_PATTERN.test(vatNumber))
    return {
      configured: false,
      reason: "ZATCA_VAT_NUMBER must be 15 digits starting and ending with 3",
    };
  if (sellerName.length > 255 || Buffer.byteLength(sellerName) > 255)
    return {
      configured: false,
      reason: "ZATCA_SELLER_NAME exceeds 255 bytes",
    };
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(issuingUnit))
    return {
      configured: false,
      reason: "ZATCA_ISSUING_UNIT must be 1-64 characters of [A-Za-z0-9._-]",
    };
  return { configured: true, sellerName, vatNumber, issuingUnit };
}

/** Minor units -> "1234.56" as the QR tags expect. */
export function formatMinor(amount: number) {
  if (!Number.isSafeInteger(amount)) throw new Error("Amount must be integer");
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** ISO 8601 to the second, as the ZATCA samples encode tag 3. */
export function qrTimestamp(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface QrFields {
  sellerName: string;
  vatNumber: string;
  /** Tag 3; a Date is encoded with `qrTimestamp`. */
  timestamp: Date | string;
  /** Tag 4, decimal string or minor units. */
  totalWithVat: string | number;
  /** Tag 5, decimal string or minor units. */
  vatTotal: string | number;
}

function tlv(tag: number, value: string) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > 255)
    throw new Error(`QR tag ${tag} exceeds the one-byte TLV length`);
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
}

/** Tags 1-5 of the ZATCA QR TLV, base64. Tags 6-9 (hash, ECDSA signature,
 * public key, stamp) need the unit's cryptographic stamp from onboarding. */
export function encodeZatcaQr(fields: QrFields) {
  const asDecimal = (v: string | number) =>
    typeof v === "number" ? formatMinor(v) : v;
  return Buffer.concat([
    tlv(1, fields.sellerName),
    tlv(2, fields.vatNumber),
    tlv(
      3,
      fields.timestamp instanceof Date
        ? qrTimestamp(fields.timestamp)
        : fields.timestamp
    ),
    tlv(4, asDecimal(fields.totalWithVat)),
    tlv(5, asDecimal(fields.vatTotal)),
  ]).toString("base64");
}

export function decodeZatcaQr(payload: string) {
  const bytes = Buffer.from(payload, "base64");
  const tags = new Map<number, string>();
  let offset = 0;
  while (offset < bytes.length) {
    const tag = bytes[offset];
    const length = bytes[offset + 1];
    if (length === undefined || offset + 2 + length > bytes.length)
      throw new Error("Malformed TLV payload");
    tags.set(tag, bytes.subarray(offset + 2, offset + 2 + length).toString());
    offset += 2 + length;
  }
  return tags;
}

/** First invoice of a chain carries base64 of the hex SHA-256 of "0". */
export const GENESIS_PREVIOUS_INVOICE_HASH = Buffer.from(
  createHash("sha256").update("0").digest("hex")
).toString("base64");

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map(key => [key, canonical((value as Record<string, unknown>)[key])])
    );
  return value instanceof Date ? value.toISOString() : value;
}

/** Base64 SHA-256 of the canonical document. Fatoora hashes the canonical UBL
 * XML; this hashes the canonical JSON that will be rendered into it. */
export function hashInvoiceDocument(document: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(document)))
    .digest("base64");
}

export type TaxDocumentType = TaxInvoice["documentType"];

export interface IssueTaxDocumentInput {
  booking: Pick<Booking, "id" | "tenantId" | "bookingReference">;
  documentType: TaxDocumentType;
  /** Positive minor units, VAT inclusive. */
  totalIncludingVat: number;
  vatAmount: number;
  reference: string;
  referencedInvoiceId?: number | null;
  lines?: Array<Record<string, unknown>>;
  issuedAt?: Date;
  env?: NodeJS.ProcessEnv;
}

/** One document per (booking, type, reference). Returns null outside production
 * when the seller is not configured; production throws so settlement stays
 * closed until the operator supplies the registration. */
export async function issueTaxDocument(
  tx: SettlementTx,
  input: IssueTaxDocumentInput
): Promise<TaxInvoice | null> {
  const env = input.env ?? process.env;
  const seller = resolveZatcaSeller(env);
  if (!seller.configured) {
    if (env.NODE_ENV === "production")
      throw new TaxInvoiceConfigurationError(seller.reason);
    return null;
  }
  if (
    !Number.isSafeInteger(input.totalIncludingVat) ||
    input.totalIncludingVat <= 0 ||
    !Number.isSafeInteger(input.vatAmount) ||
    input.vatAmount < 0 ||
    input.vatAmount > input.totalIncludingVat
  )
    throw new Error("Tax document totals are invalid");
  const [existing] = await tx
    .select()
    .from(taxInvoices)
    .where(
      and(
        eq(taxInvoices.bookingId, input.booking.id),
        eq(taxInvoices.documentType, input.documentType),
        eq(taxInvoices.reference, input.reference)
      )
    )
    .limit(1);
  if (existing) return existing;
  if (input.documentType === "simplified_credit_note") {
    if (!input.referencedInvoiceId)
      throw new Error("A credit note must reference the invoice it corrects");
    const [original] = await tx
      .select()
      .from(taxInvoices)
      .where(eq(taxInvoices.id, input.referencedInvoiceId))
      .limit(1);
    if (!original || original.bookingId !== input.booking.id)
      throw new Error("Referenced invoice does not belong to this booking");
  }
  // Serialise the unit's chain: the previous document fixes both ICV and PIH.
  const [previous] = await tx
    .select()
    .from(taxInvoices)
    .where(eq(taxInvoices.issuingUnit, seller.issuingUnit))
    .orderBy(desc(taxInvoices.sequence))
    .limit(1)
    .for("update");
  const sequence = (previous?.sequence ?? 0) + 1;
  const previousInvoiceHash =
    previous?.invoiceHash ?? GENESIS_PREVIOUS_INVOICE_HASH;
  const issuedAt = new Date(
    Math.floor((input.issuedAt ?? new Date()).getTime() / 1000) * 1000
  );
  const uuid = randomUUID();
  const invoiceNumber = `${seller.issuingUnit}-${String(sequence).padStart(8, "0")}`;
  const totalExcludingVat = input.totalIncludingVat - input.vatAmount;
  const document = {
    profile: "reporting:1.0",
    uuid,
    invoiceNumber,
    issuingUnit: seller.issuingUnit,
    sequence,
    documentType: input.documentType,
    typeCode: input.documentType === "simplified_invoice" ? "388" : "381",
    subtype: "0200000", // simplified (B2C)
    issuedAt: issuedAt.toISOString(),
    seller: { name: seller.sellerName, vatNumber: seller.vatNumber },
    buyer: null, // simplified invoices do not require buyer identification
    bookingReference: input.booking.bookingReference,
    referencedInvoiceId: input.referencedInvoiceId ?? null,
    currency: "SAR",
    totals: {
      excludingVat: totalExcludingVat,
      vat: input.vatAmount,
      includingVat: input.totalIncludingVat,
    },
    lines: input.lines ?? [],
    previousInvoiceHash,
  };
  const invoiceHash = hashInvoiceDocument(document);
  const qrPayload = encodeZatcaQr({
    sellerName: seller.sellerName,
    vatNumber: seller.vatNumber,
    timestamp: issuedAt,
    totalWithVat: input.totalIncludingVat,
    vatTotal: input.vatAmount,
  });
  const row = {
    uuid,
    issuingUnit: seller.issuingUnit,
    sequence,
    invoiceNumber,
    bookingId: input.booking.id,
    tenantId: input.booking.tenantId,
    documentType: input.documentType,
    referencedInvoiceId: input.referencedInvoiceId ?? null,
    sellerName: seller.sellerName,
    sellerVatNumber: seller.vatNumber,
    issuedAt,
    currency: "SAR",
    totalExcludingVat,
    vatAmount: input.vatAmount,
    totalIncludingVat: input.totalIncludingVat,
    qrPayload,
    invoiceHash,
    previousInvoiceHash,
    document,
    status: "generated" as const,
    reference: input.reference,
  };
  const [inserted] = await tx.insert(taxInvoices).values(row);
  const id = Number(inserted.insertId);
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: input.booking.id,
    tenantId: input.booking.tenantId,
    eventType: "tax_invoice.issued",
    payload: {
      invoiceId: id,
      invoiceNumber,
      documentType: input.documentType,
      bookingId: input.booking.id,
      totalIncludingVat: input.totalIncludingVat,
      vatAmount: input.vatAmount,
      currency: "SAR",
      reporting: "pending_operator_csid",
    },
  });
  return {
    ...row,
    id,
    submissionReference: null,
    submissionError: null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
}

/** Latest simplified invoice for a booking, for the e-ticket QR. */
export async function latestTaxInvoice(tx: SettlementTx, bookingId: number) {
  const [row] = await tx
    .select()
    .from(taxInvoices)
    .where(
      and(
        eq(taxInvoices.bookingId, bookingId),
        eq(taxInvoices.documentType, "simplified_invoice")
      )
    )
    .orderBy(desc(taxInvoices.sequence))
    .limit(1);
  return row ?? null;
}

/** Recompute every hash in the unit's chain and check the PIH links. */
export async function verifyInvoiceChain(
  db: SettlementTx,
  issuingUnit: string
) {
  const rows = await db
    .select()
    .from(taxInvoices)
    .where(eq(taxInvoices.issuingUnit, issuingUnit))
    .orderBy(asc(taxInvoices.sequence));
  let expectedPrevious = GENESIS_PREVIOUS_INVOICE_HASH;
  for (const [index, row] of rows.entries()) {
    const recomputed = hashInvoiceDocument(
      row.document as Record<string, unknown>
    );
    if (
      row.sequence !== index + 1 ||
      row.previousInvoiceHash !== expectedPrevious ||
      row.invoiceHash !== recomputed
    )
      return {
        issuingUnit,
        count: rows.length,
        valid: false,
        brokenAt: row.invoiceNumber,
      };
    expectedPrevious = row.invoiceHash;
  }
  return { issuingUnit, count: rows.length, valid: true, brokenAt: null };
}

export interface FatooraAdapter {
  /** Report a simplified document (reporting API); clearance is for standard invoices. */
  report(
    invoice: TaxInvoice
  ): Promise<
    | { outcome: "reported" | "cleared"; reference: string }
    | { outcome: "rejected"; error: string }
    | { outcome: "not_submitted"; error: string }
  >;
}

/** No credentials are shipped. Submission needs the operator's compliance and
 * production CSIDs issued by ZATCA onboarding for the issuing unit. */
export const mockFatooraAdapter: FatooraAdapter = {
  report() {
    return Promise.resolve({
      outcome: "not_submitted",
      error:
        "Fatoora reporting requires operator CSID credentials from ZATCA onboarding; no submission was attempted",
    } as const);
  },
};

export function submitTaxInvoice(
  invoiceId: number,
  adapter: FatooraAdapter = mockFatooraAdapter
) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [invoice] = await tx
      .select()
      .from(taxInvoices)
      .where(eq(taxInvoices.id, invoiceId))
      .limit(1)
      .for("update");
    if (!invoice) throw new Error("Tax invoice not found");
    if (invoice.status === "reported" || invoice.status === "cleared")
      return { invoiceId, status: invoice.status, message: null };
    const result = await adapter.report(invoice);
    const status: TaxInvoice["status"] =
      result.outcome === "reported" || result.outcome === "cleared"
        ? result.outcome
        : result.outcome === "rejected"
          ? "failed"
          : invoice.status;
    const message = "error" in result ? result.error : null;
    await tx
      .update(taxInvoices)
      .set({
        status,
        submissionReference:
          result.outcome === "reported" || result.outcome === "cleared"
            ? result.reference
            : invoice.submissionReference,
        submissionError: message,
        updatedAt: new Date(),
      })
      .where(eq(taxInvoices.id, invoiceId));
    return { invoiceId, status, message };
  });
}

export function listTaxInvoices(input: {
  bookingId?: number;
  status?: TaxInvoice["status"];
  tenantId?: number | null;
  limit?: number;
}) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const predicates = [
    input.bookingId == null
      ? undefined
      : eq(taxInvoices.bookingId, input.bookingId),
    input.status == null ? undefined : eq(taxInvoices.status, input.status),
    input.tenantId == null
      ? undefined
      : eq(taxInvoices.tenantId, input.tenantId),
  ].filter((p): p is NonNullable<typeof p> => p !== undefined);
  return db
    .select()
    .from(taxInvoices)
    .where(predicates.length ? and(...predicates) : undefined)
    .orderBy(desc(taxInvoices.id))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
}

export async function getTaxInvoice(id: number, tenantId?: number | null) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(taxInvoices)
    .where(eq(taxInvoices.id, id))
    .limit(1);
  if (!row || (tenantId != null && row.tenantId !== tenantId)) return null;
  return row;
}
