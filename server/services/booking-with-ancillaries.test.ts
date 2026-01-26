import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createBooking } from "./bookings.service";
import {
  getBookingAncillaries,
  createAncillaryService,
} from "./ancillary-services.service";
import { getDb } from "../db";
import {
  bookings,
  ancillaryServices,
  bookingAncillaries,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Booking with Ancillaries Integration", () => {
  let testServiceId: number;
  let testBookingId: number;
  const testUserId = 1;
  const testFlightId = 1;

  beforeAll(async () => {
    // Create a test ancillary service
    testServiceId = await createAncillaryService({
      code: "TEST_INTEGRATION_BAG",
      category: "baggage",
      name: "Test Integration Baggage",
      description: "Test baggage for integration",
      price: 10000,
      currency: "SAR",
      available: true,
    });
  });

  afterAll(async () => {
    // Cleanup
    const db = await getDb();
    if (db && testBookingId) {
      await db
        .delete(bookingAncillaries)
        .where(eq(bookingAncillaries.bookingId, testBookingId));
      await db.delete(bookings).where(eq(bookings.id, testBookingId));
    }
    if (db && testServiceId) {
      await db
        .delete(ancillaryServices)
        .where(eq(ancillaryServices.id, testServiceId));
    }
  });

  it("should create booking without ancillaries", async () => {
    const result = await createBooking({
      userId: testUserId,
      flightId: testFlightId,
      cabinClass: "economy",
      passengers: [
        {
          type: "adult",
          firstName: "Test",
          lastName: "User",
        },
      ],
      sessionId: `test_session_${Date.now()}`,
    });

    expect(result).toBeDefined();
    expect(result.bookingId).toBeGreaterThan(0);
    expect(result.bookingReference).toBeDefined();
    expect(result.pnr).toBeDefined();
    expect(result.totalAmount).toBeGreaterThan(0);

    testBookingId = result.bookingId;

    // Verify no ancillaries
    const ancillaries = await getBookingAncillaries(result.bookingId);
    expect(ancillaries.length).toBe(0);

    // Cleanup
    const db = await getDb();
    if (db) {
      await db.delete(bookings).where(eq(bookings.id, result.bookingId));
    }
  });

  it("should create booking with ancillaries", async () => {
    const result = await createBooking({
      userId: testUserId,
      flightId: testFlightId,
      cabinClass: "economy",
      passengers: [
        {
          type: "adult",
          firstName: "Test",
          lastName: "User",
        },
      ],
      sessionId: `test_session_${Date.now()}`,
      ancillaries: [
        {
          ancillaryServiceId: testServiceId,
          quantity: 2,
          unitPrice: 10000,
          totalPrice: 20000,
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.bookingId).toBeGreaterThan(0);

    testBookingId = result.bookingId;

    // Verify ancillaries were added
    const ancillaries = await getBookingAncillaries(result.bookingId);
    expect(ancillaries.length).toBe(1);
    expect(ancillaries[0].quantity).toBe(2);
    expect(ancillaries[0].totalPrice).toBe(20000);
    expect(ancillaries[0].service.code).toBe("TEST_INTEGRATION_BAG");
  });

  it("should create booking with multiple ancillaries", async () => {
    // Create another test service
    const mealServiceId = await createAncillaryService({
      code: "TEST_INTEGRATION_MEAL",
      category: "meal",
      name: "Test Integration Meal",
      description: "Test meal for integration",
      price: 5000,
      currency: "SAR",
      available: true,
    });

    const result = await createBooking({
      userId: testUserId,
      flightId: testFlightId,
      cabinClass: "economy",
      passengers: [
        {
          type: "adult",
          firstName: "Test",
          lastName: "User",
        },
      ],
      sessionId: `test_session_${Date.now()}`,
      ancillaries: [
        {
          ancillaryServiceId: testServiceId,
          quantity: 1,
          unitPrice: 10000,
          totalPrice: 10000,
        },
        {
          ancillaryServiceId: mealServiceId,
          quantity: 1,
          unitPrice: 5000,
          totalPrice: 5000,
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.bookingId).toBeGreaterThan(0);

    // Verify both ancillaries were added
    const ancillaries = await getBookingAncillaries(result.bookingId);
    expect(ancillaries.length).toBe(2);

    const baggage = ancillaries.find(
      a => a.service.code === "TEST_INTEGRATION_BAG"
    );
    const meal = ancillaries.find(
      a => a.service.code === "TEST_INTEGRATION_MEAL"
    );

    expect(baggage).toBeDefined();
    expect(meal).toBeDefined();
    expect(baggage?.totalPrice).toBe(10000);
    expect(meal?.totalPrice).toBe(5000);

    // Cleanup
    const db = await getDb();
    if (db) {
      await db
        .delete(bookingAncillaries)
        .where(eq(bookingAncillaries.bookingId, result.bookingId));
      await db.delete(bookings).where(eq(bookings.id, result.bookingId));
      await db
        .delete(ancillaryServices)
        .where(eq(ancillaryServices.id, mealServiceId));
    }
  });
});
