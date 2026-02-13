import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import {
  baggageItems,
  baggageTracking,
  users,
  flights,
  airlines,
  airports,
  bookings,
  passengers,
} from "../../drizzle/schema";
import * as baggageService from "./baggage.service";
import { eq } from "drizzle-orm";

describe("Baggage Service", () => {
  let db: Awaited<ReturnType<typeof getDb>>;
  let testUserId: number;
  let testAirlineId: number;
  let testOriginId: number;
  let testDestinationId: number;
  let testFlightId: number;
  let testBookingId: number;
  let testPassengerId: number;
  let testBaggageId: number;
  let testTagNumber: string;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create test user
    const [userResult] = await db.insert(users).values({
      openId: `test-baggage-${Date.now()}`,
      name: "Test User Baggage",
      email: "test-baggage@services.com",
      loginMethod: "test",
      role: "user",
    });
    testUserId = userResult.insertId;

    // Create test airline
    const [airlineResult] = await db.insert(airlines).values({
      code: "BG",
      name: "Baggage Airlines",
      active: true,
    });
    testAirlineId = airlineResult.insertId;

    // Create test airports
    const [originResult] = await db.insert(airports).values({
      code: "BGO",
      name: "Baggage Origin",
      city: "Origin City",
      country: "Test Country",
    });
    testOriginId = originResult.insertId;

    const [destResult] = await db.insert(airports).values({
      code: "BGD",
      name: "Baggage Destination",
      city: "Dest City",
      country: "Test Country",
    });
    testDestinationId = destResult.insertId;

    // Create test flight
    const [flightResult] = await db.insert(flights).values({
      flightNumber: "BG123",
      airlineId: testAirlineId,
      originId: testOriginId,
      destinationId: testDestinationId,
      departureTime: new Date(Date.now() + 86400000 * 7), // 7 days in future
      arrivalTime: new Date(Date.now() + 90000000),
      economySeats: 150,
      businessSeats: 20,
      economyPrice: 50000,
      businessPrice: 100000,
      economyAvailable: 150,
      businessAvailable: 20,
    });
    testFlightId = flightResult.insertId;

    // Create test booking
    const [bookingResult] = await db.insert(bookings).values({
      userId: testUserId,
      flightId: testFlightId,
      bookingReference: "BGTST1",
      pnr: "BGTEST",
      status: "confirmed",
      totalAmount: 50000,
      paymentStatus: "paid",
      cabinClass: "economy",
      numberOfPassengers: 1,
    });
    testBookingId = bookingResult.insertId;

    // Create test passenger
    const [passengerResult] = await db.insert(passengers).values({
      bookingId: testBookingId,
      type: "adult",
      title: "Mr",
      firstName: "John",
      lastName: "Doe",
    });
    testPassengerId = passengerResult.insertId;
  });

  afterAll(async () => {
    if (!db) return;
    // Cleanup in reverse order of dependencies
    if (testBaggageId) {
      await db
        .delete(baggageTracking)
        .where(eq(baggageTracking.baggageId, testBaggageId));
      await db.delete(baggageItems).where(eq(baggageItems.id, testBaggageId));
    }
    // Clean up any baggage items created during tests
    await db
      .delete(baggageItems)
      .where(eq(baggageItems.bookingId, testBookingId));
    await db.delete(passengers).where(eq(passengers.bookingId, testBookingId));
    await db.delete(bookings).where(eq(bookings.id, testBookingId));
    await db.delete(flights).where(eq(flights.id, testFlightId));
    await db.delete(airlines).where(eq(airlines.id, testAirlineId));
    await db.delete(airports).where(eq(airports.id, testOriginId));
    await db.delete(airports).where(eq(airports.id, testDestinationId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  describe("generateBaggageTag", () => {
    it("should generate a tag starting with AIS", () => {
      const tag = baggageService.generateBaggageTag();
      expect(tag).toMatch(/^AIS[A-Z0-9]{7}$/);
    });

    it("should generate unique tags", () => {
      const tags = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tags.add(baggageService.generateBaggageTag());
      }
      // With 7 alphanumeric chars, collisions should be extremely rare
      expect(tags.size).toBeGreaterThanOrEqual(95);
    });
  });

  describe("registerBaggage", () => {
    it("should register baggage for a passenger", async () => {
      const baggage = await baggageService.registerBaggage({
        bookingId: testBookingId,
        passengerId: testPassengerId,
        weight: 23,
        description: "Black suitcase with red ribbon",
        specialHandling: "Fragile",
      });

      testBaggageId = baggage.id;
      testTagNumber = baggage.tagNumber;

      expect(baggage).toBeDefined();
      expect(baggage.id).toBeGreaterThan(0);
      expect(baggage.bookingId).toBe(testBookingId);
      expect(baggage.passengerId).toBe(testPassengerId);
      expect(baggage.tagNumber).toMatch(/^AIS[A-Z0-9]{7}$/);
      expect(parseFloat(baggage.weight)).toBe(23);
      expect(baggage.status).toBe("checked_in");
      expect(baggage.description).toBe("Black suitcase with red ribbon");
      expect(baggage.specialHandling).toBe("Fragile");
    });

    it("should reject invalid booking ID", async () => {
      await expect(
        baggageService.registerBaggage({
          bookingId: 999999,
          passengerId: testPassengerId,
          weight: 20,
        })
      ).rejects.toThrow("Booking not found");
    });

    it("should reject invalid passenger ID", async () => {
      await expect(
        baggageService.registerBaggage({
          bookingId: testBookingId,
          passengerId: 999999,
          weight: 20,
        })
      ).rejects.toThrow("Passenger not found");
    });

    it("should reject weight exceeding 32kg", async () => {
      await expect(
        baggageService.registerBaggage({
          bookingId: testBookingId,
          passengerId: testPassengerId,
          weight: 35,
        })
      ).rejects.toThrow("exceeds maximum limit");
    });

    it("should reject weight of 0 or negative", async () => {
      await expect(
        baggageService.registerBaggage({
          bookingId: testBookingId,
          passengerId: testPassengerId,
          weight: 0,
        })
      ).rejects.toThrow("greater than 0");
    });
  });

  describe("trackBaggage", () => {
    it("should return baggage with tracking history", async () => {
      const result = await baggageService.trackBaggage(testTagNumber);

      expect(result.baggage).toBeDefined();
      expect(result.baggage.tagNumber).toBe(testTagNumber);
      expect(result.tracking).toBeDefined();
      expect(result.tracking.length).toBeGreaterThan(0);
      // Initial tracking record should be checked_in
      expect(result.tracking[0].status).toBe("checked_in");
    });

    it("should throw error for non-existent tag", async () => {
      await expect(baggageService.trackBaggage("NONEXISTENT")).rejects.toThrow(
        "Baggage not found"
      );
    });
  });

  describe("updateBaggageStatus", () => {
    it("should update baggage status", async () => {
      const result = await baggageService.updateBaggageStatus({
        tagNumber: testTagNumber,
        location: "Security Checkpoint A",
        status: "security_screening",
        notes: "Cleared security",
      });

      expect(result.success).toBe(true);
      expect(result.baggage.status).toBe("security_screening");
      expect(result.baggage.lastLocation).toBe("Security Checkpoint A");
    });

    it("should create tracking record on status update", async () => {
      const { tracking } = await baggageService.trackBaggage(testTagNumber);

      // Should have at least 2 records now (initial + update)
      expect(tracking.length).toBeGreaterThanOrEqual(2);
      expect(tracking[0].status).toBe("security_screening");
    });

    it("should reject invalid status transition", async () => {
      // Cannot go from security_screening directly to claimed
      await expect(
        baggageService.updateBaggageStatus({
          tagNumber: testTagNumber,
          location: "Carousel 3",
          status: "claimed",
        })
      ).rejects.toThrow("Invalid status transition");
    });

    it("should throw error for non-existent tag", async () => {
      await expect(
        baggageService.updateBaggageStatus({
          tagNumber: "NONEXISTENT",
          location: "Test Location",
          status: "loading",
        })
      ).rejects.toThrow("Baggage not found");
    });
  });

  describe("getPassengerBaggage", () => {
    it("should return all baggage for a passenger", async () => {
      const baggage = await baggageService.getPassengerBaggage(testPassengerId);

      expect(baggage).toBeDefined();
      expect(baggage.length).toBeGreaterThan(0);
      expect(baggage.every(b => b.passengerId === testPassengerId)).toBe(true);
    });

    it("should return empty array for passenger with no baggage", async () => {
      // Create a passenger without baggage
      const [newPassengerResult] = await db.insert(passengers).values({
        bookingId: testBookingId,
        type: "adult",
        title: "Mrs",
        firstName: "Jane",
        lastName: "Doe",
      });

      const baggage = await baggageService.getPassengerBaggage(
        newPassengerResult.insertId
      );
      expect(baggage).toEqual([]);

      // Cleanup
      await db
        .delete(passengers)
        .where(eq(passengers.id, newPassengerResult.insertId));
    });
  });

  describe("getBookingBaggage", () => {
    it("should return all baggage for a booking with passenger names", async () => {
      const baggage = await baggageService.getBookingBaggage(testBookingId);

      expect(baggage).toBeDefined();
      expect(baggage.length).toBeGreaterThan(0);
      expect(baggage[0].passengerName).toBe("John Doe");
    });
  });

  describe("getBaggageByTag", () => {
    it("should return baggage by tag number", async () => {
      const baggage = await baggageService.getBaggageByTag(testTagNumber);

      expect(baggage).toBeDefined();
      expect(baggage?.tagNumber).toBe(testTagNumber);
    });

    it("should return null for non-existent tag", async () => {
      const baggage = await baggageService.getBaggageByTag("NONEXISTENT");
      expect(baggage).toBeNull();
    });
  });

  describe("getBaggageById", () => {
    it("should return baggage by ID", async () => {
      const baggage = await baggageService.getBaggageById(testBaggageId);

      expect(baggage).toBeDefined();
      expect(baggage?.id).toBe(testBaggageId);
    });

    it("should return null for non-existent ID", async () => {
      const baggage = await baggageService.getBaggageById(999999);
      expect(baggage).toBeNull();
    });
  });

  describe("reportLostBaggage", () => {
    let lostBaggageId: number;
    let lostTagNumber: string;

    beforeAll(async () => {
      // Create a new baggage to test lost reporting
      const baggage = await baggageService.registerBaggage({
        bookingId: testBookingId,
        passengerId: testPassengerId,
        weight: 15,
        description: "Red carry-on bag",
      });
      lostBaggageId = baggage.id;
      lostTagNumber = baggage.tagNumber;
    });

    afterAll(async () => {
      if (db && lostBaggageId) {
        await db
          .delete(baggageTracking)
          .where(eq(baggageTracking.baggageId, lostBaggageId));
        await db.delete(baggageItems).where(eq(baggageItems.id, lostBaggageId));
      }
    });

    it("should report baggage as lost", async () => {
      const result = await baggageService.reportLostBaggage({
        tagNumber: lostTagNumber,
        description: "Last seen at carousel 5",
        contactEmail: "test@example.com",
        contactPhone: "+1234567890",
      });

      expect(result.success).toBe(true);
      expect(result.baggage.status).toBe("lost");
      expect(result.baggage.lostReportedAt).toBeDefined();
      expect(result.baggage.lostDescription).toContain(
        "Last seen at carousel 5"
      );
      expect(result.baggage.lostDescription).toContain("test@example.com");
    });

    it("should reject reporting already lost baggage", async () => {
      await expect(
        baggageService.reportLostBaggage({
          tagNumber: lostTagNumber,
          description: "Trying to report again",
        })
      ).rejects.toThrow("already been reported as lost");
    });

    it("should reject reporting non-existent baggage", async () => {
      await expect(
        baggageService.reportLostBaggage({
          tagNumber: "NONEXISTENT",
          description: "Test description",
        })
      ).rejects.toThrow("Baggage not found");
    });
  });

  describe("markBaggageFound", () => {
    let foundBaggageId: number;
    let foundTagNumber: string;

    beforeAll(async () => {
      // Create and mark as lost
      const baggage = await baggageService.registerBaggage({
        bookingId: testBookingId,
        passengerId: testPassengerId,
        weight: 18,
        description: "Blue duffel bag",
      });
      foundBaggageId = baggage.id;
      foundTagNumber = baggage.tagNumber;

      await baggageService.reportLostBaggage({
        tagNumber: foundTagNumber,
        description: "Lost at terminal",
      });
    });

    afterAll(async () => {
      if (db && foundBaggageId) {
        await db
          .delete(baggageTracking)
          .where(eq(baggageTracking.baggageId, foundBaggageId));
        await db
          .delete(baggageItems)
          .where(eq(baggageItems.id, foundBaggageId));
      }
    });

    it("should mark lost baggage as found", async () => {
      const result = await baggageService.markBaggageFound({
        tagNumber: foundTagNumber,
        foundLocation: "Lost and Found Office",
        notes: "Found in storage area",
      });

      expect(result.success).toBe(true);
      expect(result.baggage.status).toBe("found");
      expect(result.baggage.lastLocation).toBe("Lost and Found Office");
    });

    it("should reject marking non-lost baggage as found", async () => {
      // This baggage is now "found", not "lost"
      await expect(
        baggageService.markBaggageFound({
          tagNumber: foundTagNumber,
          foundLocation: "Another location",
        })
      ).rejects.toThrow("Only lost baggage can be marked as found");
    });
  });

  describe("getBaggageStats", () => {
    it("should return baggage statistics", async () => {
      const stats = await baggageService.getBaggageStats();

      expect(stats).toBeDefined();
      expect(typeof stats.totalBaggage).toBe("number");
      expect(typeof stats.checkedIn).toBe("number");
      expect(typeof stats.inTransit).toBe("number");
      expect(typeof stats.claimed).toBe("number");
      expect(typeof stats.lost).toBe("number");
      expect(typeof stats.damaged).toBe("number");
    });
  });

  describe("getLostBaggage", () => {
    it("should return all lost baggage", async () => {
      const lostBaggage = await baggageService.getLostBaggage();

      expect(lostBaggage).toBeDefined();
      expect(Array.isArray(lostBaggage)).toBe(true);
      expect(lostBaggage.every(b => b.status === "lost")).toBe(true);
    });
  });

  describe("getBaggageByStatus", () => {
    it("should return baggage filtered by status", async () => {
      // The main test baggage is in security_screening status
      const baggage =
        await baggageService.getBaggageByStatus("security_screening");

      expect(baggage).toBeDefined();
      expect(Array.isArray(baggage)).toBe(true);
      expect(baggage.every(b => b.status === "security_screening")).toBe(true);
    });
  });

  describe("getAllBaggage", () => {
    it("should return all baggage without filters", async () => {
      const baggage = await baggageService.getAllBaggage();

      expect(baggage).toBeDefined();
      expect(Array.isArray(baggage)).toBe(true);
      expect(baggage.length).toBeGreaterThan(0);
    });

    it("should filter by status", async () => {
      const baggage = await baggageService.getAllBaggage({
        status: "security_screening",
      });

      expect(baggage).toBeDefined();
      expect(baggage.every(b => b.status === "security_screening")).toBe(true);
    });

    it("should filter by booking ID", async () => {
      const baggage = await baggageService.getAllBaggage({
        bookingId: testBookingId,
      });

      expect(baggage).toBeDefined();
      expect(baggage.every(b => b.bookingId === testBookingId)).toBe(true);
    });
  });

  describe("BAGGAGE_STATUS_LABELS", () => {
    it("should have labels for all statuses", () => {
      const labels = baggageService.BAGGAGE_STATUS_LABELS;

      expect(labels.checked_in).toBe("Checked In");
      expect(labels.security_screening).toBe("Security Screening");
      expect(labels.loading).toBe("Loading");
      expect(labels.in_transit).toBe("In Transit");
      expect(labels.arrived).toBe("Arrived");
      expect(labels.customs).toBe("Customs");
      expect(labels.ready_for_pickup).toBe("Ready for Pickup");
      expect(labels.claimed).toBe("Claimed");
      expect(labels.lost).toBe("Lost");
      expect(labels.found).toBe("Found");
      expect(labels.damaged).toBe("Damaged");
    });
  });

  describe("VALID_STATUS_TRANSITIONS", () => {
    it("should have valid transitions defined", () => {
      const transitions = baggageService.VALID_STATUS_TRANSITIONS;

      // checked_in can go to security_screening, lost, damaged
      expect(transitions.checked_in).toContain("security_screening");
      expect(transitions.checked_in).toContain("lost");

      // claimed should have no further transitions
      expect(transitions.claimed).toEqual([]);

      // lost can only go to found
      expect(transitions.lost).toEqual(["found"]);
    });
  });
});
