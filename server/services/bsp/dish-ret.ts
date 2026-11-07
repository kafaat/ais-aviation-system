/**
 * Outbound RET (sales report) builder.
 *
 * One transaction = BCH02 + BKT06 + BKS30 + BKS39 + BKP84. The file is
 * BFH01, the transactions, one BCT95 per currency with the control totals,
 * and BFT99. Amounts are integers in the currency's minor unit; the
 * currency type element (CUTP, e.g. "SAR2") states the implied decimals.
 * Refunds are reported as positive amounts under TRNC=RFND; the control
 * totals subtract them.
 */
import { type DishTransactionCode, dishTransactionCodes } from "./dish-layouts";
import {
  civilToDishDate,
  formatRecord,
  numeric,
  parseRecord,
  splitRecords,
  type ParsedRecord,
} from "./dish-records";
import { civilDateInZone } from "../civil-day";

export interface RetTax {
  /** Tax or fee type code, e.g. "VAT", "YQ". Up to 8 characters. */
  type: string;
  amount: number;
}

export interface RetDocument {
  transactionCode: DishTransactionCode;
  /** Up to 15 characters. Local 13-digit documents are reported as issued. */
  documentNumber: string;
  /** Original document for refunds and exchanges. */
  relatedDocumentNumber?: string;
  /** Coupons 1-4: true = issued, false = not issued/void. */
  couponsIssued: readonly boolean[];
  passengerName: string;
  statisticalCode: "DOM" | "INT";
  /** Eight-digit IATA numeric agent code. */
  agentCode: string;
  issuedAt: Date;
  fareAmount: number;
  taxes: readonly RetTax[];
  /** Commission rate in basis points (500 = 5.00%). */
  commissionRateBps: number;
  commissionAmount: number;
  formOfPayment: { type: string; amount: number };
}

export interface RetSpecification {
  bspCountry: string;
  /** e.g. "23.1" → REVN "231" */
  dishVersion: string;
  airlineNumericCode: string;
  reportingSystemId: string;
  currency: string;
  timeZone: string;
  testMode: boolean;
}

export interface RetControlTotals {
  currency: string;
  transactionCount: number;
  fareTotal: number;
  taxTotal: number;
  commissionTotal: number;
  /** Σ(sales net) − Σ(refunds net); net = fare + tax − commission. */
  netRemittance: number;
  grossSales: number;
  grossRefunds: number;
}

export interface RetBuildInput {
  specification: RetSpecification;
  /** Civil date at the BSP country whose cut-off closes the reporting period. */
  reportingDate: string;
  processingAt: Date;
  sequenceNumber: number;
  documents: readonly RetDocument[];
}

export interface RetBuildResult {
  records: string[];
  content: string;
  recordCount: number;
  transactionCount: number;
  controlTotals: RetControlTotals;
  /** Transaction number per document, in input order. */
  transactionNumbers: number[];
}

export const RET_RECORDS_PER_TRANSACTION = 5;

export function currencyType(currency: string, decimals = 2): string {
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error(`Currency must be ISO 4217, got ${currency}`);
  return `${currency}${decimals}`;
}

export function handbookRevision(dishVersion: string): string {
  const m = /^(\d{1,2})\.(\d)$/.exec(dishVersion);
  if (!m)
    throw new Error(`DISH version must look like 23.1, got ${dishVersion}`);
  return `${m[1]}${m[2]}`.padStart(3, "0");
}

export function couponUseIndicator(coupons: readonly boolean[]): string {
  if (coupons.length < 1 || coupons.length > 4)
    throw new Error("A document carries one to four coupons");
  return Array.from({ length: 4 }, (_, i) => (coupons[i] ? "F" : "V")).join("");
}

export function documentNet(doc: {
  fareAmount: number;
  taxes: readonly RetTax[];
  commissionAmount: number;
}): number {
  return doc.fareAmount + taxTotal(doc.taxes) - doc.commissionAmount;
}

export function taxTotal(taxes: readonly RetTax[]): number {
  return taxes.reduce((sum, t) => sum + t.amount, 0);
}

