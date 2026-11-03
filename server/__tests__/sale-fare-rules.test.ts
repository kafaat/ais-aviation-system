import { describe, expect, it } from "vitest";
import { checkSaleFareRules } from "../services/sale-fare-rules";
import type { FareRule } from "../../drizzle/schema";

const flight = {
  id: 42,
  originId: 1,
  destinationId: 2,
  flightNumber: "XY123",
  aircraftType: "A320",
  departureTime: new Date("2030-02-01T21:30:00Z"),
};
const now = new Date("2030-01-26T21:30:00Z");
function rule(
  category: FareRule["ruleCategory"],
  conditions: unknown
): FareRule {
  return {
    id: 7,
    fareClassId: 2,
    airlineId: 1,
    ruleName: "Synthetic terms",
    ruleCategory: category,
    conditions: JSON.stringify(conditions),
    validFrom: now,
    validUntil: null,
    originAirportId: null,
    destinationAirportId: null,
    priceMultiplier: "1.000",
    priceAdjustment: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}
function check(r: FareRule, passengers = ["adult"], legs = 1) {
  return checkSaleFareRules([r], flight, passengers, legs, "Asia/Aden", now);
}
describe("named-fare sale eligibility", () => {
  it("pins the rule version and refuses a mixed ineligible party", () => {
    const adult = rule("eligibility", { passengerTypes: ["adult"] });
    expect(check(adult)).toMatch(/^[a-f0-9]{64}$/);
    expect(check(adult)).not.toEqual(
      check(rule("eligibility", { passengerTypes: ["adult", "child"] }))
    );
    expect(() => check(adult, ["adult", "child"])).toThrow(
      "Passenger type is ineligible"
    );
  });
  it("observes origin weekday, a window spanning midnight, and both advance bounds", () => {
    expect(
      check(
        rule("day_time", {
          allowedDaysOfWeek: [6],
          departureTimeFrom: "23:30",
          departureTimeTo: "01:00",
        })
      )
    ).toBeTruthy();
    expect(() => check(rule("day_time", { allowedDaysOfWeek: [5] }))).toThrow(
      "permitted"
    );
    expect(
      check(
        rule("advance_purchase", {
          minDaysBeforeDeparture: 6,
          maxDaysBeforeDeparture: 6,
        })
      )
    ).toBeTruthy();
    expect(() =>
      check(rule("advance_purchase", { minDaysBeforeDeparture: 7 }))
    ).toThrow("advance purchase");
    expect(() =>
      check(
        rule("advance_purchase", {
          minDaysBeforeDeparture: 1,
          maxDaysBeforeDeparture: 5,
        })
      )
    ).toThrow("advance purchase");
  });
  it("blocks the full last civil day of a blackout, including legacy from/to data", () => {
    expect(() =>
      check(
        rule("blackout_dates", {
          periods: [{ from: "2030-01-30", to: "2030-02-02" }],
        })
      )
    ).toThrow("blackout");
    expect(
      check(
        rule("blackout_dates", {
          blackoutPeriods: [{ start: "2030-01-30", end: "2030-02-01" }],
        })
      )
    ).toBeTruthy();
  });
  it("rejects inverted or nonexistent blackout dates", () => {
    expect(() =>
      check(
        rule("blackout_dates", {
          periods: [{ from: "2030-01-31", to: "2030-01-30" }],
        })
      )
    ).toThrow("Blackout ends before it starts");
    expect(() =>
      check(
        rule("blackout_dates", {
          periods: [{ from: "2030-02-30", to: "2030-03-01" }],
        })
      )
    ).toThrow();
  });
  it("checks flight and whole-journey eligibility", () => {
    expect(
      check(
        rule("flight_application", {
          flightNumbers: ["XY123"],
          aircraftTypes: ["A320"],
          directOnly: true,
        })
      )
    ).toBeTruthy();
    expect(() =>
      check(rule("flight_application", { directOnly: true }), ["adult"], 2)
    ).toThrow("Flight is ineligible");
  });
  it("refuses an unsupported term or unpriced adjustment instead of silently selling it", () => {
    expect(() =>
      check(rule("surcharges", { surchargeType: "YQ", fixedAmount: 1000 }))
    ).toThrow("servicing channel");
    expect(() =>
      check({ ...rule("eligibility", {}), priceMultiplier: "1.100" })
    ).toThrow("price adjustment");
    expect(() => check(rule("eligibility", { minAge: 65 }))).toThrow();
  });
});
