/**
 * Encoding and decoding of 255-character DISH records against the layout
 * table. Pure functions; no I/O.
 */
import {
  DISH_RECORD_WIDTH,
  dishLayouts,
  dishRecordNames,
  type DishField,
  type DishRecordName,
} from "./dish-layouts";

export type DishValues = Record<string, string | number | undefined>;

export class DishFormatError extends Error {
  constructor(
    message: string,
    readonly record: string,
    readonly fieldCode: string
  ) {
    super(`${record}.${fieldCode}: ${message}`);
    this.name = "DishFormatError";
  }
}

/** Only the printable ASCII subset DISH records may carry. */
const PRINTABLE = /^[\x20-\x7E]*$/;

function encodeField(record: DishRecordName, f: DishField, raw: unknown) {
  if (f.type === "N") {
    const n = typeof raw === "string" ? Number(raw) : (raw ?? 0);
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0)
      throw new DishFormatError(
        "numeric field requires a non-negative integer",
        record,
        f.code
      );
    const text = String(n);
    if (text.length > f.length)
      throw new DishFormatError(
        `${text} does not fit in ${f.length} digits`,
        record,
        f.code
      );
    return text.padStart(f.length, "0");
  }
  const text = raw === undefined || raw === null ? "" : String(raw);
  if (!PRINTABLE.test(text))
    throw new DishFormatError(
      "alphanumeric field has non-printable characters",
      record,
      f.code
    );
  if (text.length > f.length)
    throw new DishFormatError(
      `"${text}" exceeds ${f.length} characters`,
      record,
      f.code
    );
  return text.padEnd(f.length, " ");
}

/** Build one record. Every field is validated for type and width; the record
 * is padded with spaces to exactly {@link DISH_RECORD_WIDTH} characters. */
export function formatRecord(name: DishRecordName, values: DishValues): string {
  const layout = dishLayouts[name];
  const parts = layout.map(f =>
    encodeField(name, f, f.code === "RNAM" ? name : values[f.code])
  );
  const body = parts.join("");
  if (body.length > DISH_RECORD_WIDTH)
    throw new DishFormatError("record exceeds width", name, "RNAM");
  return body.padEnd(DISH_RECORD_WIDTH, " ");
}

export interface ParsedRecord {
  line: number;
  name: DishRecordName;
  values: Record<string, string>;
}

export interface UnknownRecord {
  line: number;
  name: string;
}

export function isDishRecordName(value: string): value is DishRecordName {
  return (dishRecordNames as string[]).includes(value);
}

/** Decode one record. Alphanumeric fields are right-trimmed; numeric fields
 * are kept as digit strings so callers decide the unit. */
export function parseRecord(line: number, text: string): ParsedRecord {
  if (text.length !== DISH_RECORD_WIDTH)
    throw new Error(
      `Line ${line}: record is ${text.length} characters, expected ${DISH_RECORD_WIDTH}`
    );
  const name = text.slice(0, 5);
  if (!isDishRecordName(name))
    throw new Error(`Line ${line}: unknown record ${name}`);
  const values: Record<string, string> = {};
  for (const f of dishLayouts[name]) {
    const raw = text.slice(f.start - 1, f.start - 1 + f.length);
    if (f.type === "N") {
      if (!/^\d+$/.test(raw))
        throw new Error(`Line ${line}: ${name}.${f.code} is not numeric`);
      values[f.code] = raw;
    } else values[f.code] = raw.trimEnd();
  }
  return { line, name, values };
}

/** Split file content into records. Trailing newline is tolerated; CRLF and
 * LF are both accepted because the transport, not DISH, fixes the separator. */
export function splitRecords(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function numeric(values: Record<string, string>, code: string): number {
  const raw = values[code];
  if (raw === undefined) throw new Error(`Missing numeric element ${code}`);
  return Number(raw);
}

/** YYMMDD as a civil date; two-digit years are read in the 2000s. */
export function dishDateToCivil(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd) || yymmdd === "000000") return null;
  return `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

export function civilToDishDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd))
    throw new Error(`Civil date expected, got ${ymd}`);
  return ymd.slice(2, 4) + ymd.slice(5, 7) + ymd.slice(8, 10);
}
