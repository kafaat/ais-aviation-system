/**
 * Inbound HOT (billing file) parser.
 *
 * The HOT arrives from the BSP data processing centre and is the authority
 * on what the BSP billed and will remit. The parser is layout-driven, keeps
 * every amount as an integer in the currency minor unit, and never repairs
 * data: an unknown record type is reported as a warning and skipped, a
 * malformed known record or a trailer that disagrees with the detail is an
 * error. The caller stores the file verbatim with its hash.
 */
import { DISH_RECORD_WIDTH, type DishRecordName } from "./dish-layouts";
import {
  dishDateToCivil,
  isDishRecordName,
  numeric,
  parseRecord,
  splitRecords,
} from "./dish-records";

export interface HotHeader {
  reportingPeriodEnd: string | null;
  handbookRevision: string;
  testMode: boolean;
  processingDate: string | null;
  processingTime: string;
  countryCode: string;
  reportingSystemId: string;
  fileSequence: number;
  airlineNumericCode: string;
}

export interface HotTax {
  type: string;
  amount: number;
}

export interface HotTransaction {
  line: number;
  transactionNumber: number;
  transactionCode: string;
  agentCode: string;
  issueDate: string | null;
  currency: string;
  documentNumber: string;
  relatedDocumentNumber: string;
  couponUseIndicator: string;
  passengerName: string;
  statisticalCode: string;
  fareAmount: number;
  taxes: HotTax[];
  taxAmount: number;
  documentTotal: number;
  commissionRateBps: number;
  commissionAmount: number;
  formOfPayment: { type: string; amount: number } | null;
  /** fare + tax − commission; the BSP remits this (negative for refunds). */
  netAmount: number;
}

export interface HotOfficeTotal {
  agentCode: string;
  currency: string;
  transactionCount: number;
  fareTotal: number;
  taxTotal: number;
  commissionTotal: number;
  remittance: number;
}

export interface HotCountryTotal {
  currency: string;
  transactionCount: number;
  fareTotal: number;
  taxTotal: number;
  commissionTotal: number;
  netRemittance: number;
  grossSales: number;
  grossRefunds: number;
}

export interface HotParseResult {
  header: HotHeader;
  transactions: HotTransaction[];
  officeTotals: HotOfficeTotal[];
  countryTotals: HotCountryTotal[];
  recordCount: number;
  warnings: string[];
  /** Σ transaction net, refunds negative; what the BSP should remit. */
  netRemittance: number;
}

export class HotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HotParseError";
  }
}

const KNOWN_HOT: readonly DishRecordName[] = [
  "BFH01",
  "BCH02",
  "BOH03",
  "BKT06",
  "BKS30",
  "BKS39",
  "BKP84",
  "BOT93",
  "BCT95",
  "BFT99",
];

function signed(sign: string, amount: number): number {
  if (sign !== "+" && sign !== "-")
    throw new HotParseError(`Invalid sign indicator "${sign}"`);
  return sign === "-" ? -amount : amount;
}

