import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  addCalendarDays,
  awardableEntitlement,
  convertMinorUnits,
  determineJurisdictions,
  evaluateClaim,
  PASSENGER_RIGHTS_RULE_SETS,
  percentOf,
  type ClaimContext,
  type ItineraryContext,
  type Jurisdiction,
} from "../../shared/passenger-rights";
import { gacaArrivalAward } from "../../shared/gaca-arrival-delay";

const AT = "2026-11-03T10:00:00Z";
function itinerary(
  dep: string,
  arr: string,
  carrier: string,
  distanceKm?: number
): ItineraryContext {
  return {
    operatingCarrier: { code: "XX", country: carrier },
    departure: { airport: "AAA", country: dep },
    arrival: { airport: "BBB", country: arr },
    scheduledDepartureUtc: "2026-10-01T06:00:00Z",
    scheduledArrivalUtc: "2026-10-01T10:00:00Z",
    distanceKm:
      distanceKm === undefined
        ? undefined
        : { value: distanceKm, source: "test:haversine" },
  };
}
const fx = [
  {
    id: 7,
    fromCurrency: "XDR",
    toCurrency: "SAR",
    rate: "5.123456",
    validFrom: "2026-10-01T00:00:00Z",
    source: "test:imf",
  },
  {
    id: 8,
    fromCurrency: "EUR",
    toCurrency: "SAR",
    rate: "4.0312",
    validFrom: "2026-10-01T00:00:00Z",
    source: "test:ecb",
  },
  {
    id: 9,
    fromCurrency: "EUR",
    toCurrency: "SAR",
    rate: "9.9",
    validFrom: "2027-01-01T00:00:00Z",
    source: "test:future",
  },
];
function context(partial: Partial<ClaimContext>): ClaimContext {
  return {
    claimType: "arrival_delay",
    itinerary: itinerary("SA", "SA", "SA", 800),
    facts: {},
    settlementCurrency: "SAR",
    fxRecords: fx,
    evaluatedAt: AT,
    ...partial,
  };
}
const statusOf = (
  itin: ItineraryContext,
  jurisdiction: Jurisdiction,
  at = AT
) =>
  determineJurisdictions(itin, at, PASSENGER_RIGHTS_RULE_SETS).find(
    j => j.jurisdiction === jurisdiction
  );

describe("jurisdiction determination matrix", () => {
  it.each<[string, ItineraryContext, Partial<Record<Jurisdiction, string>>]>([
    [
      "KSA domestic",
      itinerary("Saudi Arabia", "SA", "SA"),
      {
        "KSA-GACA-2023": "applicable",
        "EU261-2004": "not_applicable",
        UK261: "not_applicable",
        "US-DOT-14CFR260": "not_applicable",
      },
    ],
    [
      "KSA to EU on a Saudi carrier",
      itinerary("SA", "FR", "SA"),
      { "KSA-GACA-2023": "applicable", "EU261-2004": "not_applicable" },
    ],
    [
      "KSA to EU on an EU carrier",
      itinerary("SA", "FR", "FR"),
      { "KSA-GACA-2023": "applicable", "EU261-2004": "applicable" },
    ],
    [
      "EU to KSA on an EU carrier",
      itinerary("FR", "SA", "FR"),
      { "EU261-2004": "applicable", "KSA-GACA-2023": "requires_review" },
    ],
    [
      "EU to KSA on a non-EU carrier",
      itinerary("DE", "SA", "SA"),
      { "EU261-2004": "applicable", "KSA-GACA-2023": "applicable" },
    ],
    [
      "UK departure on a Gulf carrier",
      itinerary("GB", "AE", "AE"),
      { UK261: "applicable", "EU261-2004": "not_applicable" },
    ],
    [
      "Arrival in the UK on a Gulf carrier",
      itinerary("AE", "GB", "AE"),
      { UK261: "not_applicable" },
    ],
    [
      "Arrival in the UK on an EU carrier",
      itinerary("AE", "GB", "NL"),
      { UK261: "applicable" },
    ],
    [
      "US domestic",
      itinerary("US", "US", "US"),
      {
        "US-DOT-14CFR260": "applicable",
        "EU261-2004": "not_applicable",
        "KSA-GACA-2023": "not_applicable",
      },
    ],
    [
      "KSA to US on a Saudi carrier",
      itinerary("SA", "US", "SA"),
      { "US-DOT-14CFR260": "applicable", "KSA-GACA-2023": "applicable" },
    ],
  ])("%s", (_label, itin, expected) => {
    const determinations = determineJurisdictions(
      itin,
      AT,
      PASSENGER_RIGHTS_RULE_SETS
    );
    for (const [jurisdiction, status] of Object.entries(expected)) {
      const found = determinations.find(d => d.jurisdiction === jurisdiction);
      expect(found?.status, jurisdiction).toBe(status);
      expect(found?.reasons.length).toBeGreaterThan(0);
      expect(found?.basis).toBeTruthy();
    }
  });

  it("flags the 2026 EU amendment as not yet applicable even in scope", () => {
    const amended = statusOf(itinerary("FR", "SA", "FR"), "EU261-2026-amended");
    expect(amended?.status).toBe("not_yet_applicable");
    expect(amended?.reasons.join(" ")).toMatch(/not yet confirmed/);
  });

  it("does not apply GACA 2023 before its commencement date", () => {
    expect(
      statusOf(
        itinerary("SA", "SA", "SA"),
        "KSA-GACA-2023",
        "2023-11-19T00:00:00Z"
      )?.status
    ).toBe("not_yet_applicable");
  });
});

