/**
 * Fixed-width record layouts for the IATA BSP data interchange files.
 *
 * Direction: the airline SENDS the RET sales report to the BSP data
 * processing centre and RECEIVES the HOT billing file from it. Both files are
 * sequences of 255-character records. Each record starts with its DISH record
 * name (standard message identifier plus record number, e.g. BKT06) and the
 * data elements carry DISH mnemonics (TRNN, TDNR, AGTN, COBL, TMFA, COAM...).
 *
 * The record set, record width and element mnemonics follow the IATA Data
 * Interchange Specifications Handbook (DISH). The field offsets in this table
 * are the AIS reporting profile: the handbook is distributed to BSP
 * participants only and the per-country profile is fixed in the link
 * specification. Offsets must be certified against the DISH edition named in
 * the confirmed `settlement_link_specifications` row before transmission; the
 * builder and parser are driven by this table so a certified layout replaces
 * it without touching generation or reconciliation logic.
 */

export const DISH_RECORD_WIDTH = 255;

/** A = alphanumeric, left-justified, space padded. N = numeric, right-justified, zero padded. */
export type DishFieldType = "A" | "N";

export interface DishField {
  code: string;
  label: string;
  start: number; // 1-based
  length: number;
  type: DishFieldType;
}

export type DishRecordName =
  | "BFH01"
  | "BCH02"
  | "BOH03"
  | "BKT06"
  | "BKS30"
  | "BKS39"
  | "BKP84"
  | "BOT93"
  | "BCT95"
  | "BFT99";

const field = (
  code: string,
  label: string,
  start: number,
  length: number,
  type: DishFieldType
): DishField => ({ code, label, start, length, type });

const RNAM = field("RNAM", "Record name", 1, 5, "A");