export function parseHotFile(content: string): HotParseResult {
  const lines = splitRecords(content);
  if (!lines.length) throw new HotParseError("HOT file is empty");
  const warnings: string[] = [];
  let header: HotHeader | null = null;
  let trailer: Record<string, string> | null = null;
  const transactions: HotTransaction[] = [];
  const officeTotals: HotOfficeTotal[] = [];
  const countryTotals: HotCountryTotal[] = [];
  let current: HotTransaction | null = null;
  let knownRecords = 0;

  for (const [index, text] of lines.entries()) {
    const line = index + 1;
    if (text.length !== DISH_RECORD_WIDTH)
      throw new HotParseError(
        `Line ${line}: record is ${text.length} characters, expected ${DISH_RECORD_WIDTH}`
      );
    const name = text.slice(0, 5);
    if (!isDishRecordName(name) || !KNOWN_HOT.includes(name)) {
      warnings.push(`Line ${line}: unknown record type ${name} skipped`);
      continue;
    }
    knownRecords++;
    const { values } = parseRecord(line, text);
    switch (name) {
      case "BFH01":
        if (header) throw new HotParseError(`Line ${line}: second BFH01`);
        header = {
          reportingPeriodEnd: dishDateToCivil(values.SPED),
          handbookRevision: values.REVN,
          testMode: values.TPST === "TEST",
          processingDate: dishDateToCivil(values.PRDA),
          processingTime: values.PRTM,
          countryCode: values.ISOC,
          reportingSystemId: values.RSID,
          fileSequence: numeric(values, "FSEQ"),
          airlineNumericCode: values.TACN,
        };
        break;
      case "BOH03":
        current = null;
        break;
      case "BCH02":
        current = {
          line,
          transactionNumber: numeric(values, "TRNN"),
          transactionCode: values.TRNC,
          agentCode: values.AGTN,
          issueDate: dishDateToCivil(values.DAIS),
          currency: values.CUTP.slice(0, 3),
          documentNumber: "",
          relatedDocumentNumber: "",
          couponUseIndicator: "",
          passengerName: "",
          statisticalCode: "",
          fareAmount: 0,
          taxes: [],
          taxAmount: 0,
          documentTotal: 0,
          commissionRateBps: 0,
          commissionAmount: 0,
          formOfPayment: null,
          netAmount: 0,
        };
        transactions.push(current);
        break;
      case "BKT06":
      case "BKS30":
      case "BKS39":
      case "BKP84": {
        if (!current)
          throw new HotParseError(`Line ${line}: ${name} before any BCH02`);
        if (numeric(values, "TRNN") !== current.transactionNumber)
          throw new HotParseError(
            `Line ${line}: ${name} belongs to transaction ${values.TRNN}, expected ${current.transactionNumber}`
          );
        if (current.documentNumber && values.TDNR !== current.documentNumber)
          throw new HotParseError(
            `Line ${line}: ${name} document ${values.TDNR} differs from ${current.documentNumber}`
          );
        current.documentNumber = values.TDNR;
        if (name === "BKT06") {
          current.couponUseIndicator = values.CPUI;
          current.passengerName = values.PXNM;
          current.statisticalCode = values.STAT;
          current.relatedDocumentNumber = values.RTDN;
        } else if (name === "BKS30") {
          current.fareAmount = numeric(values, "COBL");
          current.taxes = [1, 2, 3]
            .map(i => ({
              type: values[`TMFT${i}`],
              amount: numeric(values, `TMFA${i}`),
            }))
            .filter(t => t.type || t.amount);
          current.taxAmount = current.taxes.reduce((s, t) => s + t.amount, 0);
          current.documentTotal = numeric(values, "TDAM");
          if (current.documentTotal !== current.fareAmount + current.taxAmount)
            throw new HotParseError(
              `Line ${line}: TDAM ${current.documentTotal} is not fare plus tax`
            );
        } else if (name === "BKS39") {
          current.commissionRateBps = numeric(values, "CORT");
          current.commissionAmount = numeric(values, "COAM");
        } else {
          current.formOfPayment = {
            type: values.FPTP,
            amount: numeric(values, "FPAM"),
          };
        }
        break;
      }
      case "BOT93":
        current = null;
        officeTotals.push({
          agentCode: values.AGTN,
          currency: values.CUTP.slice(0, 3),
          transactionCount: numeric(values, "TCNT"),
          fareTotal: numeric(values, "TFAR"),
          taxTotal: numeric(values, "TTAX"),
          commissionTotal: numeric(values, "TCOM"),
          remittance: signed(values.TRSG, numeric(values, "TREM")),
        });
        break;
      case "BCT95":
        current = null;
        countryTotals.push({
          currency: values.CUTP.slice(0, 3),
          transactionCount: numeric(values, "TCNT"),
          fareTotal: numeric(values, "TFAR"),
          taxTotal: numeric(values, "TTAX"),
          commissionTotal: numeric(values, "TCOM"),
          netRemittance: signed(values.TNSG, numeric(values, "TNET")),
          grossSales: numeric(values, "TSAL"),
          grossRefunds: numeric(values, "TRFD"),
        });
        break;
      case "BFT99":
        if (trailer) throw new HotParseError(`Line ${line}: second BFT99`);
        trailer = values;
        break;
    }
  }
  if (!header) throw new HotParseError("Missing BFH01 file header");
  if (!trailer) throw new HotParseError("Missing BFT99 file trailer");
  for (const t of transactions) {
    if (!t.documentNumber)
      throw new HotParseError(
        `Transaction ${t.transactionNumber}: no document records follow BCH02`
      );
    const net = t.fareAmount + t.taxAmount - t.commissionAmount;
    t.netAmount = t.transactionCode === "RFND" ? -net : net;
  }
  // The trailer counts every record the sender wrote, including the ones we
  // did not recognise; the transaction count must match what we parsed.
  if (numeric(trailer, "RCNT") !== lines.length)
    throw new HotParseError(
      `BFT99.RCNT ${trailer.RCNT} does not equal ${lines.length} records`
    );
  if (numeric(trailer, "TCNT") !== transactions.length)
    throw new HotParseError(
      `BFT99.TCNT ${trailer.TCNT} does not equal ${transactions.length} transactions`
    );
  if (numeric(trailer, "CCNT") !== countryTotals.length)
    warnings.push(
      `BFT99.CCNT ${trailer.CCNT} does not equal ${countryTotals.length} BCT95 records`
    );
  const netRemittance = transactions.reduce((s, t) => s + t.netAmount, 0);
  for (const ct of countryTotals) {
    const inCurrency = transactions.filter(t => t.currency === ct.currency);
    const net = inCurrency.reduce((s, t) => s + t.netAmount, 0);
    if (net !== ct.netRemittance)
      warnings.push(
        `BCT95 ${ct.currency}: net remittance ${ct.netRemittance} differs from detail ${net}`
      );
    if (ct.transactionCount !== inCurrency.length)
      warnings.push(
        `BCT95 ${ct.currency}: transaction count ${ct.transactionCount} differs from detail ${inCurrency.length}`
      );
  }
  return {
    header,
    transactions,
    officeTotals,
    countryTotals,
    recordCount: knownRecords,
    warnings,
    netRemittance,
  };
}
