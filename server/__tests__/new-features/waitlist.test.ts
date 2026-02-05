import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database module
const mockDatabase = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
};

vi.mock("../../db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDatabase),
}));

// Mock drizzle schema
vi.mock("../../../drizzle/schema", () => ({
  waitlist: {
    id: "id",
    flightId: "flightId",
    userId: "userId",
    cabinClass: "cabinClass",
    seats: "seats",
    priority: "priority",
    status: "status",
    offeredAt: "offeredAt",
    offerExpiresAt: "offerExpiresAt",
    confirmedAt: "confirmedAt",
    notifyByEmail: "notifyByEmail",
    notifyBySms: "notifyBySms",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  flights: {
    id: "id",
    economyAvailable: "economyAvailable",
    businessAvailable: "businessAvailable",
  },
  users: {
    id: "id",
    name: "name",
    email: "email",
  },
  airports: {
    id: "id",
    code: "code",
    city: "city",
  },
  airlines: {
    id: "id",
    name: "name",
    logo: "logo",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ type: "eq", a, b })),
  and: vi.fn((...args) => ({ type: "and", args })),
  desc: vi.fn(a => ({ type: "desc", a })),
  asc: vi.fn(a => ({ type: "asc", a })),
  sql: vi.fn((...args) => ({ type: "sql", args })),
}));

