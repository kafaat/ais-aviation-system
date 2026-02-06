import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import {
  corporateAccounts,
  corporateUsers,
  corporateBookings,
  users,
  bookings,
  flights,
  airlines,
  airports,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  createCorporateAccount,
  getCorporateAccountById,
  getCorporateAccounts,
  activateCorporateAccount,
  suspendCorporateAccount,
  updateCorporateAccount,
  addUserToCorporate,
  getCorporateUsers,
  getUserCorporateAccount,
  removeUserFromCorporate,
  updateCorporateUserRole,
  createCorporateBooking,
  approveCorporateBooking,
  rejectCorporateBooking,
  getCorporateBookings,
  getCorporateStats,
} from "./corporate.service";

describe("Corporate Service", () => {
  // Test data IDs
  let testCorporateAccountId: number;
  let testUserId: number;
  let testAdminUserId: number;
  let testCorporateUserId: number;
  let testFlightId: number;
  let testBookingId: number;
  let testCorporateBookingId: number;

  const testAirlineId = 999801;
  const testOriginId = 999802;
  const testDestinationId = 999803;

  // Short unique suffix for varchar(6) fields
  const shortId = String(Date.now()).slice(-3);

  beforeAll(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available for tests");
    }

    // Create test users
    const timestamp = Date.now();
    const userResult = await db.insert(users).values({
      email: `corporate-test-${timestamp}@example.com`,
      name: "Corporate Test User",
      role: "user",
      openId: `test-corporate-user-${timestamp}`,
    });
    testUserId =
      (userResult as any).insertId || (userResult as any)[0]?.insertId;

    const adminUserResult = await db.insert(users).values({
      email: `corporate-admin-${timestamp}@example.com`,
      name: "Corporate Admin User",
      role: "admin",
      openId: `test-corporate-admin-${timestamp}`,
    });
    testAdminUserId =
      (adminUserResult as any).insertId ||
      (adminUserResult as any)[0]?.insertId;

    // Create test airline
    await db.insert(airlines).values({
      id: testAirlineId,
      code: "TC9",
      name: "Test Corporate Airline",
      active: true,
    });

    // Create test airports
    await db.insert(airports).values([
      {
        id: testOriginId,
        code: "TC1",
        name: "Test Corporate Origin",
        city: "Test City 1",
        country: "Saudi Arabia",
      },
      {
        id: testDestinationId,
        code: "TC2",
        name: "Test Corporate Destination",
        city: "Test City 2",
        country: "Saudi Arabia",
      },
    ]);

    // Create test flight
    const flightResult = await db.insert(flights).values({
      flightNumber: "TC999",
      airlineId: testAirlineId,
      originId: testOriginId,
      destinationId: testDestinationId,
      departureTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      arrivalTime: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000
      ),
      economySeats: 150,
      businessSeats: 30,
      economyPrice: 50000,
      businessPrice: 150000,
      economyAvailable: 150,
      businessAvailable: 30,
      status: "scheduled",
    });
    testFlightId =
      (flightResult as any).insertId || (flightResult as any)[0]?.insertId;
  });

  afterAll(async () => {
    const db = await getDb();
    if (db) {
      // Cleanup test data in correct order
      if (testCorporateBookingId) {
        await db
          .delete(corporateBookings)
          .where(eq(corporateBookings.id, testCorporateBookingId));
      }
      if (testBookingId) {
        await db.delete(bookings).where(eq(bookings.id, testBookingId));
      }
      if (testCorporateUserId) {
        await db
          .delete(corporateUsers)
          .where(eq(corporateUsers.id, testCorporateUserId));
      }
      if (testCorporateAccountId) {
        await db
          .delete(corporateAccounts)
          .where(eq(corporateAccounts.id, testCorporateAccountId));
      }
      await db.delete(flights).where(eq(flights.id, testFlightId));
      await db.delete(airports).where(eq(airports.id, testOriginId));
      await db.delete(airports).where(eq(airports.id, testDestinationId));
      await db.delete(airlines).where(eq(airlines.id, testAirlineId));
      await db.delete(users).where(eq(users.id, testUserId));
      await db.delete(users).where(eq(users.id, testAdminUserId));
    }
  });

  describe("createCorporateAccount", () => {
    it("should create a corporate account successfully", async () => {
      const result = await createCorporateAccount({
        companyName: "Test Corporation",
        taxId: "TAX-12345-TEST",
        address: "123 Test Street",
        contactName: "John Test",
        contactEmail: "john@testcorp.com",
        contactPhone: "+966500000000",
      });

      expect(result).toBeDefined();
      expect(result.id).toBeGreaterThan(0);
      expect(result.companyName).toBe("Test Corporation");
      expect(result.taxId).toBe("TAX-12345-TEST");
      expect(result.status).toBe("pending");

      testCorporateAccountId = result.id;
    });

    it("should reject duplicate tax ID", async () => {
      await expect(
        createCorporateAccount({
          companyName: "Another Corp",
          taxId: "TAX-12345-TEST", // Same as above
          contactName: "Jane Test",
          contactEmail: "jane@anothercorp.com",
        })
      ).rejects.toThrow("A corporate account with this tax ID already exists");
    });

    it("should create account with custom credit limit and discount", async () => {
      const result = await createCorporateAccount({
        companyName: "Premium Corp",
        taxId: "TAX-PREMIUM-001",
        contactName: "Premium Contact",
        contactEmail: "premium@corp.com",
        creditLimit: 100000,
        discountPercent: 10,
      });

      expect(result.creditLimit).toBe(100000);
      expect(Number(result.discountPercent)).toBe(10);

      // Cleanup
      const db = await getDb();
      if (db) {
        await db
          .delete(corporateAccounts)
          .where(eq(corporateAccounts.id, result.id));
      }
    });
  });

  describe("getCorporateAccountById", () => {
    it("should return corporate account by ID", async () => {
      const account = await getCorporateAccountById(testCorporateAccountId);

      expect(account).toBeDefined();
      expect(account?.id).toBe(testCorporateAccountId);
      expect(account?.companyName).toBe("Test Corporation");
    });

    it("should return null for non-existent ID", async () => {
      const account = await getCorporateAccountById(999999999);

      expect(account).toBeNull();
    });
  });

  describe("getCorporateAccounts", () => {
    it("should return all corporate accounts", async () => {
      const accounts = await getCorporateAccounts();

      expect(accounts).toBeDefined();
      expect(Array.isArray(accounts)).toBe(true);
      expect(accounts.length).toBeGreaterThan(0);
    });

    it("should filter by status", async () => {
      const pendingAccounts = await getCorporateAccounts({ status: "pending" });

      expect(pendingAccounts).toBeDefined();
      pendingAccounts.forEach(account => {
        expect(account.status).toBe("pending");
      });
    });
  });

  describe("activateCorporateAccount", () => {
    it("should activate a pending corporate account", async () => {
      const result = await activateCorporateAccount(
        testCorporateAccountId,
        testAdminUserId
      );

      expect(result).toBeDefined();
      expect(result.status).toBe("active");
      expect(result.approvedBy).toBe(testAdminUserId);
      expect(result.approvedAt).toBeDefined();
    });

    it("should reject activating already active account", async () => {
      await expect(
        activateCorporateAccount(testCorporateAccountId, testAdminUserId)
      ).rejects.toThrow("Corporate account is already active");
    });

    it("should reject activating non-existent account", async () => {
      await expect(
        activateCorporateAccount(999999999, testAdminUserId)
      ).rejects.toThrow("Corporate account not found");
    });
  });

  describe("suspendCorporateAccount", () => {
    let suspendTestAccountId: number;

    beforeAll(async () => {
      // Create and activate an account to suspend
      const account = await createCorporateAccount({
        companyName: "Suspend Test Corp",
        taxId: "TAX-SUSPEND-001",
        contactName: "Suspend Test",
        contactEmail: "suspend@test.com",
      });
      suspendTestAccountId = account.id;
      await activateCorporateAccount(suspendTestAccountId, testAdminUserId);
    });

    afterAll(async () => {
      const db = await getDb();
      if (db) {
        await db
          .delete(corporateAccounts)
          .where(eq(corporateAccounts.id, suspendTestAccountId));
      }
    });

    it("should suspend an active corporate account", async () => {
      const result = await suspendCorporateAccount(suspendTestAccountId);

      expect(result).toBeDefined();
      expect(result.status).toBe("suspended");
    });

    it("should reject suspending non-existent account", async () => {
      await expect(suspendCorporateAccount(999999999)).rejects.toThrow(
        "Corporate account not found"
      );
    });
  });

  describe("updateCorporateAccount", () => {
    it("should update corporate account settings", async () => {
      const result = await updateCorporateAccount(testCorporateAccountId, {
        creditLimit: 200000,
        discountPercent: 15,
      });

      expect(result).toBeDefined();
      expect(result.creditLimit).toBe(200000);
      expect(Number(result.discountPercent)).toBe(15);
    });

    it("should update contact information", async () => {
      const result = await updateCorporateAccount(testCorporateAccountId, {
        contactName: "Updated Contact",
        contactEmail: "updated@testcorp.com",
      });

      expect(result.contactName).toBe("Updated Contact");
      expect(result.contactEmail).toBe("updated@testcorp.com");
    });

    it("should reject updating non-existent account", async () => {
      await expect(
        updateCorporateAccount(999999999, { creditLimit: 100000 })
      ).rejects.toThrow("Corporate account not found");
    });
  });

  describe("addUserToCorporate", () => {
    it("should add a user to corporate account", async () => {
      const result = await addUserToCorporate({
        corporateAccountId: testCorporateAccountId,
        userId: testUserId,
        role: "admin",
      });

      expect(result).toBeDefined();
      expect(result.id).toBeGreaterThan(0);
      expect(result.corporateAccountId).toBe(testCorporateAccountId);
      expect(result.userId).toBe(testUserId);
      expect(result.role).toBe("admin");

      testCorporateUserId = result.id;
    });

    it("should reject adding user to non-existent account", async () => {
      await expect(
        addUserToCorporate({
          corporateAccountId: 999999999,
          userId: testUserId,
          role: "traveler",
        })
      ).rejects.toThrow("Corporate account not found");
    });

    it("should reject adding non-existent user", async () => {
      await expect(
        addUserToCorporate({
          corporateAccountId: testCorporateAccountId,
          userId: 999999999,
          role: "traveler",
        })
      ).rejects.toThrow("User not found");
    });

    it("should reject adding user already in a corporate account", async () => {
      await expect(
        addUserToCorporate({
          corporateAccountId: testCorporateAccountId,
          userId: testUserId,
          role: "booker",
        })
      ).rejects.toThrow("User is already a member of a corporate account");
    });
  });

  describe("getCorporateUsers", () => {
    it("should return users in corporate account", async () => {
      const users = await getCorporateUsers(testCorporateAccountId);

      expect(users).toBeDefined();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
      expect(users[0].user).toBeDefined();
      expect(users[0].user.email).toContain("corporate-test-");
    });
  });

  describe("getUserCorporateAccount", () => {
    it("should return user's corporate account", async () => {
      const account = await getUserCorporateAccount(testUserId);

      expect(account).toBeDefined();
      expect(account?.id).toBe(testCorporateAccountId);
      expect(account?.role).toBe("admin");
    });

    it("should return null for user without corporate account", async () => {
      const account = await getUserCorporateAccount(testAdminUserId);

      expect(account).toBeNull();
    });
  });

  describe("updateCorporateUserRole", () => {
    it("should update user role", async () => {
      const result = await updateCorporateUserRole(
        testCorporateUserId,
        "booker"
      );

      expect(result).toBeDefined();
      expect(result.role).toBe("booker");
    });
  });

  describe("Corporate Booking Flow", () => {
    beforeAll(async () => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available for tests");
      }

      // Update user role back to admin for booking approval tests
      await updateCorporateUserRole(testCorporateUserId, "admin");

      // Create test booking
      const bookingResult = await db.insert(bookings).values({
        bookingReference: `CP${shortId}`,
        pnr: `CP${shortId}`,
        userId: testUserId,
        flightId: testFlightId,
        status: "pending",
        paymentStatus: "pending",
        totalAmount: 50000,
        cabinClass: "economy",
        numberOfPassengers: 1,
      });
      testBookingId =
        (bookingResult as any).insertId || (bookingResult as any)[0]?.insertId;
    });

    it("should create a corporate booking", async () => {
      const result = await createCorporateBooking({
        corporateAccountId: testCorporateAccountId,
        bookingId: testBookingId,
        costCenter: "IT-001",
        projectCode: "PROJ-2024-001",
        travelPurpose: "Business meeting",
        bookedByUserId: testUserId,
      });

      expect(result).toBeDefined();
      expect(result.id).toBeGreaterThan(0);
      expect(result.corporateAccountId).toBe(testCorporateAccountId);
      expect(result.bookingId).toBe(testBookingId);
      expect(result.costCenter).toBe("IT-001");
      expect(result.projectCode).toBe("PROJ-2024-001");
      expect(result.approvalStatus).toBe("pending");

      testCorporateBookingId = result.id;
    });

    it("should get corporate bookings", async () => {
      const bookings = await getCorporateBookings(testCorporateAccountId);

      expect(bookings).toBeDefined();
      expect(Array.isArray(bookings)).toBe(true);
      expect(bookings.length).toBeGreaterThan(0);
      expect(bookings[0].booking).toBeDefined();
      expect(bookings[0].flight).toBeDefined();
    });

    it("should filter bookings by approval status", async () => {
      const pendingBookings = await getCorporateBookings(
        testCorporateAccountId,
        { approvalStatus: "pending" }
      );

      expect(pendingBookings).toBeDefined();
      pendingBookings.forEach(booking => {
        expect(booking.approvalStatus).toBe("pending");
      });
    });

    it("should filter bookings by cost center", async () => {
      const bookings = await getCorporateBookings(testCorporateAccountId, {
        costCenter: "IT-001",
      });

      expect(bookings).toBeDefined();
      bookings.forEach(booking => {
        expect(booking.costCenter).toBe("IT-001");
      });
    });

    it("should approve a corporate booking", async () => {
      const result = await approveCorporateBooking(
        testCorporateBookingId,
        testUserId
      );

      expect(result).toBeDefined();
      expect(result.approvalStatus).toBe("approved");
      expect(result.approvedBy).toBe(testUserId);
      expect(result.approvedAt).toBeDefined();
    });

    it("should reject approving already approved booking", async () => {
      await expect(
        approveCorporateBooking(testCorporateBookingId, testUserId)
      ).rejects.toThrow("Cannot approve a approved booking");
    });
  });

  describe("rejectCorporateBooking", () => {
    let rejectTestBookingId: number;
    let rejectTestCorporateBookingId: number;

    beforeAll(async () => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available for tests");
      }

      // Create test booking to reject
      const bookingResult = await db.insert(bookings).values({
        bookingReference: `CJ${shortId}`,
        pnr: `CJ${shortId}`,
        userId: testUserId,
        flightId: testFlightId,
        status: "pending",
        paymentStatus: "pending",
        totalAmount: 50000,
        cabinClass: "economy",
        numberOfPassengers: 1,
      });
      rejectTestBookingId =
        (bookingResult as any).insertId || (bookingResult as any)[0]?.insertId;

      const corpBooking = await createCorporateBooking({
        corporateAccountId: testCorporateAccountId,
        bookingId: rejectTestBookingId,
        costCenter: "REJECT-001",
        bookedByUserId: testUserId,
      });
      rejectTestCorporateBookingId = corpBooking.id;
    });

    afterAll(async () => {
      const db = await getDb();
      if (db) {
        await db
          .delete(corporateBookings)
          .where(eq(corporateBookings.id, rejectTestCorporateBookingId));
        await db.delete(bookings).where(eq(bookings.id, rejectTestBookingId));
      }
    });

    it("should reject a corporate booking", async () => {
      const reason = "Budget constraints";
      const result = await rejectCorporateBooking(
        rejectTestCorporateBookingId,
        testUserId,
        reason
      );

      expect(result).toBeDefined();
      expect(result.approvalStatus).toBe("rejected");
      expect(result.rejectionReason).toBe(reason);
      expect(result.approvedBy).toBe(testUserId);
    });

    it("should reject rejecting already rejected booking", async () => {
      await expect(
        rejectCorporateBooking(
          rejectTestCorporateBookingId,
          testUserId,
          "Another reason"
        )
      ).rejects.toThrow("Cannot reject a rejected booking");
    });
  });

  describe("getCorporateStats", () => {
    it("should return corporate account statistics", async () => {
      const stats = await getCorporateStats(testCorporateAccountId);

      expect(stats).toBeDefined();
      expect(typeof stats.totalBookings).toBe("number");
      expect(typeof stats.pendingApprovals).toBe("number");
      expect(typeof stats.approvedBookings).toBe("number");
      expect(typeof stats.rejectedBookings).toBe("number");
      expect(typeof stats.totalSpent).toBe("number");
      expect(typeof stats.userCount).toBe("number");
      expect(typeof stats.creditRemaining).toBe("number");

      expect(stats.totalBookings).toBeGreaterThanOrEqual(0);
      expect(stats.userCount).toBeGreaterThan(0);
    });

    it("should reject for non-existent account", async () => {
      await expect(getCorporateStats(999999999)).rejects.toThrow(
        "Corporate account not found"
      );
    });
  });

  describe("removeUserFromCorporate", () => {
    it("should remove user from corporate account", async () => {
      await removeUserFromCorporate(testCorporateUserId);

      // Verify user is removed (isActive = false)
      const account = await getUserCorporateAccount(testUserId);
      expect(account).toBeNull();
    });
  });
});
