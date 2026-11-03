import { describe, expect, it } from "vitest";
import {
  evaluateEntryRequirements,
  entryRuleInputSchema,
  itineraryStops,
  monthsBetween,
  selectRule,
  type EntryRule,
  type ItineraryLeg,
  type TravellerDocument,
} from "../services/travel-documents/entry-rules";
import { fictionalEntryRules } from "../services/travel-documents/fictional-entry-rules.fixture";

// Fictional countries XA..XD only (ISO 3166-1 user-assigned codes).
const now = new Date("2026-11-03T00:00:00Z");
const rules = fictionalEntryRules({ confirmationStatus: "confirmed" });
const options = { now };

function passport(
  overrides: Partial<TravellerDocument> = {}
): TravellerDocument {
  return {
    documentType: "passport",
    documentNumber: "P1",
    nationality: "XB",
    issuingCountry: "XB",
    expiryDate: new Date("2028-01-01T00:00:00Z"),
    visasHeld: [],
    ...overrides,
  };
}

function leg(
  originCountry: string,
  destinationCountry: string,
  departure: string,
  arrival: string
): ItineraryLeg {
  return {
    originCountry,
    destinationCountry,
    departureTime: new Date(departure),
    arrivalTime: new Date(arrival),
  };
}

const direct = [
  leg("XB", "XA", "2026-11-10T08:00:00Z", "2026-11-10T12:00:00Z"),
];

