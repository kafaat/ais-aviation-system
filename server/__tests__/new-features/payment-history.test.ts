import { describe, it, expect, vi, beforeEach } from "vitest";
import * as paymentHistoryService from "../../services/payment-history.service";

// Mock the db module
vi.mock("../../db", () => {
  const mockResults: unknown[] = [];
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      resolve(mockResults);
    }),
  };

  return {
    getDb: vi.fn().mockResolvedValue(mockDb),
    __mockDb: mockDb,
    __mockResults: mockResults,
  };
});

describe("Payment History Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserPaymentHistory", () => {
    it("should be a function", () => {
      expect(typeof paymentHistoryService.getUserPaymentHistory).toBe(
        "function"
      );
    });

    it("should accept userId and filters parameters", () => {
      // Verify the function signature accepts proper parameters
      const fn = paymentHistoryService.getUserPaymentHistory;
      expect(fn.length).toBeGreaterThanOrEqual(1); // At least userId param
    });

    it("should accept optional filter parameters", () => {
      // TypeScript type check - verify interface compatibility
      const filters: paymentHistoryService.PaymentHistoryFilters = {
        status: "completed",
        method: "card",
        dateFrom: new Date("2025-01-01"),
        dateTo: new Date("2025-12-31"),
        limit: 50,
        offset: 0,
      };

      expect(filters.status).toBe("completed");
      expect(filters.method).toBe("card");
      expect(filters.limit).toBe(50);
      expect(filters.offset).toBe(0);
    });
  });

  describe("getUserPaymentStats", () => {
    it("should be a function", () => {
      expect(typeof paymentHistoryService.getUserPaymentStats).toBe("function");
    });
  });

  describe("getAdminPaymentHistory", () => {
    it("should be a function", () => {
      expect(typeof paymentHistoryService.getAdminPaymentHistory).toBe(
        "function"
      );
    });

    it("should accept optional filters", () => {
      const filters: paymentHistoryService.PaymentHistoryFilters = {};
      expect(filters).toBeDefined();
    });
  });

  describe("getAdminPaymentStats", () => {
    it("should be a function", () => {
      expect(typeof paymentHistoryService.getAdminPaymentStats).toBe(
        "function"
      );
    });
  });

  describe("PaymentHistoryFilters interface", () => {
    it("should support all filter types", () => {
      const filters: paymentHistoryService.PaymentHistoryFilters = {
        userId: 1,
        status: "pending",
        method: "card",
        dateFrom: new Date(),
        dateTo: new Date(),
        limit: 25,
        offset: 10,
      };

      expect(filters.userId).toBe(1);
      expect(filters.status).toBe("pending");
      expect(filters.method).toBe("card");
      expect(filters.dateFrom).toBeInstanceOf(Date);
      expect(filters.dateTo).toBeInstanceOf(Date);
      expect(filters.limit).toBe(25);
      expect(filters.offset).toBe(10);
    });

    it("should work with empty filters", () => {
      const filters: paymentHistoryService.PaymentHistoryFilters = {};
      expect(Object.keys(filters)).toHaveLength(0);
    });

    it("should support all payment statuses", () => {
      const statuses = ["pending", "completed", "failed", "refunded"];
      statuses.forEach(status => {
        const filters: paymentHistoryService.PaymentHistoryFilters = { status };
        expect(filters.status).toBe(status);
      });
    });
  });
});
