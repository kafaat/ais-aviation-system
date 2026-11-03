/**
 * Entry/transit requirement rules and their evaluation (pre-boarding
 * document verification, GACA circular August 2026).
 *
 * This module is pure. Rules come from `entry_requirement_rules` (imported
 * from a named official or commercial source with URL and effective dates) or
 * from an `EntryRulesSource` adapter such as a Timatic AutoCheck-style
 * service. No real-country rule is hard-coded here: the engine has no opinion
 * on who needs a visa where, only on how to apply rules it is given.
 *
 * Verdicts: `go` (documents satisfy every confirmed rule on the itinerary),
 * `no_go` (a rule is violated: expired document, insufficient validity, visa
 * required and none held), `manual_review` (the engine cannot decide: no
 * rule, unconfirmed source, missing document data, eVisa approval not on
 * file). Only a confirmed rule may produce `go`; unconfirmed and fictional
 * rules are downgraded to `manual_review` unless the caller explicitly opts
 * out, which the service does only in non-production environments.
 */
import { z } from "zod";

export const countryCode = z
  .string()
  .regex(/^[A-Za-z]{2,3}$/)
  .transform(v => v.toUpperCase());

export const visaRequirementSchema = z.enum([
  "none",
  "visa_required",
  "evisa",
  "visa_on_arrival",
  "transit_without_visa",
]);
export type VisaRequirement = z.infer<typeof visaRequirementSchema>;

export const ruleDocumentTypeSchema = z.enum([
  "passport",
  "national_id",
  "visa",
  "*",
]);

export const confirmationStatusSchema = z.enum([
  "confirmed",
  "unconfirmed",
  "fictional_fixture",
]);
export type ConfirmationStatus = z.infer<typeof confirmationStatusSchema>;

export const entryRuleInputSchema = z
  .object({
    destinationCountry: countryCode,
    nationality: z.union([z.literal("*"), countryCode]),
    documentType: ruleDocumentTypeSchema,
    visaRequirement: visaRequirementSchema,
    transitWithoutVisaHours: z.number().int().min(1).max(240).nullable(),
    passportValidityMonths: z.number().int().min(0).max(24),
    blankPagesRequired: z.number().int().min(0).max(8),
    sourceName: z.string().min(1).max(120),
    sourceUrl: z.string().url().max(500),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().nullable(),
    confirmationStatus: confirmationStatusSchema,
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (
      rule.visaRequirement === "transit_without_visa" &&
      rule.transitWithoutVisaHours === null
    )
      ctx.addIssue({
        code: "custom",
        path: ["transitWithoutVisaHours"],
        message: "Transit-without-visa rules need the permitted hours",
      });
    if (rule.effectiveTo && rule.effectiveTo <= rule.effectiveFrom)
      ctx.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "effectiveTo must follow effectiveFrom",
      });
  });
export type EntryRuleInput = z.infer<typeof entryRuleInputSchema>;

export interface EntryRule extends EntryRuleInput {
  id: number;
  isActive: boolean;
}

export interface TravellerDocument {
  documentType: "passport" | "national_id" | "visa";
  documentNumber: string | null;
  nationality: string | null;
  issuingCountry: string | null;
  expiryDate: Date | null;
  /** Visas on file for destination countries (apis_data `visa` documents). */
  visasHeld: Array<{ country: string }>;
}

export interface ItineraryLeg {
  originCountry: string;
  destinationCountry: string;
  departureTime: Date;
  arrivalTime: Date;
}

export interface VerificationReason {
  code: string;
  message: string;
  severity: "block" | "review" | "info";
  ruleId?: number;
  country?: string;
}

export type Verdict = "go" | "no_go" | "manual_review";

export interface VerificationOutcome {
  verdict: Verdict;
  reasons: VerificationReason[];
  rulesApplied: number[];
  /** Countries whose entry/transit requirements were evaluated. */
  countriesEvaluated: string[];
}

export interface EvaluationOptions {
  now: Date;
  /** Default true: unconfirmed/fictional rules cannot yield `go`. */
  requireConfirmedSource?: boolean;
}

/** A connection longer than this is a stopover: the passenger enters that
 * country and the journey being verified ends there. */
export const MAX_CONNECTION_HOURS = 24;

/** The journey from the first leg: intermediate arrival countries with dwell
 * time until the next departure (transit), and the country where the journey
 * ends (destination). Legs after a stopover belong to a later journey. */
