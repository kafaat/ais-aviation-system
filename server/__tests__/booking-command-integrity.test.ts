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
  generateBookingReference: () => `T${++boundary.reference}`,
}));
vi.mock("../services/notification.service", () => ({
  createNotification: vi
    .fn()
    .mockRejectedValue(new Error("Notification unavailable")),
}));
vi.mock("../services/metrics.service", () => ({
  trackBookingStarted: vi.fn(),
  trackBookingCancelled: vi.fn(),
}));
vi.mock("../services/flights.service", () => ({
  calculateFlightPrice: async () => ({ price: 10000 }),
  checkFlightAvailability: async (id: number) => ({
    available: true,
    flight: await boundary.getFlight(id),
  }),
}));

import { createBooking } from "../services/bookings.service";
import { createMultiCityBooking } from "../services/multi-city.service";
import { createAgentBooking } from "../services/travel-agent.service";
import {
  confirmFundedBooking,
  cancelBookingResources,
} from "../services/booking-settlement.service";
import { createInventoryLock } from "../services/inventory-lock.service";
import { selectSeat } from "../services/seat-map.service";
import { calculateRequestHash } from "../services/idempotency-v2.service";

let fixture: ReturnType<typeof transactionMemory>;
const input = {
  userId: 1,
  tenantId: 3,
  flightId: 11,
  cabinClass: "economy" as const,
  sessionId: "purchase-1",
  passengers: [{ type: "adult" as const, firstName: "Ali", lastName: "Saleh" }],
};

beforeEach(() => {
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    users: [{ id: 1, tenantId: 3 }],
    flights: [11, 12].map(id => ({
      id,
      tenantId: 3,
      airlineId: 1,
      status: "scheduled",
      economyAvailable: 2,
      businessAvailable: 2,
      departureTime: new Date("2030-01-01T10:00:00Z"),
    })),
    ancillary_services: [
      { id: 1, available: true, currency: "SAR", price: 500 },
    ],
    price_locks: [
      {
        id: 1,
        userId: 1,
        flightId: 11,
        cabinClass: "economy",
        lockedPrice: 7000,
        lockFee: 2500,
        status: "active",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ],
    travel_agents: [
      {
        id: 1,
        ownerUserId: 1,
        isActive: true,
        commissionRate: "5.00",
        dailyBookingLimit: 100,
        monthlyBookingLimit: 1000,
        totalBookings: 0,
        totalRevenue: 0,
        totalCommission: 0,
      },
    ],
  });
  boundary.db = fixture.db;
  boundary.getFlight.mockImplementation(async id =>
    fixture.rows("flights").find(f => f.id === id)
  );
});

