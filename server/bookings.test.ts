import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

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

describe("Booking APIs", () => {
  it("should create a booking successfully", async () => {
    const ctx = createAuthenticatedContext();
    const caller = appRouter.createCaller(ctx);

    const booking = await caller.bookings.create({
      flightId: 1,
      cabinClass: "economy",
      passengers: [
        {
          type: "adult",
          title: "Mr",
          firstName: "John",
          lastName: "Doe",
        },
      ],
    });

    expect(booking).toBeDefined();
    expect(booking).toHaveProperty("bookingId");
    expect(booking).toHaveProperty("bookingReference");
    expect(booking).toHaveProperty("pnr");
    expect(booking).toHaveProperty("totalAmount");
    expect(booking.bookingReference).toHaveLength(6);
    expect(booking.pnr).toHaveLength(6);
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
