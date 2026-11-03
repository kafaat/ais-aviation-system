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
  calculateFlightPrice: async () => ({ price: 10_000 }),
  checkFlightAvailability: async (id: number) => ({
    available: true,
    flight: await boundary.getFlight(id),
  }),
}));

import { createBooking } from "../services/bookings.service";
import { createMultiCityBooking } from "../services/multi-city.service";
import {
  cancelBookingResources,
  confirmFundedBooking,
} from "../services/booking-settlement.service";
import { getFlightRbdAvailability } from "../services/rbd-inventory.service";

let fixture: ReturnType<typeof transactionMemory>;

beforeEach(() => {
  boundary.reference = 0;
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    flights: [11, 12].map(id => ({
      id,
      tenantId: 3,
      airlineId: 7,
      status: "scheduled",
      economyAvailable: 5,
      businessAvailable: 1,
      departureTime: new Date("2030-01-01T10:00:00Z"),
    })),
    fare_classes: [
      {
        id: 41,
        airlineId: 7,
        code: "Y",
        name: "Economy Flex",
        cabinClass: "economy",
        fareFamily: "Flex",
        basePriceMultiplier: "1.000",
        priority: 100,
        active: true,
      },
    ],
    flight_fare_class_inventory: [
      {
        id: 51,
        flightId: 11,
        fareClassId: 41,
        capacity: 1,
        availableSeats: 1,
      },
      {
        id: 52,
        flightId: 12,
        fareClassId: 41,
        capacity: 1,
        availableSeats: 1,
      },
    ],
  });
  boundary.db = fixture.db;
  boundary.getFlight.mockReset().mockImplementation(async id => ({
    id,
    tenantId: 3,
    airlineId: 7,
    status: "scheduled",
    economyPrice: 10_000,
    businessPrice: 20_000,
    economyAvailable: 5,
    businessAvailable: 1,
    departureTime: new Date("2030-01-01T10:00:00Z"),
  }));
});

function request(sessionId: string) {
  return {
    userId: 1,
    tenantId: 3,
    flightId: 11,
    cabinClass: "economy" as const,
    fareClassCode: "y",
    sessionId,
    passengers: [
      { type: "adult" as const, firstName: "Ali", lastName: "Saleh" },
    ],
  };
}

describe("transactional RBD inventory", () => {
  it("binds the booking designator and its multiplier into the immutable offer", async () => {
    fixture.rows("fare_classes")[0].basePriceMultiplier = "1.250";
    const created = await createBooking(request("rbd-price"));

    expect(created.totalAmount).toBe(12_500);
    expect(fixture.rows("retail_offers")[0]).toMatchObject({
      totalAmount: 12_500,
      payload: {
        fareClassId: 41,
        policy: { name: "direct:rbd:41:v1", fareMultiplier: 1.25 },
      },
    });
    expect(fixture.rows("bookings")[0].fareClassId).toBe(41);
  });

  it("exposes the flight bucket net of active holds and rejects an oversell", async () => {
    await createBooking(request("rbd-first"));

    expect(fixture.rows("inventory_locks")[0]).toMatchObject({
      flightId: 11,
      fareClassId: 41,
      numberOfSeats: 1,
      status: "active",
    });
    expect((await getFlightRbdAvailability(fixture.db, [11])).get(11)).toEqual([
      expect.objectContaining({
        fareClassId: 41,
        code: "Y",
        totalAllocated: 1,
        availableSeats: 0,
      }),
    ]);
    await expect(createBooking(request("rbd-second"))).rejects.toThrow();
    expect(fixture.rows("bookings")).toHaveLength(1);
  });

  it("converts the exact RBD hold and restores its bucket on cancellation", async () => {
    const created = await createBooking(request("rbd-settlement"));
    const booking = fixture
      .rows("bookings")
      .find(row => row.id === created.bookingId);

    await confirmFundedBooking(fixture.db, booking, "pi_rbd");
    expect(fixture.rows("flight_fare_class_inventory")[0].availableSeats).toBe(
      0
    );
    expect(fixture.rows("flights")[0].economyAvailable).toBe(4);

    await cancelBookingResources(
      fixture.db,
      fixture.rows("bookings")[0],
      "test cancellation",
      1
    );
    expect(fixture.rows("flight_fare_class_inventory")[0].availableSeats).toBe(
      1
    );
    expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
  });

  it("writes one RBD hold and segment reference per itinerary leg", async () => {
    fixture.rows("fare_classes")[0].basePriceMultiplier = "1.250";
    const created = await createMultiCityBooking({
      userId: 1,
      tenantId: 3,
      cabinClass: "economy",
      sessionId: "rbd-multi",
      passengers: [{ type: "adult", firstName: "Mona", lastName: "Hassan" }],
      segments: [
        {
          flightId: 11,
          departureDate: new Date("2030-01-01T10:00:00Z"),
          fareClassCode: "Y",
        },
        {
          flightId: 12,
          departureDate: new Date("2030-01-02T10:00:00Z"),
          fareClassCode: "Y",
        },
      ],
    });

    expect(created.totalAmount).toBe(25_000);
    expect(created.segments).toHaveLength(2);
    expect(
      fixture
        .rows("inventory_locks")
        .map(row => [row.flightId, row.fareClassId])
    ).toEqual([
      [11, 41],
      [12, 41],
    ]);
    expect(
      fixture
        .rows("booking_segments")
        .map(row => [row.flightId, row.fareClassId])
    ).toEqual([
      [11, 41],
      [12, 41],
    ]);
  });
});