describe("atomic booking commands", () => {
  it("returns the committed identity on retry even when notification delivery fails", async () => {
    const first = await createBooking(input);
    expect(await createBooking(input)).toEqual(first);
    expect(fixture.rows("bookings")).toHaveLength(1);
    expect(fixture.rows("passengers")).toHaveLength(1);
    expect(fixture.rows("inventory_locks")).toHaveLength(1);
    expect(fixture.rows("outbox")).toHaveLength(1);
    expect(fixture.rows("idempotency_requests")[0].expiresAt).toBeNull();
  });
  it("detects nested payload changes while ignoring object key ordering", async () => {
    expect(calculateRequestHash({ a: { b: 1, c: 2 } })).toBe(
      calculateRequestHash({ a: { c: 2, b: 1 } })
    );
    expect(calculateRequestHash({ a: [{ b: 1 }] })).not.toBe(
      calculateRequestHash({ a: [{ b: 2 }] })
    );
    await createBooking(input);
    await expect(
      createBooking({
        ...input,
        passengers: [{ ...input.passengers[0], firstName: "Other" }],
      })
    ).rejects.toThrow();
    expect(fixture.rows("bookings")).toHaveLength(1);
  });
  it("rolls back identity, passengers and holds if the durable event cannot commit", async () => {
    fixture.failInsert("outbox");
    await expect(createBooking(input)).rejects.toThrow();
    for (const table of [
      "bookings",
      "passengers",
      "inventory_locks",
      "idempotency_requests",
    ])
      expect(fixture.rows(table)).toHaveLength(0);
  });
  it("consumes the owner's price lock once, including one fee and server-priced ancillaries", async () => {
    const request = {
      ...input,
      priceLockId: 1,
      ancillaries: [
        { ancillaryServiceId: 1, quantity: 2, unitPrice: 1, totalPrice: 1 },
      ],
    };
    const result = await createBooking(request);
    expect(result.totalAmount).toBe(7000 + 2500 + 1000);
    expect(fixture.rows("price_locks")[0]).toMatchObject({
      status: "used",
      bookingId: result.bookingId,
    });
    expect(await createBooking(request)).toEqual(result);
  });
  it.each(["foreign", "expired", "used"])(
    "rejects a %s price lock without consuming seats",
    async kind => {
      const lock = fixture.rows("price_locks")[0];
      if (kind === "foreign") lock.userId = 2;
      if (kind === "expired") lock.expiresAt = new Date(0);
      if (kind === "used") lock.status = "used";
      await expect(
        createBooking({ ...input, priceLockId: 1 })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(fixture.rows("inventory_locks")).toHaveLength(0);
    }
  );
  it("creates real passengers and holds for an explicitly owned agency booking", async () => {
    const request = {
      ...input,
      idempotencyKey: "agency-1",
      contactEmail: "a@example.com",
      contactPhone: "+966500000000",
    };
    const first = await createAgentBooking(1, request);
    expect(await createAgentBooking(1, request)).toEqual(first);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      userId: 1,
      tenantId: 3,
      seatsReserved: false,
    });
    expect(fixture.rows("passengers")[0]).toMatchObject({
      firstName: "Ali",
      tenantId: 3,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(2);
    expect(fixture.rows("agent_bookings")).toHaveLength(1);
  });
  it("refuses an unlinked historical agency", async () => {
    fixture.rows("travel_agents")[0].ownerUserId = null;
    await expect(
      createAgentBooking(1, {
        ...input,
        contactEmail: "a@example.com",
        contactPhone: "+966500000000",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("bookings")).toHaveLength(0);
  });
});

describe("complete itinerary inventory", () => {
  const multi = () =>
    createMultiCityBooking({
      ...input,
      segments: [11, 12].map(flightId => ({
        flightId,
        departureDate: new Date("2030-01-01"),
      })),
    });
  it("holds, settles and cancels every segment exactly once", async () => {
    await multi();
    expect(fixture.rows("inventory_locks")).toHaveLength(2);
    const booking = fixture.rows("bookings")[0];
    await fixture.db.transaction((tx: any) =>
      confirmFundedBooking(tx, booking)
    );
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      1, 1,
    ]);
    expect(fixture.rows("booking_segments").map(s => s.status)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    await fixture.db.transaction((tx: any) =>
      confirmFundedBooking(tx, booking)
    );
    await fixture.db.transaction((tx: any) =>
      cancelBookingResources(tx, booking, "Test", 1)
    );
    await fixture.db.transaction((tx: any) =>
      cancelBookingResources(tx, booking, "Retry", 1)
    );
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      2, 2,
    ]);
    expect(
      fixture
        .rows("booking_segments")
        .every(s => s.status === "cancelled" && !s.seatsReserved)
    ).toBe(true);
  });
  it("rolls back the first reservation if the second segment cannot settle", async () => {
    await multi();
    fixture.rows("flights")[1].economyAvailable = 0;
    await expect(
      fixture.db.transaction((tx: any) =>
        confirmFundedBooking(tx, fixture.rows("bookings")[0])
      )
    ).rejects.toThrow("Insufficient");
    expect(fixture.rows("flights")[0].economyAvailable).toBe(2);
    expect(fixture.rows("bookings")[0].status).toBe("pending");
    expect(fixture.rows("booking_segments").every(s => !s.seatsReserved)).toBe(
      true
    );
  });
  it("protects legacy unlinked holds without counting linked aliases twice", async () => {
    const first = await createInventoryLock(11, 1, "economy", "one", 1);
    await fixture.db
      .insert((await import("../../drizzle/schema")).seatHolds)
      .values({
        flightId: 11,
        cabinClass: "economy",
        seats: 1,
        inventoryLockId: first.lockId,
        status: "active",
        expiresAt: new Date(Date.now() + 60_000),
      });
    await createInventoryLock(11, 1, "economy", "two", 1);
    expect(fixture.rows("inventory_locks")).toHaveLength(2);
    fixture.rows("seat_holds")[0].inventoryLockId = null;
    await expect(
      createInventoryLock(11, 1, "economy", "three", 1)
    ).rejects.toThrow("Only 0 seats");
  });
});