export function itineraryStops(legs: ItineraryLeg[]) {
  const sorted = [...legs].sort(
    (a, b) => a.departureTime.getTime() - b.departureTime.getTime()
  );
  const ordered: ItineraryLeg[] = [];
  const stops: Array<{
    country: string;
    arrival: Date;
    dwellHours: number | null;
    kind: "transit" | "destination";
  }> = [];
  for (const [i, leg] of sorted.entries()) {
    ordered.push(leg);
    const next = sorted[i + 1];
    const dwellHours = next
      ? (next.departureTime.getTime() - leg.arrivalTime.getTime()) / 3600_000
      : null;
    if (dwellHours === null || dwellHours > MAX_CONNECTION_HOURS) {
      stops.push({
        country: leg.destinationCountry,
        arrival: leg.arrivalTime,
        dwellHours: null,
        kind: "destination",
      });
      break;
    }
    // A same-country connection is not an international transit point.
    if (leg.destinationCountry === next.destinationCountry) continue;
    stops.push({
      country: leg.destinationCountry,
      arrival: leg.arrivalTime,
      dwellHours,
      kind: "transit",
    });
  }
  return { ordered, stops };
}

/** Most specific active rule in force at `at`: exact nationality beats "*",
 * exact document type beats "*". Returns null when nothing applies. */
export function selectRule(
  rules: EntryRule[],
  query: {
    destinationCountry: string;
    nationality: string;
    documentType: TravellerDocument["documentType"];
    at: Date;
  }
): EntryRule | null {
  const candidates = rules.filter(
    r =>
      r.isActive &&
      r.destinationCountry === query.destinationCountry &&
      (r.nationality === "*" || r.nationality === query.nationality) &&
      (r.documentType === "*" || r.documentType === query.documentType) &&
      r.effectiveFrom.getTime() <= query.at.getTime() &&
      (!r.effectiveTo || r.effectiveTo.getTime() > query.at.getTime())
  );
  candidates.sort(
    (a, b) =>
      specificity(b, query.nationality) - specificity(a, query.nationality) ||
      b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
  );
  return candidates[0] ?? null;
}

function specificity(rule: EntryRule, nationality: string): number {
  return (
    (rule.nationality === nationality ? 2 : 0) +
    (rule.documentType !== "*" ? 1 : 0)
  );
}

