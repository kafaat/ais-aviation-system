import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("../../db", () => ({
  getDb: vi.fn(),
}));

// Mock the logger
vi.mock("../../_core/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  getUserSuggestions,
  getPopularFlightSuggestions,
  getDealSuggestions,
} from "../../services/smart-suggestions.service";
import { getDb } from "../../db";

describe("Smart Suggestions Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserSuggestions", () => {
    it("should return empty array when database is not available", async () => {
      vi.mocked(getDb).mockResolvedValue(null);

      const result = await getUserSuggestions(1, 6);

      expect(result).toEqual([]);
    });

    it("should fall back to popular flights when user has no booking history", async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await getUserSuggestions(1, 6);

      // Should return empty when no bookings and no popular flights
      expect(result).toEqual([]);
    });

    it("should accept a limit parameter", async () => {
      vi.mocked(getDb).mockResolvedValue(null);

      const result = await getUserSuggestions(1, 3);

      expect(result).toEqual([]);
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe("getPopularFlightSuggestions", () => {
    it("should return empty array when database is not available", async () => {
      vi.mocked(getDb).mockResolvedValue(null);

      const result = await getPopularFlightSuggestions(6);

      expect(result).toEqual([]);
    });

    it("should accept a limit parameter", async () => {
      vi.mocked(getDb).mockResolvedValue(null);

      const result = await getPopularFlightSuggestions(3);

      expect(result).toEqual([]);
    });

    it("should handle database errors gracefully", async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockRejectedValue(new Error("DB error")),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await getPopularFlightSuggestions(6);

      expect(result).toEqual([]);
    });
  });

  describe("getDealSuggestions", () => {
    it("should return empty array when database is not available", async () => {
      vi.mocked(getDb).mockResolvedValue(null);

      const result = await getDealSuggestions(4);

      expect(result).toEqual([]);
    });

    it("should handle database errors gracefully", async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockRejectedValue(new Error("Connection lost")),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await getDealSuggestions(4);

      expect(result).toEqual([]);
    });
  });
});
