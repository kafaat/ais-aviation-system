import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module - factory function can't reference outer variables
vi.mock("../../db", () => {
  const mockDb = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return {
    getDb: vi.fn().mockResolvedValue(mockDb),
    getUserByEmail: vi
      .fn()
      .mockResolvedValue({ id: 1, email: "test@test.com" }),
    getUserByOpenId: vi.fn().mockResolvedValue({ id: 2, openId: "abc123" }),
    __mockDb: mockDb,
  };
});

// Mock logger
vi.mock("../../services/logger.service", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock drizzle schema
vi.mock("../../../drizzle/schema", () => ({
  loginAttempts: {
    email: "email",
    openId: "openId",
    ipAddress: "ipAddress",
    userAgent: "userAgent",
    success: "success",
    failureReason: "failureReason",
    attemptedAt: "attemptedAt",
  },
  accountLocks: {
    userId: "userId",
    reason: "reason",
    lockedBy: "lockedBy",
    isActive: "isActive",
    autoUnlockAt: "autoUnlockAt",
    createdAt: "createdAt",
    unlockedAt: "unlockedAt",
    unlockedBy: "unlockedBy",
  },
  securityEvents: {
    eventType: "eventType",
    severity: "severity",
    userId: "userId",
    ipAddress: "ipAddress",
    userAgent: "userAgent",
    description: "description",
    metadata: "metadata",
    actionTaken: "actionTaken",
    createdAt: "createdAt",
  },
  ipBlacklist: {
    ipAddress: "ipAddress",
    reason: "reason",
    blockedBy: "blockedBy",
    isActive: "isActive",
    autoUnblockAt: "autoUnblockAt",
    unblockedAt: "unblockedAt",
    unblockedBy: "unblockedBy",
  },
}));

// Import the mock db reference and service functions
import { __mockDb } from "../../db";
import {
  recordLoginAttempt,
  lockAccount,
  unlockAccount,
  isAccountLocked,
  blockIpAddress,
  isIpBlocked,
  unblockIpAddress,
  recordSecurityEvent,
  getRecentSecurityEvents,
  cleanupOldLoginAttempts,
} from "../../services/account-lock.service";

const mockDb = __mockDb as any;

describe("Account Lock Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock behaviors
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValue(undefined);
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  });

  describe("recordLoginAttempt", () => {
    it("should record a successful login attempt", async () => {
      await recordLoginAttempt({
        email: "user@example.com",
        ipAddress: "192.168.1.1",
        success: true,
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "user@example.com",
          ipAddress: "192.168.1.1",
          success: true,
        })
      );
    });

    it("should record a failed login attempt", async () => {
      await recordLoginAttempt({
        email: "user@example.com",
        ipAddress: "192.168.1.1",
        success: false,
        failureReason: "Invalid password",
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          failureReason: "Invalid password",
        })
      );
    });

    it("should include user agent when provided", async () => {
      await recordLoginAttempt({
        email: "user@example.com",
        ipAddress: "10.0.0.1",
        userAgent: "Mozilla/5.0",
        success: true,
      });

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent: "Mozilla/5.0",
        })
      );
    });
  });

  describe("lockAccount", () => {
    it("should create an account lock", async () => {
      await lockAccount(1, "Suspicious activity");

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          reason: "Suspicious activity",
          lockedBy: "system",
        })
      );
    });

    it("should set auto-unlock time when specified", async () => {
      const before = new Date();
      await lockAccount(1, "Too many failed attempts", "system", 30);

      const call = mockDb.values.mock.calls[0][0];
      expect(call.autoUnlockAt).toBeDefined();
      expect(call.autoUnlockAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime() + 29 * 60 * 1000
      );
    });

    it("should allow custom lockedBy value", async () => {
      await lockAccount(1, "Manual lock", "admin:john@example.com");

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          lockedBy: "admin:john@example.com",
        })
      );
    });
  });

  describe("isAccountLocked", () => {
    it("should return false if no active locks exist", async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await isAccountLocked(1);
      expect(result).toBe(false);
    });

    it("should return true if active lock exists without auto-unlock", async () => {
      mockDb.limit.mockResolvedValue([
        { userId: 1, isActive: true, autoUnlockAt: null },
      ]);

      const result = await isAccountLocked(1);
      expect(result).toBe(true);
    });

    it("should return false and auto-unlock if lock has expired", async () => {
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - 10);

      mockDb.limit.mockResolvedValue([
        { userId: 1, isActive: true, autoUnlockAt: pastDate },
      ]);

      const result = await isAccountLocked(1);
      expect(result).toBe(false);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should return true if auto-unlock time is in the future", async () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 20);

      mockDb.limit.mockResolvedValue([
        { userId: 1, isActive: true, autoUnlockAt: futureDate },
      ]);

      const result = await isAccountLocked(1);
      expect(result).toBe(true);
    });
  });

  describe("unlockAccount", () => {
    it("should deactivate active locks for user", async () => {
      await unlockAccount(1, "admin");

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: false,
          unlockedBy: "admin",
        })
      );
    });
  });

  describe("blockIpAddress", () => {
    it("should block an IP address", async () => {
      await blockIpAddress("10.0.0.1", "Brute force attack");

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: "10.0.0.1",
          reason: "Brute force attack",
          blockedBy: "system",
        })
      );
    });

    it("should set auto-unblock time when specified", async () => {
      await blockIpAddress("10.0.0.1", "Rate limit", "system", 60);

      const call = mockDb.values.mock.calls[0][0];
      expect(call.autoUnblockAt).toBeDefined();
    });
  });

  describe("isIpBlocked", () => {
    it("should return false if IP is not blocked", async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await isIpBlocked("10.0.0.1");
      expect(result).toBe(false);
    });

    it("should return true if IP has active block", async () => {
      mockDb.limit.mockResolvedValue([
        { ipAddress: "10.0.0.1", isActive: true, autoUnblockAt: null },
      ]);

      const result = await isIpBlocked("10.0.0.1");
      expect(result).toBe(true);
    });

    it("should auto-unblock expired IP blocks", async () => {
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - 5);

      mockDb.limit.mockResolvedValue([
        { ipAddress: "10.0.0.1", isActive: true, autoUnblockAt: pastDate },
      ]);

      const result = await isIpBlocked("10.0.0.1");
      expect(result).toBe(false);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe("unblockIpAddress", () => {
    it("should deactivate IP block", async () => {
      await unblockIpAddress("10.0.0.1", "admin");

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: false,
          unblockedBy: "admin",
        })
      );
    });
  });

  describe("recordSecurityEvent", () => {
    it("should record a security event", async () => {
      await recordSecurityEvent({
        eventType: "account_locked",
        severity: "high",
        userId: 1,
        ipAddress: "10.0.0.1",
        description: "Account locked due to brute force",
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "account_locked",
          severity: "high",
          userId: 1,
        })
      );
    });
  });

  describe("getRecentSecurityEvents", () => {
    it("should fetch events with default limit", async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await getRecentSecurityEvents();
      expect(result).toEqual([]);
      expect(mockDb.limit).toHaveBeenCalledWith(50);
    });

    it("should fetch events with custom limit", async () => {
      mockDb.limit.mockResolvedValue([]);

      await getRecentSecurityEvents(10);
      expect(mockDb.limit).toHaveBeenCalledWith(10);
    });
  });

  describe("cleanupOldLoginAttempts", () => {
    it("should delete old login attempts", async () => {
      mockDb.where.mockResolvedValue({ rowsAffected: 5 });

      const count = await cleanupOldLoginAttempts(30);
      expect(mockDb.delete).toHaveBeenCalled();
      expect(count).toBe(5);
    });

    it("should return 0 when no rows affected", async () => {
      mockDb.where.mockResolvedValue({});

      const count = await cleanupOldLoginAttempts();
      expect(count).toBe(0);
    });
  });
});
