import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import {
  groupBookings,
  flights,
  airlines,
  airports,
} from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import {
  calculateGroupDiscount,
  createGroupBookingRequest,
  getGroupBookings,
  getGroupBookingById,
  approveGroupBooking,
  rejectGroupBooking,
  getGroupBookingStats,
  MIN_GROUP_SIZE,
  DISCOUNT_TIERS,
} from "./group-booking.service";

describe.skipIf(!process.env.DATABASE_URL)("Group Booking Service", () => {
  // Test data IDs
  let testFlightId: number;
  let testGroupBookingId: number;
  const testAirlineId = 999801;
  const testOriginId = 999802;
  const testDestinationId = 999803;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available for tests");
    }

    // Create test airline (use INSERT IGNORE to avoid conflicts with parallel tests)
    await db.execute(
      sql`INSERT IGNORE INTO airlines (id, code, name, active) VALUES (${testAirlineId}, 'GB9', 'Test Group Airline', 1)`
    );

    // Create test airports
    await db.execute(
      sql`INSERT IGNORE INTO airports (id, code, name, city, country) VALUES (${testOriginId}, 'GB1', 'Test Group Origin', 'Test City 1', 'Saudi Arabia')`
    );
    await db.execute(
      sql`INSERT IGNORE INTO airports (id, code, name, city, country) VALUES (${testDestinationId}, 'GB2', 'Test Group Destination', 'Test City 2', 'Saudi Arabia')`
    );

    // Create test flight
    const flightResult = await db.insert(flights).values({
      flightNumber: "GB999",
      airlineId: testAirlineId,
      originId: testOriginId,
      destinationId: testDestinationId,
      departureTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      arrivalTime: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000
      ), // +3 hours
      economySeats: 150,
      businessSeats: 30,
      economyPrice: 50000, // 500 SAR
      businessPrice: 150000, // 1500 SAR
      economyAvailable: 150,
      businessAvailable: 30,
      status: "scheduled",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle insert result type varies by driver version
    const insertResult = flightResult as Record<string, any>;
    testFlightId = Number(insertResult[0]?.insertId ?? insertResult.insertId);
  });

  afterAll(async () => {
    const db = await getDb();
    if (db) {
      // Cleanup test data in correct order
      await db
        .delete(groupBookings)
        .where(eq(groupBookings.flightId, testFlightId));
      await db.delete(flights).where(eq(flights.id, testFlightId));
      await db.delete(airports).where(eq(airports.id, testOriginId));
      await db.delete(airports).where(eq(airports.id, testDestinationId));
      await db.delete(airlines).where(eq(airlines.id, testAirlineId));
    }
  });

  describe("calculateGroupDiscount", () => {
    it("should return 0% discount for groups less than 10", () => {
      expect(calculateGroupDiscount(5)).toBe(0);
      expect(calculateGroupDiscount(9)).toBe(0);
      expect(calculateGroupDiscount(0)).toBe(0);
    });

    it("should return 5% discount for small groups (10-19)", () => {
      expect(calculateGroupDiscount(10)).toBe(DISCOUNT_TIERS.SMALL.discount);
      expect(calculateGroupDiscount(15)).toBe(DISCOUNT_TIERS.SMALL.discount);
      expect(calculateGroupDiscount(19)).toBe(DISCOUNT_TIERS.SMALL.discount);
    });

    it("should return 10% discount for medium groups (20-49)", () => {
      expect(calculateGroupDiscount(20)).toBe(DISCOUNT_TIERS.MEDIUM.discount);
      expect(calculateGroupDiscount(35)).toBe(DISCOUNT_TIERS.MEDIUM.discount);
      expect(calculateGroupDiscount(49)).toBe(DISCOUNT_TIERS.MEDIUM.discount);
    });

    it("should return 15% discount for large groups (50+)", () => {
      expect(calculateGroupDiscount(50)).toBe(DISCOUNT_TIERS.LARGE.discount);
      expect(calculateGroupDiscount(100)).toBe(DISCOUNT_TIERS.LARGE.discount);
      expect(calculateGroupDiscount(500)).toBe(DISCOUNT_TIERS.LARGE.discount);
    });
  });

  describe("createGroupBookingRequest", () => {
    it("should create a group booking request successfully", async () => {
      const result = await createGroupBookingRequest({
        organizerName: "Test Organizer",
        organizerEmail: "test@example.com",
        organizerPhone: "+966500000000",
        groupSize: 15,
        flightId: testFlightId,
        notes: "Test group booking",
      });

      expect(result).toBeDefined();
      expect(result.id).toBeGreaterThan(0);
      expect(result.suggestedDiscount).toBe(5); // 10-19 = 5%

      testGroupBookingId = result.id;
    });

    it("should reject group size less than 10", async () => {
      await expect(
        createGroupBookingRequest({
          organizerName: "Test",
          organizerEmail: "test@example.com",
          organizerPhone: "+966500000000",
          groupSize: 5,
          flightId: testFlightId,
        })
      ).rejects.toThrow(
        `Group size must be at least ${MIN_GROUP_SIZE} passengers`
      );
    });

    it("should reject invalid flight ID", async () => {
      await expect(
        createGroupBookingRequest({
          organizerName: "Test",
          organizerEmail: "test@example.com",
          organizerPhone: "+966500000000",
          groupSize: 10,
          flightId: 999999999,
        })
      ).rejects.toThrow("Flight not found");
    });

    it("should calculate correct discount for medium groups", async () => {
      const result = await createGroupBookingRequest({
        organizerName: "Medium Group Organizer",
        organizerEmail: "medium@example.com",
        organizerPhone: "+966500000001",
        groupSize: 25,
        flightId: testFlightId,
      });

      expect(result.suggestedDiscount).toBe(10); // 20-49 = 10%
    });

    it("should calculate correct discount for large groups", async () => {
      const result = await createGroupBookingRequest({
        organizerName: "Large Group Organizer",
        organizerEmail: "large@example.com",
        organizerPhone: "+966500000002",
        groupSize: 50,
        flightId: testFlightId,
      });

      expect(result.suggestedDiscount).toBe(15); // 50+ = 15%
    });
  });

  describe("getGroupBookings", () => {
    it("should return all group bookings", async () => {
      const bookings = await getGroupBookings();

      expect(bookings).toBeDefined();
      expect(Array.isArray(bookings)).toBe(true);
      expect(bookings.length).toBeGreaterThan(0);
    });

    it("should filter by status", async () => {
      const pendingBookings = await getGroupBookings({ status: "pending" });

      expect(pendingBookings).toBeDefined();
      pendingBookings.forEach(booking => {
        expect(booking.status).toBe("pending");
      });
    });

    it("should filter by flightId", async () => {
      const bookings = await getGroupBookings({ flightId: testFlightId });

      expect(bookings).toBeDefined();
      bookings.forEach(booking => {
        expect(booking.flightId).toBe(testFlightId);
      });
    });
  });

  describe("getGroupBookingById", () => {
    it("should return group booking by ID", async () => {
      const booking = await getGroupBookingById(testGroupBookingId);

      expect(booking).toBeDefined();
      expect(booking?.id).toBe(testGroupBookingId);
      expect(booking?.organizerName).toBe("Test Organizer");
    });

    it("should return null for non-existent ID", async () => {
      const booking = await getGroupBookingById(999999999);

      expect(booking).toBeNull();
    });
  });

  describe("approveGroupBooking", () => {
    it("should approve a pending group booking", async () => {
      const adminUserId = 1;
      const discountPercent = 8;

      const result = await approveGroupBooking(
        testGroupBookingId,
        discountPercent,
        adminUserId
      );

      expect(result).toBeDefined();
      expect(result.status).toBe("confirmed");
      expect(parseFloat(result.discountPercent!)).toBe(discountPercent);
      expect(result.totalPrice).toBeDefined();
      expect(result.approvedBy).toBe(adminUserId);
      expect(result.approvedAt).toBeDefined();
    });

    it("should reject approving non-pending booking", async () => {
      await expect(
        approveGroupBooking(testGroupBookingId, 10, 1)
      ).rejects.toThrow("Cannot approve a confirmed group booking");
    });

    it("should reject approving non-existent booking", async () => {
      await expect(approveGroupBooking(999999999, 10, 1)).rejects.toThrow(
        "Group booking request not found"
      );
    });
  });

  describe("rejectGroupBooking", () => {
    let rejectTestBookingId: number;

    beforeAll(async () => {
      // Create a new booking to reject
      const result = await createGroupBookingRequest({
        organizerName: "Reject Test",
        organizerEmail: "reject@example.com",
        organizerPhone: "+966500000003",
        groupSize: 12,
        flightId: testFlightId,
      });
      rejectTestBookingId = result.id;
    });

    it("should reject a pending group booking", async () => {
      const reason = "Not enough seats available for requested date";

      const result = await rejectGroupBooking(rejectTestBookingId, reason);

      expect(result).toBeDefined();
      expect(result.status).toBe("cancelled");
      expect(result.rejectionReason).toBe(reason);
    });

    it("should reject rejecting non-pending booking", async () => {
      await expect(
        rejectGroupBooking(rejectTestBookingId, "Another reason")
      ).rejects.toThrow("Cannot reject a cancelled group booking");
    });

    it("should reject rejecting non-existent booking", async () => {
      await expect(
        rejectGroupBooking(999999999, "Some reason")
      ).rejects.toThrow("Group booking request not found");
    });
  });

  describe("getGroupBookingStats", () => {
    it("should return correct statistics", async () => {
      const stats = await getGroupBookingStats();

      expect(stats).toBeDefined();
      expect(typeof stats.totalRequests).toBe("number");
      expect(typeof stats.pendingRequests).toBe("number");
      expect(typeof stats.confirmedRequests).toBe("number");
      expect(typeof stats.cancelledRequests).toBe("number");
      expect(typeof stats.totalGroupPassengers).toBe("number");

      // Verify counts are non-negative
      expect(stats.totalRequests).toBeGreaterThanOrEqual(0);
      expect(stats.pendingRequests).toBeGreaterThanOrEqual(0);
      expect(stats.confirmedRequests).toBeGreaterThanOrEqual(0);
      expect(stats.cancelledRequests).toBeGreaterThanOrEqual(0);
      expect(stats.totalGroupPassengers).toBeGreaterThanOrEqual(0);

      // Total should equal sum of all statuses
      expect(stats.totalRequests).toBe(
        stats.pendingRequests +
          stats.confirmedRequests +
          stats.cancelledRequests
      );
    });
  });
});
