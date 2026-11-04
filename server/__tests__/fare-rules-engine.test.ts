import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { FareClass, FareRule } from "../../drizzle/schema";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  calculateChangeFee,
  calculateFare,
  validateBookingRules,
  validateRules,
} from "../services/fare-rules.service";

let rules: FareRule[];
let fareClass: FareClass;
let flightExists: boolean;
let classExists: boolean;
const departureDate = "2030-01-14T12:00:00Z";
const input = {
  flightId: 1,
  fareClassId: 2,
  originId: 3,
  destinationId: 4,
  departureDate,
  passengerType: "adult" as const,
  passengerCount: 2,
};
const validation = { ...input, bookingDate: "2030-01-01T12:00:00Z" };

function rule(
  category: FareRule["ruleCategory"],
  conditions: Record<string, unknown>,
  values: Partial<FareRule> = {}
): FareRule {
  return {
    id: rules.length + 1,
    fareClassId: 2,
    ruleName: category,
    ruleCategory: category,
    conditions: JSON.stringify(conditions),
    priceMultiplier: "1.000",
    priceAdjustment: 0,
    active: true,
    validFrom: new Date("2029-01-01T00:00:00Z"),
    validUntil: null,
    originAirportId: null,
    destinationAirportId: null,
    ...values,
  } as FareRule;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(validation.bookingDate));
  rules = [];
  flightExists = true;
  classExists = true;
  fareClass = {
    id: 2,
    airlineId: 7,
    code: "Y",
    active: true,
    cabinClass: "economy",
    basePriceMultiplier: "1.000",
    changeable: true,
    changeFee: 1000,
  } as FareClass;
  // Applicable rows are the explicit persistence boundary here. These tests
  // execute the pricing/validation engine, not SQL route/date filtering.
  state.db = {
    select: () => {
      let table = "";
      const rows = () =>
        table === "flights"
          ? flightExists
            ? [
                {
                  id: 1,
                  airlineId: 7,
                  flightNumber: "ZX101",
                  economyPrice: 10000,
                  businessPrice: 25000,
                },
              ]
            : []
          : table === "fare_classes"
            ? classExists
              ? [fareClass]
              : []
            : table === "fare_rules"
              ? rules
              : [];
      const query = {
        from(value: Parameters<typeof getTableName>[0]) {
          table = getTableName(value);
          return query;
        },
        where: () => query,
        limit: () => Promise.resolve(rows()),
        orderBy: () => Promise.resolve(rows()),
      };
      return query;
    },
  };
});
afterEach(() => vi.useRealTimers());

