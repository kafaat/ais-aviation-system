// Jurisdiction determination. Every outcome names the scope article it rests
// on so a reviewer can see why KSA, EU, UK or US rules were (not) applied.
import type {
  ItineraryContext,
  Jurisdiction,
  JurisdictionDetermination,
  RuleSet,
} from "./types";

/** EU member states plus EEA states and Switzerland, to which 261/2004 extends. */
export const EU261_TERRITORY = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  // EEA Agreement and EU-Swiss air transport agreement
  "IS",
  "NO",
  "LI",
  "CH",
]);

/** Country labels found in airport and airline records, mapped to ISO 3166-1 alpha-2. */
const COUNTRY_ALIASES: Record<string, string> = {
  "saudi arabia": "SA",
  "kingdom of saudi arabia": "SA",
  ksa: "SA",
  السعودية: "SA",
  "المملكة العربية السعودية": "SA",
  "united kingdom": "GB",
  uk: "GB",
  "great britain": "GB",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "united arab emirates": "AE",
  uae: "AE",
  france: "FR",
  germany: "DE",
  netherlands: "NL",
  spain: "ES",
  italy: "IT",
  egypt: "EG",
  turkey: "TR",
  türkiye: "TR",
  india: "IN",
  singapore: "SG",
  malaysia: "MY",
  switzerland: "CH",
  norway: "NO",
  iceland: "IS",
  ireland: "IE",
};

export function normalizeCountry(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return COUNTRY_ALIASES[trimmed.toLowerCase()] ?? trimmed.toUpperCase();
}

function withinEffectiveWindow(set: RuleSet, atMs: number) {
  if (set.effectiveFrom === null) return false;
  if (atMs < Date.parse(set.effectiveFrom)) return false;
  if (set.effectiveTo !== null && atMs > Date.parse(set.effectiveTo))
    return false;
  return true;
}

export function determineJurisdictions(
  itinerary: ItineraryContext,
  evaluatedAt: string,
  ruleSets: RuleSet[]
): JurisdictionDetermination[] {
  const dep = normalizeCountry(itinerary.departure.country);
  const arr = normalizeCountry(itinerary.arrival.country);
  const carrier = normalizeCountry(itinerary.operatingCarrier.country);
  const atMs = Date.parse(evaluatedAt);
  const results: JurisdictionDetermination[] = [];
  for (const set of ruleSets) {
    const scope = scopeFor(set.jurisdiction, dep, arr, carrier);
    let status = scope.status;
    const reasons = [...scope.reasons];
    if (status === "applicable" || status === "requires_review") {
      if (!withinEffectiveWindow(set, atMs)) {
        status = "not_yet_applicable";
        reasons.push(
          set.effectiveFrom === null
            ? "Application date not yet confirmed; rule set kept for planning only"
            : `Outside the effective window starting ${set.effectiveFrom}`
        );
      }
    }
    results.push({
      jurisdiction: set.jurisdiction,
      status,
      reasons,
      basis: scope.basis,
      version: set.version,
    });
  }
  return results;
}

function scopeFor(
  jurisdiction: Jurisdiction,
  dep: string,
  arr: string,
  carrier: string
): Pick<JurisdictionDetermination, "status" | "reasons" | "basis"> {
  switch (jurisdiction) {
    case "KSA-GACA-2023": {
      const basis =
        "GACA Customer Rights Protection Regulation, scope article (Arabic text governs)";
      if (dep === "SA")
        return {
          status: "applicable",
          basis,
          reasons: [`Departure from a KSA airport (${dep})`],
        };
      if (arr === "SA" && carrier === "SA")
        return {
          status: "applicable",
          basis,
          reasons: [
            `Arrival at a KSA airport (${arr}) on a Saudi carrier (${carrier})`,
          ],
        };
      if (arr === "SA")
        return {
          status: "requires_review",
          basis,
          reasons: [
            `Arrival at a KSA airport (${arr}) on a foreign carrier (${carrier}); scope for foreign-carrier arrivals is unconfirmed in the sources`,
          ],
        };
      return {
        status: "not_applicable",
        basis,
        reasons: [`Neither departure (${dep}) nor arrival (${arr}) is in KSA`],
      };
    }
    case "EU261-2004":
    case "EU261-2026-amended": {
      const basis = "Regulation (EC) 261/2004, Article 3(1)";
      if (EU261_TERRITORY.has(dep))
        return {
          status: "applicable",
          basis,
          reasons: [
            `Departure from an airport in EU/EEA/CH territory (${dep}), Article 3(1)(a)`,
          ],
        };
      if (EU261_TERRITORY.has(arr) && EU261_TERRITORY.has(carrier))
        return {
          status: "applicable",
          basis,
          reasons: [
            `Arrival in EU/EEA/CH territory (${arr}) from a third country on a Community carrier (${carrier}), Article 3(1)(b)`,
          ],
        };
      if (EU261_TERRITORY.has(arr))
        return {
          status: "not_applicable",
          basis,
          reasons: [
            `Arrival in EU/EEA/CH territory (${arr}) on a non-Community carrier (${carrier}); Article 3(1)(b) requires a Community carrier`,
          ],
        };
      return {
        status: "not_applicable",
        basis,
        reasons: [
          `Neither departure (${dep}) nor arrival (${arr}) is in EU/EEA/CH territory`,
        ],
      };
    }
    case "UK261": {
      const basis = "Retained Regulation 261/2004 (UK), Article 3(1)";
      if (dep === "GB")
        return {
          status: "applicable",
          basis,
          reasons: [`Departure from a UK airport (${dep})`],
        };
      if (arr === "GB" && (carrier === "GB" || EU261_TERRITORY.has(carrier)))
        return {
          status: "applicable",
          basis,
          reasons: [
            `Arrival in the UK (${arr}) on a UK or Community carrier (${carrier})`,
          ],
        };
      if (arr === "GB")
        return {
          status: "not_applicable",
          basis,
          reasons: [
            `Arrival in the UK (${arr}) on a carrier outside the UK/EU (${carrier})`,
          ],
        };
      return {
        status: "not_applicable",
        basis,
        reasons: [
          `Neither departure (${dep}) nor arrival (${arr}) is in the UK`,
        ],
      };
    }
    case "US-DOT-14CFR260": {
      const basis =
        "14 CFR Part 260 (flights to, from or within the United States)";
      if (dep === "US" || arr === "US")
        return {
          status: "applicable",
          basis,
          reasons: [
            dep === "US"
              ? `Departure from a US airport (${dep})`
              : `Arrival at a US airport (${arr})`,
            "Applies to US and foreign carriers alike",
          ],
        };
      return {
        status: "not_applicable",
        basis,
        reasons: [
          `Neither departure (${dep}) nor arrival (${arr}) is in the US`,
        ],
      };
    }
  }
}