describe("amount models", () => {
  it("reproduces the GACA 10(6) SDR award through the FX record", () => {
    const evaluation = evaluateClaim(
      context({
        facts: {
          arrivalDelayMinutes: { value: 360.02, reference: "file:arrival" },
        },
      })
    );
    const award = awardableEntitlement(
      evaluation,
      "KSA-GACA-2023.arrival_delay.10-6.tier2"
    );
    expect(award.ok).toBe(true);
    if (!award.ok) return;
    expect(award.entitlement.amount).toEqual({
      minorUnits: 15_000,
      currency: "XDR",
    });
    expect(award.entitlement.settlement).toMatchObject({
      minorUnits: 76_852,
      currency: "SAR",
      fxRecordId: 7,
      rate: "5.123456",
    });
    expect(
      gacaArrivalAward(
        "2025-01-01T06:00:00Z",
        "2025-01-01T12:00:01Z",
        5_123_456
      ).halalas
    ).toBe(76_852);
    expect(
      evaluation.entitlements.find(
        e => e.ruleCode === "KSA-GACA-2023.arrival_delay.10-6.tier1"
      )?.status
    ).toBe("not_met");
  });

  it("applies EU261 distance bands and the half-rate reduction", () => {
    const long = evaluateClaim(
      context({
        itinerary: itinerary("FR", "SA", "FR", 4_900),
        facts: {
          arrivalDelayMinutes: { value: 200, reference: "file:arrival" },
        },
        jurisdictions: ["EU261-2004"],
      })
    );
    const entitlement = long.entitlements.find(
      e => e.ruleCode === "EU261-2004.art7.long"
    );
    expect(entitlement).toMatchObject({
      status: "awardable",
      amount: { minorUnits: 30_000, currency: "EUR" },
      settlement: { minorUnits: 120_936, currency: "SAR", fxRecordId: 8 },
    });
    expect(long.jurisdictions.map(j => j.jurisdiction)).toHaveLength(5);
    expect(
      long.rulesConsidered.every(code => code.startsWith("EU261-2004"))
    ).toBe(true);
    const medium = evaluateClaim(
      context({
        itinerary: itinerary("FR", "SA", "FR", 3_000),
        facts: { arrivalDelayMinutes: { value: 200, reference: "x" } },
        jurisdictions: ["EU261-2004"],
      })
    );
    expect(
      medium.entitlements.find(e => e.ruleCode === "EU261-2004.art7.medium")
    ).toMatchObject({
      status: "awardable",
      amount: { minorUnits: 40_000 },
    });
  });

  it("prices UK261 in GBP with the GBP 260 half-rate and requires an FX record", () => {
    const evaluation = evaluateClaim(
      context({
        itinerary: itinerary("GB", "SA", "SA", 4_800),
        facts: { arrivalDelayMinutes: { value: 230, reference: "x" } },
        jurisdictions: ["UK261"],
      })
    );
    const entitlement = evaluation.entitlements.find(
      e => e.ruleCode === "UK261.art7.long"
    );
    expect(entitlement).toMatchObject({
      status: "fx_required",
      amount: { minorUnits: 26_000, currency: "GBP" },
      settlement: null,
    });
    const settled = evaluateClaim(
      context({
        itinerary: itinerary("GB", "SA", "SA", 4_800),
        facts: { arrivalDelayMinutes: { value: 260, reference: "x" } },
        jurisdictions: ["UK261"],
        fxRecords: [
          {
            id: "gbp-1",
            fromCurrency: "GBP",
            toCurrency: "SAR",
            rate: "4.75",
            validFrom: "2026-01-01T00:00:00Z",
            source: "test",
          },
        ],
      })
    );
    expect(
      settled.entitlements.find(e => e.ruleCode === "UK261.art7.long")
    ).toMatchObject({
      status: "awardable",
      amount: { minorUnits: 52_000 },
      settlement: { minorUnits: 247_000, fxRecordId: "gbp-1" },
    });
  });

  it("uses the dated FX record valid at evaluation, never a later one", () => {
    const evaluation = evaluateClaim(
      context({
        itinerary: itinerary("FR", "SA", "FR", 1_000),
        facts: { arrivalDelayMinutes: { value: 200, reference: "x" } },
        jurisdictions: ["EU261-2004"],
      })
    );
    expect(
      evaluation.entitlements.find(e => e.ruleCode === "EU261-2004.art7.short")
        ?.settlement
    ).toMatchObject({ fxRecordId: 8, rate: "4.0312", minorUnits: 100_780 });
  });

  it("computes KSA percentage-of-ticket amounts but withholds the award until confirmed", () => {
    const base = context({
      claimType: "denied_boarding",
      facts: {
        deniedBoarding: {
          involuntary: true,
          alternativeDepartureWithinMinutes: 300,
          reference: "file:dnb",
        },
      },
      ticketValue: {
        minorUnits: 120_000,
        currency: "SAR",
        basis: "booking_total_per_passenger",
        reference: "booking:8",
      },
      jurisdictions: ["KSA-GACA-2023"],
    });
    const unconfirmed = evaluateClaim(base).entitlements[0];
    expect(unconfirmed).toMatchObject({
      ruleCode: "KSA-GACA-2023.denied_boarding.percentage",
      status: "needs_confirmation",
      amount: { minorUnits: 240_000, currency: "SAR" },
      settlement: { minorUnits: 240_000, fxRecordId: null },
    });
    const confirmed = evaluateClaim({
      ...base,
      confirmations: [
        {
          ruleCode: "KSA-GACA-2023.denied_boarding.percentage",
          confirmedAt: AT,
          reference: "legal:article-check-2026-11",
          decision: "confirmed",
        },
      ],
    }).entitlements[0];
    expect(confirmed.status).toBe("awardable");
    const excluded = evaluateClaim({
      ...base,
      facts: {
        deniedBoarding: {
          involuntary: true,
          alternativeDepartureWithinMinutes: 90,
          reference: "file:dnb",
        },
      },
    }).entitlements[0];
    expect(excluded.status).toBe("excluded");
    expect(
      evaluateClaim({ ...base, ticketValue: undefined }).entitlements[0].status
    ).toBe("ticket_value_required");
  });

  it("excludes cancellations notified 14 days ahead and extraordinary circumstances", () => {
    const base = context({
      claimType: "cancellation",
      itinerary: itinerary("FR", "SA", "FR", 4_900),
      facts: { cancellation: { noticeDays: 20, reference: "file:notice" } },
      jurisdictions: ["EU261-2004"],
    });
    expect(
      evaluateClaim(base).entitlements.find(
        e => e.ruleCode === "EU261-2004.art7.long"
      )?.status
    ).toBe("excluded");
    const rerouted = evaluateClaim({
      ...base,
      facts: {
        cancellation: {
          noticeDays: 2,
          reroutedArrivalDelayMinutes: 200,
          reference: "file:notice",
        },
      },
    }).entitlements.find(e => e.ruleCode === "EU261-2004.art7.long");
    expect(rerouted).toMatchObject({
      status: "awardable",
      amount: { minorUnits: 30_000 },
    });
    expect(
      evaluateClaim({
        ...base,
        facts: { ...base.facts, extraordinaryCircumstances: true },
      }).entitlements.find(e => e.ruleCode === "EU261-2004.art7.long")?.status
    ).toBe("excluded");
  });

  it("caps receipt-based baggage reimbursement and converts foreign receipts", () => {
    const over = evaluateClaim(
      context({
        claimType: "baggage_loss",
        facts: {
          baggage: {
            receiptsMinorUnits: 900_000,
            receiptsCurrency: "SAR",
            reference: "file:receipts",
          },
        },
        jurisdictions: ["KSA-GACA-2023"],
      })
    ).entitlements[0];
    expect(over).toMatchObject({
      status: "needs_confirmation",
      amount: { minorUnits: 656_800, currency: "SAR" },
    });
    const foreign = evaluateClaim(
      context({
        claimType: "baggage_damage",
        facts: {
          baggage: {
            receiptsMinorUnits: 10_000,
            receiptsCurrency: "EUR",
            reference: "file:receipts",
          },
        },
        jurisdictions: ["KSA-GACA-2023"],
      })
    ).entitlements[0];
    expect(foreign.amount).toEqual({ minorUnits: 40_312, currency: "SAR" });
    expect(
      evaluateClaim(
        context({
          claimType: "baggage_damage",
          facts: {
            baggage: {
              receiptsMinorUnits: 10_000,
              receiptsCurrency: "GBP",
              reference: "file:receipts",
            },
          },
          jurisdictions: ["KSA-GACA-2023"],
        })
      ).entitlements[0].status
    ).toBe("fx_required");
  });

  it("reimburses care receipts with the KSA fixed SAR 750 after a 6h departure delay", () => {
    const evaluation = evaluateClaim(
      context({
        claimType: "care",
        facts: {
          departureDelayMinutes: { value: 400, reference: "file:departure" },
          careExpenses: {
            receiptsMinorUnits: 20_000,
            receiptsCurrency: "SAR",
            reference: "file:meals",
          },
        },
        jurisdictions: ["KSA-GACA-2023"],
      })
    );
    expect(evaluation.entitlements[0]).toMatchObject({
      ruleCode: "KSA-GACA-2023.care.delay-over-6h",
      status: "needs_confirmation",
      amount: { minorUnits: 75_000, currency: "SAR" },
      care: { meals: true, hotel: true },
    });
  });

  it("tiers US denied boarding by alternative arrival delay with the USD cap", () => {
    const evaluation = evaluateClaim(
      context({
        claimType: "denied_boarding",
        itinerary: itinerary("US", "US", "US", 1_200),
        facts: {
          deniedBoarding: {
            involuntary: true,
            alternativeArrivalDelayMinutes: 150,
            reference: "file:dnb",
          },
        },
        ticketValue: {
          minorUnits: 60_000,
          currency: "USD",
          basis: "fare_component",
          reference: "ticket:1",
        },
        settlementCurrency: "USD",
        jurisdictions: ["US-DOT-14CFR260"],
      })
    );
    const by = (code: string) =>
      evaluation.entitlements.find(e => e.ruleCode.endsWith(code));
    expect(by("part250.200")?.status).toBe("not_met");
    expect(by("part250.400")).toMatchObject({
      status: "needs_confirmation",
      amount: { minorUnits: 155_000, currency: "USD" },
    });
    expect(by("part250.400")?.explanation.join(" ")).toMatch(
      /Capped at USD 1550/
    );
  });

  it("reports unspecified amounts for tarmac delays instead of inventing one", () => {
    const evaluation = evaluateClaim(
      context({
        claimType: "tarmac_delay",
        facts: { tarmacMinutes: { value: 200, reference: "file:ooo" } },
        jurisdictions: ["KSA-GACA-2023"],
      })
    );
    expect(evaluation.entitlements[0]).toMatchObject({
      status: "amount_unspecified",
      amount: null,
    });
    expect(
      awardableEntitlement(evaluation, "KSA-GACA-2023.tarmac_delay.3h").ok
    ).toBe(false);
  });

  it("requires a distance before applying distance bands", () => {
    const evaluation = evaluateClaim(
      context({
        itinerary: itinerary("FR", "SA", "FR"),
        facts: { arrivalDelayMinutes: { value: 200, reference: "x" } },
        jurisdictions: ["EU261-2004"],
      })
    );
    expect(
      evaluation.entitlements.every(e => e.status === "distance_required")
    ).toBe(true);
  });
});

