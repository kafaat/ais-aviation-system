import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { changeOrder, addServices } from "../services/ndc.service";
import {
  addAncillaryToBooking,
  removeAncillaryFromBooking,
} from "../services/ancillary-services.service";
let fixture: ReturnType<typeof transactionMemory>;
const command = { orderId: "ORD-7", userId: 9, idempotencyKey: "request-1" };
const future = new Date("2035-01-01T10:00:00Z");
const segment = (id: number) => ({ flightId: id, segmentKey: `SEG-${id}` });
beforeEach(() => {
  const pax = {
    type: "adult",
    firstName: "Synthetic",
    lastName: "Passenger",
    passportNumber: "TEST123",
  };
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        cabinClass: "economy",
        numberOfPassengers: 1,
        totalAmount: 10000,
        inventoryLockId: 1,
        status: "pending",
        paymentStatus: "pending",
        seatsReserved: false,
      },
    ],
    passengers: [{ id: 11, bookingId: 7, tenantId: 3, ...pax }],
    flights: [4, 5, 6, 7].map(id => ({
      id,
      tenantId: 3,
      airlineId: 2,
      departureTime: future,
      arrivalTime: new Date("2035-01-01T12:00:00Z"),
      status: "scheduled",
      economyAvailable: 2,
      businessAvailable: 2,
    })),
    booking_segments: [4, 5].map((id, i) => ({
      id: i + 1,
      bookingId: 7,
      flightId: id,
      inventoryLockId: i + 1,
      segmentOrder: i + 1,
      status: "pending",
      seatsReserved: false,
      segmentAmount: i ? 4000 : 6000,
    })),
    inventory_locks: [4, 5].map((id, i) => ({
      id: i + 1,
      userId: 9,
      flightId: id,
      cabinClass: "economy",
      numberOfSeats: 1,
      status: "active",
      expiresAt: future,
    })),
    ndc_orders: [
      {
        id: 1,
        orderId: "ORD-7",
        bookingId: 7,
        offerId: "OLD",
        airlineId: 2,
        totalAmount: 10000,
        currency: "SAR",
        status: "pending",
        channel: "direct",
        passengers: JSON.stringify([pax]),
        contactInfo: JSON.stringify({
          emailAddress: "old@example.test",
          phoneNumber: "123",
        }),
        orderPayload: JSON.stringify({
          passengers: [pax],
          segments: [4, 5].map(segment),
          pricing: { totalAmount: 10000 },
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    ndc_offers: [
      { id: 1, offerId: "OLD", status: "ordered" },
      {
        id: 2,
        offerId: "NEW",
        status: "active",
        airlineId: 2,
        currency: "SAR",
        cabinClass: "business",
        totalPrice: 12000,
        basePrice: 12000,
        taxesAndFees: 0,
        expiresAt: future,
        departureDate: future,
        segments: JSON.stringify([6, 7].map(segment)),
        offerPayload: JSON.stringify({ pricing: { passengerCount: 1 } }),
      },
    ],
    ancillary_services: [
      {
        id: 1,
        code: "BAG20",
        price: 500,
        currency: "SAR",
        category: "baggage",
        available: true,
      },
    ],
  });
  state.db = fixture.db;
});
const add = () =>
  addServices({
    ...command,
    services: [
      {
        serviceCode: "BAG20",
        passengerId: "11",
        segmentId: "SEG-4",
        quantity: 2,
      },
    ],
  });
const replace = () =>
  changeOrder({
    ...command,
    changes: { replacementOfferId: "NEW", newCabinClass: "business" },
  });
