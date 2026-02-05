/**
 * Database Optimizer Service Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SLOW_QUERY_CONFIG,
  PAGINATION_DEFAULTS,
  normalizePaginationLimit,
  buildCursorCondition,
  createCursorPaginatedResponse,
  createOffsetPaginatedResponse,
  calculateOffset,
  formatBytes,
  SlowQueryLog,
} from "./db-optimizer.service";
import { gt, lt } from "drizzle-orm";

// Mock the database module
vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getPool: vi.fn().mockReturnValue(null),
  getPoolStats: vi.fn().mockResolvedValue(null),
}));

// Mock the logger
vi.mock("../_core/logger", () => ({
  createServiceLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("db-optimizer.service", () => {
  describe("Configuration", () => {
    it("should have default slow query threshold", () => {
      expect(SLOW_QUERY_CONFIG.THRESHOLD_MS).toBe(1000);
    });

    it("should have default warning threshold", () => {
      expect(SLOW_QUERY_CONFIG.WARNING_THRESHOLD_MS).toBe(500);
    });

    it("should have default pagination limits", () => {
      expect(PAGINATION_DEFAULTS.DEFAULT_LIMIT).toBe(20);
      expect(PAGINATION_DEFAULTS.MAX_LIMIT).toBe(100);
      expect(PAGINATION_DEFAULTS.MIN_LIMIT).toBe(1);
    });
  });

  describe("normalizePaginationLimit", () => {
    it("should return default limit for undefined input", () => {
      expect(normalizePaginationLimit(undefined)).toBe(20);
    });

    it("should return default limit for zero", () => {
      expect(normalizePaginationLimit(0)).toBe(20);
    });

    it("should return default limit for negative numbers", () => {
      expect(normalizePaginationLimit(-5)).toBe(20);
    });

    it("should return the input for valid values", () => {
      expect(normalizePaginationLimit(50)).toBe(50);
    });

    it("should cap at max limit", () => {
      expect(normalizePaginationLimit(500)).toBe(100);
    });

    it("should use custom default when provided", () => {
      expect(normalizePaginationLimit(undefined, 10)).toBe(10);
    });
  });

  describe("buildCursorCondition", () => {
    it("should return undefined for null cursor", () => {
      const result = buildCursorCondition("id", null);
      expect(result).toBeUndefined();
    });

    it("should return undefined for undefined cursor", () => {
      const result = buildCursorCondition("id", undefined);
      expect(result).toBeUndefined();
    });

    it("should return gt condition for forward pagination", () => {
      const column = { name: "id" };
      const result = buildCursorCondition(column, 100, "forward");
      expect(result).toBeDefined();
    });

    it("should return lt condition for backward pagination", () => {
      const column = { name: "id" };
      const result = buildCursorCondition(column, 100, "backward");
      expect(result).toBeDefined();
    });
  });

  describe("createCursorPaginatedResponse", () => {
    it("should handle empty data", () => {
      const result = createCursorPaginatedResponse<{ id: number }, number>(
        [],
        10,
        item => item.id
      );

      expect(result.data).toEqual([]);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("should detect hasMore when data exceeds limit", () => {
      const data = Array.from({ length: 11 }, (_, i) => ({ id: i + 1 }));
      const result = createCursorPaginatedResponse(data, 10, item => item.id);

      expect(result.data).toHaveLength(10);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBe(10);
    });

    it("should not have hasMore when data is within limit", () => {
      const data = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
      const result = createCursorPaginatedResponse(data, 10, item => item.id);

      expect(result.data).toHaveLength(5);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("should set correct cursors for forward pagination", () => {
      const data = Array.from({ length: 11 }, (_, i) => ({ id: i + 1 }));
      const result = createCursorPaginatedResponse(
        data,
        10,
        item => item.id,
        "forward"
      );

      expect(result.pagination.nextCursor).toBe(10);
      expect(result.pagination.previousCursor).toBe(1);
    });
  });

  describe("createOffsetPaginatedResponse", () => {
    it("should calculate correct pagination metadata", () => {
      const data = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
      const result = createOffsetPaginatedResponse(data, 100, 1, 10);

      expect(result.pagination.total).toBe(100);
      expect(result.pagination.totalPages).toBe(10);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.hasMore).toBe(true);
    });

    it("should detect last page correctly", () => {
      const data = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
      const result = createOffsetPaginatedResponse(data, 100, 10, 10);

      expect(result.pagination.hasMore).toBe(false);
    });

    it("should handle single page result", () => {
      const data = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
      const result = createOffsetPaginatedResponse(data, 5, 1, 10);

      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe("calculateOffset", () => {
    it("should return 0 for page 1", () => {
      expect(calculateOffset(1, 10)).toBe(0);
    });

    it("should calculate correct offset for page 2", () => {
      expect(calculateOffset(2, 10)).toBe(10);
    });

    it("should calculate correct offset for page 5 with limit 20", () => {
      expect(calculateOffset(5, 20)).toBe(80);
    });

    it("should return 0 for page 0 or negative", () => {
      expect(calculateOffset(0, 10)).toBe(0);
      expect(calculateOffset(-1, 10)).toBe(0);
    });
  });

  describe("formatBytes", () => {
    it("should format bytes correctly", () => {
      expect(formatBytes(0)).toBe("0.00 B");
      expect(formatBytes(500)).toBe("500.00 B");
    });

    it("should format kilobytes correctly", () => {
      expect(formatBytes(1024)).toBe("1.00 KB");
      expect(formatBytes(1536)).toBe("1.50 KB");
    });

    it("should format megabytes correctly", () => {
      expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    });

    it("should format gigabytes correctly", () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    });

    it("should format terabytes correctly", () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1.00 TB");
    });
  });

  describe("SlowQueryLog", () => {
    let log: SlowQueryLog;

    beforeEach(() => {
      log = new SlowQueryLog(10); // Small size for testing
    });

    it("should add entries", () => {
      log.add({
        queryId: "q1",
        sql: "SELECT * FROM users",
        executionTimeMs: 1500,
        timestamp: new Date(),
      });

      expect(log.getAll()).toHaveLength(1);
    });

    it("should respect max entries limit", () => {
      for (let i = 0; i < 15; i++) {
        log.add({
          queryId: `q${i}`,
          sql: `SELECT ${i}`,
          executionTimeMs: 1000 + i,
          timestamp: new Date(),
        });
      }

      expect(log.getAll()).toHaveLength(10);
    });

    it("should get recent entries", () => {
      for (let i = 0; i < 15; i++) {
        log.add({
          queryId: `q${i}`,
          sql: `SELECT ${i}`,
          executionTimeMs: 1000 + i,
          timestamp: new Date(),
        });
      }

      const recent = log.getRecent(5);
      expect(recent).toHaveLength(5);
      expect(recent[recent.length - 1].queryId).toBe("q14");
    });

    it("should get slowest queries", () => {
      log.add({
        queryId: "q1",
        sql: "SELECT 1",
        executionTimeMs: 100,
        timestamp: new Date(),
      });
      log.add({
        queryId: "q2",
        sql: "SELECT 2",
        executionTimeMs: 5000,
        timestamp: new Date(),
      });
      log.add({
        queryId: "q3",
        sql: "SELECT 3",
        executionTimeMs: 2000,
        timestamp: new Date(),
      });

      const slowest = log.getSlowest(2);
      expect(slowest).toHaveLength(2);
      expect(slowest[0].executionTimeMs).toBe(5000);
      expect(slowest[1].executionTimeMs).toBe(2000);
    });

    it("should get entries by time range", () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60000);
      const future = new Date(now.getTime() + 60000);

      log.add({
        queryId: "q1",
        sql: "SELECT 1",
        executionTimeMs: 1000,
        timestamp: past,
      });
      log.add({
        queryId: "q2",
        sql: "SELECT 2",
        executionTimeMs: 1000,
        timestamp: now,
      });

      const inRange = log.getByTimeRange(
        new Date(now.getTime() - 30000),
        future
      );
      expect(inRange).toHaveLength(1);
      expect(inRange[0].queryId).toBe("q2");
    });

    it("should calculate stats correctly", () => {
      log.add({
        queryId: "q1",
        sql: "SELECT 1",
        executionTimeMs: 1000,
        timestamp: new Date(),
      });
      log.add({
        queryId: "q2",
        sql: "SELECT 2",
        executionTimeMs: 2000,
        timestamp: new Date(),
      });
      log.add({
        queryId: "q3",
        sql: "SELECT 3",
        executionTimeMs: 3000,
        timestamp: new Date(),
      });

      const stats = log.getStats();
      expect(stats.totalQueries).toBe(3);
      expect(stats.avgExecutionTime).toBe(2000);
      expect(stats.maxExecutionTime).toBe(3000);
      expect(stats.minExecutionTime).toBe(1000);
    });

    it("should handle empty log stats", () => {
      const stats = log.getStats();
      expect(stats.totalQueries).toBe(0);
      expect(stats.avgExecutionTime).toBe(0);
    });

    it("should clear entries", () => {
      log.add({
        queryId: "q1",
        sql: "SELECT 1",
        executionTimeMs: 1000,
        timestamp: new Date(),
      });

      log.clear();
      expect(log.getAll()).toHaveLength(0);
    });
  });
});
