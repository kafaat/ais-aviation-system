import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import {
  specialServices,
  users,
  flights,
  airlines,
  airports,
  bookings,
  passengers,
} from "../../drizzle/schema";
import * as specialServicesService from "./special-services.service";
import { eq, inArray } from "drizzle-orm";

describe.skipIf(!process.env.DATABASE_URL)("Special Services Service", () => {
  let db: Awaited<ReturnType<typeof getDb>>;
  let testUserId: number;
  let testAirlineId: number;
  let testOriginId: number;
  let testDestinationId: number;
  let testFlightId: number;
  let testBookingId: number;
  let testPassengerId: number;
  let testServiceId: number;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create test user
    const [userResult] = await db.insert(users).values({
      openId: `test-special-services-${Date.now()}`,
      name: "Test User Special Services",
      email: "test-special@services.com",
      loginMethod: "test",
      role: "user",
    });
    testUserId = userResult.insertId;

    // Create test airline
    const [airlineResult] = await db.insert(airlines).values({
      code: "SS",
      name: "Special Services Airlines",
      active: true,
    });
    testAirlineId = airlineResult.insertId;

    // Create test airports
    const [originResult] = await db.insert(airports).values({
      code: "SSO",
      name: "Special Services Origin",
      city: "Origin City",
      country: "Test Country",
    });
    testOriginId = originResult.insertId;

    const [destResult] = await db.insert(airports).values({
      code: "SSD",
      name: "Special Services Destination",
      city: "Dest City",
      country: "Test Country",
    });
    testDestinationId = destResult.insertId;

    // Create test flight
    const [flightResult] = await db.insert(flights).values({
      flightNumber: "SS123",
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
      bookingReference: "SSTST1",
      pnr: "SSTEST",
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
    await db
      .delete(specialServices)
      .where(eq(specialServices.bookingId, testBookingId));
    await db.delete(passengers).where(eq(passengers.bookingId, testBookingId));
    await db.delete(bookings).where(eq(bookings.id, testBookingId));
    await db.delete(flights).where(eq(flights.id, testFlightId));
    await db.delete(airlines).where(eq(airlines.id, testAirlineId));
    await db.delete(airports).where(eq(airports.id, testOriginId));
    await db.delete(airports).where(eq(airports.id, testDestinationId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  describe("getAvailableServices", () => {
    it("should return all available service types", () => {
      const services = specialServicesService.getAvailableServices();

      expect(services).toBeDefined();
      expect(services.meal).toBeDefined();
      expect(services.wheelchair).toBeDefined();
      expect(services.unaccompanied_minor).toBeDefined();
      expect(services.extra_legroom).toBeDefined();
      expect(services.pet_in_cabin).toBeDefined();
      expect(services.medical_assistance).toBeDefined();
    });

    it("should have meal service codes", () => {
      const services = specialServicesService.getAvailableServices();
      const mealCodes = services.meal.map(m => m.code);

      expect(mealCodes).toContain("VGML"); // Vegetarian
      expect(mealCodes).toContain("VVML"); // Vegan
      expect(mealCodes).toContain("MOML"); // Halal
      expect(mealCodes).toContain("KSML"); // Kosher
      expect(mealCodes).toContain("GFML"); // Gluten-free
      expect(mealCodes).toContain("DBML"); // Diabetic
      expect(mealCodes).toContain("CHML"); // Child
    });

    it("should have wheelchair assistance codes", () => {
      const services = specialServicesService.getAvailableServices();
      const wheelchairCodes = services.wheelchair.map(w => w.code);

      expect(wheelchairCodes).toContain("WCHR");
      expect(wheelchairCodes).toContain("WCHS");
      expect(wheelchairCodes).toContain("WCHC");
    });
  });

  describe("requestService", () => {
    it("should create a special service request for a passenger", async () => {
      const service = await specialServicesService.requestService({
        bookingId: testBookingId,
        passengerId: testPassengerId,
        serviceType: "meal",
        serviceCode: "VGML",
        details: { notes: "No onions please" },
      });

      testServiceId = service.id;

      expect(service).toBeDefined();
      expect(service.id).toBeGreaterThan(0);
      expect(service.bookingId).toBe(testBookingId);
      expect(service.passengerId).toBe(testPassengerId);
      expect(service.serviceType).toBe("meal");
      expect(service.serviceCode).toBe("VGML");
      expect(service.status).toBe("pending");
    });

    it("should reject invalid booking ID", async () => {
      await expect(
        specialServicesService.requestService({
          bookingId: 999999,
          passengerId: testPassengerId,
          serviceType: "meal",
          serviceCode: "VGML",
        })
      ).rejects.toThrow("Booking not found");
    });

    it("should reject invalid passenger ID", async () => {
      await expect(
        specialServicesService.requestService({
          bookingId: testBookingId,
          passengerId: 999999,
          serviceType: "meal",
          serviceCode: "VGML",
        })
      ).rejects.toThrow("Passenger not found");
    });

    it("should reject invalid service code for service type", async () => {
      await expect(
        specialServicesService.requestService({
          bookingId: testBookingId,
          passengerId: testPassengerId,
          serviceType: "meal",
          serviceCode: "WCHR", // Wheelchair code for meal type
        })
      ).rejects.toThrow("Invalid service code");
    });

    it("should reject duplicate service request for same type", async () => {
      await expect(
        specialServicesService.requestService({
          bookingId: testBookingId,
          passengerId: testPassengerId,
          serviceType: "meal", // Already requested
          serviceCode: "MOML",
        })
      ).rejects.toThrow("already exists");
    });

    it("should allow different service types for same passenger", async () => {
      const wheelchairService = await specialServicesService.requestService({
        bookingId: testBookingId,
        passengerId: testPassengerId,
        serviceType: "wheelchair",
        serviceCode: "WCHR",
      });

      expect(wheelchairService).toBeDefined();
      expect(wheelchairService.serviceType).toBe("wheelchair");

      // Cleanup
      await db
        .delete(specialServices)
        .where(eq(specialServices.id, wheelchairService.id));
    });
  });

  describe("getBookingServices", () => {
    it("should return all services for a booking with passenger names", async () => {
      const services =
        await specialServicesService.getBookingServices(testBookingId);

      expect(services).toBeDefined();
      expect(services.length).toBeGreaterThan(0);
      expect(services[0].passengerName).toBe("John Doe");
    });

    it("should return empty array for booking with no services", async () => {
      // Create a booking without services
      const [newBookingResult] = await db.insert(bookings).values({
        userId: testUserId,
        flightId: testFlightId,
        bookingReference: "SSTS02",
        pnr: "SSTES2",
        status: "confirmed",
        totalAmount: 50000,
        paymentStatus: "paid",
        cabinClass: "economy",
        numberOfPassengers: 1,
      });

      const services = await specialServicesService.getBookingServices(
        newBookingResult.insertId
      );
      expect(services).toEqual([]);

      // Cleanup
      await db
        .delete(bookings)
        .where(eq(bookings.id, newBookingResult.insertId));
    });
  });

  describe("getServiceById", () => {
    it("should return service by ID", async () => {
      const service =
        await specialServicesService.getServiceById(testServiceId);

      expect(service).toBeDefined();
      expect(service?.id).toBe(testServiceId);
    });

    it("should return null for non-existent service", async () => {
      const service = await specialServicesService.getServiceById(999999);
      expect(service).toBeNull();
    });
  });

  describe("cancelService", () => {
    it("should cancel a service request", async () => {
      // Create a service to cancel
      const newService = await specialServicesService.requestService({
        bookingId: testBookingId,
        passengerId: testPassengerId,
        serviceType: "extra_legroom",
        serviceCode: "EXST",
      });

      const result = await specialServicesService.cancelService(
        newService.id,
        testUserId
      );

      expect(result.success).toBe(true);

      // Verify status changed
      const cancelledService = await specialServicesService.getServiceById(
        newService.id
      );
      expect(cancelledService?.status).toBe("cancelled");
    });

    it("should reject cancellation for already cancelled service", async () => {
      // Create and cancel a service
      const newService = await specialServicesService.requestService({
        bookingId: testBookingId,
        passengerId: testPassengerId,
        serviceType: "pet_in_cabin",
        serviceCode: "PETC",
      });

      await specialServicesService.cancelService(newService.id, testUserId);

      // Try to cancel again
      await expect(
        specialServicesService.cancelService(newService.id, testUserId)
      ).rejects.toThrow("already cancelled");
    });

    it("should reject cancellation by non-owner", async () => {
      // Create another user
      const [otherUserResult] = await db.insert(users).values({
        openId: `test-other-user-${Date.now()}`,
        name: "Other User",
        email: "other@test.com",
        loginMethod: "test",
        role: "user",
      });

      const medicalService = await specialServicesService.requestService({
        bookingId: testBookingId,
        passengerId: testPassengerId,
        serviceType: "medical_assistance",
        serviceCode: "MEDA",
      });

      await expect(
        specialServicesService.cancelService(
          medicalService.id,
          otherUserResult.insertId
        )
      ).rejects.toThrow("not authorized");

      // Cleanup
      await db.delete(users).where(eq(users.id, otherUserResult.insertId));
    });
  });

  describe("updateServiceStatus (admin)", () => {
    it("should update service status", async () => {
      const result = await specialServicesService.updateServiceStatus(
        testServiceId,
        "confirmed",
        "Meal confirmed with catering"
      );

      expect(result.success).toBe(true);

      const updatedService =
        await specialServicesService.getServiceById(testServiceId);
      expect(updatedService?.status).toBe("confirmed");
      expect(updatedService?.adminNotes).toBe("Meal confirmed with catering");
    });

    it("should reject update for non-existent service", async () => {
      await expect(
        specialServicesService.updateServiceStatus(999999, "confirmed")
      ).rejects.toThrow("not found");
    });
  });

  describe("getPassengerServices", () => {
    it("should return services for a specific passenger", async () => {
      const services =
        await specialServicesService.getPassengerServices(testPassengerId);

      expect(services).toBeDefined();
      expect(services.length).toBeGreaterThan(0);
      expect(services.every(s => s.passengerId === testPassengerId)).toBe(true);
    });
  });

  describe("getPendingServices (admin)", () => {
    it("should return all pending service requests", async () => {
      // Create a pending service
      const [passengerResult] = await db.insert(passengers).values({
        bookingId: testBookingId,
        type: "adult",
        title: "Mrs",
        firstName: "Jane",
        lastName: "Doe",
      });

      const pendingService = await specialServicesService.requestService({
        bookingId: testBookingId,
        passengerId: passengerResult.insertId,
        serviceType: "meal",
        serviceCode: "MOML",
      });

      const pendingServices = await specialServicesService.getPendingServices();

      expect(pendingServices).toBeDefined();
      expect(pendingServices.some(s => s.id === pendingService.id)).toBe(true);

      // Cleanup
      await db
        .delete(specialServices)
        .where(eq(specialServices.id, pendingService.id));
      await db
        .delete(passengers)
        .where(eq(passengers.id, passengerResult.insertId));
    });
  });

  describe("bulkUpdateServiceStatus (admin)", () => {
    it("should update multiple service statuses at once", async () => {
      // Create multiple services
      const [passenger1Result] = await db.insert(passengers).values({
        bookingId: testBookingId,
        type: "adult",
        title: "Mr",
        firstName: "Test",
        lastName: "Bulk1",
      });

      const [passenger2Result] = await db.insert(passengers).values({
        bookingId: testBookingId,
        type: "adult",
        title: "Ms",
        firstName: "Test",
        lastName: "Bulk2",
      });

      const service1 = await specialServicesService.requestService({
        bookingId: testBookingId,
        passengerId: passenger1Result.insertId,
        serviceType: "meal",
        serviceCode: "KSML",
      });

      const service2 = await specialServicesService.requestService({
        bookingId: testBookingId,
        passengerId: passenger2Result.insertId,
        serviceType: "meal",
        serviceCode: "GFML",
      });

      const result = await specialServicesService.bulkUpdateServiceStatus(
        [service1.id, service2.id],
        "confirmed",
        "Bulk confirmed"
      );

      expect(result.success).toBe(true);
      expect(result.updated).toBe(2);

      // Verify statuses
      const updated1 = await specialServicesService.getServiceById(service1.id);
      const updated2 = await specialServicesService.getServiceById(service2.id);

      expect(updated1?.status).toBe("confirmed");
      expect(updated2?.status).toBe("confirmed");

      // Cleanup
      await db
        .delete(specialServices)
        .where(inArray(specialServices.id, [service1.id, service2.id]));
      await db
        .delete(passengers)
        .where(
          inArray(passengers.id, [
            passenger1Result.insertId,
            passenger2Result.insertId,
          ])
        );
    });

    it("should handle empty array of service IDs", async () => {
      const result = await specialServicesService.bulkUpdateServiceStatus(
        [],
        "confirmed"
      );

      expect(result.success).toBe(true);
      expect(result.updated).toBe(0);
    });
  });

  describe("getServiceNameByCode", () => {
    it("should return correct service name for valid code", () => {
      const name = specialServicesService.getServiceNameByCode("meal", "VGML");
      expect(name).toBe("Vegetarian Meal");
    });

    it("should return null for invalid code", () => {
      const name = specialServicesService.getServiceNameByCode(
        "meal",
        "INVALID"
      );
      expect(name).toBeNull();
    });
  });

  describe("getServiceDescriptionByCode", () => {
    it("should return correct service description for valid code", () => {
      const description = specialServicesService.getServiceDescriptionByCode(
        "wheelchair",
        "WCHR"
      );
      expect(description).toContain("walk short distances");
    });

    it("should return null for invalid code", () => {
      const description = specialServicesService.getServiceDescriptionByCode(
        "wheelchair",
        "INVALID"
      );
      expect(description).toBeNull();
    });
  });
});
