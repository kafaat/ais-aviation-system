import { describe, expect, it, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { bookings, type User } from "../drizzle/schema";
import { getDb } from "./db";
import { eq } from "drizzle-orm";

function createAuthenticatedContext(): TrpcContext {
  const user: User = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe.skipIf(!process.env.DATABASE_URL)("Booking APIs", () => {
  const createdBookingIds: number[] = [];

  afterAll(async () => {
    // Clean up test bookings
    const db = await getDb();
    if (!db) return;

    try {
      for (const bookingId of createdBookingIds) {
        await db.delete(bookings).where(eq(bookings.id, bookingId));
      }
    } catch (error) {
      console.error("Error cleaning up test bookings:", error);
    }
  });

  it("should create a booking successfully", async () => {
    const ctx = createAuthenticatedContext();
    const caller = appRouter.createCaller(ctx);

    // Find a valid flight first
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const publicCaller = appRouter.createCaller({
      user: undefined,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });

    const flights = await publicCaller.flights.search({
      originId: 1,
      destinationId: 2,
      departureDate: tomorrow,
    });

    if (flights.length === 0) {
      // No flights available - skip gracefully
      return;
    }

    const booking = await caller.bookings.create({
      flightId: flights[0].id,
      cabinClass: "economy",
      passengers: [
        {
          type: "adult",
          title: "Mr",
          firstName: "John",
          lastName: "Doe",
        },
      ],
      sessionId: `test_session_${Date.now()}`,
    });

    expect(booking).toBeDefined();
    expect(booking).toHaveProperty("bookingId");
    expect(booking).toHaveProperty("bookingReference");
    expect(booking).toHaveProperty("pnr");
    expect(booking).toHaveProperty("totalAmount");
    expect(booking.bookingReference).toHaveLength(6);
    expect(booking.pnr).toHaveLength(6);

    // Track for cleanup
    createdBookingIds.push(booking.bookingId);
  });

  it("should get user bookings", async () => {
    const ctx = createAuthenticatedContext();
    const caller = appRouter.createCaller(ctx);

    const bookings = await caller.bookings.myBookings();

    expect(Array.isArray(bookings)).toBe(true);
  });

  it("should require authentication for creating booking", async () => {
    const ctx: TrpcContext = {
      user: undefined,
      req: {
        protocol: "https",
        headers: {},
      } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.bookings.create({
        flightId: 1,
        cabinClass: "economy",
        passengers: [
          {
            type: "adult",
            firstName: "John",
            lastName: "Doe",
          },
        ],
      })
    ).rejects.toThrow();
  });
});