describe("seat replacement", () => {
  async function seed(status: "occupied" | "available") {
    const { bookings, passengers, seatInventory } =
      await import("../../drizzle/schema");
    await fixture.db
      .insert(bookings)
      .values({ id: 5, userId: 1, flightId: 11, cabinClass: "economy" });
    await fixture.db
      .insert(passengers)
      .values({ id: 5, bookingId: 5, seatNumber: "1A" });
    await fixture.db.insert(seatInventory).values([
      {
        id: 1,
        flightId: 11,
        seatNumber: "1A",
        cabinClass: "economy",
        passengerId: 5,
        bookingId: 5,
        status: "occupied",
      },
      { id: 2, flightId: 11, seatNumber: "1B", cabinClass: "economy", status },
    ]);
  }
  it("preserves the current seat when the requested seat is occupied", async () => {
    await seed("occupied");
    await expect(selectSeat(11, "1B", 5, 5)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(fixture.rows("seat_inventory")[0]).toMatchObject({
      passengerId: 5,
      status: "occupied",
    });
    expect(fixture.rows("passengers")[0].seatNumber).toBe("1A");
  });
  it("moves the passenger once and makes retry idempotent", async () => {
    await seed("available");
    await selectSeat(11, "1B", 5, 5);
    await selectSeat(11, "1B", 5, 5);
    expect(fixture.rows("seat_inventory").map(s => s.status)).toEqual([
      "available",
      "occupied",
    ]);
    expect(fixture.rows("passengers")[0].seatNumber).toBe("1B");
  });
});

it("rolls back earlier legs before retaining a later-leg payment failure for review", async () => {
  const { settleVerifiedPayment } =
    await import("../services/payment-settlement.service");
  const result = await createMultiCityBooking({
    ...input,
    segments: [11, 12].map(flightId => ({
      flightId,
      departureDate: new Date("2030-01-01"),
    })),
  });
  fixture.rows("flights")[1].economyAvailable = 0;
  await fixture.db.transaction((tx: any) =>
    settleVerifiedPayment(tx, {
      paymentIntentId: "pi_review_leg",
      amount: result.totalAmount,
      currency: "sar",
      eventId: "evt_review_leg",
      metadata: { bookingId: String(result.bookingId), userId: "1" },
    })
  );
  expect(fixture.rows("flights")[0].economyAvailable).toBe(2);
  expect(
    fixture.rows("booking_segments").every(segment => !segment.seatsReserved)
  ).toBe(true);
  expect(fixture.rows("payment_receipts")[0].settlementStatus).toBe(
    "review_required"
  );
});

it("replays a committed booking even after availability and pricing become unavailable", async () => {
  const first = await createBooking(input);
  boundary.getFlight.mockRejectedValueOnce(
    new Error("Flight lookup unavailable")
  );
  expect(await createBooking(input)).toEqual(first);
  expect(fixture.rows("bookings")).toHaveLength(1);
});