function nonNegativeInteger(value: number, what: string) {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${what} must be a non-negative integer in minor units`);
}

export function validateDocument(doc: RetDocument, index: number): void {
  const at = `document ${index + 1} (${doc.documentNumber})`;
  if (!dishTransactionCodes.includes(doc.transactionCode))
    throw new Error(`${at}: unsupported transaction code`);
  if (!/^[A-Z0-9]{1,15}$/.test(doc.documentNumber))
    throw new Error(`${at}: document number must be 1-15 alphanumerics`);
  if (!/^\d{8}$/.test(doc.agentCode))
    throw new Error(`${at}: agent numeric code must be eight digits`);
  if (doc.taxes.length > 3)
    throw new Error(`${at}: BKS30 carries at most three tax elements`);
  nonNegativeInteger(doc.fareAmount, `${at}: fare`);
  for (const t of doc.taxes)
    nonNegativeInteger(t.amount, `${at}: tax ${t.type}`);
  nonNegativeInteger(doc.commissionAmount, `${at}: commission`);
  nonNegativeInteger(doc.commissionRateBps, `${at}: commission rate`);
  nonNegativeInteger(doc.formOfPayment.amount, `${at}: form of payment`);
  const total = doc.fareAmount + taxTotal(doc.taxes);
  if (doc.formOfPayment.amount !== total)
    throw new Error(
      `${at}: form of payment ${doc.formOfPayment.amount} must equal fare plus tax ${total}`
    );
  if (doc.commissionAmount > doc.fareAmount)
    throw new Error(`${at}: commission exceeds commissionable amount`);
  if (doc.transactionCode === "RFND" && !doc.relatedDocumentNumber)
    throw new Error(`${at}: refunds must reference the original document`);
}

export function computeControlTotals(
  currency: string,
  documents: readonly RetDocument[]
): RetControlTotals {
  const totals: RetControlTotals = {
    currency,
    transactionCount: documents.length,
    fareTotal: 0,
    taxTotal: 0,
    commissionTotal: 0,
    netRemittance: 0,
    grossSales: 0,
    grossRefunds: 0,
  };
  for (const doc of documents) {
    const tax = taxTotal(doc.taxes);
    totals.fareTotal += doc.fareAmount;
    totals.taxTotal += tax;
    totals.commissionTotal += doc.commissionAmount;
    const gross = doc.fareAmount + tax;
    if (doc.transactionCode === "RFND") {
      totals.grossRefunds += gross;
      totals.netRemittance -= documentNet(doc);
    } else {
      totals.grossSales += gross;
      totals.netRemittance += documentNet(doc);
    }
  }
  return totals;
}

function timeHHMM(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  return `${get("hour")}${get("minute")}`;
}

export function buildRetFile(input: RetBuildInput): RetBuildResult {
  const { specification: spec, documents } = input;
  documents.forEach(validateDocument);
  const cutp = currencyType(spec.currency);
  const records: string[] = [];
  const transactionNumbers: number[] = [];
  records.push(
    formatRecord("BFH01", {
      SPED: civilToDishDate(input.reportingDate),
      REVN: handbookRevision(spec.dishVersion),
      TPST: spec.testMode ? "TEST" : "PROD",
      PRDA: civilToDishDate(civilDateInZone(input.processingAt, spec.timeZone)),
      PRTM: timeHHMM(input.processingAt, spec.timeZone),
      ISOC: spec.bspCountry,
      RSID: spec.reportingSystemId,
      FSEQ: input.sequenceNumber,
      TACN: spec.airlineNumericCode,
    })
  );
  documents.forEach((doc, index) => {
    const trnn = index + 1;
    transactionNumbers.push(trnn);
    const dais = civilToDishDate(civilDateInZone(doc.issuedAt, spec.timeZone));
    const tax = taxTotal(doc.taxes);
    const common = { TRNN: trnn, TDNR: doc.documentNumber };
    records.push(
      formatRecord("BCH02", {
        TRNN: trnn,
        TRNC: doc.transactionCode,
        AGTN: doc.agentCode,
        DAIS: dais,
        TACN: spec.airlineNumericCode,
        CUTP: cutp,
        TRCN: RET_RECORDS_PER_TRANSACTION,
      }),
      formatRecord("BKT06", {
        ...common,
        CPUI: couponUseIndicator(doc.couponsIssued),
        CJCP: "",
        PXNM: doc.passengerName.toUpperCase(),
        STAT: doc.statisticalCode,
        DAIS: dais,
        AGTN: doc.agentCode,
        RTDN: doc.relatedDocumentNumber ?? "",
      }),
      formatRecord("BKS30", {
        ...common,
        COBL: doc.fareAmount,
        TMFT1: doc.taxes[0]?.type ?? "",
        TMFA1: doc.taxes[0]?.amount ?? 0,
        TMFT2: doc.taxes[1]?.type ?? "",
        TMFA2: doc.taxes[1]?.amount ?? 0,
        TMFT3: doc.taxes[2]?.type ?? "",
        TMFA3: doc.taxes[2]?.amount ?? 0,
        TDAM: doc.fareAmount + tax,
        CUTP: cutp,
      }),
      formatRecord("BKS39", {
        ...common,
        COTP: doc.commissionAmount ? "STD" : "",
        CORT: doc.commissionRateBps,
        COAM: doc.commissionAmount,
        SPAM: 0,
        TOCA: 0,
      }),
      formatRecord("BKP84", {
        ...common,
        FPTP: doc.formOfPayment.type,
        FPAM: doc.formOfPayment.amount,
        FPAC: "",
        CUTP: cutp,
      })
    );
  });
  const controlTotals = computeControlTotals(spec.currency, documents);
  records.push(
    formatRecord("BCT95", {
      CUTP: cutp,
      TCNT: controlTotals.transactionCount,
      TFAR: controlTotals.fareTotal,
      TTAX: controlTotals.taxTotal,
      TCOM: controlTotals.commissionTotal,
      TNSG: controlTotals.netRemittance < 0 ? "-" : "+",
      TNET: Math.abs(controlTotals.netRemittance),
      TSAL: controlTotals.grossSales,
      TRFD: controlTotals.grossRefunds,
    })
  );
  const recordCount = records.length + 1;
  records.push(
    formatRecord("BFT99", {
      RCNT: recordCount,
      TCNT: documents.length,
      CCNT: 1,
    })
  );
  return {
    records,
    content: records.join("\n") + "\n",
    recordCount,
    transactionCount: documents.length,
    controlTotals,
    transactionNumbers,
  };
}

export interface RetValidation {
  ok: boolean;
  errors: string[];
  recordCount: number;
  transactionCount: number;
}

/** Re-read a RET file and prove its trailer and control totals against the
 * detail records. Used before storage and again before transmission. */
export function validateRetFile(content: string): RetValidation {
  const errors: string[] = [];
  const lines = splitRecords(content);
  let parsed: ParsedRecord[] = [];
  try {
    parsed = lines.map((text, i) => parseRecord(i + 1, text));
  } catch (e) {
    return {
      ok: false,
      errors: [e instanceof Error ? e.message : String(e)],
      recordCount: lines.length,
      transactionCount: 0,
    };
  }
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  if (first?.name !== "BFH01") errors.push("File must start with BFH01");
  if (last?.name !== "BFT99") errors.push("File must end with BFT99");
  const headers = parsed.filter(r => r.name === "BCH02");
  const amounts = parsed.filter(r => r.name === "BKS30");
  const commissions = parsed.filter(r => r.name === "BKS39");
  const totals = parsed.filter(r => r.name === "BCT95");
  if (
    headers.length !== amounts.length ||
    headers.length !== commissions.length
  )
    errors.push("Every transaction needs BCH02, BKS30 and BKS39 records");
  let fare = 0;
  let tax = 0;
  let commission = 0;
  let net = 0;
  let sales = 0;
  let refunds = 0;
  headers.forEach((h, i) => {
    const a = amounts[i];
    const c = commissions[i];
    if (!a || !c) return;
    const docFare = numeric(a.values, "COBL");
    const docTax =
      numeric(a.values, "TMFA1") +
      numeric(a.values, "TMFA2") +
      numeric(a.values, "TMFA3");
    if (numeric(a.values, "TDAM") !== docFare + docTax)
      errors.push(`Transaction ${h.values.TRNN}: TDAM is not fare plus tax`);
    const docCommission = numeric(c.values, "COAM");
    fare += docFare;
    tax += docTax;
    commission += docCommission;
    const docNet = docFare + docTax - docCommission;
    if (h.values.TRNC === "RFND") {
      refunds += docFare + docTax;
      net -= docNet;
    } else {
      sales += docFare + docTax;
      net += docNet;
    }
  });
  if (totals.length !== 1) errors.push("Exactly one BCT95 record expected");
  const t = totals[0]?.values;
  if (t) {
    const check = (code: string, expected: number) => {
      if (numeric(t, code) !== expected)
        errors.push(`BCT95.${code} ${t[code]} does not equal ${expected}`);
    };
    check("TCNT", headers.length);
    check("TFAR", fare);
    check("TTAX", tax);
    check("TCOM", commission);
    check("TNET", Math.abs(net));
    check("TSAL", sales);
    check("TRFD", refunds);
    if ((t.TNSG === "-") !== net < 0) errors.push("BCT95.TNSG sign is wrong");
  }
  if (last?.name === "BFT99") {
    if (numeric(last.values, "RCNT") !== parsed.length)
      errors.push(
        `BFT99.RCNT ${last.values.RCNT} does not equal ${parsed.length}`
      );
    if (numeric(last.values, "TCNT") !== headers.length)
      errors.push(
        `BFT99.TCNT ${last.values.TCNT} does not equal ${headers.length}`
      );
  }
  return {
    ok: errors.length === 0,
    errors,
    recordCount: parsed.length,
    transactionCount: headers.length,
  };
}
