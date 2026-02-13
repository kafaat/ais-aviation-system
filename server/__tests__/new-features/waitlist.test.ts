import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock database with chainable methods
const createMockDb = () => {
  const results: unknown[][] = [];
  let callIndex = 0;

  const mockDb = {
    _setResults: (...data: unknown[][]) => {
      results.length = 0;
      results.push(...data);
      callIndex = 0;
    },
    _reset: () => {
      callIndex = 0;
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => ({
      ...mockDb,
      then: (resolve: (v: unknown) => void) => {
        const result = results[callIndex++] ?? [];
        resolve(result);
      },
      limit: vi.fn().mockImplementation(() => ({
        then: (resolve: (v: unknown) => void) => {
          const result = results[callIndex++] ?? [];
          resolve(result);
        },
      })),
      orderBy: vi.fn().mockReturnThis(),
    })),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => ({
      then: (resolve: (v: unknown) => void) => {
        const result = results[callIndex++] ?? [];
        resolve(result);
      },
    })),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockImplementation(() => ({
      then: (resolve: (v: unknown) => void) => {
        const result = results[callIndex++] ?? [{ insertId: 1 }];
        resolve(result);
      },
    })),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    transaction: vi
      .fn()
      .mockImplementation((fn: (tx: typeof mockDb) => Promise<unknown>) =>
        fn(mockDb)
      ),
  };

  return mockDb;
};

const mockDb = createMockDb();

// Mock modules before any imports
vi.mock("../../db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

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
  users: { id: "id", name: "name", email: "email" },
  airports: { id: "id", code: "code", city: "city" },
  airlines: { id: "id", name: "name", logo: "logo" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ type: "eq", a, b })),
  and: vi.fn((...args) => ({ type: "and", args })),
  desc: vi.fn(a => ({ type: "desc", a })),
  asc: vi.fn(a => ({ type: "asc", a })),
  sql: vi.fn((...args) => ({ type: "sql", args })),
}));

// Mock TRPCError
vi.mock("@trpc/server", () => ({
  TRPCError: class TRPCError extends Error {
    code: string;
    constructor({ code, message }: { code: string; message: string }) {
      super(message);
      this.code = code;
    }
  },
}));

