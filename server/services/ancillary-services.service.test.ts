import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getAvailableAncillaries,
  getAncillaryById,
  createAncillaryService,
  addAncillaryToBooking,
  getBookingAncillaries,
  calculateAncillariesTotalCost,
  removeAncillaryFromBooking,
  getAncillariesByCategory,
} from "./ancillary-services.service";
import { getDb } from "../db";
import {
  ancillaryServices,
  bookingAncillaries,
  bookingFareComponents,
  bookings,
  flights,
  idempotencyRequests,
  outbox,
  users,
} from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../__tests__/test-db-helper";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("Ancillary Services Service", () => {
  let testServiceId: number;
  let testBookingId: number;
  let otherBookingId: number;
  let testFlightId: number;
  let testUserId: number;
  const testTenantId = null;
  const bookingIds: number[] = [];

  beforeAll(async () => {
    const db = getDb()!;
    const [user] = await db.insert(users).values({
      openId: `ancillary-test-${randomUUID()}`,
      role: "user",
      tenantId: testTenantId,
    });
    testUserId = user.insertId;
    const [flight] = await db.insert(flights).values({
      flightNumber: "AC100",
      airlineId: 1,
      originId: 1,
      destinationId: 2,
      departureTime: new Date("2035-01-01"),
      arrivalTime: new Date("2035-01-02"),
      economyPrice: 50000,
      businessPrice: 100000,
      economyAvailable: 100,
      economySeats: 100,
      businessSeats: 10,
      businessAvailable: 10,
    });
    testFlightId = flight.insertId;
    for (const n of [0, 1]) {
      const [booking] = await db.insert(bookings).values({
        userId: testUserId,
        tenantId: testTenantId,
        flightId: testFlightId,
        bookingReference: `AC${n}001`,
        pnr: `AP${n}001`,
        totalAmount: 50000,
        status: "pending",
        cabinClass: "economy",
        numberOfPassengers: 1,
      });
      bookingIds.push(booking.insertId);
    }
    [testBookingId, otherBookingId] = bookingIds;
    // Create a test ancillary service
    testServiceId = await createAncillaryService({
      code: "TEST_BAG_20KG",
      category: "baggage",
      name: "Test 20kg Baggage",
      description: "Test baggage service",
      price: 15000,
      currency: "SAR",
      available: true,
    });
  });

  afterAll(async () => {
    const db = getDb();
    if (!db) return;
    for (const id of bookingIds) {
      await db
        .delete(bookingAncillaries)
        .where(eq(bookingAncillaries.bookingId, id));
      await db
        .delete(bookingFareComponents)
        .where(eq(bookingFareComponents.bookingId, id));
      await db
        .delete(outbox)
        .where(
          and(
            eq(outbox.aggregateType, "booking"),
            eq(outbox.aggregateId, String(id))
          )
        );
      await db.delete(bookings).where(eq(bookings.id, id));
    }
    if (Number.isSafeInteger(testServiceId))
      await db
        .delete(ancillaryServices)
        .where(eq(ancillaryServices.id, testServiceId));
    if (Number.isSafeInteger(testFlightId))
      await db.delete(flights).where(eq(flights.id, testFlightId));
    if (Number.isSafeInteger(testUserId)) {
      await db
        .delete(idempotencyRequests)
        .where(
          and(
            eq(idempotencyRequests.userId, testUserId),
            eq(idempotencyRequests.scope, "booking.ancillary.add")
          )
        );
      await db.delete(users).where(eq(users.id, testUserId));
    }
  });

  it("should get all available ancillaries", async () => {
    const services = await getAvailableAncillaries();
    expect(services).toBeDefined();
    expect(Array.isArray(services)).toBe(true);
    expect(services.length).toBeGreaterThan(0);
  });

  it("should get ancillaries by category", async () => {
    const services = await getAvailableAncillaries("baggage");
    expect(services).toBeDefined();
    expect(Array.isArray(services)).toBe(true);
    expect(services.every(s => s.category === "baggage")).toBe(true);
  });

  it("should get ancillary by ID", async () => {
    const service = await getAncillaryById(testServiceId);
    expect(service).toBeDefined();
    expect(service?.code).toBe("TEST_BAG_20KG");
    expect(service?.price).toBe(15000);
  });

  it("should return null for non-existent ancillary", async () => {
    const service = await getAncillaryById(999999);
    expect(service).toBeNull();
  });

  it("should add ancillary to booking", async () => {
    const result = await addAncillaryToBooking(
      {
        bookingId: testBookingId,
        ancillaryServiceId: testServiceId,
        quantity: 2,
        idempotencyKey: "ancillary-test-add",
      },
      { userId: testUserId, tenantId: testTenantId }
    );

    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
    expect(result.totalPrice).toBe(30000); // 15000 * 2
    expect(result.service.code).toBe("TEST_BAG_20KG");
  });

  it("should get booking ancillaries", async () => {
    const ancillaries = await getBookingAncillaries(testBookingId);
    expect(ancillaries).toBeDefined();
    expect(Array.isArray(ancillaries)).toBe(true);
    expect(ancillaries.length).toBeGreaterThan(0);
    expect(ancillaries[0].service.code).toBe("TEST_BAG_20KG");
  });

  it("should calculate total ancillaries cost", async () => {
    const total = await calculateAncillariesTotalCost(testBookingId);
    expect(total).toBe(30000); // 15000 * 2
  });

  it("should remove ancillary from booking", async () => {
    const ancillaries = await getBookingAncillaries(testBookingId);
    const ancillaryId = ancillaries[0].id;

    await removeAncillaryFromBooking(ancillaryId, {
      userId: testUserId,
      tenantId: testTenantId,
    });

    const updated = await getBookingAncillaries(testBookingId);
    const cancelled = updated.find(a => a.id === ancillaryId);
    expect(cancelled?.status).toBe("cancelled");
  });

  it("should filter ancillaries by cabin class", async () => {
    // Create a service restricted to economy
    const economyServiceId = await createAncillaryService({
      code: "TEST_ECONOMY_SEAT",
      category: "seat",
      name: "Test Economy Seat",
      description: "Test seat service",
      price: 10000,
      currency: "SAR",
      available: true,
      applicableCabinClasses: JSON.stringify(["economy"]),
    });

    const economyServices = await getAncillariesByCategory({
      category: "seat",
      cabinClass: "economy",
    });

    const businessServices = await getAncillariesByCategory({
      category: "seat",
      cabinClass: "business",
    });

    expect(economyServices.some(s => s.id === economyServiceId)).toBe(true);
    expect(businessServices.some(s => s.id === economyServiceId)).toBe(false);

    // Cleanup
    const db = await getDb();
    if (db) {
      await db
        .delete(ancillaryServices)
        .where(eq(ancillaryServices.id, economyServiceId));
    }
  });

  it("should handle metadata in booking ancillaries", async () => {
    const metadata = { seatNumber: "12A", preference: "window" };
    const result = await addAncillaryToBooking(
      {
        bookingId: otherBookingId,
        ancillaryServiceId: testServiceId,
        quantity: 1,
        metadata,
        idempotencyKey: "ancillary-test-metadata",
      },
      { userId: testUserId, tenantId: testTenantId }
    );

    expect(result).toBeDefined();

    const ancillaries = await getBookingAncillaries(otherBookingId);
    expect(ancillaries[0].metadata.preferences).toEqual(metadata);

    // Cleanup
    const db = await getDb();
    if (db) {
      await db
        .delete(bookingAncillaries)
        .where(eq(bookingAncillaries.bookingId, otherBookingId));
    }
  });
});
