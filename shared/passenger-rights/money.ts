// Exact money arithmetic for the passenger-rights engine. Rates are decimal
// strings from a dated FX record and are scaled to integers; nothing is
// multiplied as a float.
import type { FxRecord } from "./types";

const MAX_INT = 2_147_483_647;

/** Parse "5.123456" into a scaled integer: { mantissa: 5123456n, scale: 6 }. */
export function parseDecimalRate(rate: string): {
  mantissa: bigint;
  scale: number;
} {
  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(rate.trim());
  if (!match) throw new RangeError(`Invalid decimal rate: ${rate}`);
  const [, whole, fraction = ""] = match;
  const mantissa = BigInt(whole + fraction);
  if (mantissa <= 0n) throw new RangeError("Rate must be positive");
  return { mantissa, scale: fraction.length };
}

/** amountMinor * rate, rounded half up to integer minor units. */
export function convertMinorUnits(amountMinor: number, rate: string): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new RangeError("Amount must be a nonnegative integer");
  const { mantissa, scale } = parseDecimalRate(rate);
  const divisor = 10n ** BigInt(scale);
  const product = BigInt(amountMinor) * mantissa;
  const result = (product + divisor / 2n) / divisor;
  if (result > BigInt(MAX_INT))
    throw new RangeError("Converted amount exceeds supported amount");
  return Number(result);
}

/** Percent of an amount, rounded half up; percent may exceed 100. */
export function percentOf(amountMinor: number, percent: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new RangeError("Amount must be a nonnegative integer");
  if (!Number.isSafeInteger(percent) || percent < 0)
    throw new RangeError("Percent must be a nonnegative integer");
  const result = (BigInt(amountMinor) * BigInt(percent) + 50n) / 100n;
  if (result > BigInt(MAX_INT))
    throw new RangeError("Amount exceeds supported amount");
  return Number(result);
}

/**
 * Latest record for the pair whose validity started on or before `asOf`.
 * Only direct quotes are used so the audit trail names the actual record.
 */
export function selectFxRecord(
  records: FxRecord[],
  fromCurrency: string,
  toCurrency: string,
  asOf: string
): FxRecord | null {
  const asOfMs = Date.parse(asOf);
  let best: FxRecord | null = null;
  for (const record of records) {
    if (
      record.fromCurrency !== fromCurrency ||
      record.toCurrency !== toCurrency
    )
      continue;
    const validMs = Date.parse(record.validFrom);
    if (!Number.isFinite(validMs) || validMs > asOfMs) continue;
    if (!best || validMs > Date.parse(best.validFrom)) best = record;
  }
  return best;
}

/** Monday to Friday count. US federal holidays are not modelled. */
export function addBusinessDays(start: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 0)
    throw new RangeError("Business days must be a nonnegative integer");
  const result = new Date(start.getTime());
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

export function addCalendarDays(start: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 0)
    throw new RangeError("Calendar days must be a nonnegative integer");
  const result = new Date(start.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
