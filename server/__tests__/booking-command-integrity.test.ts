import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({
  db: null as any,
  getFlight: vi.fn(),
  price: vi.fn(),
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
  calculateFlightPrice: boundary.price,
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
      {
        id: 1,
        available: true,
        currency: "SAR",
        price: 500,
        category: "baggage",
        weightGrams: 20000,
      },
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
  boundary.price.mockReset().mockResolvedValue({ price: 10000 });
  boundary.getFlight
    .mockReset()
    .mockImplementation(async id =>
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
    expect(fixture.rows("outbox")).toHaveLength(2);
    expect(fixture.rows("retail_offers")[0].consumedBookingId).toBe(
      first.bookingId
    );
    expect(fixture.rows("booking_fare_components")).toMatchObject([
      {
        bookingId: first.bookingId,
        flightId: 11,
        componentType: "unclassified",
        code: "GROSS_RECONCILIATION_REQUIRED",
        amount: 10000,
      },
    ]);
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
      "booking_fare_components",
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

describe("initial ancillary scope and pricing", () => {
  const line = {
    ancillaryServiceId: 1,
    passengerIndex: 0,
    segmentIndex: 0,
    quantity: 2,
    unitPrice: 500,
    totalPrice: 1000,
  };
  it("preserves the purchased allowance and binds both the invoice and baggage to the issued passenger and sector", async () => {
    const command = { ...input, ancillaries: [line] };
    const sale = await createBooking(command);
    expect(await createBooking(command)).toEqual(sale);
    expect(sale.totalAmount).toBe(11000);
    const [sector] = fixture.rows("booking_segments");
    const [person] = fixture.rows("passengers");
    expect(sector).toMatchObject({
      flightId: 11,
      segmentAmount: 11000,
      inventoryLockId: fixture.rows("inventory_locks")[0].id,
    });
    expect(fixture.rows("booking_ancillaries")).toMatchObject([
      {
        passengerId: person.id,
        segmentId: sector.id,
        scopeState: "specific_segment",
        totalPrice: 1000,
        weightSnapshotGrams: 40000,
        metadata: JSON.stringify({ source: "initial_booking" }),
      },
    ]);
    expect(
      fixture
        .rows("booking_fare_components")
        .find(row => row.componentType === "ancillary")
    ).toMatchObject({
      bookingSegmentId: sector.id,
      passengerId: person.id,
      amount: 1000,
    });
  });
  it.each([
    ["stale price", [{ ...line, totalPrice: 999 }], "CONFLICT"],
    ["wrong passenger", [{ ...line, passengerIndex: 1 }], "BAD_REQUEST"],
    ["wrong flight", [{ ...line, segmentIndex: 1 }], "BAD_REQUEST"],
    ["missing scope", [{ ...line, passengerIndex: undefined }], "BAD_REQUEST"],
    ["raw passenger ID", [{ ...line, passengerId: 1 }], "BAD_REQUEST"],
    ["duplicate service", [line, line], "BAD_REQUEST"],
  ] as const)("rejects %s without retaining a hold", async (_, lines, code) => {
    await expect(
      createBooking({ ...input, ancillaries: [...lines] })
    ).rejects.toMatchObject({ code });
    for (const table of ["bookings", "inventory_locks", "booking_ancillaries"])
      expect(fixture.rows(table)).toHaveLength(0);
  });
  it("keeps scoped fees on the sold sector during a reprice and reverses only the removed passenger's line", async () => {
    const { setInvoiceTotal } =
      await import("../services/booking-invoice.service");
    const { removeAncillaryFromBooking } =
      await import("../services/ancillary-services.service");
    const command = {
      ...input,
      passengers: [
        ...input.passengers,
        { ...input.passengers[0], firstName: "Sara" },
      ],
      segments: [11, 12].map(flightId => ({
        flightId,
        departureDate: new Date("2030-01-01"),
      })),
      expectedTotalMinor: 22000,
      ancillaries: [line, { ...line, passengerIndex: 1 }],
    };
    await createMultiCityBooking(command);
    const [first, second] = fixture.rows("booking_ancillaries");
    const charges = fixture
      .rows("booking_fare_components")
      .filter(row => row.componentType === "ancillary");
    expect(charges.map(row => row.sourceReference)).toEqual([
      String(first.id),
      String(second.id),
    ]);
    await fixture.db.transaction((tx: any) =>
      setInvoiceTotal(tx, fixture.rows("bookings")[0], 20000)
    );
    expect(
      fixture.rows("booking_segments").map(row => row.segmentAmount)
    ).toEqual([11000, 9000]);
    await removeAncillaryFromBooking(first.id, { userId: input.userId });
    await removeAncillaryFromBooking(first.id, { userId: input.userId });
    expect(charges[0].reversedAt).toBeDefined();
    expect(charges[1].reversedAt).toBeUndefined();
    expect(first.status).toBe("cancelled");
    expect(second.status).toBe("active");
    expect(
      fixture.rows("booking_segments").map(row => row.segmentAmount)
    ).toEqual([10000, 9000]);
    expect(fixture.rows("bookings")[0].totalAmount).toBe(19000);
  });
  it.each([
    "missing",
    "duplicate",
    "wrong amount",
    "wrong traveler",
    "wrong sector",
  ])(
    "does not reduce the invoice when the linked charge is %s",
    async corruption => {
      const { removeAncillaryFromBooking } =
        await import("../services/ancillary-services.service");
      const sale = await createBooking({ ...input, ancillaries: [line] });
      const [purchase] = fixture.rows("booking_ancillaries");
      const rows = fixture.rows("booking_fare_components");
      const charge = rows.find(row => row.componentType === "ancillary");
      if (corruption === "missing") rows.splice(rows.indexOf(charge), 1);
      if (corruption === "duplicate")
        rows.push({ ...charge, id: charge.id + 50 });
      if (corruption === "wrong amount") charge.amount--;
      if (corruption === "wrong traveler") charge.passengerId++;
      if (corruption === "wrong sector") charge.bookingSegmentId++;
      await expect(
        removeAncillaryFromBooking(purchase.id, { userId: input.userId })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(fixture.rows("bookings")[0].totalAmount).toBe(sale.totalAmount);
      expect(fixture.rows("booking_ancillaries")[0].status).toBe("active");
      expect(
        fixture
          .rows("booking_fare_components")
          .some(row => row.reversedAt != null)
      ).toBe(false);
    }
  );
  it("rejects removal when a scoped charge loses its segment reference", async () => {
    const { removeAncillaryFromBooking } =
      await import("../services/ancillary-services.service");
    const sale = await createBooking({ ...input, ancillaries: [line] });
    const [purchase] = fixture.rows("booking_ancillaries");
    purchase.segmentId = null;
    await expect(
      removeAncillaryFromBooking(purchase.id, { userId: input.userId })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("bookings")[0].totalAmount).toBe(sale.totalAmount);
    expect(fixture.rows("booking_ancillaries")[0].status).toBe("active");
    expect(
      fixture
        .rows("booking_fare_components")
        .find(row => row.componentType === "ancillary").reversedAt
    ).toBeUndefined();
  });
  it("checks the grand total, airline and sector order even when flights lock in a different order", async () => {
    fixture.rows("flights")[0].airlineId = 99;
    fixture.rows("ancillary_services")[0].applicableAirlines = "[99]";
    const command = {
      ...input,
      segments: [12, 11].map(flightId => ({
        flightId,
        departureDate: new Date("2030-01-01"),
      })),
      expectedTotalMinor: 21000,
      ancillaries: [{ ...line, segmentIndex: 1 }],
    };
    await expect(
      createMultiCityBooking({ ...command, ancillaries: [line] })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      createMultiCityBooking({ ...command, expectedTotalMinor: 20000 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.rows("inventory_locks")).toHaveLength(0);
    const sale = await createMultiCityBooking(command);
    expect(await createMultiCityBooking(command)).toEqual(sale);
    expect(sale.totalAmount).toBe(21000);
    expect(fixture.rows("booking_segments")).toMatchObject([
      { flightId: 12, segmentAmount: 10000 },
      { flightId: 11, segmentAmount: 11000 },
    ]);
    expect(fixture.rows("booking_ancillaries")).toMatchObject([
      { segmentId: sale.segments[1].segmentId },
    ]);
    const invoice = fixture.rows("booking_fare_components");
    expect(invoice.reduce((sum, row) => sum + row.amount, 0)).toBe(21000);
    expect(
      invoice.find(row => row.componentType === "ancillary")
    ).toMatchObject({
      flightId: 11,
      amount: 1000,
      bookingSegmentId: sale.segments[1].segmentId,
    });
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
  it("keeps each quoted passenger fare, tax and fee with its segment on command replay", async () => {
    boundary.price.mockImplementation(async (flight: { id: number }) => {
      const baseFare = flight.id === 11 ? 8000 : 9000;
      return {
        price: baseFare + 6500,
        fareLines: [
          {
            type: "adult",
            baseFare,
            tax: 1000,
            bookingFee: 100,
            total: baseFare + 1100,
          },
          {
            type: "child",
            baseFare: 5000,
            tax: 350,
            bookingFee: 50,
            total: 5400,
          },
        ],
      };
    });
    const request = {
      ...input,
      passengers: [
        ...input.passengers,
        { type: "child" as const, firstName: "Lina", lastName: "Saleh" },
      ],
      segments: [11, 12].map(flightId => ({
        flightId,
        departureDate: new Date("2030-01-01"),
      })),
    };
    const result = await createMultiCityBooking(request);
    expect(await createMultiCityBooking(request)).toEqual(result);
    const rows = fixture.rows("booking_fare_components");
    expect(rows).toHaveLength(12);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(result.totalAmount);
    for (const { segmentId, flightId } of result.segments) {
      for (const p of fixture.rows("passengers")) {
        const scoped = rows.filter(
          r =>
            r.passengerId === p.id &&
            r.bookingSegmentId === segmentId &&
            r.flightId === flightId
        );
        expect(scoped.map(r => [r.componentType, r.amount])).toEqual([
          [
            "base_fare",
            p.type === "adult" ? (flightId === 11 ? 8000 : 9000) : 5000,
          ],
          ["tax", p.type === "adult" ? 1000 : 350],
          ["booking_fee", p.type === "adult" ? 100 : 50],
        ]);
      }
    }
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
    await fixture.db.insert(bookings).values({
      id: 5,
      userId: 1,
      flightId: 11,
      cabinClass: "economy",
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
      tenantId: 3,
    });
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
      {
        id: 2,
        flightId: 11,
        seatNumber: "1B",
        cabinClass: "economy",
        seatPrice: 0,
        status,
      },
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

it("declines a changed multi-city total before saving a passenger or acquiring a hold", async () => {
  const command = {
    ...input,
    segments: [11, 12].map(flightId => ({
      flightId,
      departureDate: new Date("2030-01-01"),
    })),
    expectedTotalMinor: 19999,
  };
  await expect(createMultiCityBooking(command)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(fixture.rows("bookings")).toHaveLength(0);
  expect(fixture.rows("passengers")).toHaveLength(0);
  expect(fixture.rows("inventory_locks")).toHaveLength(0);
  const accepted = { ...command, expectedTotalMinor: 20000 };
  const created = await createMultiCityBooking(accepted);
  expect(await createMultiCityBooking(accepted)).toEqual(created);
  expect(fixture.rows("passengers")).toHaveLength(1);
  expect(fixture.rows("booking_segments")).toHaveLength(2);
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

it("preserves optional properties and dates in committed command responses", async () => {
  const { withTransactionalIdempotency, findCompletedCommand } =
    await import("../services/idempotency-v2.service");
  const response = {
    createdAt: new Date("2030-01-01"),
    contact: { optional: undefined },
  };
  const command = {
    scope: "test.serialization",
    key: "1",
    userId: 1,
    request: { id: 1 },
  };
  const first = await withTransactionalIdempotency({
    ...command,
    run: async () => response,
  });
  const retry = await withTransactionalIdempotency({
    ...command,
    run: async () => {
      throw new Error("Must not rerun");
    },
  });
  expect(retry).toStrictEqual(first);
  expect((await findCompletedCommand(command))?.response).toStrictEqual(first);
});

it("full refund closes every segment and releases physical seats without removing airline blocks", async () => {
  const { settleVerifiedPayment, settleVerifiedRefund } =
    await import("../services/payment-settlement.service");
  const { seatInventory, ndcOrders, ticketCoupons } =
    await import("../../drizzle/schema");
  const result = await createMultiCityBooking({
    ...input,
    segments: [11, 12].map(flightId => ({
      flightId,
      departureDate: new Date("2030-01-01"),
    })),
  });
  await fixture.db
    .insert(ndcOrders)
    .values({ bookingId: result.bookingId, status: "pending" });
  await fixture.db.transaction((tx: any) =>
    settleVerifiedPayment(tx, {
      paymentIntentId: "pi_refund_legs",
      amount: result.totalAmount,
      currency: "sar",
      eventId: "evt_fund_legs",
      metadata: { bookingId: String(result.bookingId), userId: "1" },
    })
  );
  expect(fixture.rows("ndc_orders")[0].status).toBe("confirmed");
  await fixture.db.insert(seatInventory).values([
    {
      flightId: 11,
      bookingId: result.bookingId,
      passengerId: 1,
      status: "checked_in",
      boardingPassIssued: true,
    },
    {
      flightId: 12,
      bookingId: result.bookingId,
      passengerId: 1,
      status: "blocked",
      boardingPassIssued: false,
    },
  ]);
  await fixture.db.insert(ticketCoupons).values(
    [11, 12].map((flightId, i) => ({
      bookingId: result.bookingId,
      passengerId: 1,
      flightId,
      couponNumber: i + 1,
      ticketNumber: "0010000000001",
      status: i ? "O" : "C",
    }))
  );
  const refund = {
    paymentIntentId: "pi_refund_legs",
    chargeId: "ch_refund_legs",
    amount: result.totalAmount,
    amountRefunded: result.totalAmount,
    currency: "sar",
    eventId: "evt_refund_legs",
  };
  await fixture.db.transaction((tx: any) => settleVerifiedRefund(tx, refund));
  await fixture.db.transaction((tx: any) => settleVerifiedRefund(tx, refund));
  expect(fixture.rows("ndc_orders")[0].status).toBe("refunded");
  expect(fixture.rows("ticket_coupons").map(c => c.status)).toEqual(["R", "R"]);
  expect(
    fixture.rows("flights").map(flight => flight.economyAvailable)
  ).toEqual([2, 2]);
  expect(
    fixture
      .rows("booking_segments")
      .every(
        segment => segment.status === "cancelled" && !segment.seatsReserved
      )
  ).toBe(true);
  expect(
    fixture
      .rows("seat_inventory")
      .map(seat => [seat.status, seat.bookingId, seat.boardingPassIssued])
  ).toEqual([
    ["available", null, false],
    ["blocked", null, false],
  ]);
});

describe("NDC terminal command boundaries", () => {
  async function seedOrder() {
    const result = await createMultiCityBooking({
      ...input,
      segments: [11, 12].map(flightId => ({
        flightId,
        departureDate: new Date("2030-01-01"),
      })),
    });
    const schema = await import("../../drizzle/schema");
    await fixture.db.insert(schema.ndcOrders).values({
      orderId: "ndc-terminal",
      offerId: "offer-terminal",
      bookingId: result.bookingId,
      airlineId: 1,
      status: "pending",
      servicingHistory: "[]",
      passengers: "[]",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await fixture.db
      .insert(schema.ndcOffers)
      .values({ offerId: "offer-terminal", status: "ordered" });
    return result;
  }
  it("checks ownership before cancelling and restores all legs once on replay", async () => {
    await seedOrder();
    const { cancelOrder } = await import("../services/ndc.service");
    await fixture.db.transaction((tx: any) =>
      confirmFundedBooking(tx, fixture.rows("bookings")[0])
    );
    await expect(
      cancelOrder({ orderId: "ndc-terminal", userId: 2 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      1, 1,
    ]);
    await cancelOrder({ orderId: "ndc-terminal", userId: 1 });
    await cancelOrder({ orderId: "ndc-terminal", userId: 1 });
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      2, 2,
    ]);
    expect(fixture.rows("ndc_orders")[0].status).toBe("cancelled");
    expect(fixture.rows("bookings")[0].paymentStatus).toBe("paid");
    expect(
      fixture.rows("outbox").filter(e => e.eventType === "NdcOrderCancelled")
    ).toHaveLength(1);
  });
  it("rolls back the order and held capacity if cancellation cannot persist its event", async () => {
    await seedOrder();
    fixture.failInsert("outbox");
    const { cancelOrder } = await import("../services/ndc.service");
    await expect(
      cancelOrder({ orderId: "ndc-terminal", userId: 1 })
    ).rejects.toThrow("Injected");
    expect(fixture.rows("ndc_orders")[0].status).toBe("pending");
    expect(fixture.rows("bookings")[0].status).toBe("pending");
    expect(
      fixture.rows("inventory_locks").every(h => h.status === "active")
    ).toBe(true);
  });
  it("refuses unintegrated exchange and ancillary writes without issuing fake EMDs", async () => {
    await seedOrder();
    const { changeOrder, serviceOrder } =
      await import("../services/ndc.service");
    await expect(
      changeOrder({
        orderId: "ndc-terminal",
        userId: 1,
        changes: { newCabinClass: "business" },
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      serviceOrder("ndc-terminal", [{ serviceCode: "BAG", quantity: 1 }])
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("bookings")[0].cabinClass).toBe("economy");
    expect(fixture.rows("booking_ancillaries")).toHaveLength(0);
    expect(fixture.rows("ndc_orders")[0].emdNumbers).toBeUndefined();
  });
});
