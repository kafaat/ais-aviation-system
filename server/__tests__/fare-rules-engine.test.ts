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
let scheduledDeparture: string;
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
    airlineId: 7,
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
  scheduledDeparture = departureDate;
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
                  originId: 3,
                  destinationId: 4,
                  departureTime: new Date(scheduledDeparture),
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

describe("UTC fare period date boundaries", () => {
  const cases = [
    {
      label: "one calendar day",
      start: "2030-01-14",
      end: "2030-01-14",
      departure: departureDate,
      inside: true,
    },
    {
      label: "inclusive final calendar day",
      start: "2030-01-13",
      end: "2030-01-14",
      departure: departureDate,
      inside: true,
    },
    {
      label: "final millisecond of the calendar day",
      start: "2030-01-14",
      end: "2030-01-14",
      departure: "2030-01-14T23:59:59.999Z",
      inside: true,
    },
    {
      label: "first instant of the next UTC day",
      start: "2030-01-13",
      end: "2030-01-13",
      departure: "2030-01-14T00:00:00Z",
      inside: false,
    },
    {
      label: "timestamp start with a calendar end on the same day",
      start: "2030-01-14T11:00:00Z",
      end: "2030-01-14",
      departure: departureDate,
      inside: true,
    },
    {
      label: "explicit midnight remains an exact end instant",
      start: "2030-01-13",
      end: "2030-01-14T00:00:00Z",
      departure: departureDate,
      inside: false,
    },
    {
      label: "inclusive explicit timestamp end",
      start: "2030-01-14T11:00:00Z",
      end: departureDate,
      departure: departureDate,
      inside: true,
    },
    {
      label: "one millisecond after an explicit timestamp end",
      start: "2030-01-14T11:00:00Z",
      end: "2030-01-14T11:59:59.999Z",
      departure: departureDate,
      inside: false,
    },
  ];

  it.each(cases)("blackout: $label", async period => {
    scheduledDeparture = period.departure;
    rules = [
      rule("blackout_dates", {
        blackoutPeriods: [{ start: period.start, end: period.end }],
      }),
    ];
    const quote = calculateFare({
      ...input,
      departureDate: period.departure.slice(0, 10),
    });
    if (period.inside) await expect(quote).rejects.toThrow(/blackout period/);
    else await expect(quote).resolves.toMatchObject({ adjustedFare: 10000 });
    const validated = await validateBookingRules({
      ...validation,
      departureDate: period.departure,
    });
    expect(validated.valid).toBe(!period.inside);
    expect(validated.violations.map(item => item.category)).toEqual(
      period.inside ? ["blackout_dates"] : []
    );
  });

  it.each(cases)("seasonality: $label", async period => {
    scheduledDeparture = period.departure;
    rules = [
      rule("seasonality", {
        season: "UTC boundary",
        periodStart: period.start,
        periodEnd: period.end,
        seasonMultiplier: 2,
      }),
    ];
    await expect(
      calculateFare({
        ...input,
        departureDate: period.departure.slice(0, 10),
      })
    ).resolves.toMatchObject({
      adjustedFare: period.inside ? 20000 : 10000,
      totalPerPassenger: period.inside ? 23000 : 11500,
    });
    await expect(
      validateBookingRules({ ...validation, departureDate: period.departure })
    ).resolves.toMatchObject({ valid: true, violations: [] });
  });

  it("treats a calendar end and its exact end-of-day alias consistently", async () => {
    rules = [
      rule("blackout_dates", {
        periods: [
          {
            start: "2030-01-14T11:00:00Z",
            from: "2030-01-14T11:00:00Z",
            end: "2030-01-14",
            to: "2030-01-14T23:59:59.999Z",
          },
        ],
      }),
    ];
    await expect(calculateFare(input)).rejects.toThrow(/blackout period/);
    await expect(validateBookingRules(validation)).resolves.toMatchObject({
      valid: false,
      violations: [{ category: "blackout_dates" }],
    });
  });

  it("rejects an explicit midnight alias that contradicts a calendar end", async () => {
    rules = [
      rule("blackout_dates", {
        periods: [
          {
            start: "2030-01-13",
            end: "2030-01-14",
            to: "2030-01-14T00:00:00Z",
          },
        ],
      }),
    ];
    await expect(calculateFare(input)).rejects.toThrow(/conditions/);
    await expect(validateBookingRules(validation)).rejects.toThrow(
      /conditions/
    );
  });
});

