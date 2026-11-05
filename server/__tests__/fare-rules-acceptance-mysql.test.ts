import { randomBytes } from "node:crypto";
import { eq, getTableName } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { fareRulesRouter } from "../routers/fare-rules";
import { getApplicableRules } from "../services/fare-rules.service";

const tables = [
  schema.flights,
  schema.fareClasses,
  schema.fareRules,
  schema.flightFareClassInventory,
  schema.inventoryLocks,
];
const enabled =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = enabled ? describe : describe.skip;

function caller(role: schema.User["role"] | null) {
  return fareRulesRouter.createCaller({
    user: role ? ({ id: 9, role, tenantId: 3 } as schema.User) : null,
    tenantId: role ? 3 : null,
    authMethod: role ? "cookie" : null,
  } as TrpcContext);
}

nativeDescribe(
  "fare administration, SQL applicability and public quotes on native MySQL",
  () => {
    let adminConnection: mysql.Connection | null = null;
    let pool: mysql.Pool | null = null;
    let db: MySql2Database<typeof schema>;
    let databaseName = "";
    let created = false;
    let fareClassId: number;
    let discountClassId: number;
    const admin = caller("admin");
    const customer = caller("user");
    const anonymous = caller(null);
    const departureDate = "2030-06-10T12:00:00Z";
    const trip = { flightId: 41, originId: 3, destinationId: 4, departureDate };
    const quote = () => ({
      ...trip,
      fareClassId,
      passengerType: "adult" as const,
      passengerCount: 1,
    });
    const validation = () => ({
      ...trip,
      fareClassId,
      bookingDate: "2030-05-01T12:00:00Z",
      returnDate: "2030-06-12T12:00:00Z",
      passengerCount: 1,
    });
    const classInput = (code: string, overrides = {}) => ({
      airlineId: 7,
      code,
      name: `Synthetic ${code}`,
      cabinClass: "economy" as const,
      priority: 10,
      basePriceMultiplier: 1.25,
      seatsAllocated: 3,
      refundable: true,
      changeable: true,
      changeFee: 1000,
      upgradeable: true,
      baggageAllowance: 23,
      baggagePieces: 1,
      carryOnAllowance: 7,
      seatSelection: "free" as const,
      loungeAccess: false,
      priorityBoarding: false,
      mealIncluded: false,
      ...overrides,
    });
    const surcharge = (overrides = {}) => ({
      fareClassId,
      airlineId: 7,
      ruleName: "Synthetic surcharge",
      ruleCategory: "surcharges" as const,
      conditions: JSON.stringify({ surchargeType: "YQ", fixedAmount: 499 }),
      validFrom: "2030-01-01T00:00:00Z",
      ...overrides,
    });

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      const source = url.pathname.slice(1);
      if (
        !/^[A-Za-z0-9_]+_test$/.test(source) ||
        !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
      )
        throw new Error(
          "Native fare acceptance requires a loopback disposable _test database"
        );
      const options = {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
      };
      databaseName = "ais_fares_" + randomBytes(6).toString("hex");
      if (!/^ais_fares_[0-9a-f]{12}$/.test(databaseName))
        throw new Error("Invalid fixture identity");
      adminConnection = await mysql.createConnection(options);
      await adminConnection.query(`CREATE DATABASE \`${databaseName}\``);
      created = true;
      for (const table of tables) {
        const name = getTableName(table);
        if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid fixture table");
        // Production column types/defaults/keys are cloned; foreign keys are
        // verified by the migration catalog gate, not by CREATE TABLE LIKE.
        await adminConnection.query(
          `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${source}\`.\`${name}\``
        );
      }
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 4,
      });
      db = drizzle(pool, { schema, mode: "default" });
      state.db = db;
      const [settings] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT @@SESSION.sql_mode AS sqlMode"
      );
      expect(settings[0]?.sqlMode).toContain("STRICT_TRANS_TABLES");
    }, 60000);

    afterAll(async () => {
      state.db = null;
      if (pool) await pool.end();
      if (adminConnection) {
        try {
          if (created)
            await adminConnection.query(`DROP DATABASE \`${databaseName}\``);
        } finally {
          await adminConnection.end();
        }
      }
    });

    beforeEach(async () => {
      for (const table of [...tables].reverse()) await db.delete(table);
      await db.insert(schema.flights).values({
        id: 41,
        airlineId: 7,
        flightNumber: "FA041",
        originId: 3,
        destinationId: 4,
        departureTime: new Date(departureDate),
        arrivalTime: new Date("2030-06-10T14:00:00Z"),
        economySeats: 8,
        businessSeats: 2,
        economyAvailable: 8,
        businessAvailable: 2,
        economyPrice: 10001,
        businessPrice: 25000,
      });
      fareClassId = (await admin.createFareClass(classInput("Y"))).id;
      discountClassId = (
        await admin.createFareClass(
          classInput("M", {
            priority: 0,
            basePriceMultiplier: 1,
            seatsAllocated: 2,
          })
        )
      ).id;
    });

    describe("UTC fare period date boundaries", () => {
      const cases = [
        {
          label: "one calendar day",
          start: "2030-06-10",
          end: "2030-06-10",
          departure: departureDate,
          inside: true,
        },
        {
          label: "inclusive final calendar day",
          start: "2030-06-09",
          end: "2030-06-10",
          departure: departureDate,
          inside: true,
        },
        {
          label: "final persisted second of the calendar day",
          start: "2030-06-10",
          end: "2030-06-10",
          departure: "2030-06-10T23:59:59Z",
          inside: true,
        },
        {
          label: "first instant of the next UTC day",
          start: "2030-06-09",
          end: "2030-06-09",
          departure: "2030-06-10T00:00:00Z",
          inside: false,
        },
        {
          label: "timestamp start with a calendar end on the same day",
          start: "2030-06-10T11:00:00Z",
          end: "2030-06-10",
          departure: departureDate,
          inside: true,
        },
        {
          label: "explicit midnight remains an exact end instant",
          start: "2030-06-09",
          end: "2030-06-10T00:00:00Z",
          departure: departureDate,
          inside: false,
        },
        {
          label: "inclusive explicit timestamp end",
          start: "2030-06-10T11:00:00Z",
          end: departureDate,
          departure: departureDate,
          inside: true,
        },
        {
          label: "one millisecond after an explicit timestamp end",
          start: "2030-06-10T11:00:00Z",
          end: "2030-06-10T11:59:59.999Z",
          departure: departureDate,
          inside: false,
        },
      ];

      it.each(cases)("blackout: $label", async period => {
        await db
          .update(schema.flights)
          .set({
            departureTime: new Date(period.departure),
            arrivalTime: new Date(Date.parse(period.departure) + 7_200_000),
          })
          .where(eq(schema.flights.id, trip.flightId));
        const rule = await admin.createFareRule(
          surcharge({
            ruleCategory: "blackout_dates",
            conditions: JSON.stringify({
              blackoutPeriods: [{ start: period.start, end: period.end }],
            }),
          })
        );
        const calendarTrip = {
          ...trip,
          departureDate: period.departure.slice(0, 10),
        };
        const result = anonymous.calculateFare({ ...quote(), ...calendarTrip });
        if (period.inside)
          await expect(result).rejects.toThrow(/blackout period/);
        else
          await expect(result).resolves.toMatchObject({ adjustedFare: 12501 });
        expect(
          await customer.validateRules({
            ...validation(),
            departureDate: period.departure,
          })
        ).toMatchObject({
          valid: !period.inside,
          violations: period.inside
            ? [{ ruleId: rule.id, category: "blackout_dates" }]
            : [],
        });
        expect(
          (await anonymous.compareFareClasses(calendarTrip)).comparisons.some(
            row => row.fareClass.id === fareClassId
          )
        ).toBe(!period.inside);
      });

      it.each(cases)("seasonality: $label", async period => {
        await db
          .update(schema.flights)
          .set({
            departureTime: new Date(period.departure),
            arrivalTime: new Date(Date.parse(period.departure) + 7_200_000),
          })
          .where(eq(schema.flights.id, trip.flightId));
        await admin.createFareRule(
          surcharge({
            ruleCategory: "seasonality",
            conditions: JSON.stringify({
              season: "UTC boundary",
              periodStart: period.start,
              periodEnd: period.end,
              seasonMultiplier: 2,
            }),
          })
        );
        const calendarTrip = {
          ...trip,
          departureDate: period.departure.slice(0, 10),
        };
        const total = period.inside ? 28752 : 14376;
        await expect(
          anonymous.calculateFare({ ...quote(), ...calendarTrip })
        ).resolves.toMatchObject({
          adjustedFare: period.inside ? 25002 : 12501,
          totalPerPassenger: total,
        });
        await expect(
          customer.validateRules({
            ...validation(),
            departureDate: period.departure,
          })
        ).resolves.toMatchObject({ valid: true, violations: [] });
        expect(
          (await anonymous.compareFareClasses(calendarTrip)).comparisons.find(
            row => row.fareClass.id === fareClassId
          )?.total
        ).toBe(total);
      });

      it("persists a date-only validity end through its final database second without including the next day", async () => {
        const rule = await admin.createFareRule(
          surcharge({ validFrom: "2030-06-10", validUntil: "2030-06-10" })
        );
        let stored = (await db.select().from(schema.fareRules))[0]!;
        expect(stored.validFrom.toISOString()).toBe("2030-06-10T00:00:00.000Z");
        expect(stored.validUntil?.toISOString()).toBe(
          "2030-06-10T23:59:59.000Z"
        );
        expect(
          (
            await getApplicableRules(
              fareClassId,
              3,
              4,
              new Date("2030-06-10T23:59:59Z")
            )
          ).map(row => row.id)
        ).toEqual([rule.id]);
        expect(
          await getApplicableRules(
            fareClassId,
            3,
            4,
            new Date("2030-06-11T00:00:00Z")
          )
        ).toEqual([]);
        await expect(anonymous.calculateFare(quote())).resolves.toMatchObject({
          surcharges: 499,
        });
        await admin.updateFareRule({
          id: rule.id,
          validFrom: "2030-06-09",
          validUntil: "2030-06-09",
        });
        await expect(anonymous.calculateFare(quote())).resolves.toMatchObject({
          surcharges: 0,
        });
        await admin.updateFareRule({ id: rule.id, validUntil: "2030-06-10" });
        stored = (await db.select().from(schema.fareRules))[0]!;
        expect(stored.validUntil?.toISOString()).toBe(
          "2030-06-10T23:59:59.000Z"
        );
        await expect(anonymous.calculateFare(quote())).resolves.toMatchObject({
          surcharges: 499,
        });
        await admin.updateFareRule({ id: rule.id, validUntil: null });
        expect(
          (
            await getApplicableRules(
              fareClassId,
              3,
              4,
              new Date("2030-06-11T00:00:00Z")
            )
          ).map(row => row.id)
        ).toEqual([rule.id]);
      });

      it("preserves explicit validity instants during create and update", async () => {
        const rule = await admin.createFareRule(
          surcharge({ validUntil: "2030-06-10T00:00:00Z" })
        );
        expect(
          (
            await db.select().from(schema.fareRules)
          )[0]?.validUntil?.toISOString()
        ).toBe("2030-06-10T00:00:00.000Z");
        await expect(anonymous.calculateFare(quote())).resolves.toMatchObject({
          surcharges: 0,
        });
        await admin.updateFareRule({ id: rule.id, validUntil: departureDate });
        await expect(anonymous.calculateFare(quote())).resolves.toMatchObject({
          surcharges: 499,
        });
        expect(
          await getApplicableRules(
            fareClassId,
            3,
            4,
            new Date("2030-06-10T12:00:01Z")
          )
        ).toEqual([]);
        await admin.updateFareRule({
          id: rule.id,
          validUntil: "2030-06-10T03:00:00+03:00",
        });
        expect(
          (
            await db.select().from(schema.fareRules)
          )[0]?.validUntil?.toISOString()
        ).toBe("2030-06-10T00:00:00.000Z");
        await expect(anonymous.calculateFare(quote())).resolves.toMatchObject({
          surcharges: 0,
        });
      });

      it("accepts equal normalized blackout endpoint aliases and refuses conflicting ones without writing", async () => {
        const rule = await admin.createFareRule(
          surcharge({
            ruleCategory: "blackout_dates",
            conditions: JSON.stringify({
              periods: [
                {
                  start: "2030-06-10T11:00:00Z",
                  end: "2030-06-10",
                  to: "2030-06-10T23:59:59.999Z",
                },
              ],
            }),
          })
        );
        await expect(anonymous.calculateFare(quote())).rejects.toThrow(
          /blackout period/
        );
        const before = (await db.select().from(schema.fareRules))[0]!;
        await expect(
          admin.updateFareRule({
            id: rule.id,
            conditions: JSON.stringify({
              periods: [
                {
                  start: "2030-06-09",
                  end: "2030-06-10",
                  to: "2030-06-10T00:00:00Z",
                },
              ],
            }),
          })
        ).rejects.toThrow(/conditions/);
        expect((await db.select().from(schema.fareRules))[0]!.conditions).toBe(
          before.conditions
        );
      });
    });

    it("allows only authenticated platform administrators to persist fare edits", async () => {
      await expect(
        anonymous.createFareClass(classInput("Q"))
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      for (const role of ["user", "ops", "airline_admin"] as const) {
        const denied = caller(role);
        await expect(
          denied.createFareClass(classInput("Q"))
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(denied.createFareRule(surcharge())).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          denied.updateFareClass({ id: fareClassId, basePriceMultiplier: 9 })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const rule = await admin.createFareRule(surcharge());
      await expect(
        customer.updateFareRule({ id: rule.id, active: false })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.select().from(schema.fareClasses)).toHaveLength(2);
      expect((await db.select().from(schema.fareRules))[0]).toMatchObject({
        id: rule.id,
        active: true,
      });
      await expect(anonymous.validateRules(validation())).rejects.toMatchObject(
        { code: "UNAUTHORIZED" }
      );
    });

    it("makes availability and comparison agree with actual rounded quotes before and after administrative edits", async () => {
      const rule = await admin.createFareRule(surcharge());
      const assertQuote = async (total: number, extra: number) => {
        const availability = await anonymous.getFareClassAvailability({
          flightId: 41,
        });
        expect(
          availability.fareClasses.find(row => row.id === fareClassId)
            ?.availableSeats
        ).toBe(3);
        expect(
          availability.fareClasses.find(row => row.id === discountClassId)
            ?.availableSeats
        ).toBe(5);
        const direct = await anonymous.calculateFare(quote());
        expect(direct).toMatchObject({
          adjustedFare: 12501,
          surcharges: extra,
          totalPerPassenger: total,
          totalAmount: total,
        });
        const comparison = await anonymous.compareFareClasses(trip);
        expect(comparison.comparisons.map(row => row.fareClass.id)).toEqual([
          discountClassId,
          fareClassId,
        ]);
        expect(
          comparison.comparisons.find(row => row.fareClass.id === fareClassId)
        ).toMatchObject({
          estimatedFare: direct.adjustedFare,
          surcharges: direct.surcharges,
          taxes: direct.taxes,
          total: direct.totalPerPassenger,
          availableSeats: 3,
          isAvailable: true,
        });
      };
      await assertQuote(14950, 499);
      await admin.updateFareRule({
        id: rule.id,
        conditions: JSON.stringify({ surchargeType: "YQ", fixedAmount: 999 }),
      });
      await assertQuote(15525, 999);
    });

    it("uses flight-scoped RBD availability and its physical cabin ceiling in comparison", async () => {
      await db.insert(schema.flightFareClassInventory).values([
        { flightId: 41, fareClassId, capacity: 12, availableSeats: 12 },
        {
          flightId: 41,
          fareClassId: discountClassId,
          capacity: 2,
          availableSeats: 0,
        },
      ]);
      const availability = await anonymous.getFareClassAvailability({
        flightId: 41,
      });
      expect(
        availability.fareClasses.find(row => row.id === fareClassId)
          ?.availableSeats
      ).toBe(8);
      expect(
        availability.fareClasses.find(row => row.id === discountClassId)
          ?.availableSeats
      ).toBe(0);
      const comparison = await anonymous.compareFareClasses(trip);
      expect(
        comparison.comparisons.find(row => row.fareClass.id === fareClassId)
      ).toMatchObject({ availableSeats: 8, isAvailable: true });
      expect(
        comparison.comparisons.find(row => row.fareClass.id === discountClassId)
      ).toMatchObject({ availableSeats: 0, isAvailable: false });
    });

    it("filters real SQL rules by class, both route endpoints, active status and inclusive validity boundaries", async () => {
      const global = await admin.createFareRule(surcharge());
      const boundary = await admin.createFareRule(
        surcharge({
          ruleName: "Exact boundary",
          originAirportId: 3,
          destinationAirportId: 4,
          validFrom: departureDate,
          validUntil: departureDate,
        })
      );
      for (const overrides of [
        { originAirportId: 30 },
        { destinationAirportId: 40 },
        { fareClassId: discountClassId },
        { validFrom: "2030-06-10T12:00:01Z" },
        { validUntil: "2030-06-10T11:59:59Z" },
      ])
        await admin.createFareRule(surcharge(overrides));
      const disabled = await admin.createFareRule(surcharge());
      await admin.updateFareRule({ id: disabled.id, active: false });
      const selected = await getApplicableRules(
        fareClassId,
        3,
        4,
        new Date(departureDate)
      );
      expect(selected.map(rule => rule.id)).toEqual([global.id, boundary.id]);
      const direct = await anonymous.calculateFare(quote());
      expect(direct.appliedRules.map(rule => rule.ruleId)).toEqual([
        global.id,
        boundary.id,
      ]);
      expect(direct.surcharges).toBe(998);
    });

    it("propagates a persisted administrative restriction to both validation and pricing, then recovers after correction", async () => {
      const rule = await admin.createFareRule(
        surcharge({
          ruleCategory: "minimum_stay",
          conditions: JSON.stringify({ minNights: 2 }),
        })
      );
      expect(await customer.validateRules(validation())).toMatchObject({
        valid: true,
        violations: [],
      });
      await expect(
        anonymous.calculateFare({
          ...quote(),
          returnDate: validation().returnDate,
        })
      ).resolves.toMatchObject({ totalPerPassenger: 14376 });
      await admin.updateFareRule({
        id: rule.id,
        conditions: JSON.stringify({ minNights: 3 }),
      });
      expect(await customer.validateRules(validation())).toMatchObject({
        valid: false,
        violations: [{ ruleId: rule.id, category: "minimum_stay" }],
      });
      await expect(
        anonymous.calculateFare({
          ...quote(),
          returnDate: validation().returnDate,
        })
      ).rejects.toThrow(/Minimum stay/);
      await admin.updateFareRule({
        id: rule.id,
        conditions: JSON.stringify({ minNights: 2 }),
      });
      expect(await customer.validateRules(validation())).toMatchObject({
        valid: true,
        violations: [],
      });
    });

    it.each(["{broken", "null", "[]", '"scalar"', "false", "123"])(
      "rejects malformed admin conditions %s without writing a rule",
      async conditions => {
        await expect(
          admin.createFareRule(surcharge({ conditions }))
        ).rejects.toThrow(/conditions.*JSON/);
        expect(await db.select().from(schema.fareRules)).toHaveLength(0);
        const rule = await admin.createFareRule(surcharge());
        await expect(
          admin.updateFareRule({ id: rule.id, conditions })
        ).rejects.toThrow(/conditions.*JSON/);
        expect((await db.select().from(schema.fareRules))[0]?.conditions).toBe(
          surcharge().conditions
        );
      }
    );

    it("rejects a category-only edit when the retained conditions do not satisfy the new category", async () => {
      const rule = await admin.createFareRule(surcharge());
      await expect(
        admin.updateFareRule({ id: rule.id, ruleCategory: "advance_purchase" })
      ).rejects.toThrow(/minDaysBeforeDeparture/);
      expect((await db.select().from(schema.fareRules))[0]).toMatchObject({
        ruleCategory: "surcharges",
        conditions: surcharge().conditions,
      });
    });

    it("fails closed if imported stored conditions are malformed and excludes that class from comparison", async () => {
      const rule = await admin.createFareRule(
        surcharge({
          ruleCategory: "penalties",
          conditions: JSON.stringify({ penaltyType: "change", fixedFee: 500 }),
        })
      );
      await db
        .update(schema.fareRules)
        .set({ conditions: "{broken" })
        .where(eq(schema.fareRules.id, rule.id));
      await expect(anonymous.calculateFare(quote())).rejects.toThrow(
        /conditions.*JSON object/
      );
      await expect(customer.validateRules(validation())).rejects.toThrow(
        /conditions.*JSON object/
      );
      await expect(
        customer.calculateChangeFee({
          fareClassId,
          bookingDate: "2030-05-01T12:00:00Z",
          changeDate: departureDate,
        })
      ).rejects.toThrow(/conditions.*JSON object/);
      expect(
        (await anonymous.compareFareClasses(trip)).comparisons.map(
          row => row.fareClass.id
        )
      ).toEqual([discountClassId]);
    });

    it("rejects imported objects missing required category fields across every fare reader", async () => {
      const rule = await admin.createFareRule(
        surcharge({
          ruleCategory: "penalties",
          conditions: JSON.stringify({ penaltyType: "change", fixedFee: 500 }),
        })
      );
      await db
        .update(schema.fareRules)
        .set({ conditions: "{}" })
        .where(eq(schema.fareRules.id, rule.id));
      await expect(anonymous.calculateFare(quote())).rejects.toThrow(
        /penalties conditions must include/
      );
      await expect(customer.validateRules(validation())).rejects.toThrow(
        /penalties conditions must include/
      );
      await expect(
        customer.calculateChangeFee({
          fareClassId,
          bookingDate: "2030-05-01T12:00:00Z",
          changeDate: departureDate,
        })
      ).rejects.toThrow(/penalties conditions must include/);
      expect(
        (await anonymous.compareFareClasses(trip)).comparisons.map(
          row => row.fareClass.id
        )
      ).toEqual([discountClassId]);
    });

    it.each([
      ["surcharges", { surchargeType: "YQ", fixedAmount: -20000 }],
      ["surcharges", { surchargeType: "YQ", fixedAmount: "499" }],
      [
        "children_discount",
        { passengerType: "child", discountPercentage: 101 },
      ],
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
      "rejects invalid %s values on admin write and on reading an imported row",
      async (ruleCategory, conditions) => {
        const conditionsText = JSON.stringify(conditions);
        await expect(
          admin.createFareRule(
            surcharge({ ruleCategory, conditions: conditionsText })
          )
        ).rejects.toThrow(/conditions/);
        expect(await db.select().from(schema.fareRules)).toHaveLength(0);
        const rule = await admin.createFareRule(surcharge());
        await db
          .update(schema.fareRules)
          .set({ ruleCategory, conditions: conditionsText })
          .where(eq(schema.fareRules.id, rule.id));
        await expect(anonymous.calculateFare(quote())).rejects.toThrow(
          /conditions/
        );
        await expect(customer.validateRules(validation())).rejects.toThrow(
          /conditions/
        );
        if (ruleCategory === "penalties")
          await expect(
            customer.calculateChangeFee({
              fareClassId,
              bookingDate: "2030-05-01T12:00:00Z",
              changeDate: departureDate,
            })
          ).rejects.toThrow(/conditions/);
        expect(
          (await anonymous.compareFareClasses(trip)).comparisons.map(
            row => row.fareClass.id
          )
        ).toEqual([discountClassId]);
      }
    );

    it.each([
      { originId: 30 },
      { destinationId: 40 },
      { departureDate: "2030-06-11T12:00:00Z" },
      { departureDate: "invalid" },
    ])(
      "refuses route/departure substitution in both quote and comparison: %j",
      async changed => {
        await expect(
          anonymous.calculateFare({ ...quote(), ...changed })
        ).rejects.toThrow(/does not match the selected flight/);
        await expect(
          anonymous.compareFareClasses({ ...trip, ...changed })
        ).rejects.toThrow(/does not match the selected flight/);
      }
    );

    it("rejects a foreign airline class even if it is active and has a valid price", async () => {
      const foreign = await admin.createFareClass(
        classInput("Q", { airlineId: 8 })
      );
      await expect(
        anonymous.calculateFare({ ...quote(), fareClassId: foreign.id })
      ).rejects.toThrow(/Fare class airline does not match/);
      expect(
        (
          await anonymous.getFareClassAvailability({ flightId: 41 })
        ).fareClasses.map(row => row.id)
      ).not.toContain(foreign.id);
      expect(
        (await anonymous.compareFareClasses(trip)).comparisons.map(
          row => row.fareClass.id
        )
      ).not.toContain(foreign.id);
    });

    it("keeps rule airline and class ownership consistent during create and reassignment", async () => {
      const foreign = await admin.createFareClass(
        classInput("Q", { airlineId: 8 })
      );
      await expect(
        admin.createFareRule(surcharge({ airlineId: 8 }))
      ).rejects.toThrow(/Fare rule airline does not match/);
      expect(await db.select().from(schema.fareRules)).toHaveLength(0);
      const rule = await admin.createFareRule(surcharge());
      for (const change of [
        { airlineId: 8 },
        { fareClassId: foreign.id },
        { fareClassId: 987654 },
      ])
        await expect(
          admin.updateFareRule({ id: rule.id, ...change })
        ).rejects.toThrow(/does not match|not found/);
      expect((await db.select().from(schema.fareRules))[0]).toMatchObject({
        fareClassId,
        airlineId: 7,
      });
      await admin.updateFareRule({
        id: rule.id,
        fareClassId: foreign.id,
        airlineId: 8,
      });
      expect((await db.select().from(schema.fareRules))[0]).toMatchObject({
        fareClassId: foreign.id,
        airlineId: 8,
      });
    });

    it("rejects an imported rule with inconsistent airline metadata instead of applying it", async () => {
      const rule = await admin.createFareRule(
        surcharge({
          ruleCategory: "penalties",
          conditions: JSON.stringify({ penaltyType: "change", fixedFee: 500 }),
        })
      );
      await db
        .update(schema.fareRules)
        .set({ airlineId: 8 })
        .where(eq(schema.fareRules.id, rule.id));
      await expect(anonymous.calculateFare(quote())).rejects.toThrow(
        /Fare rule airline does not match/
      );
      await expect(customer.validateRules(validation())).rejects.toThrow(
        /Fare rule airline does not match/
      );
      await expect(
        customer.calculateChangeFee({
          fareClassId,
          bookingDate: "2030-05-01T12:00:00Z",
          changeDate: departureDate,
        })
      ).rejects.toThrow(/Fare rule airline does not match/);
    });

    it("does not approve validation for an unknown or inactive fare class", async () => {
      await expect(
        customer.validateRules({ ...validation(), fareClassId: 987654 })
      ).rejects.toThrow(/not found/);
      await admin.updateFareClass({ id: fareClassId, active: false });
      await expect(customer.validateRules(validation())).rejects.toThrow(
        /not found/
      );
    });

    it("rejects negative administrative multipliers without writing and refuses imported negative multipliers in every reader", async () => {
      await expect(
        admin.createFareRule(surcharge({ priceMultiplier: -1 }))
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await db.select().from(schema.fareRules)).toHaveLength(0);
      const rule = await admin.createFareRule(
        surcharge({
          ruleCategory: "penalties",
          conditions: JSON.stringify({ penaltyType: "change", fixedFee: 500 }),
        })
      );
      await expect(
        admin.updateFareRule({ id: rule.id, priceMultiplier: -1 })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        (await db.select().from(schema.fareRules))[0]?.priceMultiplier
      ).toBe("1.000");
      await db
        .update(schema.fareRules)
        .set({ priceMultiplier: "-1.000" })
        .where(eq(schema.fareRules.id, rule.id));
      await expect(anonymous.calculateFare(quote())).rejects.toThrow(
        /price multiplier/
      );
      await expect(customer.validateRules(validation())).rejects.toThrow(
        /price multiplier/
      );
      await expect(
        customer.calculateChangeFee({
          fareClassId,
          bookingDate: validation().bookingDate,
          changeDate: departureDate,
        })
      ).rejects.toThrow(/price multiplier/);
    });

    it("rejects a negative surcharge total but preserves legitimate signed discounts and a zero fare", async () => {
      const rule = await admin.createFareRule(
        surcharge({ priceAdjustment: -20000 })
      );
      await expect(anonymous.calculateFare(quote())).rejects.toThrow(
        /Surcharge.*minor units/
      );
      expect(
        (await anonymous.compareFareClasses(trip)).comparisons.map(
          row => row.fareClass.id
        )
      ).toEqual([discountClassId]);
      await admin.updateFareRule({ id: rule.id, priceAdjustment: -100 });
      expect(await anonymous.calculateFare(quote())).toMatchObject({
        adjustedFare: 12501,
        surcharges: 399,
        taxes: 1935,
        totalPerPassenger: 14835,
      });
      await admin.updateFareRule({
        id: rule.id,
        priceAdjustment: 0,
        conditions: JSON.stringify({ surchargeType: "YQ", percentage: 5 }),
      });
      await admin.createFareRule(
        surcharge({
          ruleCategory: "advance_purchase",
          conditions: JSON.stringify({ minDaysBeforeDeparture: 0 }),
          priceAdjustment: -20000,
        })
      );
      expect(await anonymous.calculateFare(quote())).toMatchObject({
        adjustedFare: 0,
        surcharges: 0,
        taxes: 0,
        totalPerPassenger: 0,
        totalAmount: 0,
      });
    });

    it.each([
      [
        "seasonality",
        {
          season: "overflow",
          periodStart: "2030-06-01",
          periodEnd: "2030-07-01",
          seasonMultiplier: 1e308,
        },
      ],
      ["surcharges", { surchargeType: "YQ", percentage: 1e308 }],
    ] as const)(
      "excludes overflowing %s arithmetic from comparison while returning the healthy class",
      async (ruleCategory, conditions) => {
        await admin.createFareRule(
          surcharge({ ruleCategory, conditions: JSON.stringify(conditions) })
        );
        await expect(anonymous.calculateFare(quote())).rejects.toThrow(
          /minor units/
        );
        expect(
          (await anonymous.compareFareClasses(trip)).comparisons.map(
            row => row.fareClass.id
          )
        ).toEqual([discountClassId]);
      }
    );

    it.each([
      { blackoutPeriods: [{ from: "2030-06-10", to: "2030-06-11" }] },
      { periods: [{ start: "2030-06-10", end: "2030-06-11" }] },
      {
        blackoutPeriods: [{ start: "2030-06-01", end: "2030-06-02" }],
        periods: [{ from: "2030-06-10", to: "2030-06-11" }],
      },
    ])(
      "enforces accepted blackout aliases consistently through admin, quote and validation: %j",
      async conditions => {
        const rule = await admin.createFareRule(
          surcharge({
            ruleCategory: "blackout_dates",
            conditions: JSON.stringify(conditions),
          })
        );
        await expect(anonymous.calculateFare(quote())).rejects.toThrow(
          /blackout period/
        );
        expect(await customer.validateRules(validation())).toMatchObject({
          valid: false,
          violations: [{ ruleId: rule.id, category: "blackout_dates" }],
        });
        await expect(
          admin.updateFareRule({
            id: rule.id,
            conditions: JSON.stringify({
              blackoutPeriods: [{ start: "2030-06-01", end: "2030-06-02" }],
              periods: [{}],
            }),
          })
        ).rejects.toThrow(/conditions/);
        expect((await db.select().from(schema.fareRules))[0]?.conditions).toBe(
          JSON.stringify(conditions)
        );
      }
    );

    it.each(["invalid", "2030-02-30", ""])(
      "rejects invalid request dates before SQL or stay/advance rules can ignore them: %s",
      async invalid => {
        await admin.createFareRule(
          surcharge({
            ruleCategory: "minimum_stay",
            conditions: JSON.stringify({ minNights: 2 }),
          })
        );
        await expect(
          anonymous.calculateFare({ ...quote(), returnDate: invalid })
        ).rejects.toThrow(/Invalid return date/);
        await expect(
          customer.validateRules({ ...validation(), returnDate: invalid })
        ).rejects.toThrow(/Invalid return date/);
        await expect(
          customer.validateRules({ ...validation(), bookingDate: invalid })
        ).rejects.toThrow(/Invalid booking date/);
        await expect(
          customer.calculateChangeFee({
            fareClassId,
            bookingDate: invalid,
            changeDate: departureDate,
          })
        ).rejects.toThrow(/Invalid booking date/);
        await expect(
          customer.calculateChangeFee({
            fareClassId,
            bookingDate: validation().bookingDate,
            changeDate: invalid,
          })
        ).rejects.toThrow(/Invalid change date/);
      }
    );

    it("binds a date-only request to the flight's UTC day and actual departure time", async () => {
      const calendarTrip = { ...trip, departureDate: "2030-06-10" };
      expect(
        await anonymous.calculateFare({ ...quote(), ...calendarTrip })
      ).toEqual(await anonymous.calculateFare(quote()));
      expect(await anonymous.compareFareClasses(calendarTrip)).toEqual(
        await anonymous.compareFareClasses(trip)
      );
      await admin.createFareRule(
        surcharge({
          ruleCategory: "blackout_dates",
          conditions: JSON.stringify({
            blackoutPeriods: [
              { start: "2030-06-10T11:00:00Z", end: "2030-06-10T13:00:00Z" },
            ],
          }),
        })
      );
      await expect(
        anonymous.calculateFare({ ...quote(), ...calendarTrip })
      ).rejects.toThrow(/blackout period/);
      expect(
        (await anonymous.compareFareClasses(calendarTrip)).comparisons.map(
          row => row.fareClass.id
        )
      ).toEqual([discountClassId]);
    });

    it("rejects change fee addition beyond safe minor units", async () => {
      await admin.createFareRule(
        surcharge({
          ruleCategory: "penalties",
          conditions: JSON.stringify({
            penaltyType: "change",
            fixedFee: Number.MAX_SAFE_INTEGER,
          }),
        })
      );
      await expect(
        customer.calculateChangeFee({
          fareClassId,
          bookingDate: validation().bookingDate,
          changeDate: departureDate,
        })
      ).rejects.toThrow(/Total change fee.*minor units/);
    });

    it("rejects unsupported cabin input through the router before persistence", async () => {
      const input = { ...classInput("Q"), cabinClass: "unsupported" };
      await expect(
        admin.createFareClass(
          input as Parameters<typeof admin.createFareClass>[0]
        )
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await db.select().from(schema.fareClasses)).toHaveLength(2);
    });
  }
);
