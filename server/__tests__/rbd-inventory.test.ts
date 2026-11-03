/**
 * Booking-class (RBD) inventory nested inside the cabin counters (ADR 0002).
 *
 * The relational fixture rolls back and evaluates SQL predicates; it is not a
 * MySQL lock simulator. Two interleaved sales therefore run as two sequential
 * transactions here, which proves the availability arithmetic and the rollback
 * boundary; `integration/rbd-inventory-concurrency.test.ts` proves the
 * `SELECT ... FOR UPDATE` serialization against a real MySQL-compatible server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({
  db: null as any,
  getFlight: vi.fn(),
  reference: 0,
}));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getFlightById: boundary.getFlight,
  generateBookingReference: () => `R${++boundary.reference}`,
}));
vi.mock("../services/metrics.service", () => ({
  trackBookingStarted: vi.fn(),
  trackBookingCancelled: vi.fn(),
}));
vi.mock("../services/flights.service", () => ({
  calculateFlightPrice: async (
    _flight: unknown,
    _cabin: string,
    count: number
  ) => ({ price: 10000 * count }),
  checkFlightAvailability: async (id: number) => ({
    available: true,
    flight: await boundary.getFlight(id),
  }),
}));

import {
  computeNestedAvailability,
  deriveDefaultInventory,
  holdBookingClass,
  listBookingClasses,
  sellBookingClass,
} from "../services/rbd-inventory.service";
import {
  cancelBookingResources,
  confirmFundedBooking,
  reserveSeats,
  restoreSeats,
} from "../services/booking-settlement.service";
import { createBooking } from "../services/bookings.service";
import { createMultiCityBooking } from "../services/multi-city.service";
import { releaseExpiredLocks } from "../services/inventory-lock.service";
import { inventoryLocks } from "../../drizzle/schema";

const FUTURE = new Date("2030-01-01T10:00:00Z");
const fareClass = (
  id: number,
  code: string,
  priority: number,
  multiplier: string,
  cabinClass = "economy"
) => ({
  id,
  airlineId: 1,
  code,
  name: `${code} fare`,
  cabinClass,
  fareFamily: priority >= 100 ? "Flex" : "Value",
  priority,
  basePriceMultiplier: multiplier,
  seatsAllocated: 0,
  refundable: priority >= 100,
  changeable: true,
  changeFee: 0,
  upgradeable: true,
  baggageAllowance: 23,
  baggagePieces: 1,
  carryOnAllowance: 7,
  mileageEarningRate: "1.00",
  seatSelection: "paid",
  loungeAccess: false,
  priorityBoarding: false,
  mealIncluded: false,
  active: true,
});
const flight = (id: number) => ({
  id,
  tenantId: 3,
  airlineId: 1,
  airline: { id: 1 },
  status: "scheduled",
  economySeats: 10,
  businessSeats: 2,
  economyPrice: 10000,
  businessPrice: 30000,
  economyAvailable: 10,
  businessAvailable: 2,
  departureTime: FUTURE,
});

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    users: [{ id: 1, tenantId: 3 }],
    flights: [flight(11), flight(12)],
    // Y (full fare) nests M (value) nests Q (deep discount); G is a discrete
    // group bucket. Y's AU equals the cabin; Q is authorized for 3 only.
    fare_classes: [
      fareClass(40, "Y", 100, "1.000"),
      fareClass(41, "M", 50, "0.800"),
      fareClass(42, "Q", 10, "0.500"),
      fareClass(43, "G", 0, "0.700"),
      fareClass(44, "J", 100, "1.000", "business"),
      fareClass(45, "X", 0, "0.900"),
    ],
    flight_fare_class_inventory: [
      ...[11, 12].flatMap(flightId => [
        {
          flightId,
          fareClassId: 40,
          cabinClass: "economy",
          authorizedSeats: 10,
          sold: 0,
          nested: true,
        },
        {
          flightId,
          fareClassId: 41,
          cabinClass: "economy",
          authorizedSeats: 6,
          sold: 0,
          nested: true,
        },
        {
          flightId,
          fareClassId: 42,
          cabinClass: "economy",
          authorizedSeats: 3,
          sold: 0,
          nested: true,
        },
        {
          flightId,
          fareClassId: 43,
          cabinClass: "economy",
          authorizedSeats: 2,
          sold: 0,
          nested: false,
        },
        {
          flightId,
          fareClassId: 44,
          cabinClass: "business",
          authorizedSeats: 2,
          sold: 0,
          nested: true,
        },
      ]),
    ].map((row, i) => ({ id: i + 1, ...row })),
  });
  fixture.rows("fare_classes")[5].active = false;
  boundary.db = fixture.db;
  boundary.reference = 0;
  boundary.getFlight
    .mockReset()
    .mockImplementation(async id =>
      fixture.rows("flights").find(f => f.id === id)
    );
});

const inventory = (flightId: number, fareClassId: number) =>
  fixture
    .rows("flight_fare_class_inventory")
    .find(r => r.flightId === flightId && r.fareClassId === fareClassId);
const classesOf = async (flightId: number) =>
  (
    await listBookingClasses(fixture.db, [
      fixture.rows("flights").find(f => f.id === flightId),
    ])
  ).get(flightId)!;
const sale = (fareClassId: number, seats: number, extra = {}) => ({
  flightId: 11,
  cabinClass: "economy" as const,
  fareClassId,
  seats,
  ...extra,
});

describe("nested availability math", () => {
  const nest = (
    sold: Record<string, number>,
    held: Record<string, number> = {}
  ) =>
    computeNestedAvailability(
      [
        ["Y", 100, 10, true],
        ["M", 50, 6, true],
        ["Q", 10, 3, true],
        ["G", 0, 2, false],
      ].map(([code, priority, authorizedSeats, nested]) => ({
        fareClassId: { Y: 40, M: 41, Q: 42, G: 43 }[code as string]!,
        cabinClass: "economy" as const,
        priority: priority as number,
        authorizedSeats: authorizedSeats as number,
        sold: sold[code as string] ?? 0,
        held: held[code as string] ?? 0,
        nested: nested as boolean,
      })),
      { economy: 10 }
    );
  it("opens each class to its own authorization when nothing is sold", () => {
    expect([...nest({}).values()]).toEqual([10, 6, 3, 2]);
  });
  it("lets a lower-class sale consume every higher nested class, not the bucket", () => {
    expect([...nest({ Q: 2 }).values()]).toEqual([8, 4, 1, 2]);
    expect([...nest({ Q: 2, M: 4 }).values()]).toEqual([4, 0, 0, 2]);
  });
  it("counts held seats like sold seats", () => {
    expect([...nest({ M: 1 }, { Q: 1 }).values()]).toEqual([8, 4, 2, 2]);
  });
  it("never shows a lower class above the class nested over it", () => {
    // Y sells 8: Y keeps 2, and M (AU 6) and Q (AU 3) are ceilinged by Y.
    expect([...nest({ Y: 8 }).values()]).toEqual([2, 2, 2, 2]);
  });
  it("caps every class by the physical cabin and never goes negative", () => {
    const capped = computeNestedAvailability(
      [
        {
          fareClassId: 40,
          cabinClass: "economy",
          priority: 100,
          authorizedSeats: 10,
          sold: 11,
          held: 0,
          nested: true,
        },
        {
          fareClassId: 43,
          cabinClass: "economy",
          priority: 0,
          authorizedSeats: 5,
          sold: 0,
          held: 0,
          nested: false,
        },
      ],
      { economy: 1 }
    );
    expect([...capped.values()]).toEqual([0, 1]);
  });
});

describe("search view", () => {
  it("lists sellable classes with code, family, multiplier, counts and rules, hiding sold-out and inactive ones", async () => {
    inventory(11, 42)!.sold = 3;
    const classes = await classesOf(11);
    expect(classes.map(c => [c.cabinClass, c.code, c.available])).toEqual([
      ["business", "J", 2],
      ["economy", "Y", 7],
      ["economy", "M", 3],
      ["economy", "G", 2],
    ]);
    expect(classes[2]).toMatchObject({
      fareFamily: "Value",
      priceMultiplier: 0.8,
      baseFare: 8000,
      authorized: 6,
      sold: 0,
      held: 0,
      nested: true,
      rules: { refundable: false, changeable: true, baggageAllowance: 23 },
    });
    expect((await listBookingClasses(fixture.db, [], {})).size).toBe(0);
  });
  it("subtracts active class-level holds and ignores expired or cabin-level ones", async () => {
    await fixture.db.insert(inventoryLocks).values([
      {
        flightId: 11,
        cabinClass: "economy",
        fareClassId: 41,
        numberOfSeats: 2,
        status: "active",
        expiresAt: FUTURE,
        sessionId: "a",
      },
      {
        flightId: 11,
        cabinClass: "economy",
        fareClassId: 41,
        numberOfSeats: 5,
        status: "active",
        expiresAt: new Date(0),
        sessionId: "b",
      },
      {
        flightId: 11,
        cabinClass: "economy",
        fareClassId: null,
        numberOfSeats: 5,
        status: "active",
        expiresAt: FUTURE,
        sessionId: "c",
      },
      {
        flightId: 11,
        cabinClass: "economy",
        fareClassId: 42,
        numberOfSeats: 1,
        status: "released",
        expiresAt: FUTURE,
        sessionId: "d",
      },
    ]);
    const classes = await classesOf(11);
    expect(classes.map(c => [c.code, c.available, c.held])).toEqual([
      ["J", 2, 0],
      ["Y", 8, 0],
      ["M", 4, 2],
      ["Q", 3, 0],
      ["G", 2, 0],
    ]);
  });
  it("returns an empty list for a flight without RBD rows", async () => {
    fixture.rows("flights").push(flight(13));
    expect(await classesOf(13)).toEqual([]);
  });
});

describe("sale path", () => {
  it("sells the class with the cabin decrement and refuses the seat that would oversell it", async () => {
    await fixture.db.transaction((tx: any) =>
      reserveSeats(tx, 11, "economy", 3, null, 42)
    );
    expect(fixture.rows("flights")[0].economyAvailable).toBe(7);
    expect(inventory(11, 42)!.sold).toBe(3);
    // Q is exhausted although 7 economy seats remain: cabin-level sales still work.
    await expect(
      fixture.db.transaction((tx: any) =>
        reserveSeats(tx, 11, "economy", 1, null, 42)
      )
    ).rejects.toThrow("Only 0 Q seats available");
    expect(fixture.rows("flights")[0].economyAvailable).toBe(7);
    await fixture.db.transaction((tx: any) =>
      reserveSeats(tx, 11, "economy", 1, null, null)
    );
    expect(fixture.rows("flights")[0].economyAvailable).toBe(6);
  });
  it("two sales of the last seat: the second transaction fails and leaves no partial decrement", async () => {
    // Sequential by necessity: the fixture has no row locks. The real
    // serialization is covered by integration/rbd-inventory-concurrency.
    inventory(11, 42)!.sold = 2;
    const results = [];
    for (let i = 0; i < 2; i++)
      results.push(
        await fixture.db
          .transaction((tx: any) =>
            reserveSeats(tx, 11, "economy", 1, null, 42)
          )
          .then(
            () => "fulfilled",
            () => "rejected"
          )
      );
    expect(results).toEqual(["fulfilled", "rejected"]);
    expect(inventory(11, 42)!.sold).toBe(3);
    expect(fixture.rows("flights")[0].economyAvailable).toBe(9);
    expect(fixture.lockedTables).toContain("flight_fare_class_inventory");
  });
  it("a lower-class sale consumes the higher nested classes; a discrete bucket does not", async () => {
    await fixture.db.transaction((tx: any) =>
      sellBookingClass(tx, sale(42, 3))
    );
    await fixture.db.transaction((tx: any) =>
      sellBookingClass(tx, sale(43, 2))
    );
    const classes = await classesOf(11);
    expect(classes.map(c => [c.code, c.available])).toEqual([
      ["J", 2],
      ["Y", 7],
      ["M", 3],
    ]);
    await expect(
      fixture.db.transaction((tx: any) => sellBookingClass(tx, sale(43, 1)))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      fixture.db.transaction((tx: any) => sellBookingClass(tx, sale(41, 4)))
    ).rejects.toThrow("Only 3 M seats available");
  });
  it("rejects a class that is closed on the flight, inactive, or in another cabin", async () => {
    for (const [fareClassId, cabinClass] of [
      [45, "economy"],
      [44, "economy"],
      [41, "business"],
      [99, "economy"],
    ] as const)
      await expect(
        fixture.db.transaction((tx: any) =>
          sellBookingClass(tx, { ...sale(fareClassId, 1), cabinClass })
        )
      ).rejects.toThrow("not open for sale");
  });
  it("restores the class with the cabin and never below zero", async () => {
    inventory(11, 41)!.sold = 2;
    await fixture.db.transaction((tx: any) =>
      restoreSeats(tx, 11, "economy", 2, 41)
    );
    expect(inventory(11, 41)!.sold).toBe(0);
    await fixture.db.transaction((tx: any) =>
      restoreSeats(tx, 11, "economy", 1, null)
    );
    expect(inventory(11, 41)!.sold).toBe(0);
  });
});

describe("booking creation", () => {
  const input = {
    userId: 1,
    tenantId: 3,
    flightId: 11,
    cabinClass: "economy" as const,
    sessionId: "rbd-1",
    passengers: [
      { type: "adult" as const, firstName: "Ali", lastName: "Saleh" },
      { type: "adult" as const, firstName: "Nora", lastName: "Saleh" },
    ],
  };
  it("prices through the class multiplier, holds the class, then sells and releases it with the cabin", async () => {
    const result = await createBooking({ ...input, fareClassId: 41 });
    expect(result.totalAmount).toBe(16000);
    const booking = fixture.rows("bookings")[0];
    expect(booking.fareClassId).toBe(41);
    expect(fixture.rows("inventory_locks")[0].fareClassId).toBe(41);
    expect(fixture.rows("retail_offers")[0].payload).toMatchObject({
      fareClassId: 41,
      policy: { name: "direct:rbd:M:v1", fareMultiplier: 0.8 },
    });
    // The hold already counts against M and the classes it nests under.
    expect((await classesOf(11)).map(c => [c.code, c.available])).toEqual([
      ["J", 2],
      ["Y", 8],
      ["M", 4],
      ["Q", 3],
      ["G", 2],
    ]);
    await fixture.db.transaction((tx: any) =>
      confirmFundedBooking(tx, booking)
    );
    expect(inventory(11, 41)!.sold).toBe(2);
    expect(fixture.rows("flights")[0].economyAvailable).toBe(8);
    expect(fixture.rows("inventory_locks")[0].status).toBe("converted");
    await fixture.db.transaction((tx: any) =>
      cancelBookingResources(tx, fixture.rows("bookings")[0], "Test", 1)
    );
    expect(inventory(11, 41)!.sold).toBe(0);
    expect(fixture.rows("flights")[0].economyAvailable).toBe(10);
  });
  it("leaves the RBD layer untouched for a cabin-level booking", async () => {
    const result = await createBooking(input);
    expect(result.totalAmount).toBe(20000);
    expect(fixture.rows("bookings")[0].fareClassId).toBeNull();
    expect(fixture.rows("inventory_locks")[0].fareClassId).toBeUndefined();
    await fixture.db.transaction((tx: any) =>
      confirmFundedBooking(tx, fixture.rows("bookings")[0])
    );
    expect(fixture.rows("flights")[0].economyAvailable).toBe(8);
    expect(
      fixture.rows("flight_fare_class_inventory").every(r => r.sold === 0)
    ).toBe(true);
  });
  it("rejects an oversold class while cabin seats remain, holding nothing", async () => {
    inventory(11, 42)!.sold = 2;
    await expect(
      createBooking({ ...input, fareClassId: 42 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.rows("bookings")).toHaveLength(0);
    expect(fixture.rows("inventory_locks")).toHaveLength(0);
    expect(fixture.rows("flights")[0].economyAvailable).toBe(10);
  });
  it("rejects a class from another cabin or airline before pricing", async () => {
    await expect(
      createBooking({ ...input, fareClassId: 44 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    fixture.rows("fare_classes")[1].airlineId = 2;
    await expect(
      createBooking({ ...input, fareClassId: 41 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("retail_offers")).toHaveLength(0);
  });
  it("refuses an offer priced for a different class", async () => {
    await expect(
      createBooking({ ...input, fareClassId: 41, sessionId: "a" })
    ).resolves.toBeTruthy();
    const offer = fixture.rows("retail_offers")[0];
    offer.consumedBookingId = null;
    await expect(
      createBooking({
        ...input,
        sessionId: "b",
        fareClassId: 40,
        offerId: offer.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createBooking({ ...input, sessionId: "c", offerId: offer.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("releases the class when the unpaid hold expires", async () => {
    await createBooking({ ...input, fareClassId: 42 });
    expect((await classesOf(11)).find(c => c.code === "Q")!.available).toBe(1);
    fixture.rows("inventory_locks")[0].expiresAt = new Date(0);
    expect(await releaseExpiredLocks()).toBe(1);
    expect((await classesOf(11)).find(c => c.code === "Q")!.available).toBe(3);
  });
  it("holds, sells and releases a class per multi-city leg", async () => {
    const result = await createMultiCityBooking({
      ...input,
      segments: [
        { flightId: 11, departureDate: FUTURE, fareClassId: 42 },
        { flightId: 12, departureDate: FUTURE },
      ],
    });
    // leg 1: 2 x 10000 x 0.5, leg 2: 2 x 10000 at cabin fare.
    expect(result.totalAmount).toBe(30000);
    expect(fixture.rows("booking_segments").map(s => s.fareClassId)).toEqual([
      42,
      null,
    ]);
    const booking = fixture.rows("bookings")[0];
    await fixture.db.transaction((tx: any) =>
      confirmFundedBooking(tx, booking)
    );
    expect(inventory(11, 42)!.sold).toBe(2);
    expect(inventory(12, 42)!.sold).toBe(0);
    await fixture.db.transaction((tx: any) =>
      cancelBookingResources(tx, fixture.rows("bookings")[0], "Test", 1)
    );
    expect(inventory(11, 42)!.sold).toBe(0);
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      10, 10,
    ]);
  });
  it("adopts an existing cabin hold into the class and refuses one owned by another class", async () => {
    const [{ insertId: lockId }] = await fixture.db
      .insert(inventoryLocks)
      .values({
        flightId: 11,
        cabinClass: "economy",
        numberOfSeats: 2,
        status: "active",
        expiresAt: FUTURE,
        fareClassId: null,
        sessionId: "hold",
      });
    await fixture.db.transaction((tx: any) =>
      holdBookingClass(tx, sale(41, 2, { lockId }))
    );
    expect(fixture.rows("inventory_locks")[0].fareClassId).toBe(41);
    await expect(
      fixture.db.transaction((tx: any) =>
        holdBookingClass(tx, sale(42, 2, { lockId }))
      )
    ).rejects.toThrow("different booking class");
    await expect(
      fixture.db.transaction((tx: any) =>
        holdBookingClass(tx, sale(41, 1, { lockId }))
      )
    ).rejects.toThrow("does not match");
  });
});

describe("backfill derivation", () => {
  it("authorizes one default class per cabin to the capacity and derives sold from the counters", () => {
    expect(
      deriveDefaultInventory(
        {
          id: 5,
          economySeats: 150,
          businessSeats: 12,
          economyAvailable: 97,
          businessAvailable: 15,
        },
        { economy: 40, business: 44 }
      )
    ).toEqual([
      {
        flightId: 5,
        fareClassId: 40,
        cabinClass: "economy",
        authorizedSeats: 150,
        sold: 53,
        nested: true,
      },
      {
        flightId: 5,
        fareClassId: 44,
        cabinClass: "business",
        authorizedSeats: 12,
        sold: 0,
        nested: true,
      },
    ]);
  });
  it("skips cabins without a default class or without seats", () => {
    expect(
      deriveDefaultInventory(
        {
          id: 5,
          economySeats: 150,
          businessSeats: 0,
          economyAvailable: 150,
          businessAvailable: 0,
        },
        { business: 44 }
      )
    ).toEqual([]);
  });
});
