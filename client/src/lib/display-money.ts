import {
  DISPLAY_RATE_SOURCES,
  DISPLAY_RATE_MAX_AGE_MS,
} from "@shared/ibe-search";
export type DisplayRate = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: string;
  updatedAt: Date | string;
  expiresAt: Date | string;
};

/** Display conversions only use fresh observed rates, never static fallbacks. */
export function displayEstimate(
  amountMinor: number,
  currency: string,
  rate: DisplayRate | null | undefined,
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
    !DISPLAY_RATE_SOURCES.some(source => source === rate.source)
  )
    return null;
  const age = now - new Date(rate.updatedAt).getTime();
  const expiry = new Date(rate.expiresAt).getTime();
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age >= DISPLAY_RATE_MAX_AGE_MS ||
    !(now < expiry)
  )
    return null;
  const amount = (amountMinor / 100) * rate.rate;
  return Number.isFinite(amount) ? amount : null;
}
