export type DisplayRate = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: string;
  updatedAt: Date | string;
};

/** Display conversions only use fresh observed rates, never static fallbacks. */
export function displayEstimate(
  amountMinor: number,
  currency: string,
  rate: DisplayRate | undefined,
  now = Date.now()
): number | null {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    !rate ||
    rate.fromCurrency !== "SAR" ||
    rate.toCurrency !== currency ||
    !Number.isFinite(rate.rate) ||
    rate.rate <= 0 ||
    rate.source === "fallback" ||
    rate.source === "cross_rate"
  )
    return null;
  const age = now - new Date(rate.updatedAt).getTime();
  if (!Number.isFinite(age) || age < -60_000 || age > 24 * 60 * 60 * 1000)
    return null;
  const amount = (amountMinor / 100) * rate.rate;
  return Number.isFinite(amount) ? amount : null;
}
