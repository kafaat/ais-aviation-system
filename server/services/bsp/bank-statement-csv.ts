/**
 * Bank statement CSV import for BSP remittances.
 *
 * Expected columns (header row, case-insensitive, any order):
 *   date | value_date | valueDate   civil date YYYY-MM-DD
 *   amount                          decimal in major units, "." separator,
 *                                   at most two decimals, sign allowed
 *   reference                       free text, up to 140 characters
 *   currency                        optional ISO 4217; defaults to the import currency
 *   counterparty                    optional, up to 140 characters
 * Account numbers are not read even when present.
 */

export interface BankStatementLine {
  lineNumber: number;
  valueDate: string;
  amount: number; // minor units, signed
  currency: string;
  reference: string;
  counterparty: string | null;
}

export class BankStatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankStatementError";
  }
}

const DATE_COLUMNS = ["date", "value_date", "valuedate"];

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw new BankStatementError("Unterminated quoted field");
  out.push(cell);
  return out.map(c => c.trim());
}

export function majorToMinor(text: string, lineNumber: number): number {
  const m = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.replaceAll(",", ""));
  if (!m)
    throw new BankStatementError(
      `Line ${lineNumber}: amount "${text}" must be a decimal with at most two places`
    );
  const minor = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor))
    throw new BankStatementError(`Line ${lineNumber}: amount out of range`);
  return m[1] === "-" ? -minor : minor;
}

export function parseBankStatementCsv(
  content: string,
  defaultCurrency: string
): BankStatementLine[] {
  const rows = content
    .split(/\r?\n/)
    .map((l, i) => ({ text: l, lineNumber: i + 1 }))
    .filter(r => r.text.trim() !== "");
  if (rows.length < 2)
    throw new BankStatementError("CSV needs a header row and one line");
  const header = splitCsvLine(rows[0].text).map(h => h.toLowerCase());
  const col = (names: string[]) => header.findIndex(h => names.includes(h));
  const dateCol = col(DATE_COLUMNS);
  const amountCol = col(["amount"]);
  const referenceCol = col(["reference"]);
  const currencyCol = col(["currency"]);
  const counterpartyCol = col(["counterparty"]);
  if (dateCol < 0 || amountCol < 0 || referenceCol < 0)
    throw new BankStatementError(
      "CSV header must contain date, amount and reference columns"
    );
  return rows.slice(1).map(({ text, lineNumber }) => {
    const cells = splitCsvLine(text);
    const valueDate = cells[dateCol] ?? "";
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(valueDate) ||
      Number.isNaN(Date.parse(valueDate))
    )
      throw new BankStatementError(
        `Line ${lineNumber}: date "${valueDate}" must be YYYY-MM-DD`
      );
    const reference = (cells[referenceCol] ?? "").slice(0, 140);
    if (!reference)
      throw new BankStatementError(`Line ${lineNumber}: reference is required`);
    const currency = (
      currencyCol >= 0 && cells[currencyCol]
        ? cells[currencyCol]
        : defaultCurrency
    ).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
      throw new BankStatementError(`Line ${lineNumber}: invalid currency`);
    return {
      lineNumber,
      valueDate,
      amount: majorToMinor(cells[amountCol] ?? "", lineNumber),
      currency,
      reference,
      counterparty:
        counterpartyCol >= 0 && cells[counterpartyCol]
          ? cells[counterpartyCol].slice(0, 140)
          : null,
    };
  });
}