export function monthsBetween(from: Date, to: Date): number {
  // Calendar months fully remaining from `from` to `to` (UTC).
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

export function evaluateEntryRequirements(
  document: TravellerDocument | null,
  legs: ItineraryLeg[],
  rules: EntryRule[],
  options: EvaluationOptions
): VerificationOutcome {
  const requireConfirmed = options.requireConfirmedSource !== false;
  const reasons: VerificationReason[] = [];
  const rulesApplied: number[] = [];
  if (!legs.length)
    return {
      verdict: "manual_review",
      reasons: [
        {
          code: "itinerary_missing",
          message: "No itinerary legs to evaluate",
          severity: "review",
        },
      ],
      rulesApplied,
      countriesEvaluated: [],
    };
  // Domestic itineraries are decided before any stop arithmetic.
  const countries = new Set(
    legs.flatMap(l => [l.originCountry, l.destinationCountry])
  );
  if (countries.size === 1)
    return {
      verdict: "go",
      reasons: [
        {
          code: "domestic_itinerary",
          message:
            "Domestic itinerary: no entry or transit requirements evaluated",
          severity: "info",
        },
      ],
      rulesApplied,
      countriesEvaluated: [],
    };
  const { ordered, stops } = itineraryStops(legs);
  const lastArrival = ordered[ordered.length - 1].arrivalTime;
  if (!document || !document.nationality) {
    return {
      verdict: "manual_review",
      reasons: [
        {
          code: "document_missing",
          message:
            "No travel document or nationality on file; the agent must inspect the physical document",
          severity: "review",
        },
      ],
      rulesApplied,
      countriesEvaluated: stops.map(s => s.country),
    };
  }
  if (document.expiryDate && document.expiryDate <= options.now)
    reasons.push({
      code: "document_expired",
      message: "Travel document has expired",
      severity: "block",
    });
  else if (document.expiryDate && document.expiryDate <= lastArrival)
    reasons.push({
      code: "document_expires_before_arrival",
      message:
        "Travel document expires before arrival at the final destination",
      severity: "block",
    });
  if (!document.expiryDate)
    reasons.push({
      code: "expiry_unknown",
      message: "Document expiry date is not on file",
      severity: "review",
    });

  for (const stop of stops) {
    if (stop.country === document.nationality) {
      // Nationals are not subject to their own country's visa rules; document
      // validity is still checked above.
      reasons.push({
        code: "own_nationality",
        country: stop.country,
        message: `${stop.country}: traveller is a national; no visa rule evaluated`,
        severity: "info",
      });
      continue;
    }
    const rule = selectRule(rules, {
      destinationCountry: stop.country,
      nationality: document.nationality,
      documentType: document.documentType,
      at: stop.arrival,
    });
    if (!rule) {
      reasons.push({
        code: stop.kind === "transit" ? "transit_rule_missing" : "rule_missing",
        country: stop.country,
        message: `No ${stop.kind} requirement rule on file for ${stop.country} / ${document.nationality} / ${document.documentType}`,
        severity: "review",
      });
      continue;
    }
    rulesApplied.push(rule.id);
    if (requireConfirmed && rule.confirmationStatus !== "confirmed")
      reasons.push({
        code: "rule_unconfirmed",
        country: stop.country,
        ruleId: rule.id,
        message: `Rule for ${stop.country} comes from an ${rule.confirmationStatus === "fictional_fixture" ? "fictional test fixture" : "unconfirmed source"} (${rule.sourceName}); agent confirmation required`,
        severity: "review",
      });
    if (
      rule.passportValidityMonths > 0 &&
      document.expiryDate &&
      monthsBetween(stop.arrival, document.expiryDate) <
        rule.passportValidityMonths
    )
      reasons.push({
        code: "validity_insufficient",
        country: stop.country,
        ruleId: rule.id,
        message: `${stop.country} requires ${rule.passportValidityMonths} month(s) of document validity beyond arrival`,
        severity: "block",
      });
    if (rule.blankPagesRequired > 0)
      reasons.push({
        code: "blank_pages_unverifiable",
        country: stop.country,
        ruleId: rule.id,
        message: `${stop.country} requires ${rule.blankPagesRequired} blank page(s); not verifiable electronically`,
        severity: "info",
      });
    const visaHeld = document.visasHeld.some(v => v.country === stop.country);
    let requirement: VisaRequirement = rule.visaRequirement;
    if (requirement === "transit_without_visa") {
      if (
        stop.kind === "transit" &&
        stop.dwellHours !== null &&
        rule.transitWithoutVisaHours !== null &&
        stop.dwellHours <= rule.transitWithoutVisaHours
      ) {
        reasons.push({
          code: "transit_without_visa",
          country: stop.country,
          ruleId: rule.id,
          message: `Transit through ${stop.country} within ${rule.transitWithoutVisaHours}h is visa free`,
          severity: "info",
        });
        continue;
      }
      requirement = "visa_required";
      if (stop.kind === "transit")
        reasons.push({
          code: "transit_exceeds_twov",
          country: stop.country,
          ruleId: rule.id,
          message: `Transit dwell in ${stop.country} exceeds the ${rule.transitWithoutVisaHours}h visa-free window`,
          severity: "info",
        });
    }
    switch (requirement) {
      case "none":
        reasons.push({
          code: "visa_not_required",
          country: stop.country,
          ruleId: rule.id,
          message: `${stop.country}: no visa required for ${document.nationality}`,
          severity: "info",
        });
        break;
      case "visa_on_arrival":
        reasons.push({
          code: "visa_on_arrival",
          country: stop.country,
          ruleId: rule.id,
          message: `${stop.country}: visa on arrival available for ${document.nationality}`,
          severity: "info",
        });
        break;
      case "visa_required":
        reasons.push(
          visaHeld
            ? {
                code: "visa_on_file",
                country: stop.country,
                ruleId: rule.id,
                message: `${stop.country}: visa required and a visa document is on file`,
                severity: "info",
              }
            : {
                code: "visa_missing",
                country: stop.country,
                ruleId: rule.id,
                message: `${stop.country}: visa required for ${document.nationality}; none on file`,
                severity: "block",
              }
        );
        break;
      case "evisa":
        reasons.push(
          visaHeld
            ? {
                code: "evisa_on_file",
                country: stop.country,
                ruleId: rule.id,
                message: `${stop.country}: eVisa required and a visa document is on file`,
                severity: "info",
              }
            : {
                code: "evisa_unverified",
                country: stop.country,
                ruleId: rule.id,
                message: `${stop.country}: eVisa required; approval not on file, agent must sight it`,
                severity: "review",
              }
        );
        break;
      default:
        break;
    }
  }
  const verdict: Verdict = reasons.some(r => r.severity === "block")
    ? "no_go"
    : reasons.some(r => r.severity === "review")
      ? "manual_review"
      : "go";
  return {
    verdict,
    reasons,
    rulesApplied,
    countriesEvaluated: stops.map(s => s.country),
  };
}

/** Adapter contract for a rules provider (Timatic AutoCheck-style service or
 * a government source). Implementations return the rules relevant to the
 * query; the engine above applies them so decisions stay explainable. */
export interface EntryRulesSource {
  readonly name: string;
  rulesFor(query: {
    destinationCountries: string[];
    nationality: string | null;
    documentType: TravellerDocument["documentType"] | null;
    at: Date;
  }): Promise<EntryRule[]>;
}

/** In-memory source used by tests and local rehearsal. */
export class StaticEntryRulesSource implements EntryRulesSource {
  constructor(
    readonly name: string,
    private readonly rules: EntryRule[]
  ) {}
  // eslint-disable-next-line require-await
  async rulesFor(query: {
    destinationCountries: string[];
    nationality: string | null;
  }): Promise<EntryRule[]> {
    return this.rules.filter(
      r =>
        query.destinationCountries.includes(r.destinationCountry) &&
        (r.nationality === "*" || r.nationality === query.nationality)
    );
  }
}