describe("Waitlist Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._reset();
  });

  describe("addToWaitlist", () => {
    it("should add user to waitlist for a full flight", async () => {
      // Setup: No existing entry, flight with no economy seats, max priority 3
      mockDb._setResults(
        [], // Check existing entry - none found
        [{ id: 1, economyAvailable: 0, businessAvailable: 5 }], // Get flight
        [{ maxPriority: 3 }], // Get max priority
        [{ insertId: 1 }] // Insert result
      );

      // Reset module cache to pick up mocks
      vi.resetModules();
      const { addToWaitlist } = await import("../../services/waitlist.service");

      const result = await addToWaitlist(1, 1, 2, "economy");

      expect(result).toBeDefined();
      expect(result.position).toBe(4);
      expect(result.message).toContain("Successfully added to waitlist");
    });

    it("should throw error if user is already on waitlist", async () => {
      mockDb._setResults([
        {
          id: 1,
          userId: 1,
          flightId: 1,
          cabinClass: "economy",
          status: "waiting",
        },
      ]);

      vi.resetModules();
      const { addToWaitlist } = await import("../../services/waitlist.service");

      await expect(addToWaitlist(1, 1, 2, "economy")).rejects.toThrow(
        "You are already on the waitlist for this flight"
      );
    });

    it("should throw error if seats are still available", async () => {
      mockDb._setResults(
        [], // No existing entry
        [{ id: 1, economyAvailable: 10, businessAvailable: 5 }] // Flight has seats
      );

      vi.resetModules();
      const { addToWaitlist } = await import("../../services/waitlist.service");

      await expect(addToWaitlist(1, 1, 2, "economy")).rejects.toThrow(
        "Seats are still available"
      );
    });

    it("should throw error if flight not found", async () => {
      mockDb._setResults(
        [], // No existing entry
        [] // Flight not found
      );

      vi.resetModules();
      const { addToWaitlist } = await import("../../services/waitlist.service");

      await expect(addToWaitlist(1, 999, 2, "economy")).rejects.toThrow(
        "Flight not found"
      );
    });
  });

  describe("getWaitlistPosition", () => {
    it("should return user position in waitlist", async () => {
      mockDb._setResults(
        [
          {
            id: 1,
            userId: 1,
            flightId: 1,
            cabinClass: "economy",
            priority: 5,
            status: "waiting",
          },
        ],
        [{ count: 4 }]
      );

      vi.resetModules();
      const { getWaitlistPosition } =
        await import("../../services/waitlist.service");

      const result = await getWaitlistPosition(1, 1, "economy");

      expect(result).toBeDefined();
      expect(result.position).toBe(5);
      expect(result.status).toBe("waiting");
    });

    it("should return null if user not on waitlist", async () => {
      mockDb._setResults([]);

      vi.resetModules();
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
      mockDb._setResults(
        [
          {
            id: 1,
            userId: 1,
            flightId: 1,
            cabinClass: "economy",
            status: "waiting",
          },
        ],
        [{ affectedRows: 1 }]
      );

      vi.resetModules();
      const { offerSeat } = await import("../../services/waitlist.service");

      const result = await offerSeat(1);

      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("should throw error if entry not found", async () => {
      mockDb._setResults([]);

      vi.resetModules();
      const { offerSeat } = await import("../../services/waitlist.service");

      await expect(offerSeat(999)).rejects.toThrow("Waitlist entry not found");
    });

    it("should throw error if entry not in waiting status", async () => {
      mockDb._setResults([
        {
          id: 1,
          userId: 1,
          flightId: 1,
          cabinClass: "economy",
          status: "offered",
        },
      ]);

      vi.resetModules();
      const { offerSeat } = await import("../../services/waitlist.service");

      await expect(offerSeat(1)).rejects.toThrow("not in waiting status");
    });
  });

  describe("acceptOffer", () => {
    it("should accept offer and return booking info", async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 24);

      mockDb._setResults(
        [
          {
            id: 1,
            userId: 1,
            flightId: 10,
            cabinClass: "economy",
            seats: 2,
            status: "offered",
            offerExpiresAt: futureDate,
          },
        ],
        [{ affectedRows: 1 }]
      );

      vi.resetModules();
      const { acceptOffer } = await import("../../services/waitlist.service");

      const result = await acceptOffer(1, 1);

      expect(result.success).toBe(true);
      expect(result.flightId).toBe(10);
      expect(result.cabinClass).toBe("economy");
      expect(result.passengers).toBe(2);
    });

    it("should throw error if offer has expired", async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      mockDb._setResults(
        [
          {
            id: 1,
            userId: 1,
            flightId: 10,
            cabinClass: "economy",
            seats: 2,
            status: "offered",
            offerExpiresAt: pastDate,
          },
        ],
        [{ affectedRows: 1 }]
      );

      vi.resetModules();
      const { acceptOffer } = await import("../../services/waitlist.service");

      await expect(acceptOffer(1, 1)).rejects.toThrow("offer has expired");
    });

    it("should throw error if no active offer", async () => {
      mockDb._setResults([
        {
          id: 1,
          userId: 1,
          flightId: 10,
          cabinClass: "economy",
          status: "waiting",
        },
      ]);

      vi.resetModules();
      const { acceptOffer } = await import("../../services/waitlist.service");

      await expect(acceptOffer(1, 1)).rejects.toThrow("No active offer");
    });
  });

  describe("declineOffer", () => {
    it("should decline offer and mark as cancelled", async () => {
      mockDb._setResults(
        [
          {
            id: 1,
            userId: 1,
            flightId: 10,
            cabinClass: "economy",
            status: "offered",
          },
        ],
        [{ affectedRows: 1 }],
        [{ id: 10, economyAvailable: 1, businessAvailable: 0 }],
        []
      );

      vi.resetModules();
      const { declineOffer } = await import("../../services/waitlist.service");

      const result = await declineOffer(1, 1);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Offer declined");
    });
  });

  describe("cancelWaitlistEntry", () => {
    it("should cancel waitlist entry", async () => {
      mockDb._setResults(
        [
          {
            id: 1,
            userId: 1,
            flightId: 10,
            cabinClass: "economy",
            status: "waiting",
          },
        ],
        [{ affectedRows: 1 }]
      );

      vi.resetModules();
      const { cancelWaitlistEntry } =
        await import("../../services/waitlist.service");

      const result = await cancelWaitlistEntry(1, 1);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Successfully removed from waitlist");
    });

    it("should throw error if entry already cancelled", async () => {
      mockDb._setResults([
        {
          id: 1,
          userId: 1,
          flightId: 10,
          cabinClass: "economy",
          status: "cancelled",
        },
      ]);

      vi.resetModules();
      const { cancelWaitlistEntry } =
        await import("../../services/waitlist.service");

      await expect(cancelWaitlistEntry(1, 1)).rejects.toThrow(
        "Cannot cancel this waitlist entry"
      );
    });
  });

  describe("getWaitlistStats", () => {
    it("should return waitlist statistics", async () => {
      mockDb._setResults(
        [{ count: 50 }], // waiting
        [{ count: 10 }], // offered
        [{ count: 30 }], // confirmed
        [{ count: 5 }], // expired
        [{ avgHours: 12.5 }] // avg wait time
      );

      vi.resetModules();
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
