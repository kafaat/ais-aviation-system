import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  bookingFareComponents,
  zatcaInvoiceDrafts,
  type InsertBookingFareComponent,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import {
  retailOfferPayloadSchema,
  type RetailOffer,
} from "./retail-offer.service";

type ComponentSource = InsertBookingFareComponent["source"];

export type InitialFareComponentInput = {
  bookingId: number;
  tenantId: number | null;
  flightId: number;
  passengerIds: number[];
  totalAmount: number;
  offer?: RetailOffer;
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
    bookingSegmentId: null,
    flightId: input.flightId,
    currency: "SAR",
    source: input.source,
    sourceReference: input.sourceReference ?? null,
  } as const;
  const rows: InsertBookingFareComponent[] = [];
  if (input.offer) {
    const payload = retailOfferPayloadSchema.parse(input.offer.payload);
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
    !input.components.length ||
    input.components.some(
      line =>
        line.componentType === "unclassified" ||
        line.code === "OFFER_TAX_ESTIMATE" ||
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
  await tx.insert(zatcaInvoiceDrafts).values(row);
  return row;
}