describe("fare quote arithmetic and ordered rule behavior", () => {
  describe("review follow-up guards", () => {
    it("rejects a surcharge adjustment that would make its monetary amount negative", async () => {
      rules = [
        rule(
          "surcharges",
          { surchargeType: "YQ", fixedAmount: 100 },
          { priceAdjustment: -20000 }
        ),
      ];
      await expect(calculateFare(input)).rejects.toThrow(
        /surcharge.*minor units/i
      );
    });

    it("floors a legitimate flat fare discount before percentage surcharges", async () => {
      rules = [
        rule(
          "advance_purchase",
          { minDaysBeforeDeparture: 0 },
          { id: 1, priceAdjustment: -20000 }
        ),
        rule("surcharges", { surchargeType: "YQ", percentage: 5 }, { id: 2 }),
      ];
      expect(await calculateFare(input)).toMatchObject({
        adjustedFare: 0,
        surcharges: 0,
        taxes: 0,
        totalPerPassenger: 0,
        totalAmount: 0,
      });
    });

    it("preserves a valid signed discount on a positive surcharge", async () => {
      rules = [
        rule(
          "surcharges",
          { surchargeType: "YQ", fixedAmount: 500 },
          { priceAdjustment: -100 }
        ),
      ];
      expect(await calculateFare(input)).toMatchObject({
        adjustedFare: 10000,
        surcharges: 400,
        taxes: 1560,
        totalPerPassenger: 11960,
      });
    });

    it.each(["-1.000", "NaN", "Infinity", "1invalid", ""])(
      "rejects an invalid rule price multiplier %s",
      async priceMultiplier => {
        rules = [
          rule(
            "advance_purchase",
            { minDaysBeforeDeparture: 0 },
            { priceMultiplier }
          ),
        ];
        await expect(calculateFare(input)).rejects.toThrow(/price multiplier/i);
        await expect(validateBookingRules(validation)).rejects.toThrow(
          /price multiplier/i
        );
      }
    );

    it.each([
      [
        "seasonality",
        {
          season: "overflow",
          periodStart: "2030-01-01",
          periodEnd: "2030-02-01",
          seasonMultiplier: 1e308,
        },
      ],
      ["surcharges", { surchargeType: "YQ", percentage: 1e308 }],
    ] as const)(
      "rejects finite %s inputs whose computed money overflows",
      async (category, conditions) => {
        rules = [rule(category, conditions)];
        await expect(calculateFare(input)).rejects.toThrow(/minor units/i);
      }
    );

    it("rejects an unsafe passenger total even when one passenger's fare is safe", async () => {
      fareClass.basePriceMultiplier = "400000000000.000";
      await expect(
        calculateFare({ ...input, passengerCount: 3 })
      ).rejects.toThrow(/total amount.*minor units/i);
    });

    it("rejects overflow when adding valid individual change fee contributions", async () => {
      rules = [
        rule("penalties", {
          penaltyType: "change",
          fixedFee: Number.MAX_SAFE_INTEGER,
        }),
      ];
      await expect(
        calculateChangeFee({
          fareClassId: 2,
          bookingDate: validation.bookingDate,
          changeDate: departureDate,
        })
      ).rejects.toThrow(/total change fee.*minor units/i);
    });

    it.each([
      { blackoutPeriods: [{ from: "2030-01-14", to: "2030-01-15" }] },
      { periods: [{ start: "2030-01-14", end: "2030-01-15" }] },
      {
        blackoutPeriods: [{ start: "2030-01-01", end: "2030-01-02" }],
        periods: [{ from: "2030-01-14", to: "2030-01-15" }],
      },
    ])("enforces every accepted blackout alias: %j", async conditions => {
      rules = [rule("blackout_dates", conditions)];
      await expect(calculateFare(input)).rejects.toThrow(/blackout period/);
      expect(await validateBookingRules(validation)).toMatchObject({
        valid: false,
        violations: [{ category: "blackout_dates" }],
      });
    });

    it("rejects incomplete periods in either array even when the other array is valid", async () => {
      rules = [
        rule("blackout_dates", {
          blackoutPeriods: [{ start: "2030-01-01", end: "2030-01-02" }],
          periods: [{}],
        }),
      ];
      await expect(calculateFare(input)).rejects.toThrow(/conditions/);
      await expect(validateBookingRules(validation)).rejects.toThrow(
        /conditions/
      );
    });

    it.each(["invalid", "2030-02-30", ""])(
      "rejects an invalid return date instead of bypassing stay rules: %s",
      async returnDate => {
        rules = [rule("minimum_stay", { minNights: 2 })];
        await expect(calculateFare({ ...input, returnDate })).rejects.toThrow(
          /Invalid return date/
        );
        await expect(
          validateBookingRules({ ...validation, returnDate })
        ).rejects.toThrow(/Invalid return date/);
      }
    );

    it.each(["invalid", "2030-02-30", new Date(NaN)])(
      "rejects an invalid booking date before rule evaluation: %s",
      async bookingDate => {
        rules = [rule("advance_purchase", { minDaysBeforeDeparture: 7 })];
        await expect(
          validateBookingRules({ ...validation, bookingDate })
        ).rejects.toThrow(/Invalid booking date/);
      }
    );

    it.each(["bookingDate", "changeDate"] as const)(
      "rejects an invalid %s before calculating a change fee",
      async field => {
        await expect(
          calculateChangeFee({
            fareClassId: 2,
            bookingDate: validation.bookingDate,
            changeDate: departureDate,
            [field]: "invalid",
          })
        ).rejects.toThrow(/Invalid (booking|change) date/);
      }
    );

    it("accepts a matching ISO calendar day but evaluates rules at the actual departure instant", async () => {
      rules = [
        rule("blackout_dates", {
          blackoutPeriods: [
            { start: "2030-01-14T11:00:00Z", end: "2030-01-14T13:00:00Z" },
          ],
        }),
      ];
      await expect(
        calculateFare({ ...input, departureDate: "2030-01-14" })
      ).rejects.toThrow(/blackout period/);
      rules = [];
      expect(
        await calculateFare({ ...input, departureDate: "2030-01-14" })
      ).toEqual(await calculateFare(input));
    });
  });

  it.each(["{", "null", "[]", '"invalid"', "false", "123"])(
    "refuses malformed persisted conditions %s in quotes, validation and change fees",
    async conditions => {
      rules = [rule("penalties", {}, { conditions })];
      await expect(calculateFare(input)).rejects.toThrow(
        /conditions.*JSON object/i
      );
      await expect(validateBookingRules(validation)).rejects.toThrow(
        /conditions.*JSON object/i
      );
      await expect(
        calculateChangeFee({
          fareClassId: 2,
          bookingDate: validation.bookingDate,
          changeDate: departureDate,
        })
      ).rejects.toThrow(/conditions.*JSON object/i);
    }
  );

  it("refuses an unsupported persisted cabin instead of quoting economy", async () => {
    fareClass.cabinClass = "unsupported" as FareClass["cabinClass"];
    await expect(calculateFare(input)).rejects.toThrow(
      /Unsupported cabin class/
    );
  });

  it.each(["advance_purchase", "penalties", "surcharges"] as const)(
    "refuses a persisted %s object that omits its category's required fields",
    async category => {
      rules = [rule(category, {})];
      await expect(calculateFare(input)).rejects.toThrow(
        /conditions must include/
      );
      await expect(validateBookingRules(validation)).rejects.toThrow(
        /conditions must include/
      );
    }
  );

  it.each([
    ["surcharges", { surchargeType: "YQ", fixedAmount: -20000 }],
    ["surcharges", { surchargeType: "YQ", fixedAmount: "499" }],
    ["surcharges", { surchargeType: "unknown", fixedAmount: 500 }],
    ["children_discount", { passengerType: "child", discountPercentage: 101 }],
    ["penalties", { penaltyType: "change", fixedFee: -500 }],
    [
      "blackout_dates",
      { blackoutPeriods: [{ start: "2030-02-30", end: "2030-03-01" }] },
    ],
    [
      "blackout_dates",
      { blackoutPeriods: [{ start: "2030-02-02", end: "2030-02-01" }] },
    ],
  ] as const)(
    "rejects malformed typed %s conditions before computing money",
    async (category, conditions) => {
      rules = [rule(category, conditions)];
      await expect(calculateFare(input)).rejects.toThrow(/conditions/);
      await expect(validateBookingRules(validation)).rejects.toThrow(
        /conditions/
      );
      if (category === "penalties")
        await expect(
          calculateChangeFee({
            fareClassId: 2,
            bookingDate: validation.bookingDate,
            changeDate: departureDate,
          })
        ).rejects.toThrow(/conditions/);
    }
  );

  it.each([
    { originId: 30 },
    { destinationId: 40 },
    { departureDate: "2030-01-15T12:00:00Z" },
    { departureDate: "invalid" },
  ])(
    "binds the requested route and departure to the selected flight: %j",
    async changed => {
      await expect(calculateFare({ ...input, ...changed })).rejects.toThrow(
        /does not match the selected flight/
      );
    }
  );

  it("refuses a fare class from another airline even when it exists and is active", async () => {
    fareClass.airlineId = 8;
    await expect(calculateFare(input)).rejects.toThrow(
      /Fare class airline does not match/
    );
  });

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
        { surchargeType: "YQ", fixedAmount: 300, percentage: 5 },
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
        season: "fixture",
        periodStart: "2030-02-01",
        periodEnd: "2030-03-01",
        seasonMultiplier: 2,
      }),
      rule("group_discount", {
        minPassengers: 3,
        maxPassengers: 4,
        discountPercentage: 50,
      }),
      rule("surcharges", { surchargeType: "YQ", fixedAmount: 0 }),
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
      rule(
        "group_discount",
        { minPassengers: 3, maxPassengers: 4, discountPercentage: 10 },
        { id: 7 }
      ),
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
