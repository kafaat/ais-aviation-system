import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createMockContext(): TrpcContext {
  return {
    user: undefined,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe.skipIf(!process.env.DATABASE_URL)("Flight APIs", () => {
  it("should search for flights successfully", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const result = await caller.flights.search({
      originId: 1, // RUH
      destinationId: 2, // JED
      departureDate: tomorrow,
    });

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("flightNumber");
      expect(result[0]).toHaveProperty("airline");
      expect(result[0]).toHaveProperty("origin");
      expect(result[0]).toHaveProperty("destination");
    }
  });

  it("should get flight by ID", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    // First search to find a valid flight ID
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const searchResults = await caller.flights.search({
      originId: 1,
      destinationId: 2,
      departureDate: tomorrow,
    });

    if (searchResults.length === 0) {
      // No flights in DB - skip gracefully
      return;
    }

    const flight = await caller.flights.getById({ id: searchResults[0].id });

    expect(flight).toBeDefined();
    if (flight) {
      expect(flight).toHaveProperty("flightNumber");
      expect(flight).toHaveProperty("airline");
      expect(flight).toHaveProperty("economyPrice");
      expect(flight).toHaveProperty("businessPrice");
    }
  });

  it("should throw error for non-existent flight", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.flights.getById({ id: 99999 })).rejects.toThrow(
      "Flight not found"
    );
  });
});