describe("Waitlist Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("addToWaitlist", () => {
    it("should add user to waitlist for a full flight", async () => {
      // Setup mock responses
      // First query: Check for existing waitlist entry
      mockDatabase.limit.mockResolvedValueOnce([]);

      // Second query: Check flight exists and get available seats
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          economyAvailable: 0,
          businessAvailable: 5,
        },
      ]);

      // Third query: Get max priority
      mockDatabase.where.mockResolvedValueOnce([{ maxPriority: 3 }]);

      // Fourth: Insert into waitlist
      mockDatabase.values.mockResolvedValueOnce([{ insertId: 1 }]);

      const { addToWaitlist } = await import("../../services/waitlist.service");

      const result = await addToWaitlist(1, 1, 2, "economy");

      expect(result).toBeDefined();
      expect(result.position).toBe(4);
      expect(result.message).toContain("Successfully added to waitlist");
    });

    it("should throw error if user is already on waitlist", async () => {
      // Setup mock - user already on waitlist
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 1,
          cabinClass: "economy",
          status: "waiting",
        },
      ]);

      const { addToWaitlist } = await import("../../services/waitlist.service");

      await expect(addToWaitlist(1, 1, 2, "economy")).rejects.toThrow(
        "You are already on the waitlist for this flight"
      );
    });

    it("should throw error if seats are still available", async () => {
      // First query: No existing entry
      mockDatabase.limit.mockResolvedValueOnce([]);

      // Second query: Flight has available seats
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          economyAvailable: 10,
          businessAvailable: 5,
        },
      ]);

      const { addToWaitlist } = await import("../../services/waitlist.service");

      await expect(addToWaitlist(1, 1, 2, "economy")).rejects.toThrow(
        "Seats are still available"
      );
    });

    it("should throw error if flight not found", async () => {
      // First query: No existing entry
      mockDatabase.limit.mockResolvedValueOnce([]);

      // Second query: Flight not found
      mockDatabase.limit.mockResolvedValueOnce([]);

      const { addToWaitlist } = await import("../../services/waitlist.service");

      await expect(addToWaitlist(1, 999, 2, "economy")).rejects.toThrow(
        "Flight not found"
      );
    });
  });

  describe("getWaitlistPosition", () => {
    it("should return user position in waitlist", async () => {
      // Mock entry exists
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 1,
          cabinClass: "economy",
          priority: 5,
          status: "waiting",
        },
      ]);

      // Mock count of users ahead
      mockDatabase.where.mockResolvedValueOnce([{ count: 4 }]);

      const { getWaitlistPosition } =
        await import("../../services/waitlist.service");

      const result = await getWaitlistPosition(1, 1, "economy");

      expect(result).toBeDefined();
      expect(result.position).toBe(5);
      expect(result.status).toBe("waiting");
    });

    it("should return null if user not on waitlist", async () => {
      // Mock no entry
      mockDatabase.limit.mockResolvedValueOnce([]);

      const { getWaitlistPosition } =
        await import("../../services/waitlist.service");

      const result = await getWaitlistPosition(1, 1, "economy");

      expect(result.position).toBeNull();
      expect(result.status).toBeNull();
      expect(result.entry).toBeNull();
    });
  });

  describe("offerSeat", () => {
    it("should mark waitlist entry as offered", async () => {
      // Mock entry exists and is waiting
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 1,
          cabinClass: "economy",
          status: "waiting",
        },
      ]);

      // Mock update
      mockDatabase.where.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const { offerSeat } = await import("../../services/waitlist.service");

      const result = await offerSeat(1);

      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("should throw error if entry not found", async () => {
      // Mock no entry
      mockDatabase.limit.mockResolvedValueOnce([]);

      const { offerSeat } = await import("../../services/waitlist.service");

      await expect(offerSeat(999)).rejects.toThrow("Waitlist entry not found");
    });

    it("should throw error if entry not in waiting status", async () => {
      // Mock entry exists but not in waiting status
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 1,
          cabinClass: "economy",
          status: "offered",
        },
      ]);

      const { offerSeat } = await import("../../services/waitlist.service");

      await expect(offerSeat(1)).rejects.toThrow("not in waiting status");
    });
  });

  describe("acceptOffer", () => {
    it("should accept offer and return booking info", async () => {
      // Mock entry exists with offered status
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 24);

      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 10,
          cabinClass: "economy",
          seats: 2,
          status: "offered",
          offerExpiresAt: futureDate,
        },
      ]);

      // Mock update
      mockDatabase.where.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const { acceptOffer } = await import("../../services/waitlist.service");

      const result = await acceptOffer(1, 1);

      expect(result.success).toBe(true);
      expect(result.flightId).toBe(10);
      expect(result.cabinClass).toBe("economy");
      expect(result.passengers).toBe(2);
    });

    it("should throw error if offer has expired", async () => {
      // Mock entry with expired offer
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 10,
          cabinClass: "economy",
          seats: 2,
          status: "offered",
          offerExpiresAt: pastDate,
        },
      ]);

      // Mock update for expiring the offer
      mockDatabase.where.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const { acceptOffer } = await import("../../services/waitlist.service");

      await expect(acceptOffer(1, 1)).rejects.toThrow("offer has expired");
    });

    it("should throw error if no active offer", async () => {
      // Mock entry with waiting status (no offer)
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 10,
          cabinClass: "economy",
          status: "waiting",
        },
      ]);

      const { acceptOffer } = await import("../../services/waitlist.service");

      await expect(acceptOffer(1, 1)).rejects.toThrow("No active offer");
    });
  });

  describe("declineOffer", () => {
    it("should decline offer and mark as cancelled", async () => {
      // Mock entry exists with offered status
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 10,
          cabinClass: "economy",
          status: "offered",
        },
      ]);

      // Mock update
      mockDatabase.where.mockResolvedValueOnce([{ affectedRows: 1 }]);

      // Mock processWaitlist (get flight)
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 10,
          economyAvailable: 1,
          businessAvailable: 0,
        },
      ]);

      // Mock processWaitlist queries
      mockDatabase.limit.mockResolvedValueOnce([]);

      const { declineOffer } = await import("../../services/waitlist.service");

      const result = await declineOffer(1, 1);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Offer declined");
    });
  });

  describe("cancelWaitlistEntry", () => {
    it("should cancel waitlist entry", async () => {
      // Mock entry exists
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 10,
          cabinClass: "economy",
          status: "waiting",
        },
      ]);

      // Mock update
      mockDatabase.where.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const { cancelWaitlistEntry } =
        await import("../../services/waitlist.service");

      const result = await cancelWaitlistEntry(1, 1);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Successfully removed from waitlist");
    });

    it("should throw error if entry already cancelled", async () => {
      // Mock entry already cancelled
      mockDatabase.limit.mockResolvedValueOnce([
        {
          id: 1,
          userId: 1,
          flightId: 10,
          cabinClass: "economy",
          status: "cancelled",
        },
      ]);

      const { cancelWaitlistEntry } =
        await import("../../services/waitlist.service");

      await expect(cancelWaitlistEntry(1, 1)).rejects.toThrow(
        "Cannot cancel this waitlist entry"
      );
    });
  });

  describe("getWaitlistStats", () => {
    it("should return waitlist statistics", async () => {
      // Mock counts for each status
      mockDatabase.where.mockResolvedValueOnce([{ count: 50 }]); // waiting
      mockDatabase.where.mockResolvedValueOnce([{ count: 10 }]); // offered
      mockDatabase.where.mockResolvedValueOnce([{ count: 30 }]); // confirmed
      mockDatabase.where.mockResolvedValueOnce([{ count: 5 }]); // expired
      mockDatabase.where.mockResolvedValueOnce([{ avgHours: 12.5 }]); // avg wait time

      const { getWaitlistStats } =
        await import("../../services/waitlist.service");

      const result = await getWaitlistStats();

      expect(result.totalWaiting).toBe(50);
      expect(result.totalOffered).toBe(10);
      expect(result.totalConfirmed).toBe(30);
      expect(result.totalExpired).toBe(5);
      expect(result.avgWaitTime).toBe(12.5);
    });
  });
});