export const dishLayouts: Record<DishRecordName, readonly DishField[]> = {
  /** File header. */
  BFH01: [
    RNAM,
    field("SPED", "Reporting period ending date YYMMDD", 6, 6, "N"),
    field("REVN", "Handbook revision number", 12, 3, "N"),
    field("TPST", "Test or production status", 15, 4, "A"),
    field("PRDA", "Processing date YYMMDD", 19, 6, "N"),
    field("PRTM", "Processing time HHMM", 25, 4, "N"),
    field("ISOC", "ISO country code", 29, 2, "A"),
    field("RSID", "Reporting system identifier", 31, 4, "A"),
    field("FSEQ", "File sequence number", 35, 6, "N"),
    field("TACN", "Ticketing airline numeric code", 41, 3, "N"),
  ],
  /** Transaction header: one per sale, refund or EMD transaction. */
  BCH02: [
    RNAM,
    field("TRNN", "Transaction number", 6, 6, "N"),
    field("TRNC", "Transaction code", 12, 4, "A"),
    field("AGTN", "Agent numeric code", 16, 8, "N"),
    field("DAIS", "Date of issue YYMMDD", 24, 6, "N"),
    field("TACN", "Ticketing airline numeric code", 30, 3, "N"),
    field("CUTP", "Currency type", 33, 4, "A"),
    field("TRCN", "Records in transaction", 37, 4, "N"),
  ],
  /** Office header (HOT): opens the records billed for one agent. */
  BOH03: [
    RNAM,
    field("AGTN", "Agent numeric code", 6, 8, "N"),
    field("RPED", "Reporting period ending date YYMMDD", 14, 6, "N"),
    field("TACN", "Ticketing airline numeric code", 20, 3, "N"),
    field("CUTP", "Currency type", 23, 4, "A"),
  ],
  /** Ticket or document identification. */
  BKT06: [
    RNAM,
    field("TRNN", "Transaction number", 6, 6, "N"),
    field("TDNR", "Ticket/document number", 12, 15, "A"),
    field("CPUI", "Coupon use indicator", 27, 4, "A"),
    field("CJCP", "Conjunction ticket indicator", 31, 3, "A"),
    field("PXNM", "Passenger name", 34, 49, "A"),
    field("STAT", "Statistical code DOM/INT", 83, 3, "A"),
    field("DAIS", "Date of issue YYMMDD", 86, 6, "N"),
    field("AGTN", "Agent numeric code", 92, 8, "N"),
    field("RTDN", "Related ticket/document number", 100, 15, "A"),
  ],
  /** Standard traffic document amounts: fare and up to three taxes. */
  BKS30: [
    RNAM,
    field("TRNN", "Transaction number", 6, 6, "N"),
    field("TDNR", "Ticket/document number", 12, 15, "A"),
    field("COBL", "Commissionable amount", 27, 11, "N"),
    field("TMFT1", "Tax/fee type 1", 38, 8, "A"),
    field("TMFA1", "Tax/fee amount 1", 46, 11, "N"),
    field("TMFT2", "Tax/fee type 2", 57, 8, "A"),
    field("TMFA2", "Tax/fee amount 2", 65, 11, "N"),
    field("TMFT3", "Tax/fee type 3", 76, 8, "A"),
    field("TMFA3", "Tax/fee amount 3", 84, 11, "N"),
    field("TDAM", "Ticket/document total amount", 95, 11, "N"),
    field("CUTP", "Currency type", 106, 4, "A"),
  ],
  /** Commission. */
  BKS39: [
    RNAM,
    field("TRNN", "Transaction number", 6, 6, "N"),
    field("TDNR", "Ticket/document number", 12, 15, "A"),
    field("COTP", "Commission type", 27, 6, "A"),
    field("CORT", "Commission rate, two implied decimals", 33, 5, "N"),
    field("COAM", "Commission amount", 38, 11, "N"),
    field("SPAM", "Supplementary commission amount", 49, 11, "N"),
    field("TOCA", "Tax on commission amount", 60, 11, "N"),
  ],
  /** Form of payment. The account number element is never populated by AIS. */
  BKP84: [
    RNAM,
    field("TRNN", "Transaction number", 6, 6, "N"),
    field("TDNR", "Ticket/document number", 12, 15, "A"),
    field("FPTP", "Form of payment type", 27, 10, "A"),
    field("FPAM", "Form of payment amount", 37, 11, "N"),
    field("FPAC", "Form of payment account number", 48, 19, "A"),
    field("CUTP", "Currency type", 67, 4, "A"),
  ],
  /** Office totals (HOT): remittance per agent. */
  BOT93: [
    RNAM,
    field("AGTN", "Agent numeric code", 6, 8, "N"),
    field("CUTP", "Currency type", 14, 4, "A"),
    field("TCNT", "Transaction count", 18, 8, "N"),
    field("TFAR", "Total commissionable amount", 26, 15, "N"),
    field("TTAX", "Total tax", 41, 15, "N"),
    field("TCOM", "Total commission", 56, 15, "N"),
    field("TRSG", "Remittance sign", 71, 1, "A"),
    field("TREM", "Total remittance", 72, 15, "N"),
  ],
  /** Country/currency totals: the control totals of a file. */
  BCT95: [
    RNAM,
    field("CUTP", "Currency type", 6, 4, "A"),
    field("TCNT", "Transaction count", 10, 8, "N"),
    field("TFAR", "Total commissionable amount", 18, 15, "N"),
    field("TTAX", "Total tax", 33, 15, "N"),
    field("TCOM", "Total commission", 48, 15, "N"),
    field("TNSG", "Net remittance sign", 63, 1, "A"),
    field("TNET", "Net remittance", 64, 15, "N"),
    field("TSAL", "Gross sales", 79, 15, "N"),
    field("TRFD", "Gross refunds", 94, 15, "N"),
  ],
  /** File trailer. */
  BFT99: [
    RNAM,
    field("RCNT", "Record count including header and trailer", 6, 8, "N"),
    field("TCNT", "Transaction count", 14, 8, "N"),
    field("CCNT", "Count of BCT95 records", 22, 8, "N"),
  ],
};

export const dishRecordNames = Object.keys(dishLayouts) as DishRecordName[];

/** Records the airline populates in the outbound RET. */
export const retRecordNames: readonly DishRecordName[] = [
  "BFH01",
  "BCH02",
  "BKT06",
  "BKS30",
  "BKS39",
  "BKP84",
  "BCT95",
  "BFT99",
];

/** Records the airline reads from the inbound HOT. */
export const hotRecordNames: readonly DishRecordName[] = [
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

export type DishTransactionCode = "TKTT" | "RFND" | "EMDS" | "EMDA";
export const dishTransactionCodes: readonly DishTransactionCode[] = [
  "TKTT",
  "RFND",
  "EMDS",
  "EMDA",
];

/** Layout sanity: fields are contiguous, in order, and fit inside the record. */
export function assertLayoutIntegrity(
  name: DishRecordName,
  layout: readonly DishField[] = dishLayouts[name]
): void {
  let next = 1;
  for (const f of layout) {
    if (f.start !== next)
      throw new Error(
        `${name}.${f.code} starts at ${f.start}, expected ${next}`
      );
    if (f.length < 1) throw new Error(`${name}.${f.code} has no length`);
    next += f.length;
  }
  if (next - 1 > DISH_RECORD_WIDTH)
    throw new Error(`${name} exceeds ${DISH_RECORD_WIDTH} characters`);
}
