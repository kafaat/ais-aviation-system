/**
 * Itinerary tax rules.
 *
 * Decides VAT applicability for one flight segment from the countries of its
 * origin and destination airports. The rate table below is operator-confirmable
 * configuration seeded from public ZATCA guidance, not certified tax law:
 *
 * - KSA VAT Implementing Regulations, Article 34 (zero-rating of international
 *   transport of passengers and goods) and the standard rate of 15% in force
 *   since 1 July 2020:
 *   https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/VAT-Implementing-Regulations.aspx
 * - ZATCA "Transportation Sector" VAT guideline (domestic passenger transport at
 *   the standard rate; international transport zero-rated):
 *   https://zatca.gov.sa/en/HelpCenter/guidelines/Pages/default.aspx
 *
 * The operator's tax adviser must confirm the table before go-live; an entry
 * that is not confirmed yields `confirmed: false` on every decision so callers
 * can surface that in reporting.
 */

export type VatApplicability =
  | "domestic_standard"
  | "international_zero_rated"
  | "out_of_scope"
  | "unresolved";

export interface VatRule {
  applicability: VatApplicability;
  /** Taxing jurisdiction (ISO 3166-1 alpha-2) or null when unresolved. */
  jurisdiction: string | null;
  /** Basis points: 1500 = 15.00%. */
  rateBasisPoints: number;
  code: "VAT";
  /** False until the operator confirms the rate table for this jurisdiction. */
  confirmed: boolean;
  source: string;
}

export interface JurisdictionVatConfig {
  /** Country code of the operator's VAT registration. */
  country: string;
  domesticRateBasisPoints: number;
  internationalRateBasisPoints: number;
  confirmed: boolean;
  source: string;
}

/** Default table. Replace or extend via `resolveSegmentVat(..., config)`. */
export const DEFAULT_VAT_CONFIG: JurisdictionVatConfig = {
  country: "SA",
  domesticRateBasisPoints: 1500,
  internationalRateBasisPoints: 0,
  confirmed: false,
  source:
    "https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/VAT-Implementing-Regulations.aspx",
};

const COUNTRY_ALIASES: Record<string, string> = {
  SA: "SA",
  SAU: "SA",
  KSA: "SA",
  "SAUDI ARABIA": "SA",
  "KINGDOM OF SAUDI ARABIA": "SA",
  "المملكة العربية السعودية": "SA",
  السعودية: "SA",
};

/** Airport rows store either ISO codes or display names; normalise both. */
export function normalizeCountry(value: string | null | undefined) {
  if (!value) return null;
  const key = value.trim().toUpperCase();
  if (!key) return null;
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  return /^[A-Z]{2}$/.test(key) ? key : null;
}

export function resolveSegmentVat(
  segment: {
    originCountry: string | null | undefined;
    destinationCountry: string | null | undefined;
  },
  config: JurisdictionVatConfig = DEFAULT_VAT_CONFIG
): VatRule {
  const origin = normalizeCountry(segment.originCountry);
  const destination = normalizeCountry(segment.destinationCountry);
  const base = {
    code: "VAT" as const,
    confirmed: config.confirmed,
    source: config.source,
  };
  if (!origin || !destination)
    return {
      ...base,
      applicability: "unresolved",
      jurisdiction: null,
      rateBasisPoints: 0,
    };
  if (origin === config.country && destination === config.country)
    return {
      ...base,
      applicability: "domestic_standard",
      jurisdiction: config.country,
      rateBasisPoints: config.domesticRateBasisPoints,
    };
  if (origin === config.country || destination === config.country)
    return {
      ...base,
      applicability: "international_zero_rated",
      jurisdiction: config.country,
      rateBasisPoints: config.internationalRateBasisPoints,
    };
  return {
    ...base,
    applicability: "out_of_scope",
    jurisdiction: null,
    rateBasisPoints: 0,
  };
}

/** Rate as a fraction (0.15) for callers that still price as `net * rate`. */
export function vatFraction(rule: Pick<VatRule, "rateBasisPoints">) {
  return rule.rateBasisPoints / 10000;
}

/** Split a VAT-inclusive minor-unit amount into net and VAT; net + vat === gross. */
export function splitGross(
  gross: number,
  rule: Pick<VatRule, "rateBasisPoints">
) {
  if (!Number.isSafeInteger(gross))
    throw new Error("Gross must be integer minor units");
  const rate = rule.rateBasisPoints;
  if (rate <= 0) return { net: gross, vat: 0 };
  const vat = Math.round((gross * rate) / (10000 + rate));
  return { net: gross - vat, vat };
}

/** VAT on a net minor-unit amount. */
export function vatOnNet(net: number, rule: Pick<VatRule, "rateBasisPoints">) {
  if (!Number.isSafeInteger(net))
    throw new Error("Net must be integer minor units");
  return Math.round((net * rule.rateBasisPoints) / 10000);
}