describe("fare quote arithmetic and ordered rule behavior", () => {
  it.each([
    ["economy", 10000],
    ["premium_economy", 10000],
    ["business", 25000],
    ["first", 25000],
  ] as const)(
    "uses the documented %s cabin base and integer minor units",
    async (cabinClass, baseFare) => {
      fareClass.cabinClass = cabinClass;
      fareClass.basePriceMultiplier = "1.250";
      const quote = await calculateFare(input);
      expect(quote.baseFare).toBe(baseFare);
      expect(quote.adjustedFare).toBe(
        cabinClass === "economy" || cabinClass === "premium_economy"
          ? 12500
          : 31250
      );
      expect(quote.totalAmount).toBe(quote.totalPerPassenger * 2);
      expect(Number.isInteger(quote.taxes)).toBe(true);
      expect(quote.currency).toBe("SAR");
    }
  );

  it("applies advance, seasonal, surcharge, child and group rules in category order", async () => {
    rules = [
      rule(
        "group_discount",
        { minPassengers: 2, maxPassengers: 4, discountPercentage: 10 },
        { id: 5 }
      ),
      rule(
        "children_discount",
        { passengerType: "child", discountPercentage: 50 },
        { id: 4 }
      ),
      rule(
        "surcharges",
        { fixedAmount: 300, percentage: 5 },
        { id: 3, priceAdjustment: 50 }
      ),
      rule(
        "seasonality",
        {
          season: "fixture",
          periodStart: departureDate,
          periodEnd: departureDate,
          seasonMultiplier: 1.2,
        },
        { id: 2 }
      ),
      rule(
        "advance_purchase",
        { minDaysBeforeDeparture: 7, maxDaysBeforeDeparture: 30 },
        { id: 1, priceMultiplier: "0.900", priceAdjustment: -100 }
      ),
    ];
    const quote = await calculateFare({ ...input, passengerType: "child" });
    // 10,000 -> 8,900 -> 10,680; surcharge 300+534+50; child 5,340 -> group 4,806.
    expect(quote).toMatchObject({
      adjustedFare: 4806,
      surcharges: 884,
      taxes: 854,
      totalPerPassenger: 6544,
      totalAmount: 13088,
    });
    expect(quote.appliedRules.map(row => row.ruleId)).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([
    ["child", 7500, 1125, 8625],
    ["infant", 1000, 150, 1150],
  ] as const)(
    "uses the default %s discount when no matching rule exists",
    async (passengerType, adjustedFare, taxes, totalPerPassenger) => {
      rules = [
        rule("children_discount", {
          passengerType: passengerType === "child" ? "infant" : "child",
          discountPercentage: 50,
        }),
      ];
      expect(
        await calculateFare({ ...input, passengerType, passengerCount: 1 })
      ).toMatchObject({
        adjustedFare,
        taxes,
        totalPerPassenger,
        totalAmount: totalPerPassenger,
      });
    }
  );

  it("does not apply a second default discount after a matching child rule", async () => {
    rules = [
      rule("children_discount", {
        passengerType: "child",
        discountPercentage: 40,
      }),
    ];
    expect(
      (await calculateFare({ ...input, passengerType: "child" })).adjustedFare
    ).toBe(6000);
  });

  it("skips inactive pricing windows and groups outside the configured size", async () => {
    rules = [
      rule(
        "advance_purchase",
        { minDaysBeforeDeparture: 1, maxDaysBeforeDeparture: 7 },
        { priceMultiplier: "0.500" }
      ),
      rule("seasonality", {
        periodStart: "2030-02-01",
        periodEnd: "2030-03-01",
        seasonMultiplier: 2,
      }),
      rule("group_discount", {
        minPassengers: 3,
        maxPassengers: 4,
        discountPercentage: 50,
      }),
      rule("surcharges", { fixedAmount: 0 }),
    ];
    const quote = await calculateFare(input);
    expect(quote).toMatchObject({
      adjustedFare: 10000,
      surcharges: 0,
      totalAmount: 23000,
    });
    expect(quote.appliedRules).toHaveLength(0);
    expect(
      (await calculateFare({ ...input, passengerCount: 5 })).adjustedFare
    ).toBe(10000);
  });

  it("floors an over-discounted fare at zero and keeps informational rules out of the price", async () => {
    rules = [
      rule(
        "advance_purchase",
        { minDaysBeforeDeparture: 1 },
        { priceAdjustment: -20000 }
      ),
      rule("stopovers", { freeStopoverCount: 1 }),
      rule("transfers", { transfersAllowed: false }),
      rule("combinations", { combinable: false }),
      rule("penalties", { penaltyType: "cancel", fixedFee: 9999 }),
    ];
    const quote = await calculateFare(input);
    expect(quote).toMatchObject({ adjustedFare: 0, taxes: 0, totalAmount: 0 });
    expect(quote.appliedRules).toHaveLength(5);
  });

  it.each([
    ["eligibility", { passengerTypes: ["infant"] }, {}, /not eligible/],
    ["flight_application", { flightNumbers: ["OTHER"] }, {}, /not eligible/],
    ["day_time", { allowedDaysOfWeek: [2] }, {}, /day is not permitted/],
    ["advance_purchase", { minDaysBeforeDeparture: 14 }, {}, /at least 14/],
    [
      "blackout_dates",
      {
        blackoutPeriods: [
          { start: departureDate, end: departureDate, reason: "closed" },
        ],
      },
      {},
      /blackout period/,
    ],
    [
      "blackout_dates",
      { periods: [{ from: "2030-01-01", to: "2030-01-31" }] },
      {},
      /blackout period/,
    ],
    [
      "minimum_stay",
      { minNights: 3 },
      { returnDate: "2030-01-16T12:00:00Z" },
      /Minimum stay/,
    ],
    [
      "minimum_stay",
      { minStayDays: 3 },
      { returnDate: "2030-01-16T12:00:00Z" },
      /Minimum stay/,
    ],
    [
      "minimum_stay",
      { requireSaturdayNight: true },
      { returnDate: "2030-01-16T12:00:00Z" },
      /Saturday night/,
    ],
    [
      "maximum_stay",
      { maxNights: 1 },
      { returnDate: "2030-01-16T12:00:00Z" },
      /Maximum stay/,
    ],
    [
      "maximum_stay",
      { maxStayDays: 1 },
      { returnDate: "2030-01-16T12:00:00Z" },
      /Maximum stay/,
    ],
  ] as const)(
    "refuses a fare violating %s",
    async (category, conditions, trip, error) => {
      rules = [rule(category, conditions)];
      await expect(calculateFare({ ...input, ...trip })).rejects.toThrow(error);
    }
  );

  it("accepts boundary-valid eligibility, flight, day and Saturday-stay rules", async () => {
    rules = [
      rule("eligibility", { passengerTypes: ["adult"] }),
      rule("flight_application", { flightNumbers: ["ZX101"] }),
      rule("day_time", { allowedDaysOfWeek: [1] }),
      rule("minimum_stay", {
        minNights: 6,
        minDays: 6,
        requireSaturdayNight: true,
      }),
      rule("maximum_stay", { maxNights: 6, maxDays: 6 }),
      rule("blackout_dates", {
        blackoutPeriods: [{ start: "2030-02-01", end: "2030-02-02" }],
      }),
    ];
    const quote = await calculateFare({
      ...input,
      returnDate: "2030-01-20T12:00:00Z",
    });
    expect(quote.totalAmount).toBe(23000);
    expect(quote.appliedRules).toHaveLength(6);
  });

  it("rejects missing database, flight and fare class instead of returning a fabricated quote", async () => {
    flightExists = false;
    await expect(calculateFare(input)).rejects.toThrow(
      "Flight with id 1 not found"
    );
    flightExists = true;
    classExists = false;
    await expect(calculateFare(input)).rejects.toThrow(
      "Fare class with id 2 not found"
    );
    state.db = null;
    await expect(calculateFare(input)).rejects.toThrow(
      "Database not available"
    );
  });
});

describe("booking validation and change-fee results", () => {
  it("returns every independent violation with its rule identity", async () => {
    rules = [
      rule("advance_purchase", { minDaysBeforeDeparture: 14 }, { id: 1 }),
      rule(
        "minimum_stay",
        { minNights: 3, minDays: 3, requireSaturdayNight: true },
        { id: 2 }
      ),
      rule("maximum_stay", { maxNights: 1, maxDays: 1 }, { id: 3 }),
      rule(
        "blackout_dates",
        {
          periods: [{ from: "2030-01-01", to: "2030-01-31", reason: "closed" }],
        },
        { id: 4 }
      ),
      rule("day_time", { allowedDaysOfWeek: [2] }, { id: 5 }),
      rule("eligibility", { requireCorporateId: true }, { id: 6 }),
      rule("group_discount", { minPassengers: 3, maxPassengers: 4 }, { id: 7 }),
    ];
    const result = await validateBookingRules({
      ...validation,
      returnDate: "2030-01-16T12:00:00Z",
    });
    expect(result.valid).toBe(false);
    expect(result.violations.map(row => row.ruleId)).toEqual([
      1, 2, 2, 2, 3, 3, 4, 5, 6, 7,
    ]);
    expect(result.violations.every(row => row.message.length > 0)).toBe(true);
  });

  it("keeps the public validation alias consistent and permits one-way travel without a stay restriction", async () => {
    rules = [
      rule("minimum_stay", { minStayDays: 10 }),
      rule("maximum_stay", { maxStayDays: 1 }),
    ];
    expect(await validateRules(validation)).toEqual({
      valid: true,
      violations: [],
    });
    expect(
      await validateBookingRules({
        ...validation,
        departureDate: new Date(departureDate),
        bookingDate: new Date(validation.bookingDate),
      })
    ).toEqual({ valid: true, violations: [] });
  });

  it("returns a non-changeable fare before calculating any penalty", async () => {
    fareClass.changeable = false;
    rules = [rule("penalties", { penaltyType: "change", fixedFee: 9999 })];
    expect(
      await calculateChangeFee({
        fareClassId: 2,
        bookingDate: validation.bookingDate,
        changeDate: departureDate,
      })
    ).toEqual({
      fareClassId: 2,
      changeable: false,
      baseFee: 0,
      additionalFees: 0,
      totalFee: 0,
      currency: "SAR",
      rules: [],
    });
  });

  it("uses the first matching change tier once and excludes cancellation penalties", async () => {
    rules = [
      rule(
        "penalties",
        {
          penaltyType: "change",
          changeTiers: [
            { withinHours: 24, fee: 500 },
            { withinHours: 48, fee: 300 },
          ],
          fixedFee: 200,
        },
        { id: 1, priceAdjustment: 100 }
      ),
      rule("penalties", { penaltyType: "cancel", fixedFee: 9999 }, { id: 2 }),
    ];
    expect(
      await calculateChangeFee({
        fareClassId: 2,
        bookingDate: validation.bookingDate,
        changeDate: "2030-01-02T12:00:00Z",
      })
    ).toEqual({
      fareClassId: 2,
      changeable: true,
      baseFee: 1000,
      additionalFees: 800,
      totalFee: 1800,
      currency: "SAR",
      rules: [{ ruleId: 1, ruleName: "penalties", feeContribution: 800 }],
    });
    expect(
      (
        await calculateChangeFee({
          fareClassId: 2,
          bookingDate: validation.bookingDate,
          changeDate: "2030-01-05T12:00:00Z",
        })
      ).additionalFees
    ).toBe(300);
  });
});
