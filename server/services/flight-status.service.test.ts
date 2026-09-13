import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import type Stripe from "stripe";
const provider = vi.hoisted(() => ({ refund: vi.fn() }));
vi.mock("../stripe", () => ({
  stripe: {
    refunds: {
      create: provider.refund,
      list: () => ({
        async *[Symbol.asyncIterator]() {
          /* No prior provider refunds in this fixture. */
        },
      }),
    },
  },
}));
vi.mock("../_core/notification", () => ({ notifyOwner: vi.fn() }));
vi.mock("./email.service", async importOriginal => ({
  ...(await importOriginal<typeof import("./email.service")>()),
  sendFlightStatusChange: vi.fn(),
}));
import {
  updateFlightStatus,
  cancelFlightAndRefund,
} from "./flight-status.service";
import { getDb } from "../db";
import {
  flights,
  bookings,
  users,
  payments,
  paymentReceipts,
  financialLedger,
  bookingStatusHistory,
  flightStatusHistory,
  outbox,
  flightCancellationJobs,
  orderServiceRefunds,
} from "../../drizzle/schema";
import { eq, and, or } from "drizzle-orm";
import { settleVerifiedPayment } from "./payment-settlement.service";
import {
  processFlightCancellations,
  getFlightCancellationStatus,
} from "./flight-cancellation.service";
import { recordVerifiedOrderRefund } from "./order-refunds.service";
import { retryCancellationPlanning } from "./operations-dashboard.service";
import { isDatabaseAvailable } from "../__tests__/test-db-helper";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("Flight Status Service", () => {
  let testFlightId: number;
  let testBookingId: number;
  let testUserId: number;
  let paymentIntentId: string;

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
      status: "pending",
      totalAmount: 50000,
      paymentStatus: "pending",
      cabinClass: "economy",
      numberOfPassengers: 1,
      checkedIn: false,
    });
    testBookingId = Number(bookingResult[0].insertId);
    paymentIntentId = `pi_flight_status_${testBookingId}`;
    await db.transaction(tx =>
      settleVerifiedPayment(tx, {
        paymentIntentId,
        amount: 50000,
        currency: "sar",
        metadata: {
          bookingId: String(testBookingId),
          userId: String(testUserId),
        },
        eventId: `evt_flight_collection_${testBookingId}`,
      })
    );
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;

    try {
      await db
        .delete(outbox)
        .where(
          or(
            and(
              eq(outbox.aggregateType, "booking"),
              eq(outbox.aggregateId, String(testBookingId))
            ),
            and(
              eq(outbox.aggregateType, "payment"),
              eq(outbox.aggregateId, paymentIntentId)
            )
          )
        );
      await db
        .delete(orderServiceRefunds)
        .where(eq(orderServiceRefunds.bookingId, testBookingId));
      await db
        .delete(flightCancellationJobs)
        .where(eq(flightCancellationJobs.bookingId, testBookingId));
      await db
        .delete(financialLedger)
        .where(eq(financialLedger.bookingId, testBookingId));
      await db.delete(payments).where(eq(payments.bookingId, testBookingId));
      await db
        .delete(paymentReceipts)
        .where(eq(paymentReceipts.bookingId, testBookingId));
      await db
        .delete(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, testBookingId));
      await db
        .delete(flightStatusHistory)
        .where(eq(flightStatusHistory.flightId, testFlightId));
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

  it("requires reconciliation when a paid booking has no provider reference", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db
      .update(flights)
      .set({ status: "scheduled" })
      .where(eq(flights.id, testFlightId));
    await db
      .update(bookings)
      .set({ stripePaymentIntentId: null })
      .where(eq(bookings.id, testBookingId));
    const [collection] = await db
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentIntentId, paymentIntentId));
    await db
      .delete(paymentReceipts)
      .where(eq(paymentReceipts.paymentIntentId, paymentIntentId));
    try {
      await cancelFlightAndRefund({
        flightId: testFlightId,
        reason: "Missing original payment",
      });
      await processFlightCancellations();
      expect(
        (await getFlightCancellationStatus(testFlightId)).reviewRequiredBookings
      ).toBe(1);
      expect(provider.refund).not.toHaveBeenCalled();
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, testBookingId));
      expect(booking.paymentStatus).toBe("paid");
      expect(booking.seatsReserved).toBe(true);
    } finally {
      await db.insert(paymentReceipts).values(collection);
      await db
        .update(bookings)
        .set({ stripePaymentIntentId: paymentIntentId })
        .where(eq(bookings.id, testBookingId));
    }
  });

  it("cancels locally but counts refunds only after verified payer settlement", async () => {
    // Reset flight to scheduled directly in DB (cancelled → scheduled is not a valid transition)
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db
      .update(flights)
      .set({ status: "scheduled" })
      .where(eq(flights.id, testFlightId));

    const [job] = await db
      .select()
      .from(flightCancellationJobs)
      .where(eq(flightCancellationJobs.bookingId, testBookingId));
    await retryCancellationPlanning(
      job.id,
      testUserId,
      null,
      "Original collection reconciled"
    );
    let verified: Stripe.Refund | undefined;
    provider.refund.mockImplementation(
      async (params: Stripe.RefundCreateParams) => {
        verified = {
          id: "re_flight_status",
          object: "refund",
          payment_intent: paymentIntentId,
          charge: `ch_flight_status_${testBookingId}`,
          amount: 50000,
          currency: "sar",
          status: "pending",
          metadata: params.metadata ?? {},
        } as Stripe.Refund;
        return verified;
      }
    );
    const result = await cancelFlightAndRefund({
      flightId: testFlightId,
      reason: "Airline operational issues",
    });

    expect(result.success).toBe(true);
    expect(result.refundedBookings).toBe(0);
    await processFlightCancellations();
    expect(provider.refund).toHaveBeenCalledOnce();
    expect(provider.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: paymentIntentId,
        amount: 50000,
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^order-refund:/),
      })
    );
    // Local cancellation releases seats; money stays paid until individual success evidence.
    const [pending] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, testBookingId));
    expect(pending.paymentStatus).toBe("paid");
    expect(pending.seatsReserved).toBe(false);
    const [reservedFlight] = await db
      .select()
      .from(flights)
      .where(eq(flights.id, testFlightId));
    expect(reservedFlight.economyAvailable).toBe(100);

    if (!verified) throw new Error("Missing provider request");
    const completed = { ...verified, status: "succeeded" as const };
    await db.transaction(tx =>
      recordVerifiedOrderRefund(
        tx,
        completed,
        `evt_flight_refund_${testBookingId}`
      )
    );
    await db.transaction(tx =>
      recordVerifiedOrderRefund(
        tx,
        completed,
        `evt_flight_refund_${testBookingId}`
      )
    );
    await processFlightCancellations();
    expect(
      (await getFlightCancellationStatus(testFlightId)).refundedBookings
    ).toBe(1);
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, testBookingId))
      .limit(1);

    expect(booking.status).toBe("cancelled");
    expect(booking.paymentStatus).toBe("refunded");
    expect(booking.seatsReserved).toBe(false);
    const [restoredFlight] = await db
      .select()
      .from(flights)
      .where(eq(flights.id, testFlightId));
    expect(restoredFlight.economyAvailable).toBe(100);
  });
});