describe("disputed values", () => {
  const baggageDelay = (confirmations: ClaimContext["confirmations"]) =>
    evaluateClaim(
      context({
        claimType: "baggage_delay",
        itinerary: itinerary("SA", "AE", "SA", 1_000),
        facts: { baggage: { delayDays: 3, reference: "file:pir" } },
        jurisdictions: ["KSA-GACA-2023"],
        confirmations,
      })
    );
  const byCode = (codes: ReturnType<typeof baggageDelay>, suffix: string) =>
    codes.entitlements.find(e => e.ruleCode.endsWith(suffix));

  it("keeps both candidates, computes both and blocks both until confirmation", () => {
    const evaluation = baggageDelay(undefined);
    expect(byCode(evaluation, "daily.A")).toMatchObject({
      status: "blocked_disputed",
      amount: { minorUnits: 134_000 },
    });
    expect(byCode(evaluation, "daily.B-international")).toMatchObject({
      status: "blocked_disputed",
      amount: { minorUnits: 60_000 },
    });
    expect(byCode(evaluation, "daily.B-domestic")?.status).toBe("not_met");
    expect(
      awardableEntitlement(evaluation, "KSA-GACA-2023.baggage_delay.daily.A").ok
    ).toBe(false);
  });

  it("awards the confirmed candidate only, and refuses when both are confirmed", () => {
    const confirmA = baggageDelay([
      {
        ruleCode: "KSA-GACA-2023.baggage_delay.daily.A",
        confirmedAt: AT,
        reference: "legal:arabic-text-article-check",
        decision: "confirmed",
      },
    ]);
    expect(byCode(confirmA, "daily.A")?.status).toBe("awardable");
    expect(byCode(confirmA, "daily.B-international")?.status).toBe(
      "blocked_disputed"
    );
    const both = baggageDelay([
      {
        ruleCode: "KSA-GACA-2023.baggage_delay.daily.A",
        confirmedAt: AT,
        reference: "a",
        decision: "confirmed",
      },
      {
        ruleCode: "KSA-GACA-2023.baggage_delay.daily.B-international",
        confirmedAt: AT,
        reference: "b",
        decision: "confirmed",
      },
    ]);
    expect(byCode(both, "daily.A")?.status).toBe("blocked_disputed");
    expect(byCode(both, "daily.B-international")?.status).toBe(
      "blocked_disputed"
    );
    const rejected = baggageDelay([
      {
        ruleCode: "KSA-GACA-2023.baggage_delay.daily.A",
        confirmedAt: AT,
        reference: "a",
        decision: "rejected",
      },
    ]);
    expect(byCode(rejected, "daily.A")?.explanation.join(" ")).toMatch(
      /rejected/
    );
  });

  it("caps the daily count at the maximum number of days", () => {
    const evaluation = evaluateClaim(
      context({
        claimType: "baggage_delay",
        itinerary: itinerary("SA", "AE", "SA", 1_000),
        facts: { baggage: { delayDays: 9, reference: "file:pir" } },
        jurisdictions: ["KSA-GACA-2023"],
      })
    );
    expect(byCode(evaluation, "daily.A")?.amount?.minorUnits).toBe(
      74_000 + 30_000 * 4
    );
  });
});

