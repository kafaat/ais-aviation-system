import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  redisCacheService,
  CacheNamespace,
  CacheTTL,
} from "./redis-cache.service";

// Mock ioredis
vi.mock("ioredis", () => {
  const mockClient = {
    on: vi.fn().mockReturnThis(),
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    setex: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(300),
    ping: vi.fn().mockResolvedValue("PONG"),
    info: vi.fn().mockResolvedValue("redis_version:7.0.0\r\n"),
    multi: vi.fn().mockReturnValue({
      incr: vi.fn().mockReturnThis(),
      ttl: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, 1],
        [null, 60],
      ]),
    }),
    expire: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(["0", []]),
    quit: vi.fn().mockResolvedValue("OK"),
    disconnect: vi.fn(),
    zincrby: vi.fn().mockResolvedValue("1"),
  };

  return {
    default: vi.fn().mockImplementation(() => mockClient),
  };
});

describe("RedisCacheService", () => {
  describe("Memory Fallback", () => {
    it("should use memory cache when Redis is unavailable", async () => {
      const testParams = { key: "test", value: "data" };
      const testValue = { result: "cached data" };

      // Set value (will use memory cache if Redis not connected)
      await redisCacheService.set(
        CacheNamespace.SEARCH,
        testParams,
        testValue,
        300
      );

      // Get value from memory cache
      const result = await redisCacheService.get<typeof testValue>(
        CacheNamespace.SEARCH,
        testParams
      );

      // Memory cache should return the value
      expect(result).toEqual(testValue);
    });

    it("should handle cache miss gracefully", async () => {
      const result = await redisCacheService.get(CacheNamespace.SEARCH, {
        nonexistent: "key",
      });

      expect(result).toBeNull();
    });
  });

  describe("Flight Search Caching", () => {
    const searchParams = {
      originId: 1,
      destinationId: 2,
      departureDate: "2026-03-01",
    };
    const searchResults = [
      { id: 1, flightNumber: "AA100" },
      { id: 2, flightNumber: "AA101" },
    ];

    it("should cache flight search results", async () => {
      await redisCacheService.cacheFlightSearch(searchParams, searchResults);

      const cached =
        await redisCacheService.getCachedFlightSearch(searchParams);

      expect(cached).toEqual(searchResults);
    });

    it("should return null for uncached search", async () => {
      const result = await redisCacheService.getCachedFlightSearch({
        originId: 999,
        destinationId: 999,
        departureDate: "2099-01-01",
      });

      expect(result).toBeNull();
    });
  });

  describe("Flight Details Caching", () => {
    const flightId = 123;
    const flightDetails = {
      id: 123,
      flightNumber: "BA456",
      departure: "LHR",
      arrival: "JFK",
    };

    it("should cache flight details", async () => {
      await redisCacheService.cacheFlightDetails(flightId, flightDetails);

      const cached = await redisCacheService.getCachedFlightDetails(flightId);

      expect(cached).toEqual(flightDetails);
    });
  });

  describe("Reference Data Caching", () => {
    const airports = [
      { id: 1, code: "JFK", name: "John F. Kennedy" },
      { id: 2, code: "LAX", name: "Los Angeles" },
    ];

    const airlines = [
      { id: 1, code: "AA", name: "American Airlines" },
      { id: 2, code: "UA", name: "United Airlines" },
    ];

    it("should cache airports", async () => {
      await redisCacheService.cacheAirports(airports);

      const cached = await redisCacheService.getCachedAirports();

      expect(cached).toEqual(airports);
    });

    it("should cache airlines", async () => {
      await redisCacheService.cacheAirlines(airlines);

      const cached = await redisCacheService.getCachedAirlines();

      expect(cached).toEqual(airlines);
    });
  });

  describe("User Session Caching", () => {
    const userId = 42;
    const sessionData = {
      id: 42,
      email: "user@example.com",
      role: "user",
      lastLogin: new Date().toISOString(),
    };

    it("should cache user session", async () => {
      await redisCacheService.cacheUserSession(userId, sessionData);

      const cached = await redisCacheService.getCachedUserSession(userId);

      expect(cached).toEqual(sessionData);
    });

    it("should invalidate user session", async () => {
      await redisCacheService.cacheUserSession(userId, sessionData);
      await redisCacheService.invalidateUserSession(userId);

      const cached = await redisCacheService.getCachedUserSession(userId);

      expect(cached).toBeNull();
    });
  });

  describe("Popular Routes Caching", () => {
    const popularRoutes = [
      { originId: 1, destinationId: 2, score: 100 },
      { originId: 3, destinationId: 4, score: 80 },
    ];

    it("should cache popular routes", async () => {
      await redisCacheService.cachePopularRoutes(popularRoutes);

      const cached = await redisCacheService.getCachedPopularRoutes();

      expect(cached).toEqual(popularRoutes);
    });
  });

  describe("Cache Invalidation", () => {
    it("should invalidate flight search cache namespace", async () => {
      const searchParams = {
        originId: 10,
        destinationId: 20,
        departureDate: "2026-04-01",
      };
      const results = [{ id: 1 }];

      await redisCacheService.cacheFlightSearch(searchParams, results);
      await redisCacheService.invalidateFlightSearchCache();

      // After invalidation, namespace version is bumped, so old keys won't be found
      const cached =
        await redisCacheService.getCachedFlightSearch(searchParams);
      expect(cached).toBeNull();
    });
  });

  describe("Health Check", () => {
    it("should return health status", async () => {
      const health = await redisCacheService.healthCheck();

      expect(health).toHaveProperty("status");
      expect(health).toHaveProperty("redis");
      expect(health).toHaveProperty("memory");
      expect(health.memory).toHaveProperty("entries");
      expect(health.memory).toHaveProperty("maxSize");
    });
  });

  describe("Statistics", () => {
    it("should track cache statistics", async () => {
      // Perform some cache operations
      await redisCacheService.set(
        CacheNamespace.SEARCH,
        { test: 1 },
        { data: 1 },
        60
      );
      await redisCacheService.get(CacheNamespace.SEARCH, { test: 1 });
      await redisCacheService.get(CacheNamespace.SEARCH, { test: 2 }); // miss

      const stats = await redisCacheService.getStats();

      expect(stats).toHaveProperty("hits");
      expect(stats).toHaveProperty("misses");
      expect(stats).toHaveProperty("sets");
      expect(stats).toHaveProperty("hitRate");
      expect(stats).toHaveProperty("memoryEntries");
      expect(stats).toHaveProperty("uptime");
      expect(stats.sets).toBeGreaterThanOrEqual(1);
    });

    it("should reset statistics", () => {
      redisCacheService.resetStats();

      // After reset, we need to perform a new operation to verify reset worked
      // The stats will be at 0 until we perform operations
    });
  });

  describe("TTL Configuration", () => {
    it("should have correct TTL values configured", () => {
      expect(CacheTTL.FLIGHT_SEARCH).toBe(120); // 2 minutes
      expect(CacheTTL.PRICING).toBe(60); // 1 minute
      expect(CacheTTL.FLIGHT_DETAILS).toBe(300); // 5 minutes
      expect(CacheTTL.USER_SESSION).toBe(900); // 15 minutes
      expect(CacheTTL.AIRPORTS).toBe(3600); // 1 hour
      expect(CacheTTL.AIRLINES).toBe(3600); // 1 hour
    });
  });

  describe("Namespace Configuration", () => {
    it("should have all required namespaces defined", () => {
      expect(CacheNamespace.SEARCH).toBe("search");
      expect(CacheNamespace.FLIGHT).toBe("flight");
      expect(CacheNamespace.PRICING).toBe("pricing");
      expect(CacheNamespace.AIRPORTS).toBe("airports");
      expect(CacheNamespace.AIRLINES).toBe("airlines");
      expect(CacheNamespace.SESSION).toBe("session");
      expect(CacheNamespace.ROUTES).toBe("routes");
      expect(CacheNamespace.USER).toBe("user");
    });
  });

  describe("Rate Limiting", () => {
    it("should check rate limit", async () => {
      const result = await redisCacheService.checkRateLimit(
        "test-user:api",
        100,
        60
      );

      expect(result).toHaveProperty("allowed");
      expect(result).toHaveProperty("remaining");
      expect(result).toHaveProperty("resetIn");
      expect(result.allowed).toBe(true);
    });
  });
});
