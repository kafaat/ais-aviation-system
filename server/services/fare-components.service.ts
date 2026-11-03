import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookings,
  bookingFareComponents,
  zatcaInvoiceDrafts,
  type InsertBookingFareComponent,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import {
  retailOfferPayloadSchema,
  type RetailOffer,
  type OfferPayload,
} from "./retail-offer.service";

type ComponentSource = InsertBookingFareComponent["source"];

export type InitialFareComponentInput = {
  bookingId: number;
  tenantId: number | null;
  flightId: number;
  passengerIds: number[];
  totalAmount: number;
  offer?: RetailOffer;
  sectorQuote?: Pick<OfferPayload, "fareLines"> & { policy: { name: string } };
  bookingSegmentId?: number;
  source: ComponentSource;
  sourceReference?: string;
  ancillaries?: Array<{ amount: number; code?: string }>;
};

export function composeInitialFareComponents(
  input: InitialFareComponentInput
): InsertBookingFareComponent[] {
  const ancillaryTotal = (input.ancillaries ?? []).reduce(
    (sum, line) => sum + line.amount,
    0
  );
  if (
    !Number.isSafeInteger(input.totalAmount) ||
    input.totalAmount < 0 ||
    !Number.isSafeInteger(ancillaryTotal) ||
    ancillaryTotal < 0 ||
    ancillaryTotal > input.totalAmount
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Invoice component amounts require reconciliation",
    });

  const common = {
    bookingId: input.bookingId,
    tenantId: input.tenantId,
    bookingSegmentId: input.bookingSegmentId ?? null,
    flightId: input.flightId,
    currency: "SAR",
    source: input.source,
    sourceReference: input.sourceReference ?? null,
  } as const;
  const rows: InsertBookingFareComponent[] = [];
  const payload = input.offer
    ? retailOfferPayloadSchema.parse(input.offer.payload)
    : input.sectorQuote;
  if (payload) {
    if (
      payload.fareLines &&
      payload.fareLines.length === input.passengerIds.length
    ) {
      payload.fareLines.forEach((line, index) => {
        const passengerId = input.passengerIds[index];
        rows.push(
          {
            ...common,
            passengerId,
            componentType: "base_fare",
            code: "AIR_FARE",
            amount: line.baseFare,
            policyVersion: payload.policy.name,
          },
          {
            ...common,
            passengerId,
            componentType: "tax",
            // The quote is an estimate until an operator-approved route tax
            // policy classifies it with an official tax category/code.
            code: "OFFER_TAX_ESTIMATE",
            amount: line.tax,
            policyVersion: payload.policy.name,
          },
          {
            ...common,
            passengerId,
            componentType: "booking_fee",
            code: "BOOKING_FEE",
            amount: line.bookingFee,
            policyVersion: payload.policy.name,
          }
        );
      });
    } else {
      rows.push({
        ...common,
        passengerId: null,
        componentType: "unclassified",
        code: "GROSS_RECONCILIATION_REQUIRED",
        amount: input.totalAmount - ancillaryTotal,
        policyVersion: payload.policy.name,
      });
    }
  } else {
    rows.push({
      ...common,
      passengerId: null,
      componentType: "unclassified",
      code: "GROSS_RECONCILIATION_REQUIRED",
      amount: input.totalAmount - ancillaryTotal,
      policyVersion: null,
    });
  }
  for (const ancillary of input.ancillaries ?? [])
    rows.push({
      ...common,
      passengerId: null,
      componentType: "ancillary",
      code: ancillary.code ?? "ANCILLARY",
      amount: ancillary.amount,
      policyVersion: null,
      source: "ancillary_catalog",
    });

  if (
    rows.some(row => !Number.isSafeInteger(row.amount) || row.amount < 0) ||
    rows.reduce((sum, row) => sum + row.amount, 0) !== input.totalAmount
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Invoice components do not conserve the booking total",
    });
  return rows;
}

export async function persistInitialFareComponents(
  tx: SettlementTx,
  input: InitialFareComponentInput
) {
  const rows = composeInitialFareComponents(input);
  if (rows.length) await tx.insert(bookingFareComponents).values(rows);
  return rows;
}

function tlvTag(tag: number, value: string) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > 255)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ZATCA preview field exceeds one-byte TLV length",
    });
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
}

/** Five-tag QR preview used for internal review only. Phase 2 requires the
 * accepted EGS to replace this with the signed nine-tag value. */
export function buildZatcaPreviewQr(input: {
  sellerName: string;
  sellerVatNumber: string;
  issueTimestamp: Date;
  totalAmount: number;
  taxAmount: number;
}) {
  if (
    !input.sellerName.trim() ||
    !/^3\d{13}3$/.test(input.sellerVatNumber) ||
    !Number.isFinite(input.issueTimestamp.getTime()) ||
    !Number.isSafeInteger(input.totalAmount) ||
    !Number.isSafeInteger(input.taxAmount) ||
    input.totalAmount < 0 ||
    input.taxAmount < 0 ||
    input.taxAmount > input.totalAmount
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Invalid ZATCA draft identity or totals",
    });
  return Buffer.concat([
    tlvTag(1, input.sellerName.trim()),
    tlvTag(2, input.sellerVatNumber),
    tlvTag(3, input.issueTimestamp.toISOString()),
    tlvTag(4, (input.totalAmount / 100).toFixed(2)),
    tlvTag(5, (input.taxAmount / 100).toFixed(2)),
  ]).toString("base64");
}