describe("deadlines and business days", () => {
  it("adds business days across weekends; federal holidays are not modelled", () => {
    // Friday 6 Nov 2026 + 7 business days = Tuesday 17 Nov 2026
    expect(
      addBusinessDays(new Date("2026-11-06T15:00:00Z"), 7).toISOString()
    ).toBe("2026-11-17T15:00:00.000Z");
    // Saturday start: the next counted day is Monday
    expect(
      addBusinessDays(new Date("2026-11-07T00:00:00Z"), 1).toISOString()
    ).toBe("2026-11-09T00:00:00.000Z");
    expect(addBusinessDays(new Date("2026-11-07T00:00:00Z"), 0).getTime()).toBe(
      Date.parse("2026-11-07T00:00:00Z")
    );
    expect(
      addCalendarDays(new Date("2026-11-06T15:00:00Z"), 20).toISOString()
    ).toBe("2026-11-26T15:00:00.000Z");
    expect(() => addBusinessDays(new Date(), -1)).toThrow(RangeError);
  });

  it("derives US DOT refund-due and EU amendment document deadlines", () => {
    const evaluation = evaluateClaim(
      context({
        claimType: "cancellation",
        itinerary: itinerary("US", "US", "US", 1_000),
        facts: {
          cancellation: { reference: "file:cancel" },
          refundTrigger: {
            triggeredAt: "2026-11-06T15:00:00Z",
            tenderClass: "card",
            reference: "file:cancel",
          },
        },
        jurisdictions: ["US-DOT-14CFR260"],
      })
    );
    const due = evaluation.deadlines.filter(d => d.kind === "refund_due");
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      ruleCode: "US-DOT-14CFR260.refund_timeline.card",
      dueAt: "2026-11-17T15:00:00.000Z",
    });
    expect(due[0].basis).toMatch(/federal holidays not modelled/);
    const other = evaluateClaim(
      context({
        claimType: "refund_timeline",
        itinerary: itinerary("US", "US", "US", 1_000),
        facts: {
          refundTrigger: {
            triggeredAt: "2026-11-06T15:00:00Z",
            tenderClass: "other",
            reference: "file:cancel",
          },
        },
        jurisdictions: ["US-DOT-14CFR260"],
      })
    );
    expect(other.deadlines.find(d => d.kind === "refund_due")).toMatchObject({
      ruleCode: "US-DOT-14CFR260.refund_timeline.other",
      dueAt: "2026-11-26T15:00:00.000Z",
    });
    const amended = evaluateClaim(
      context({
        claimType: "refund_timeline",
        itinerary: itinerary("FR", "SA", "FR", 4_000),
        jurisdictions: ["EU261-2026-amended"],
      })
    );
    expect(amended.deadlines).toEqual([]);
    expect(amended.entitlements[0].status).toBe("not_yet_applicable");
  });
});

describe("exact money arithmetic", () => {
  it("converts with scaled integers and rounds half up", () => {
    expect(convertMinorUnits(15_000, "5.123456")).toBe(76_852);
    expect(convertMinorUnits(1, "0.5")).toBe(1);
    expect(convertMinorUnits(25_000, "4.0312")).toBe(100_780);
    expect(() => convertMinorUnits(100, "4.1x")).toThrow(RangeError);
    expect(() => convertMinorUnits(100, "0")).toThrow(RangeError);
    expect(percentOf(120_000, 150)).toBe(180_000);
    expect(percentOf(1, 50)).toBe(1);
  });
});
