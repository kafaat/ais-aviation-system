/**
 * BSP settlement service.
 *
 * Data direction follows the IATA BSP link: the airline SENDS the DISH RET
 * sales report and RECEIVES the HOT billing file. This service generates and
 * stores RET files, ingests HOT files immutably, imports bank remittances and
 * runs the reconciliation gate that blocks "settlement complete" until every
 * document transaction is matched or dispositioned with a reason.
 *
 * Transmission requires a confirmed `settlement_link_specifications` row in
 * force for the reporting date and a file without fallback fare components.
 * Nothing here contacts an external system; see bsp/ret-transport.ts.
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { getDb } from "../db";
import {
  agentBookings,
  airports,
  bookings,
  bspBankRemittances,
  bspHotFiles,
  bspHotLines,
  bspReconciliationItems,
  bspReconciliationRuns,
  bspRetFiles,
  bspRetLines,
  financialLedger,
  flights,
  passengers,
  settlementLinkSpecifications,
  travelAgents,
} from "../../drizzle/schema";
import { civilDateOf, isValidTimeZone } from "./civil-day";
import {
  buildRetFile,
  validateRetFile,
  documentNet,
  type RetDocument,
} from "./bsp/dish-ret";
import { parseHotFile, HotParseError } from "./bsp/hot-parser";
import {
  classifySettlement,
  settlementGate,
  documentKey,
  type LedgerExpectation,
  type SettlementClassification,
} from "./bsp/settlement-reconciliation";
import {
  parseBankStatementCsv,
  BankStatementError,
} from "./bsp/bank-statement-csv";
import {
  CUTOFF_TIME,
  periodWindow,
  retReportingWindow,
} from "./bsp/reporting-period";
import {
  drizzleFareComponents,
  resolveDocumentComponents,
  type FareComponentSource,
} from "./bsp/fare-components";
import { resolveRetTransport, type RetTransport } from "./bsp/ret-transport";

type Db = NonNullable<ReturnType<typeof getDb>>;
export type LinkSpecification =
  typeof settlementLinkSpecifications.$inferSelect;
export type SettlementPlan = LinkSpecification["settlementPlan"];

export const settlementPlans: ReadonlyArray<{
  plan: SettlementPlan;
  implemented: boolean;
  label: string;
}> = [
  { plan: "bsp", implemented: true, label: "IATA BSP (RET out, HOT in)" },
  { plan: "arc", implemented: false, label: "ARC (stub: not implemented)" },
  {
    plan: "other",
    implemented: false,
    label: "Other settlement plan (stub: not implemented)",
  },
];

function database(): Db {
  const db = getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}

const precondition = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });
const notFound = (message: string) =>
  new TRPCError({ code: "NOT_FOUND", message });

export const sha256 = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

/** Ledger amounts are decimal SAR strings; reporting works in minor units. */
export function ledgerMinor(amount: string | number): number {
  const minor = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(minor) || minor < 0)
    throw new Error(`Invalid ledger amount ${amount}`);
  return minor;
}

// ----------------------------------------------------------------------------
// Link specifications
// ----------------------------------------------------------------------------

