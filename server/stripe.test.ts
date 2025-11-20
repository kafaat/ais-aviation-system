import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { bookings, flights, airlines, airports } from "../drizzle/schema";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
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

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {
        origin: "https://test.example.com",
      },
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("Stripe Payment Integration", () => {
  let testBookingId: number;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create test booking
    const bookingResult = await db.insert(bookings).values({
      userId: 1,
      flightId: 1,
      bookingReference: "TST123",
      pnr: "ABC123",
      status: "pending",
      totalAmount: 50000, // 500 SAR
      paymentStatus: "pending",
      cabinClass: "economy",
      numberOfPassengers: 1,
      checkedIn: false,
    });

    testBookingId = Number(bookingResult[0].insertId);
  });

  it("creates a Stripe checkout session successfully", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.stripe.createCheckoutSession({
      bookingId: testBookingId,
    });

    expect(result).toHaveProperty("sessionId");
    expect(result).toHaveProperty("url");
    expect(result.sessionId).toMatch(/^cs_test_/);
    expect(result.url).toContain("checkout.stripe.com");
  });

  it("prevents creating checkout session for already paid booking", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Mark booking as paid
    await db.update(bookings)
      .set({ paymentStatus: "paid" })
      .where({ id: testBookingId });

    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.stripe.createCheckoutSession({ bookingId: testBookingId })
    ).rejects.toThrow("Booking already paid");

    // Reset for other tests
    await db.update(bookings)
      .set({ paymentStatus: "pending" })
      .where({ id: testBookingId });
  });

  it("prevents unauthorized access to booking", async () => {
    const { ctx } = createAuthContext();
    // Change user ID to simulate different user
    ctx.user!.id = 999;
    
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.stripe.createCheckoutSession({ bookingId: testBookingId })
    ).rejects.toThrow("Unauthorized");
  });
});
