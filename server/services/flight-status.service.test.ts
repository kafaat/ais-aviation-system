import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  updateFlightStatus,
  cancelFlightAndRefund,
} from "./flight-status.service";
import { getDb } from "../db";
import { flights, bookings, users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Flight Status Service", () => {
  let testFlightId: number;
  let testBookingId: number;
  let testUserId: number;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create test user
    const userResult = await db.insert(users).values({
      openId: `test-flight-status-${Date.now()}`,
      email: "test@flight-status.com",
      name: "Test User",
      loginMethod: "test",
      role: "user",
    });
    testUserId = Number(userResult[0].insertId);

    // Create test flight
    const flightResult = await db.insert(flights).values({
      flightNumber: `FS${Date.now().toString().slice(-6)}`,
      airlineId: 1,
      originId: 1,
      destinationId: 2,
      departureTime: new Date(Date.now() + 86400000), // Tomorrow
      arrivalTime: new Date(Date.now() + 90000000),
      status: "scheduled",
      economySeats: 100,
      businessSeats: 20,
      economyPrice: 50000,
      businessPrice: 150000,
      economyAvailable: 100,
      businessAvailable: 20,
    });
    testFlightId = Number(flightResult[0].insertId);

    // Create test booking
    const bookingResult = await db.insert(bookings).values({
      userId: testUserId,
      flightId: testFlightId,
      bookingReference: `${Date.now().toString().slice(-4)}AB`,
      pnr: `${Date.now().toString().slice(-4)}CD`,
      status: "confirmed",
      totalAmount: 50000,
      paymentStatus: "paid",
      cabinClass: "economy",
      numberOfPassengers: 1,
      checkedIn: false,
    });
    testBookingId = Number(bookingResult[0].insertId);
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;

    try {
      await db.delete(bookings).where(eq(bookings.id, testBookingId));
      await db.delete(flights).where(eq(flights.id, testFlightId));
      await db.delete(users).where(eq(users.id, testUserId));
    } catch (error) {
      console.error("Error cleaning up test data:", error);
    }
  });

  it("should update flight status to delayed", async () => {
    const result = await updateFlightStatus({
      flightId: testFlightId,
      status: "delayed",
      delayMinutes: 30,
      reason: "Weather conditions",
    });

    expect(result.success).toBe(true);
    expect(result.affectedBookings).toBe(1);

    // Verify flight status was updated
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [flight] = await db
      .select()
      .from(flights)
      .where(eq(flights.id, testFlightId))
      .limit(1);

    expect(flight.status).toBe("delayed");
  });

  it("should update flight status to cancelled", async () => {
    const result = await updateFlightStatus({
      flightId: testFlightId,
      status: "cancelled",
      reason: "Technical issues",
    });

    expect(result.success).toBe(true);
    expect(result.affectedBookings).toBe(1);
  });

  it("should cancel flight and refund all bookings", async () => {
    // Reset flight to scheduled directly in DB (cancelled → scheduled is not a valid transition)
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db
      .update(flights)
      .set({ status: "scheduled" })
      .where(eq(flights.id, testFlightId));

    const result = await cancelFlightAndRefund({
      flightId: testFlightId,
      reason: "Airline operational issues",
    });

    expect(result.success).toBe(true);
    expect(result.refundedBookings).toBe(1);

    // Verify booking was refunded (reuse db from above)

    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, testBookingId))
      .limit(1);

    expect(booking.status).toBe("cancelled");
    expect(booking.paymentStatus).toBe("refunded");
  });
});