function draftGate() {
  if (process.env.AIS_ZATCA_DRAFT_MODE !== "true")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ZATCA draft generation is disabled",
    });
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.AIS_ZATCA_EGS_ACCEPTANCE_EVIDENCE_ID ||
      process.env.AIS_ZATCA_PRODUCTION_ACCEPTED !== "true")
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Accepted EGS evidence is required in production",
    });
}

export async function createZatcaInvoiceDraft(
  tx: SettlementTx,
  input: {
    bookingId: number;
    tenantId: number | null;
    invoiceNumber: string;
    issueTimestamp: Date;
    supplyTimestamp: Date;
    sellerName: string;
    sellerVatNumber: string;
    components: Array<{
      componentType: InsertBookingFareComponent["componentType"];
      code: string | null;
      amount: number;
    }>;
  }
) {
  draftGate();
  if (
    !input.invoiceNumber.trim() ||
    input.invoiceNumber.length > 64 ||
    !Number.isFinite(input.supplyTimestamp.getTime()) ||
    // Tag 5 is the VAT total. An omitted tax line or a generic airport/route
    // levy cannot establish a VAT determination for this draft.
    !input.components.some(
      line => line.componentType === "tax" && line.code === "VAT-S"
    ) ||
    input.components.some(
      line =>
        line.componentType === "unclassified" ||
        !line.code?.trim() ||
        (line.componentType === "tax" && line.code !== "VAT-S") ||
        !Number.isSafeInteger(line.amount) ||
        line.amount < 0
    )
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Approved tax classifications are required for a ZATCA draft",
    });
  const taxAmount = input.components
    .filter(line => line.componentType === "tax")
    .reduce((sum, line) => sum + line.amount, 0);
  const totalAmount = input.components.reduce(
    (sum, line) => sum + line.amount,
    0
  );
  const taxableAmount = totalAmount - taxAmount;
  const previewQrPayload = buildZatcaPreviewQr({
    sellerName: input.sellerName,
    sellerVatNumber: input.sellerVatNumber,
    issueTimestamp: input.issueTimestamp,
    totalAmount,
    taxAmount,
  });
  const normalizedComponents = input.components.map(line => ({
    componentType: line.componentType,
    code: line.code,
    amount: line.amount,
  }));
  const row = {
    id: randomUUID(),
    bookingId: input.bookingId,
    tenantId: input.tenantId,
    invoiceNumber: input.invoiceNumber,
    documentType: "simplified" as const,
    status: "draft" as const,
    currency: "SAR",
    issueTimestamp: input.issueTimestamp,
    supplyTimestamp: input.supplyTimestamp,
    sellerName: input.sellerName.trim(),
    sellerVatNumber: input.sellerVatNumber,
    taxableAmount,
    taxAmount,
    totalAmount,
    previewQrPayload,
    previewQrSha256: createHash("sha256")
      .update(previewQrPayload)
      .digest("hex"),
    componentDigest: createHash("sha256")
      .update(JSON.stringify(normalizedComponents))
      .digest("hex"),
    egsAcceptanceEvidenceId:
      process.env.AIS_ZATCA_EGS_ACCEPTANCE_EVIDENCE_ID ?? null,
  };
  await tx
    .insert(zatcaInvoiceDrafts)
    .values(row)
    .onDuplicateKeyUpdate({ set: { id: sql`${zatcaInvoiceDrafts.id}` } });
  const [stored] = await tx
    .select()
    .from(zatcaInvoiceDrafts)
    .where(eq(zatcaInvoiceDrafts.invoiceNumber, input.invoiceNumber))
    .limit(1)
    .for("update");
  if (
    !stored ||
    stored.bookingId !== row.bookingId ||
    stored.tenantId !== row.tenantId ||
    stored.componentDigest !== row.componentDigest ||
    stored.previewQrSha256 !== row.previewQrSha256 ||
    Math.floor(stored.supplyTimestamp.getTime() / 1000) !==
      Math.floor(row.supplyTimestamp.getTime() / 1000)
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Invoice number already reserved for different draft data",
    });
  }
  return stored;
}

/** Only the stored, active components of this tenant's invoice may enter review. */
export async function draftStoredBookingInvoice(
  tx: SettlementTx,
  tenantId: number,
  input: Omit<
    Parameters<typeof createZatcaInvoiceDraft>[1],
    "components" | "tenantId"
  >
) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(
      and(eq(bookings.id, input.bookingId), eq(bookings.tenantId, tenantId))
    )
    .limit(1)
    .for("update");
  if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
  const components = await tx
    .select()
    .from(bookingFareComponents)
    .where(
      and(
        eq(bookingFareComponents.bookingId, booking.id),
        eq(bookingFareComponents.tenantId, tenantId),
        isNull(bookingFareComponents.reversedAt)
      )
    )
    .orderBy(bookingFareComponents.id);
  if (
    !components.length ||
    components.some(line => line.currency !== "SAR") ||
    components.reduce((sum, line) => sum + line.amount, 0) !==
      booking.totalAmount
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Stored components do not reconcile with the booking",
    });
  return createZatcaInvoiceDraft(tx, { ...input, tenantId, components });
}
