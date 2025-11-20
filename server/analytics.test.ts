import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { bookings, flights, airlines, airports } from "../drizzle/schema";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(role: "admin" | "user" = "admin"): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-admin",
    email: "admin@example.com",
    name: "Test Admin",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("Analytics APIs", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Ensure we have test data
    const bookingsCount = await db.select().from(bookings).limit(1);
    if (bookingsCount.length === 0) {
      console.log("No test data found. Analytics tests may return empty results.");
    }
  });

  it("returns overview statistics", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.analytics.overview();

    expect(result).toHaveProperty("totalBookings");
    expect(result).toHaveProperty("totalRevenue");
    expect(result).toHaveProperty("todayBookings");
    expect(result).toHaveProperty("avgBookingValue");
    expect(typeof result.totalBookings).toBe("number");
    expect(typeof result.totalRevenue).toBe("number");
    expect(typeof result.todayBookings).toBe("number");
    expect(typeof result.avgBookingValue).toBe("number");
  });

  it("returns daily bookings data", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.analytics.dailyBookings();

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("bookings");
      expect(result[0]).toHaveProperty("revenue");
    }
  });

  it("returns top destinations", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.analytics.topDestinations();

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("destination");
      expect(result[0]).toHaveProperty("code");
      expect(result[0]).toHaveProperty("count");
    }
  });

  it("returns airline performance data", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.analytics.airlinePerformance();

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("airline");
      expect(result[0]).toHaveProperty("bookings");
      expect(result[0]).toHaveProperty("revenue");
    }
  });

  it("calculates average booking value correctly", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.analytics.overview();

    if (result.totalBookings > 0) {
      const expectedAvg = result.totalRevenue / result.totalBookings;
      expect(result.avgBookingValue).toBeCloseTo(expectedAvg, 2);
    } else {
      expect(result.avgBookingValue).toBe(0);
    }
  });
});