export interface LinkSpecificationInput {
  id?: number;
  tenantId?: number | null;
  bspCountry: string;
  settlementPlan: SettlementPlan;
  linkType: LinkSpecification["linkType"];
  dishVersion: string;
  airlineNumericCode: string;
  reportingSystemId: string;
  currency: string;
  timeZone: string;
  retCutoffLocalTime: string;
  hotCutoffLocalTime: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export function validateLinkSpecificationInput(input: LinkSpecificationInput) {
  if (!/^[A-Z]{2}$/.test(input.bspCountry))
    throw precondition("BSP country must be an ISO 3166-1 alpha-2 code");
  if (!/^\d{1,2}\.\d$/.test(input.dishVersion))
    throw precondition("DISH version must look like 23.1");
  if (!/^\d{3}$/.test(input.airlineNumericCode))
    throw precondition("Airline numeric code must be three digits");
  if (!/^[A-Z0-9]{1,4}$/.test(input.reportingSystemId))
    throw precondition("Reporting system identifier is 1-4 alphanumerics");
  if (!/^[A-Z]{3}$/.test(input.currency))
    throw precondition("Currency must be ISO 4217");
  if (!isValidTimeZone(input.timeZone))
    throw precondition("Time zone must be a valid IANA zone");
  if (
    !CUTOFF_TIME.test(input.retCutoffLocalTime) ||
    !CUTOFF_TIME.test(input.hotCutoffLocalTime)
  )
    throw precondition("Cut-off times must be HH:MM");
  civilDateOf(input.effectiveFrom);
  if (input.effectiveTo) {
    civilDateOf(input.effectiveTo);
    if (input.effectiveTo < input.effectiveFrom)
      throw precondition("Effective end precedes effective start");
  }
}

export async function listLinkSpecifications(bspCountry?: string) {
  const db = database();
  const rows = bspCountry
    ? await db
        .select()
        .from(settlementLinkSpecifications)
        .where(eq(settlementLinkSpecifications.bspCountry, bspCountry))
    : await db.select().from(settlementLinkSpecifications);
  return rows.sort((a, b) => b.id - a.id);
}

/** Any edit returns the row to draft: the confirmation covered the old text. */
export async function saveLinkSpecification(
  input: LinkSpecificationInput,
  actorId: number
) {
  validateLinkSpecificationInput(input);
  const db = database();
  const values = {
    tenantId: input.tenantId ?? null,
    bspCountry: input.bspCountry,
    settlementPlan: input.settlementPlan,
    linkType: input.linkType,
    dishVersion: input.dishVersion,
    airlineNumericCode: input.airlineNumericCode,
    reportingSystemId: input.reportingSystemId,
    currency: input.currency,
    timeZone: input.timeZone,
    retCutoffLocalTime: input.retCutoffLocalTime,
    hotCutoffLocalTime: input.hotCutoffLocalTime,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
  };
  if (input.id) {
    const [existing] = await db
      .select()
      .from(settlementLinkSpecifications)
      .where(eq(settlementLinkSpecifications.id, input.id));
    if (!existing) throw notFound("Link specification not found");
    await db
      .update(settlementLinkSpecifications)
      .set({
        ...values,
        confirmationStatus: "draft",
        confirmationReference: null,
        confirmedBy: null,
        confirmedAt: null,
      })
      .where(eq(settlementLinkSpecifications.id, input.id));
    return input.id;
  }
  const [inserted] = await db.insert(settlementLinkSpecifications).values({
    ...values,
    confirmationStatus: "draft",
    createdBy: actorId,
  });
  return inserted.insertId;
}

export async function confirmLinkSpecification(
  id: number,
  confirmationReference: string,
  actorId: number
) {
  if (!confirmationReference.trim())
    throw precondition("A confirmation reference from the BSP is required");
  const db = database();
  const [row] = await db
    .select()
    .from(settlementLinkSpecifications)
    .where(eq(settlementLinkSpecifications.id, id));
  if (!row) throw notFound("Link specification not found");
  if (row.settlementPlan !== "bsp")
    throw precondition(
      `${row.settlementPlan.toUpperCase()} settlement is a labelled stub; only BSP links can be confirmed`
    );
  await db
    .update(settlementLinkSpecifications)
    .set({
      confirmationStatus: "confirmed",
      confirmationReference: confirmationReference.trim(),
      confirmedBy: actorId,
      confirmedAt: new Date(),
    })
    .where(eq(settlementLinkSpecifications.id, id));
}

export async function revokeLinkSpecification(id: number) {
  const db = database();
  const [row] = await db
    .select()
    .from(settlementLinkSpecifications)
    .where(eq(settlementLinkSpecifications.id, id));
  if (!row) throw notFound("Link specification not found");
  await db
    .update(settlementLinkSpecifications)
    .set({ confirmationStatus: "revoked" })
    .where(eq(settlementLinkSpecifications.id, id));
}

function inForce(spec: LinkSpecification, date: string) {
  return (
    spec.effectiveFrom <= date &&
    (!spec.effectiveTo || spec.effectiveTo >= date)
  );
}

/** The specification that governs `date`; drafts are allowed for generation. */
export async function linkSpecificationFor(
  db: Db,
  bspCountry: string,
  date: string
): Promise<LinkSpecification | null> {
  const rows = await db
    .select()
    .from(settlementLinkSpecifications)
    .where(eq(settlementLinkSpecifications.bspCountry, bspCountry));
  const candidates = rows
    .filter(s => inForce(s, date) && s.confirmationStatus !== "revoked")
    .sort(
      (a, b) =>
        Number(b.confirmationStatus === "confirmed") -
          Number(a.confirmationStatus === "confirmed") || b.id - a.id
    );
  return candidates[0] ?? null;
}

export async function requireConfirmedLink(
  db: Db,
  bspCountry: string,
  date: string
): Promise<LinkSpecification> {
  const spec = await linkSpecificationFor(db, bspCountry, date);
  if (!spec)
    throw precondition(
      `No settlement link specification is in force for ${bspCountry} on ${date}`
    );
  if (spec.confirmationStatus !== "confirmed")
    throw precondition(
      `Link specification ${spec.id} (${spec.linkType}, DISH ${spec.dishVersion}) is ${spec.confirmationStatus}; the BSP link agreement must be confirmed before transmission`
    );
  return spec;
}

// ----------------------------------------------------------------------------
// Ledger expectations: the documents the airline expects the BSP to settle
// ----------------------------------------------------------------------------

export interface ExpectedDocument {
  ledgerEntryId: number;
  bookingId: number;
  passengerId: number;
  transactionCode: "TKTT" | "RFND";
  documentNumber: string;
  relatedDocumentNumber?: string;
  passengerName: string;
  statisticalCode: "DOM" | "INT";
  agentCode: string;
  issuedAt: Date;
  fareAmount: number;
  taxes: Array<{ type: string; amount: number }>;
  commissionRateBps: number;
  commissionAmount: number;
  formOfPayment: string;
  componentsSource: "fare_components" | "booking_total_fallback";
  couponCount: number;
}

export interface ExpectationReport {
  documents: ExpectedDocument[];
  skipped: {
    directSales: number;
    unticketedPassengers: number;
    foreignCurrency: number;
  };
}

/** Agency-channel sales and refunds whose ledger entry falls in [start, end),
 * expanded to one document per ticketed passenger. */
export async function collectExpectedDocuments(
  db: Db,
  input: {
    window: { start: Date; end: Date };
    currency: string;
    fareComponents: FareComponentSource;
  }
): Promise<ExpectationReport> {
  const entries = await db
    .select()
    .from(financialLedger)
    .where(
      and(
        inArray(financialLedger.type, ["charge", "refund", "partial_refund"]),
        gte(financialLedger.transactionDate, input.window.start),
        lt(financialLedger.transactionDate, input.window.end)
      )
    );
  const skipped = {
    directSales: 0,
    unticketedPassengers: 0,
    foreignCurrency: 0,
  };
  const bookingIds = [
    ...new Set(
      entries.flatMap(e => (e.bookingId === null ? [] : [e.bookingId]))
    ),
  ];
  if (!bookingIds.length) return { documents: [], skipped };
  const agencyRows = await db
    .select()
    .from(agentBookings)
    .where(inArray(agentBookings.bookingId, bookingIds));
  const agencyByBooking = new Map(agencyRows.map(a => [a.bookingId, a]));
  const agentIds = [...new Set(agencyRows.map(a => a.agentId))];
  const agents = agentIds.length
    ? await db
        .select()
        .from(travelAgents)
        .where(inArray(travelAgents.id, agentIds))
    : [];
  const agentById = new Map(agents.map(a => [a.id, a]));
  const agencyBookingIds = agencyRows.map(a => a.bookingId);
  if (!agencyBookingIds.length) {
    skipped.directSales = entries.length;
    return { documents: [], skipped };
  }
  const bookingRows = await db
    .select()
    .from(bookings)
    .where(inArray(bookings.id, agencyBookingIds));
  const bookingById = new Map(bookingRows.map(b => [b.id, b]));
  const passengerRows = await db
    .select()
    .from(passengers)
    .where(inArray(passengers.bookingId, agencyBookingIds));
  const flightIds = [...new Set(bookingRows.map(b => b.flightId))];
  const flightRows = flightIds.length
    ? await db.select().from(flights).where(inArray(flights.id, flightIds))
    : [];
  const airportIds = [
    ...new Set(flightRows.flatMap(f => [f.originId, f.destinationId])),
  ];
  const airportRows = airportIds.length
    ? await db.select().from(airports).where(inArray(airports.id, airportIds))
    : [];
  const airportById = new Map(airportRows.map(a => [a.id, a]));
  const flightById = new Map(flightRows.map(f => [f.id, f]));

  const documents: ExpectedDocument[] = [];
  for (const entry of entries.sort(
    (a, b) =>
      a.transactionDate.getTime() - b.transactionDate.getTime() || a.id - b.id
  )) {
    if (entry.bookingId === null) continue;
    const agency = agencyByBooking.get(entry.bookingId);
    if (!agency) {
      skipped.directSales++;
      continue;
    }
    if (entry.currency !== input.currency) {
      skipped.foreignCurrency++;
      continue;
    }
    const booking = bookingById.get(entry.bookingId);
    if (!booking) continue;
    const pax = passengerRows
      .filter(p => p.bookingId === entry.bookingId)
      .sort((a, b) => a.id - b.id);
    const ticketed = pax.filter(p => p.ticketNumber);
    skipped.unticketedPassengers += pax.length - ticketed.length;
    if (!ticketed.length) continue;
    const agent = agentById.get(agency.agentId);
    const iata = (agent?.iataNumber ?? "").replace(/\D/g, "");
    const agentCode = iata.slice(0, 8).padStart(8, "0");
    const amount = ledgerMinor(entry.amount);
    const isRefund = entry.type !== "charge";
    const components = resolveDocumentComponents(
      await input.fareComponents.read(entry.bookingId),
      amount,
      ticketed.map(p => p.id)
    );
    // Commission follows the money: the agency's booking rate applied to the
    // commissionable amount of each document.
    const rateBps = Math.round(Number(agency.commissionRate) * 100);
    const flight = flightById.get(booking.flightId);
    const origin = flight ? airportById.get(flight.originId) : undefined;
    const destination = flight
      ? airportById.get(flight.destinationId)
      : undefined;
    const statisticalCode: "DOM" | "INT" =
      origin && destination && origin.country === destination.country
        ? "DOM"
        : "INT";
    for (const passenger of ticketed) {
      const component = components.find(c => c.passengerId === passenger.id);
      const ticketNumber = passenger.ticketNumber;
      if (!component || !ticketNumber) continue;
      const fareAmount = component.baseAmount + component.feeAmount;
      documents.push({
        ledgerEntryId: entry.id,
        bookingId: entry.bookingId,
        passengerId: passenger.id,
        transactionCode: isRefund ? "RFND" : "TKTT",
        documentNumber: ticketNumber,
        relatedDocumentNumber: isRefund ? ticketNumber : undefined,
        passengerName: `${passenger.lastName}/${passenger.firstName}`
          .toUpperCase()
          .slice(0, 49),
        statisticalCode,
        agentCode,
        issuedAt: entry.transactionDate,
        fareAmount,
        taxes: component.taxes,
        commissionRateBps: rateBps,
        commissionAmount: Math.round((fareAmount * rateBps) / 10000),
        formOfPayment: entry.stripePaymentIntentId ? "CC" : "CA",
        componentsSource: component.source,
        couponCount: 1,
      });
    }
  }
  return { documents, skipped };
}

export function toRetDocument(doc: ExpectedDocument): RetDocument {
  const total = doc.fareAmount + doc.taxes.reduce((s, t) => s + t.amount, 0);
  return {
    transactionCode: doc.transactionCode,
    documentNumber: doc.documentNumber,
    relatedDocumentNumber: doc.relatedDocumentNumber,
    couponsIssued: Array.from(
      { length: Math.min(4, Math.max(1, doc.couponCount)) },
      () => true
    ),
    passengerName: doc.passengerName,
    statisticalCode: doc.statisticalCode,
    agentCode: doc.agentCode,
    issuedAt: doc.issuedAt,
    fareAmount: doc.fareAmount,
    taxes: doc.taxes,
    commissionRateBps: doc.commissionRateBps,
    commissionAmount: doc.commissionAmount,
    formOfPayment: { type: doc.formOfPayment, amount: total },
  };
}

// ----------------------------------------------------------------------------
// Outbound RET
// ----------------------------------------------------------------------------

export interface GenerateRetInput {
  bspCountry: string;
  reportingDate: string;
  actorId: number;
  fareComponents?: FareComponentSource;
  now?: Date;
  testMode?: boolean;
}

export async function generateRetFile(input: GenerateRetInput) {
  const db = database();
  const reportingDate = civilDateOf(input.reportingDate);
  const spec = await linkSpecificationFor(db, input.bspCountry, reportingDate);
  if (!spec)
    throw precondition(
      `No settlement link specification covers ${input.bspCountry} on ${reportingDate}; configure the BSP link before generating a RET`
    );
  if (spec.settlementPlan !== "bsp")
    throw precondition(
      `${spec.settlementPlan.toUpperCase()} reporting is a labelled stub; only BSP RET generation is implemented`
    );
  const window = retReportingWindow(
    reportingDate,
    spec.retCutoffLocalTime,
    spec.timeZone
  );
  const expectation = await collectExpectedDocuments(db, {
    window,
    currency: spec.currency,
    fareComponents:
      input.fareComponents ?? drizzleFareComponents(db, spec.currency),
  });
  const now = input.now ?? new Date();
  const previous = await db
    .select()
    .from(bspRetFiles)
    .where(
      and(
        eq(bspRetFiles.bspCountry, spec.bspCountry),
        eq(bspRetFiles.reportingDate, reportingDate)
      )
    );
  const sequenceNumber =
    previous.reduce((max, f) => Math.max(max, f.sequenceNumber), 0) + 1;
  const built = buildRetFile({
    specification: {
      bspCountry: spec.bspCountry,
      dishVersion: spec.dishVersion,
      airlineNumericCode: spec.airlineNumericCode,
      reportingSystemId: spec.reportingSystemId,
      currency: spec.currency,
      timeZone: spec.timeZone,
      testMode: input.testMode ?? spec.confirmationStatus !== "confirmed",
    },
    reportingDate,
    processingAt: now,
    sequenceNumber,
    documents: expectation.documents.map(toRetDocument),
  });
  const validation = validateRetFile(built.content);
  if (!validation.ok)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Generated RET failed self-validation: ${validation.errors.join("; ")}`,
    });
  const hash = sha256(built.content);
  const fileName = `RET_${spec.airlineNumericCode}_${spec.bspCountry}_${reportingDate.replaceAll("-", "")}_${String(sequenceNumber).padStart(3, "0")}.txt`;
  const fallbackLineCount = expectation.documents.filter(
    d => d.componentsSource === "booking_total_fallback"
  ).length;
  const fileId = await db.transaction(async tx => {
    const [inserted] = await tx.insert(bspRetFiles).values({
      specificationId: spec.id,
      bspCountry: spec.bspCountry,
      reportingDate,
      windowStart: window.start,
      windowEnd: window.end,
      sequenceNumber,
      fileName,
      sha256: hash,
      content: built.content,
      recordCount: built.recordCount,
      transactionCount: built.transactionCount,
      controlTotals: { ...built.controlTotals, skipped: expectation.skipped },
      fallbackLineCount,
      status: "generated",
      createdBy: input.actorId,
    });
    const id = inserted.insertId;
    if (expectation.documents.length)
      await tx.insert(bspRetLines).values(
        expectation.documents.map((doc, index) => ({
          fileId: id,
          transactionNumber: built.transactionNumbers[index],
          transactionCode: doc.transactionCode,
          documentNumber: doc.documentNumber,
          bookingId: doc.bookingId,
          passengerId: doc.passengerId,
          ledgerEntryId: doc.ledgerEntryId,
          agentCode: doc.agentCode,
          fareAmount: doc.fareAmount,
          taxAmount: doc.taxes.reduce((s, t) => s + t.amount, 0),
          commissionAmount: doc.commissionAmount,
          netAmount: documentNet({
            fareAmount: doc.fareAmount,
            taxes: doc.taxes,
            commissionAmount: doc.commissionAmount,
          }),
          currency: spec.currency,
          formOfPayment: doc.formOfPayment,
          issuedAt: doc.issuedAt,
          componentsSource: doc.componentsSource,
        }))
      );
    return id;
  });
  return {
    fileId,
    fileName,
    sha256: hash,
    reportingDate,
    sequenceNumber,
    window,
    recordCount: built.recordCount,
    transactionCount: built.transactionCount,
    controlTotals: built.controlTotals,
    fallbackLineCount,
    skipped: expectation.skipped,
    specificationStatus: spec.confirmationStatus,
  };
}

export async function listRetFiles(bspCountry?: string) {
  const db = database();
  const rows = bspCountry
    ? await db
        .select()
        .from(bspRetFiles)
        .where(eq(bspRetFiles.bspCountry, bspCountry))
    : await db.select().from(bspRetFiles);
  return rows
    .sort((a, b) => b.id - a.id)
    .map(({ content: _content, ...file }) => file);
}

export async function getRetFile(fileId: number) {
  const db = database();
  const [file] = await db
    .select()
    .from(bspRetFiles)
    .where(eq(bspRetFiles.id, fileId));
  if (!file) throw notFound("RET file not found");
  const lines = await db
    .select()
    .from(bspRetLines)
    .where(eq(bspRetLines.fileId, fileId));
  return {
    file,
    lines: lines.sort((a, b) => a.transactionNumber - b.transactionNumber),
  };
}

/** Transmission gate: confirmed link in force, immutable content, no fallback
 * components, file not yet sent. */
export async function transmitRetFile(
  fileId: number,
  actorId: number,
  transport?: RetTransport
) {
  const db = database();
  const [file] = await db
    .select()
    .from(bspRetFiles)
    .where(eq(bspRetFiles.id, fileId));
  if (!file) throw notFound("RET file not found");
  if (file.status !== "generated")
    throw precondition(`RET file ${fileId} is already ${file.status}`);
  const spec = await requireConfirmedLink(
    db,
    file.bspCountry,
    file.reportingDate
  );
  if (spec.id !== file.specificationId)
    throw precondition(
      `RET file ${fileId} was generated under specification ${file.specificationId}; the confirmed specification is ${spec.id}. Regenerate the file.`
    );
  if (file.fallbackLineCount > 0)
    throw precondition(
      `RET file ${fileId} carries ${file.fallbackLineCount} line(s) without fare components; a tax breakdown is required before transmission`
    );
  if (sha256(file.content) !== file.sha256)
    throw precondition(`RET file ${fileId} content no longer matches its hash`);
  const validation = validateRetFile(file.content);
  if (!validation.ok)
    throw precondition(
      `RET file ${fileId} fails validation: ${validation.errors.join("; ")}`
    );
  const adapter = transport ?? resolveRetTransport();
  const receipt = await adapter.transmit({
    fileName: file.fileName,
    content: file.content,
    sha256: file.sha256,
  });
  await db
    .update(bspRetFiles)
    .set({
      status: "transmitted",
      transmittedAt: receipt.transmittedAt,
      transportReference: `${adapter.kind}|${receipt.reference}|by:${actorId}`,
    })
    .where(eq(bspRetFiles.id, fileId));
  return { fileId, status: "transmitted" as const, ...receipt };
}

export async function acknowledgeRetFile(input: {
  fileId: number;
  outcome: "accepted" | "rejected";
  reason: string;
}) {
  const db = database();
  const [file] = await db
    .select()
    .from(bspRetFiles)
    .where(eq(bspRetFiles.id, input.fileId));
  if (!file) throw notFound("RET file not found");
  if (file.status !== "transmitted")
    throw precondition(
      `Only transmitted files receive a BSP acknowledgement; file is ${file.status}`
    );
  if (!input.reason.trim())
    throw precondition("Quote the BSP acknowledgement reference or reason");
  await db
    .update(bspRetFiles)
    .set({
      status: input.outcome,
      acknowledgedAt: new Date(),
      acknowledgementReason: input.reason.trim().slice(0, 500),
    })
    .where(eq(bspRetFiles.id, input.fileId));
}

// ----------------------------------------------------------------------------
// Inbound HOT
// ----------------------------------------------------------------------------

export async function ingestHotFile(input: {
  bspCountry: string;
  fileName: string;
  content: string;
  actorId: number;
}) {
  const db = database();
  const hash = sha256(input.content);
  const [duplicate] = await db
    .select()
    .from(bspHotFiles)
    .where(eq(bspHotFiles.sha256, hash));
  if (duplicate)
    throw new TRPCError({
      code: "CONFLICT",
      message: `This HOT file was already ingested as file ${duplicate.id}`,
    });
  let parsed;
  try {
    parsed = parseHotFile(input.content);
  } catch (e) {
    if (e instanceof HotParseError || e instanceof Error)
      throw precondition(`HOT file rejected: ${e.message}`);
    throw e;
  }
  if (parsed.header.countryCode !== input.bspCountry)
    throw precondition(
      `HOT header country ${parsed.header.countryCode} differs from ${input.bspCountry}`
    );
  const fileId = await db.transaction(async tx => {
    const [inserted] = await tx.insert(bspHotFiles).values({
      bspCountry: input.bspCountry,
      fileName: input.fileName.slice(0, 128),
      sha256: hash,
      content: input.content,
      recordCount: parsed.recordCount,
      transactionCount: parsed.transactions.length,
      processingDate: parsed.header.processingDate,
      remittancePeriodEnd: parsed.header.reportingPeriodEnd,
      totals: {
        netRemittance: parsed.netRemittance,
        countryTotals: parsed.countryTotals,
        officeTotals: parsed.officeTotals,
      },
      warnings: parsed.warnings,
      ingestedBy: input.actorId,
    });
    const id = inserted.insertId;
    if (parsed.transactions.length)
      await tx.insert(bspHotLines).values(
        parsed.transactions.map(t => ({
          fileId: id,
          transactionNumber: t.transactionNumber,
          transactionCode: t.transactionCode,
          documentNumber: t.documentNumber,
          agentCode: t.agentCode,
          passengerName: t.passengerName || null,
          fareAmount: t.fareAmount,
          taxAmount: t.taxAmount,
          commissionAmount: t.commissionAmount,
          netAmount: t.netAmount,
          currency: t.currency,
          formOfPayment: t.formOfPayment?.type.slice(0, 2) ?? null,
          issueDate: t.issueDate,
        }))
      );
    return id;
  });
  return {
    fileId,
    sha256: hash,
    recordCount: parsed.recordCount,
    transactionCount: parsed.transactions.length,
    netRemittance: parsed.netRemittance,
    processingDate: parsed.header.processingDate,
    remittancePeriodEnd: parsed.header.reportingPeriodEnd,
    warnings: parsed.warnings,
  };
}

export async function listHotFiles(bspCountry?: string) {
  const db = database();
  const rows = bspCountry
    ? await db
        .select()
        .from(bspHotFiles)
        .where(eq(bspHotFiles.bspCountry, bspCountry))
    : await db.select().from(bspHotFiles);
  return rows
    .sort((a, b) => b.id - a.id)
    .map(({ content: _content, ...file }) => file);
}

export async function getHotFile(fileId: number) {
  const db = database();
  const [file] = await db
    .select()
    .from(bspHotFiles)
    .where(eq(bspHotFiles.id, fileId));
  if (!file) throw notFound("HOT file not found");
  const lines = await db
    .select()
    .from(bspHotLines)
    .where(eq(bspHotLines.fileId, fileId));
  return {
    file,
    lines: lines.sort((a, b) => a.transactionNumber - b.transactionNumber),
  };
}

// ----------------------------------------------------------------------------
// Bank remittances
// ----------------------------------------------------------------------------

export async function importBankStatement(input: {
  bspCountry: string;
  currency: string;
  csv: string;
  actorId: number;
}) {
  const db = database();
  let lines;
  try {
    lines = parseBankStatementCsv(input.csv, input.currency);
  } catch (e) {
    if (e instanceof BankStatementError)
      throw precondition(`Bank statement rejected: ${e.message}`);
    throw e;
  }
  const importSha256 = sha256(input.csv);
  const existing = await db
    .select()
    .from(bspBankRemittances)
    .where(eq(bspBankRemittances.importSha256, importSha256));
  if (existing.length)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This statement was already imported",
    });
  await db.insert(bspBankRemittances).values(
    lines.map(l => ({
      bspCountry: input.bspCountry,
      importSha256,
      lineNumber: l.lineNumber,
      valueDate: l.valueDate,
      amount: l.amount,
      currency: l.currency,
      reference: l.reference,
      counterparty: l.counterparty,
      importedBy: input.actorId,
    }))
  );
  return {
    importSha256,
    lineCount: lines.length,
    totalAmount: lines.reduce((s, l) => s + l.amount, 0),
  };
}

export async function listBankRemittances(bspCountry: string) {
  const db = database();
  const rows = await db
    .select()
    .from(bspBankRemittances)
    .where(eq(bspBankRemittances.bspCountry, bspCountry));
  return rows.sort((a, b) => b.id - a.id);
}

// ----------------------------------------------------------------------------
// Reconciliation gate
// ----------------------------------------------------------------------------

export interface RunReconciliationInput {
  bspCountry: string;
  periodStart: string;
  periodEnd: string;
  actorId: number;
  settlementPlan?: SettlementPlan;
  /** Explicit HOT files; default: files for the country processed in the period. */
  hotFileIds?: number[];
  /** Explicit bank lines; default: credits with a value date in the period. */
  remittanceIds?: number[];
  fareComponents?: FareComponentSource;
}

export async function runReconciliation(input: RunReconciliationInput) {
  const plan = input.settlementPlan ?? "bsp";
  if (plan !== "bsp")
    throw precondition(
      `${plan.toUpperCase()} settlement reconciliation is a labelled stub; only the IATA BSP plan is implemented`
    );
  const db = database();
  const periodStart = civilDateOf(input.periodStart);
  const periodEnd = civilDateOf(input.periodEnd);
  const spec = await linkSpecificationFor(db, input.bspCountry, periodEnd);
  if (!spec)
    throw precondition(
      `No settlement link specification covers ${input.bspCountry} on ${periodEnd}`
    );
  const window = periodWindow(
    periodStart,
    periodEnd,
    spec.retCutoffLocalTime,
    spec.timeZone
  );
  const expectation = await collectExpectedDocuments(db, {
    window,
    currency: spec.currency,
    fareComponents:
      input.fareComponents ?? drizzleFareComponents(db, spec.currency),
  });
  // (a) RET lines: what the airline actually reported for the period.
  const retFiles = (
    await db
      .select()
      .from(bspRetFiles)
      .where(
        and(
          eq(bspRetFiles.bspCountry, input.bspCountry),
          gte(bspRetFiles.reportingDate, periodStart),
          lte(bspRetFiles.reportingDate, periodEnd)
        )
      )
  ).filter(f => f.status === "transmitted" || f.status === "accepted");
  const retLines = retFiles.length
    ? await db
        .select()
        .from(bspRetLines)
        .where(
          inArray(
            bspRetLines.fileId,
            retFiles.map(f => f.id)
          )
        )
    : [];
  // The latest RET line per document is what the BSP was told; the HOT is
  // compared against it. Documents never reported fall back to the ledger.
  const retByKey = new Map<string, (typeof retLines)[number]>();
  for (const line of retLines
    .filter(line => line.currency === spec.currency)
    .sort((a, b) => b.id - a.id)) {
    const key = documentKey(line.documentNumber, line.transactionCode);
    if (!retByKey.has(key)) retByKey.set(key, line);
  }
  // (b) HOT lines.
  const hotFiles = input.hotFileIds?.length
    ? await db
        .select()
        .from(bspHotFiles)
        .where(inArray(bspHotFiles.id, input.hotFileIds))
    : (
        await db
          .select()
          .from(bspHotFiles)
          .where(eq(bspHotFiles.bspCountry, input.bspCountry))
      ).filter(f => {
        // A HOT is processed after the period it bills: select by the
        // reporting period it closes, not by the day the BSP produced it.
        const period = f.remittancePeriodEnd ?? f.processingDate;
        return period !== null && period >= periodStart && period <= periodEnd;
      });
  const hotLines = hotFiles.length
    ? await db
        .select()
        .from(bspHotLines)
        .where(
          inArray(
            bspHotLines.fileId,
            hotFiles.map(f => f.id)
          )
        )
    : [];
  if (input.hotFileIds?.length) {
    const found = new Set(hotFiles.map(f => f.id));
    if (
      input.hotFileIds.some(id => !found.has(id)) ||
      hotFiles.some(f => {
        const period = f.remittancePeriodEnd ?? f.processingDate;
        return (
          f.bspCountry !== input.bspCountry ||
          !period ||
          period < periodStart ||
          period > periodEnd
        );
      }) ||
      hotLines.some(line => line.currency !== spec.currency)
    )
      throw precondition(
        "HOT source IDs are missing or outside the reconciliation country, currency or period scope"
      );
  }
  // (c) Bank remittances.
  const remittances = input.remittanceIds?.length
    ? await db
        .select()
        .from(bspBankRemittances)
        .where(inArray(bspBankRemittances.id, input.remittanceIds))
    : (
        await db
          .select()
          .from(bspBankRemittances)
          .where(eq(bspBankRemittances.bspCountry, input.bspCountry))
      ).filter(
        r =>
          r.valueDate >= periodStart &&
          r.valueDate <= periodEnd &&
          r.currency === spec.currency
      );
  if (input.remittanceIds?.length) {
    const found = new Set(remittances.map(r => r.id));
    if (
      input.remittanceIds.some(id => !found.has(id)) ||
      remittances.some(
        r =>
          r.bspCountry !== input.bspCountry ||
          r.currency !== spec.currency ||
          r.valueDate < periodStart ||
          r.valueDate > periodEnd
      )
    )
      throw precondition(
        "Remittance source IDs are missing or outside the reconciliation country, currency or period scope"
      );
  }
  const expectations: LedgerExpectation[] = expectation.documents.map(doc => {
    const reported = retByKey.get(
      documentKey(doc.documentNumber, doc.transactionCode)
    );
    const net = reported ? reported.netAmount : documentNet(doc);
    return {
      documentNumber: doc.documentNumber,
      transactionCode: doc.transactionCode,
      ledgerEntryId: doc.ledgerEntryId,
      bookingId: doc.bookingId,
      expectedAmount: doc.transactionCode === "RFND" ? -net : net,
      retLineId: reported?.id ?? null,
    };
  });
  const result = classifySettlement({
    expectations,
    hotLines: hotLines
      .filter(h => h.currency === spec.currency)
      .map(h => ({
        hotLineId: h.id,
        documentNumber: h.documentNumber,
        transactionCode: h.transactionCode,
        netAmount: h.netAmount,
      })),
    remittances: remittances.map(r => ({ id: r.id, amount: r.amount })),
  });
  const gate = settlementGate(
    result.items.map(i => ({
      classification: i.classification,
      dispositionReason: null,
    }))
  );
  const runId = await db.transaction(async tx => {
    const [inserted] = await tx.insert(bspReconciliationRuns).values({
      bspCountry: input.bspCountry,
      settlementPlan: plan,
      periodStart,
      periodEnd,
      sources: {
        specificationId: spec.id,
        retFileIds: retFiles.map(f => f.id),
        hotFileIds: hotFiles.map(f => f.id),
        remittanceIds: remittances.map(r => r.id),
        window: { start: window.start, end: window.end },
        skipped: expectation.skipped,
      },
      summary: result.summary,
      status: gate.status === "complete" ? "complete" : "open",
      createdBy: input.actorId,
      completedAt: gate.status === "complete" ? new Date() : null,
    });
    const id = inserted.insertId;
    if (result.items.length)
      await tx
        .insert(bspReconciliationItems)
        .values(result.items.map(item => ({ runId: id, ...item })));
    return id;
  });
  return getReconciliationReport(runId);
}

export async function getReconciliationReport(runId: number) {
  const db = database();
  const [run] = await db
    .select()
    .from(bspReconciliationRuns)
    .where(eq(bspReconciliationRuns.id, runId));
  if (!run) throw notFound("Reconciliation run not found");
  const items = await db
    .select()
    .from(bspReconciliationItems)
    .where(eq(bspReconciliationItems.runId, runId));
  const gate = settlementGate(items);
  const counts = Object.fromEntries(
    (
      [
        "matched",
        "missing_in_hot",
        "amount_mismatch",
        "missing_remittance",
        "unexpected_in_hot",
      ] as SettlementClassification[]
    ).map(c => [c, items.filter(i => i.classification === c).length])
  ) as Record<SettlementClassification, number>;
  return {
    run,
    items: items.sort((a, b) => a.id - b.id),
    gate,
    counts,
  };
}

export async function listReconciliationRuns(bspCountry?: string) {
  const db = database();
  const rows = bspCountry
    ? await db
        .select()
        .from(bspReconciliationRuns)
        .where(eq(bspReconciliationRuns.bspCountry, bspCountry))
    : await db.select().from(bspReconciliationRuns);
  return rows.sort((a, b) => b.id - a.id);
}

/** Record why an unmatched item is acceptable. Items are never deleted; the
 * run turns complete only when no undispositioned exception remains. */
export async function dispositionReconciliationItem(input: {
  itemId: number;
  reason: string;
  actorId: number;
}) {
  const reason = input.reason.trim();
  if (reason.length < 5)
    throw precondition(
      "A disposition reason of at least five characters is required"
    );
  const db = database();
  const [item] = await db
    .select()
    .from(bspReconciliationItems)
    .where(eq(bspReconciliationItems.id, input.itemId));
  if (!item) throw notFound("Reconciliation item not found");
  if (item.classification === "matched")
    throw precondition("Matched items need no disposition");
  const [run] = await db
    .select()
    .from(bspReconciliationRuns)
    .where(eq(bspReconciliationRuns.id, item.runId));
  if (!run) throw notFound("Reconciliation run not found");
  if (run.status === "complete")
    throw precondition("Reconciliation run is already complete");
  await db
    .update(bspReconciliationItems)
    .set({
      dispositionReason: reason.slice(0, 500),
      dispositionedBy: input.actorId,
      dispositionedAt: new Date(),
    })
    .where(eq(bspReconciliationItems.id, input.itemId));
  const items = await db
    .select()
    .from(bspReconciliationItems)
    .where(eq(bspReconciliationItems.runId, item.runId));
  const gate = settlementGate(items);
  if (gate.status === "complete")
    await db
      .update(bspReconciliationRuns)
      .set({ status: "complete", completedAt: new Date() })
      .where(eq(bspReconciliationRuns.id, item.runId));
  return gate;
}