describe("entry-rule evaluation", () => {
  it("passes a domestic itinerary without consulting rules", () => {
    const outcome = evaluateEntryRequirements(
      null,
      [leg("XB", "XB", "2026-11-10T08:00:00Z", "2026-11-10T10:00:00Z")],
      [],
      options
    );
    expect(outcome.verdict).toBe("go");
    expect(outcome.reasons[0].code).toBe("domestic_itinerary");
  });

  it("asks for manual review when no document or no rule is on file", () => {
    expect(
      evaluateEntryRequirements(null, direct, rules, options).verdict
    ).toBe("manual_review");
    const noRule = evaluateEntryRequirements(
      passport({ nationality: "XC" }),
      [leg("XC", "XD", "2026-11-10T08:00:00Z", "2026-11-10T12:00:00Z")],
      rules,
      options
    );
    expect(noRule.verdict).toBe("manual_review");
    expect(noRule.reasons.map(r => r.code)).toContain("rule_missing");
  });

  it("gives go for visa-free entry with sufficient validity and no_go for visa required without visa", () => {
    const ok = evaluateEntryRequirements(passport(), direct, rules, options);
    expect(ok.verdict).toBe("go");
    expect(ok.rulesApplied).toEqual([9001]);
    const other = evaluateEntryRequirements(
      passport({ nationality: "XC", issuingCountry: "XC" }),
      direct,
      rules,
      options
    );
    expect(other.verdict).toBe("no_go");
    expect(other.reasons.map(r => r.code)).toContain("visa_missing");
    expect(other.rulesApplied).toEqual([9002]);
    const withVisa = evaluateEntryRequirements(
      passport({
        nationality: "XC",
        issuingCountry: "XC",
        visasHeld: [{ country: "XA" }],
      }),
      direct,
      rules,
      options
    );
    expect(withVisa.verdict).toBe("go");
    expect(withVisa.reasons.map(r => r.code)).toContain(
      "blank_pages_unverifiable"
    );
  });

  it("enforces passport validity months beyond arrival and expiry before arrival", () => {
    const short = evaluateEntryRequirements(
      passport({ expiryDate: new Date("2027-03-01T00:00:00Z") }), // < 6 months after 10 Nov 2026
      direct,
      rules,
      options
    );
    expect(short.verdict).toBe("no_go");
    expect(short.reasons.map(r => r.code)).toContain("validity_insufficient");
    const exact = evaluateEntryRequirements(
      passport({ expiryDate: new Date("2027-05-10T00:00:00Z") }),
      direct,
      rules,
      options
    );
    expect(exact.verdict).toBe("go");
    const expired = evaluateEntryRequirements(
      passport({ expiryDate: new Date("2026-11-01T00:00:00Z") }),
      direct,
      rules,
      options
    );
    expect(expired.reasons.map(r => r.code)).toContain("document_expired");
    expect(expired.verdict).toBe("no_go");
  });

  it("applies transit-without-visa windows and falls back to the visa rule when exceeded", () => {
    const viaXC = [
      leg("XB", "XC", "2026-11-10T08:00:00Z", "2026-11-10T12:00:00Z"),
      leg("XC", "XA", "2026-11-10T18:00:00Z", "2026-11-10T22:00:00Z"),
    ];
    const short = evaluateEntryRequirements(passport(), viaXC, rules, options);
    expect(short.verdict).toBe("go");
    expect(short.reasons.map(r => r.code)).toContain("transit_without_visa");
    expect(short.countriesEvaluated).toEqual(["XC", "XA"]);
    const long = [
      viaXC[0],
      leg("XC", "XA", "2026-11-11T20:00:00Z", "2026-11-12T00:00:00Z"), // 32h, still a connection? no: > 24h is a stopover
    ];
    const stopover = evaluateEntryRequirements(
      passport(),
      long,
      rules,
      options
    );
    // Beyond MAX_CONNECTION_HOURS the journey ends in XC, where a visa is then required.
    expect(stopover.countriesEvaluated).toEqual(["XC"]);
    expect(stopover.verdict).toBe("no_go");
    const twentyHours = [
      viaXC[0],
      leg("XC", "XA", "2026-11-11T09:00:00Z", "2026-11-11T13:00:00Z"), // 21h dwell
    ];
    expect(
      evaluateEntryRequirements(passport(), twentyHours, rules, options).verdict
    ).toBe("go");
  });

  it("marks eVisa requirements for review when no approval is on file and skips own-nationality stops", () => {
    const toXD = [
      leg("XB", "XD", "2026-11-10T08:00:00Z", "2026-11-10T12:00:00Z"),
    ];
    const evisa = evaluateEntryRequirements(passport(), toXD, rules, options);
    expect(evisa.verdict).toBe("manual_review");
    expect(evisa.reasons.map(r => r.code)).toContain("evisa_unverified");
    const home = evaluateEntryRequirements(
      passport({ nationality: "XA", issuingCountry: "XA" }),
      direct,
      rules,
      options
    );
    expect(home.verdict).toBe("go");
    expect(home.reasons.map(r => r.code)).toContain("own_nationality");
  });

  it("never returns go from unconfirmed or fictional rules unless explicitly allowed", () => {
    const fictional = fictionalEntryRules();
    const strict = evaluateEntryRequirements(
      passport(),
      direct,
      fictional,
      options
    );
    expect(strict.verdict).toBe("manual_review");
    expect(strict.reasons.map(r => r.code)).toContain("rule_unconfirmed");
    const relaxed = evaluateEntryRequirements(passport(), direct, fictional, {
      now,
      requireConfirmedSource: false,
    });
    expect(relaxed.verdict).toBe("go");
  });

  it("selects the most specific rule in force", () => {
    const at = new Date("2026-11-10T12:00:00Z");
    expect(
      selectRule(rules, {
        destinationCountry: "XA",
        nationality: "XB",
        documentType: "passport",
        at,
      })?.id
    ).toBe(9001);
    expect(
      selectRule(rules, {
        destinationCountry: "XA",
        nationality: "XB",
        documentType: "national_id",
        at,
      })?.id
    ).toBe(9002);
    const expiredRule: EntryRule = {
      ...rules[0],
      id: 1,
      effectiveTo: new Date("2026-06-01T00:00:00Z"),
    };
    expect(
      selectRule([expiredRule], {
        destinationCountry: "XA",
        nationality: "XB",
        documentType: "passport",
        at,
      })
    ).toBeNull();
  });

  it("validates imported rules", () => {
    expect(() =>
      entryRuleInputSchema.parse({
        destinationCountry: "XC",
        nationality: "*",
        documentType: "*",
        visaRequirement: "transit_without_visa",
        transitWithoutVisaHours: null,
        passportValidityMonths: 0,
        blankPagesRequired: 0,
        sourceName: "x",
        sourceUrl: "https://example.invalid/x",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        confirmationStatus: "unconfirmed",
      })
    ).toThrow(/permitted hours/);
    expect(monthsBetween(new Date("2026-11-10"), new Date("2027-05-09"))).toBe(
      5
    );
    expect(monthsBetween(new Date("2026-11-10"), new Date("2027-05-10"))).toBe(
      6
    );
    expect(itineraryStops([]).stops).toEqual([]);
  });
});