describe("unpaid NDC invoice commands", () => {
  it("synchronizes canonical passenger/contact details atomically and replays once", async () => {
    const input = {
      ...command,
      changes: {
        passengerUpdates: [{ passengerId: "11", firstName: "Corrected" }],
        contactInfoUpdate: { emailAddress: "new@example.test" },
      },
    };
    const first = await changeOrder(input);
    expect(await changeOrder(input)).toEqual(first);
    expect(first.passengers[0].firstName).toBe("Corrected");
    expect(fixture.rows("passengers")[0].firstName).toBe("Corrected");
    expect(
      JSON.parse(fixture.rows("ndc_orders")[0].orderPayload).contactInfo
        .emailAddress
    ).toBe("new@example.test");
    expect(fixture.rows("ndc_orders")[0].status).toBe("pending");
    expect(fixture.rows("outbox")).toHaveLength(1);
    expect(JSON.stringify(fixture.rows("outbox"))).not.toContain("Corrected");
    await expect(
      changeOrder({
        ...input,
        changes: { passengerUpdates: [{ index: 0, firstName: "Other" }] },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects a foreign actor, passenger and unsynchronized travel-document fields", async () => {
    await expect(
      changeOrder({
        ...command,
        userId: 8,
        changes: { passengerUpdates: [{ index: 0, firstName: "Bad" }] },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      changeOrder({
        ...command,
        changes: {
          passengerUpdates: [{ passengerId: "99", firstName: "Bad" }],
        },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      changeOrder({
        ...command,
        changes: {
          passengerUpdates: [{ index: 0, passportExpiry: "2036-01-01" }],
        },
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("passengers")[0].firstName).toBe("Synthetic");
    expect(fixture.rows("outbox")).toHaveLength(0);
  });
  it("adds server-priced services once to booking, NDC and all segment allocations without EMD issuance", async () => {
    const result = await add();
    expect(await add()).toEqual(result);
    expect(result.totalAmount).toBe(11000);
    expect(result.emdNumbers).toEqual([]);
    expect(result.status).toBe("pending");
    expect(fixture.rows("bookings")[0].totalAmount).toBe(11000);
    expect(fixture.rows("booking_segments").map(l => l.segmentAmount)).toEqual([
      6600, 4400,
    ]);
    expect(fixture.rows("booking_ancillaries")).toHaveLength(1);
    expect(fixture.rows("booking_ancillaries")[0]).toMatchObject({
      unitPrice: 500,
      quantity: 2,
      totalPrice: 1000,
      passengerId: 11,
    });
    expect(fixture.rows("payments")).toHaveLength(0);
  });
  it("uses the same invoice authority for direct ancillary add/remove and prevents duplicate deductions", async () => {
    const input = {
      bookingId: 7,
      ancillaryServiceId: 1,
      quantity: 2,
      idempotencyKey: "direct-add",
    };
    const added = await addAncillaryToBooking(input, { userId: 9 });
    expect(await addAncillaryToBooking(input, { userId: 9 })).toEqual(added);
    await removeAncillaryFromBooking(added.id, { userId: 9 });
    await removeAncillaryFromBooking(added.id, { userId: 9 });
    expect(fixture.rows("bookings")[0].totalAmount).toBe(10000);
    expect(fixture.rows("ndc_orders")[0].totalAmount).toBe(10000);
    expect(fixture.rows("booking_ancillaries")[0].status).toBe("cancelled");
  });
  it("rejects invoice edits behind an unresolved checkout or after payment", async () => {
    await fixture.db
      .insert((await import("../../drizzle/schema")).bookingCheckoutRequests)
      .values({ bookingId: 7, status: "creating" });
    await expect(add()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(replace()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    fixture.rows("booking_checkout_requests")[0].status = "expired";
    fixture.rows("bookings")[0].paymentStatus = "paid";
    await expect(add()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("booking_ancillaries")).toHaveLength(0);
  });
  it("rolls back service rows, totals and idempotency when outbox persistence fails", async () => {
    fixture.failInsert("outbox");
    await expect(add()).rejects.toThrow("Injected");
    expect(fixture.rows("booking_ancillaries")).toHaveLength(0);
    expect(fixture.rows("bookings")[0].totalAmount).toBe(10000);
    expect(fixture.rows("ndc_orders")[0].totalAmount).toBe(10000);
    expect(fixture.rows("idempotency_requests")).toHaveLength(0);
  });
  it("replaces every leg with owned holds from the fresh quote and releases originals once", async () => {
    const result = await replace();
    expect(await replace()).toEqual(result);
    expect(result.offerId).toBe("NEW");
    expect(result.totalAmount).toBe(12000);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      cabinClass: "business",
      flightId: 6,
    });
    expect(fixture.rows("booking_segments").map(s => s.flightId)).toEqual([
      6, 7,
    ]);
    expect(
      fixture
        .rows("booking_segments")
        .reduce((sum, s) => sum + s.segmentAmount, 0)
    ).toBe(12000);
    expect(fixture.rows("inventory_locks").map(h => h.status)).toEqual([
      "released",
      "released",
      "active",
      "active",
    ]);
    expect(fixture.rows("ndc_offers").map(o => o.status)).toEqual([
      "cancelled",
      "ordered",
    ]);
  });
  it("restores original legs and holds when the final replacement leg has no capacity", async () => {
    fixture.rows("flights").find(f => f.id === 7).businessAvailable = 0;
    await expect(replace()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("booking_segments").map(s => s.flightId)).toEqual([
      4, 5,
    ]);
    expect(fixture.rows("inventory_locks").map(h => h.status)).toEqual([
      "active",
      "active",
    ]);
    expect(fixture.rows("ndc_orders")[0]).toMatchObject({
      offerId: "OLD",
      totalAmount: 10000,
    });
    expect(fixture.rows("ndc_offers")[1].status).toBe("active");
  });
  it("rejects a quote whose flight schedule changed before acceptance", async () => {
    const quote = fixture.rows("ndc_offers")[1];
    const segments = JSON.parse(quote.segments);
    segments[0].departureTime = "2034-01-01T10:00:00Z";
    quote.segments = JSON.stringify(segments);
    await expect(replace()).rejects.toThrow("schedule changed");
    expect(
      fixture.rows("inventory_locks").every(h => h.status === "active")
    ).toBe(true);
    expect(fixture.rows("ndc_orders")[0].offerId).toBe("OLD");
  });
  it("rejects changed tenant, invalid segment and unsupported ancillary fulfillment", async () => {
    fixture.rows("flights").find(f => f.id === 7).tenantId = 99;
    await expect(replace()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      addServices({
        ...command,
        services: [{ serviceCode: "BAG20", segmentId: "foreign" }],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    fixture.rows("ancillary_services")[0].category = "seat";
    await expect(add()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("booking_ancillaries")).toHaveLength(0);
  });
});
