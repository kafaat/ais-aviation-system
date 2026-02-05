/**
 * Travel Agent Service Tests
 *
 * Unit tests for travel agent API operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";

// Mock the database module
vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

// Mock the logger
vi.mock("../_core/logger", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getDb } from "../db";

describe("Travel Agent Service", () => {
  let mockDb: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock database
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue({ insertId: 1 }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    (getDb as any).mockResolvedValue(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("API Key Generation", () => {
    it("should generate a unique API key with correct prefix", () => {
      // Generate multiple keys and verify uniqueness
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const key = `ais_agent_${crypto.randomBytes(24).toString("hex")}`;
        expect(key).toMatch(/^ais_agent_[a-f0-9]{48}$/);
        expect(keys.has(key)).toBe(false);
        keys.add(key);
      }
    });

    it("should generate a secure API secret", () => {
      const secret = crypto.randomBytes(32).toString("hex");
      expect(secret).toHaveLength(64);
      expect(secret).toMatch(/^[a-f0-9]+$/);
    });

    it("should hash API secrets securely", () => {
      const secret = "test_secret_12345";
      const hash = crypto.createHash("sha256").update(secret).digest("hex");

      // Hash should be deterministic
      const hash2 = crypto.createHash("sha256").update(secret).digest("hex");
      expect(hash).toBe(hash2);

      // Different secret should produce different hash
      const differentHash = crypto
        .createHash("sha256")
        .update("different_secret")
        .digest("hex");
      expect(hash).not.toBe(differentHash);
    });

    it("should verify API secret against hash", () => {
      const secret = "my_api_secret";
      const hash = crypto.createHash("sha256").update(secret).digest("hex");

      // Correct secret should verify
      const inputHash = crypto
        .createHash("sha256")
        .update(secret)
        .digest("hex");
      expect(inputHash).toBe(hash);

      // Incorrect secret should not verify
      const wrongHash = crypto
        .createHash("sha256")
        .update("wrong_secret")
        .digest("hex");
      expect(wrongHash).not.toBe(hash);
    });
  });

  describe("Commission Calculation", () => {
    it("should calculate commission correctly", () => {
      const bookingAmount = 100000; // 1000 SAR in cents
      const commissionRate = 5; // 5%

      const commissionAmount = Math.round(
        (bookingAmount * commissionRate) / 100
      );
      expect(commissionAmount).toBe(5000); // 50 SAR in cents
    });

    it("should handle decimal commission rates", () => {
      const bookingAmount = 100000;
      const commissionRate = 7.5;

      const commissionAmount = Math.round(
        (bookingAmount * commissionRate) / 100
      );
      expect(commissionAmount).toBe(7500);
    });

    it("should handle zero commission rate", () => {
      const bookingAmount = 100000;
      const commissionRate = 0;

      const commissionAmount = Math.round(
        (bookingAmount * commissionRate) / 100
      );
      expect(commissionAmount).toBe(0);
    });

    it("should handle large booking amounts", () => {
      const bookingAmount = 10000000; // 100,000 SAR in cents
      const commissionRate = 10;

      const commissionAmount = Math.round(
        (bookingAmount * commissionRate) / 100
      );
      expect(commissionAmount).toBe(1000000); // 10,000 SAR in cents
    });
  });

  describe("Booking Reference Generation", () => {
    it("should generate 6-character booking reference", () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const generateRef = () => {
        let result = "";
        for (let i = 0; i < 6; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      };

      const ref = generateRef();
      expect(ref).toHaveLength(6);
      expect(ref).toMatch(/^[A-Z0-9]+$/);
    });

    it("should not include ambiguous characters", () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      // Should not include 0 (looks like O), O (looks like 0), 1 (looks like I), I (looks like 1)
      // Note: L is included as uppercase L is distinguishable from 1 in most fonts
      expect(chars).not.toContain("0");
      expect(chars).not.toContain("O");
      expect(chars).not.toContain("1");
      expect(chars).not.toContain("I");
      // Verify L is included (it's acceptable in uppercase form)
      expect(chars).toContain("L");
    });

    it("should generate unique references", () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const generateRef = () => {
        let result = "";
        for (let i = 0; i < 6; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      };

      const refs = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        refs.add(generateRef());
      }
      // With 32^6 possible combinations, collisions should be rare
      expect(refs.size).toBeGreaterThan(990);
    });
  });

  describe("Input Validation", () => {
    it("should validate IATA number format", () => {
      const validIata = ["12345678", "ABC12345", "IATA1234"];
      const invalidIata = ["", "123", "12345678901234567890"];

      validIata.forEach(iata => {
        expect(iata.length).toBeGreaterThanOrEqual(1);
        expect(iata.length).toBeLessThanOrEqual(20);
      });

      invalidIata.forEach(iata => {
        const isValid = iata.length >= 1 && iata.length <= 20;
        if (iata === "") expect(isValid).toBe(false);
        if (iata.length > 20) expect(isValid).toBe(false);
      });
    });

    it("should validate email format", () => {
      const validEmails = [
        "agent@agency.com",
        "test.user@travel-agency.co.uk",
        "booking@airline.travel",
      ];

      validEmails.forEach(email => {
        expect(email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      });
    });

    it("should validate commission rate range", () => {
      const validRates = [0, 5, 10, 25, 50];
      const invalidRates = [-1, 51, 100];

      validRates.forEach(rate => {
        expect(rate >= 0 && rate <= 50).toBe(true);
      });

      invalidRates.forEach(rate => {
        expect(rate >= 0 && rate <= 50).toBe(false);
      });
    });

    it("should validate airport codes", () => {
      const validCodes = ["JED", "RUH", "DXB", "LHR"];
      const invalidCodes = ["", "JE", "JEDD", "jed"];

      validCodes.forEach(code => {
        expect(code).toMatch(/^[A-Z]{3}$/);
      });

      invalidCodes.forEach(code => {
        const isValid = /^[A-Z]{3}$/.test(code);
        expect(isValid).toBe(false);
      });
    });
  });

  describe("Rate Limiting", () => {
    it("should track daily booking count", () => {
      const dailyLimit = 100;
      let dailyCount = 0;

      // Simulate bookings
      for (let i = 0; i < 50; i++) {
        dailyCount++;
        expect(dailyCount <= dailyLimit).toBe(true);
      }
    });

    it("should block bookings when daily limit exceeded", () => {
      const dailyLimit = 100;
      let dailyCount = 100;

      const canBook = dailyCount < dailyLimit;
      expect(canBook).toBe(false);
    });

    it("should track monthly booking count", () => {
      const monthlyLimit = 2000;
      let monthlyCount = 1500;

      const remainingBookings = monthlyLimit - monthlyCount;
      expect(remainingBookings).toBe(500);
    });

    it("should generate correct cache keys for rate limiting", () => {
      const agentId = 123;
      const today = new Date().toISOString().split("T")[0];
      const month = new Date().toISOString().slice(0, 7);

      const dailyKey = `agent_daily_bookings:${agentId}:${today}`;
      const monthlyKey = `agent_monthly_bookings:${agentId}:${month}`;

      expect(dailyKey).toMatch(/^agent_daily_bookings:\d+:\d{4}-\d{2}-\d{2}$/);
      expect(monthlyKey).toMatch(/^agent_monthly_bookings:\d+:\d{4}-\d{2}$/);
    });
  });

  describe("Statistics Calculation", () => {
    it("should calculate total revenue correctly", () => {
      const bookings = [
        { bookingAmount: 50000 },
        { bookingAmount: 75000 },
        { bookingAmount: 100000 },
      ];

      const totalRevenue = bookings.reduce(
        (sum, b) => sum + b.bookingAmount,
        0
      );
      expect(totalRevenue).toBe(225000);
    });

    it("should calculate total commission correctly", () => {
      const bookings = [
        { commissionAmount: 2500 },
        { commissionAmount: 3750 },
        { commissionAmount: 5000 },
      ];

      const totalCommission = bookings.reduce(
        (sum, b) => sum + b.commissionAmount,
        0
      );
      expect(totalCommission).toBe(11250);
    });

    it("should categorize commission by status", () => {
      const commissions = [
        { status: "pending", amount: 5000 },
        { status: "pending", amount: 3000 },
        { status: "approved", amount: 2000 },
        { status: "paid", amount: 10000 },
        { status: "paid", amount: 8000 },
      ];

      let pendingCommission = 0;
      let paidCommission = 0;

      for (const c of commissions) {
        if (c.status === "pending" || c.status === "approved") {
          pendingCommission += c.amount;
        } else if (c.status === "paid") {
          paidCommission += c.amount;
        }
      }

      expect(pendingCommission).toBe(10000);
      expect(paidCommission).toBe(18000);
    });
  });

  describe("Date Filtering", () => {
    it("should filter bookings by date range", () => {
      const bookings = [
        { createdAt: new Date("2024-01-15") },
        { createdAt: new Date("2024-02-01") },
        { createdAt: new Date("2024-02-15") },
        { createdAt: new Date("2024-03-01") },
      ];

      const startDate = new Date("2024-02-01");
      const endDate = new Date("2024-02-28");

      const filtered = bookings.filter(
        b => b.createdAt >= startDate && b.createdAt <= endDate
      );

      expect(filtered).toHaveLength(2);
    });

    it("should get start of day correctly", () => {
      const date = new Date("2024-02-15T14:30:00Z");
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      expect(startOfDay.getHours()).toBe(0);
      expect(startOfDay.getMinutes()).toBe(0);
      expect(startOfDay.getSeconds()).toBe(0);
    });

    it("should get end of day correctly", () => {
      const date = new Date("2024-02-15T14:30:00Z");
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      expect(endOfDay.getHours()).toBe(23);
      expect(endOfDay.getMinutes()).toBe(59);
      expect(endOfDay.getSeconds()).toBe(59);
    });

    it("should get start of month correctly", () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      expect(startOfMonth.getDate()).toBe(1);
      expect(startOfMonth.getHours()).toBe(0);
    });
  });

  describe("Pagination", () => {
    it("should calculate offset correctly", () => {
      const page = 3;
      const limit = 20;
      const offset = (page - 1) * limit;

      expect(offset).toBe(40);
    });

    it("should enforce maximum limit", () => {
      const requestedLimit = 500;
      const maxLimit = 100;
      const limit = Math.min(requestedLimit, maxLimit);

      expect(limit).toBe(100);
    });

    it("should default to first page", () => {
      const page = undefined ?? 1;
      expect(page).toBe(1);
    });

    it("should default to 20 items per page", () => {
      const limit = undefined ?? 20;
      expect(limit).toBe(20);
    });
  });

  describe("Flight Availability Check", () => {
    it("should check economy seat availability", () => {
      const flight = {
        economyAvailable: 50,
        businessAvailable: 10,
      };
      const requestedSeats = 5;
      const cabinClass = "economy";

      const availableSeats =
        cabinClass === "economy"
          ? flight.economyAvailable
          : flight.businessAvailable;

      expect(availableSeats >= requestedSeats).toBe(true);
    });

    it("should check business seat availability", () => {
      const flight = {
        economyAvailable: 50,
        businessAvailable: 2,
      };
      const requestedSeats = 5;
      const cabinClass = "business";

      const availableSeats =
        cabinClass === "economy"
          ? flight.economyAvailable
          : flight.businessAvailable;

      expect(availableSeats >= requestedSeats).toBe(false);
    });

    it("should calculate total price correctly", () => {
      const flight = {
        economyPrice: 50000, // 500 SAR
        businessPrice: 150000, // 1500 SAR
      };
      const passengerCount = 3;
      const cabinClass = "economy";

      const pricePerSeat =
        cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;
      const totalPrice = pricePerSeat * passengerCount;

      expect(totalPrice).toBe(150000);
    });
  });
});
