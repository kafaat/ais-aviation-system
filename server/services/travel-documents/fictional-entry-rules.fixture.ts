/**
 * FICTIONAL ENTRY-RULE FIXTURE. Not a statement about any real country.
 *
 * Country codes XA, XB, XC and XD are from the ISO 3166-1 user-assigned range
 * and designate no state. These rows exist only so the evaluation engine and
 * the check-in hook can be tested end to end. Importing them with
 * `confirmationStatus: "fictional_fixture"` is refused in production and they
 * can never produce a `go` while confirmed sources are required.
 */
import type { EntryRule, EntryRuleInput } from "./entry-rules";

export const FICTIONAL_SOURCE = {
  sourceName: "AIS fictional fixture (not a real source)",
  sourceUrl: "https://example.invalid/fictional-entry-rules",
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  effectiveTo: null,
  confirmationStatus: "fictional_fixture" as const,
  notes: "Fictional rule for automated tests only",
};

export const fictionalEntryRuleInputs: EntryRuleInput[] = [
  {
    // XA admits XB nationals without a visa if the passport has 6 months left.
    destinationCountry: "XA",
    nationality: "XB",
    documentType: "passport",
    visaRequirement: "none",
    transitWithoutVisaHours: null,
    passportValidityMonths: 6,
    blankPagesRequired: 0,
    ...FICTIONAL_SOURCE,
  },
  {
    // XA requires a visa from everyone else.
    destinationCountry: "XA",
    nationality: "*",
    documentType: "*",
    visaRequirement: "visa_required",
    transitWithoutVisaHours: null,
    passportValidityMonths: 6,
    blankPagesRequired: 1,
    ...FICTIONAL_SOURCE,
  },
  {
    // XC allows 24h visa-free transit for anyone; otherwise a visa is required.
    destinationCountry: "XC",
    nationality: "*",
    documentType: "*",
    visaRequirement: "transit_without_visa",
    transitWithoutVisaHours: 24,
    passportValidityMonths: 0,
    blankPagesRequired: 0,
    ...FICTIONAL_SOURCE,
  },
  {
    // XD offers an eVisa to XB nationals.
    destinationCountry: "XD",
    nationality: "XB",
    documentType: "passport",
    visaRequirement: "evisa",
    transitWithoutVisaHours: null,
    passportValidityMonths: 3,
    blankPagesRequired: 0,
    ...FICTIONAL_SOURCE,
  },
];

/** The fixture as stored rules, with ids 9001..; `confirmed` only when a test
 * explicitly asks for engine behaviour independent of source confirmation. */
export function fictionalEntryRules(
  overrides: Partial<Pick<EntryRule, "confirmationStatus">> = {}
): EntryRule[] {
  return fictionalEntryRuleInputs.map((rule, index) => ({
    ...rule,
    id: 9001 + index,
    isActive: true,
    ...overrides,
  }));
}
