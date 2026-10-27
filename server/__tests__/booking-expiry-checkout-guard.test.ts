/**
 * The unpaid-booking sweeper must not cancel a booking whose customer may
 * still be inside a live provider checkout: the funds would settle onto a
 * cancelled booking and be parked in review. Sessions now carry a 31-minute
 * provider expiry, so a claim older than that window is safe to expire.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as any, cancel: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/booking-settlement.service", () => ({
  cancelBookingResources: state.cancel,
}));
vi.mock("bullmq", () => ({
  Queue: class {},
  Worker: class {},
  Job: class {},
}));
vi.mock("../queue/redis-config", () => ({
  redisConnectionOptions: () => ({}),
}));

import { cleanupExpiredBookings } from "../services/queue-v2.service";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);
let fixture: ReturnType<typeof transactionMemory>;

function seed(claims: any[]) {
  fixture = transactionMemory({
    bookings: [1, 2, 3].map(id => ({
      id,
      userId: 9,
      status: "pending",
      paymentStatus: "pending",
      createdAt: minutesAgo(45),
    })),
    booking_checkout_requests: claims,
    payment_receipts: [],
  });
  state.db = fixture.db;
}

beforeEach(() => {
  state.cancel.mockReset().mockResolvedValue(undefined);
});

describe("unpaid booking expiry versus live checkout sessions", () => {
  it("skips a booking with a recent ready claim and expires the rest", async () => {
    seed([
      { bookingId: 1, status: "ready", updatedAt: minutesAgo(5) },
      { bookingId: 2, status: "expired", updatedAt: minutesAgo(5) },
    ]);
    await cleanupExpiredBookings();
    const cancelled = state.cancel.mock.calls.map(c => c[1].id).sort();
    expect(cancelled).toEqual([2, 3]);
  });

  it("expires a booking once its checkout claim is past the provider window", async () => {
    seed([{ bookingId: 1, status: "ready", updatedAt: minutesAgo(40) }]);
    await cleanupExpiredBookings();
    expect(state.cancel.mock.calls.map(c => c[1].id).sort()).toEqual([1, 2, 3]);
  });

  it("treats a claim still being created like a live session", async () => {
    seed([{ bookingId: 3, status: "creating", updatedAt: minutesAgo(1) }]);
    await cleanupExpiredBookings();
    expect(state.cancel.mock.calls.map(c => c[1].id).sort()).toEqual([1, 2]);
  });

  it("never expires a booking whose collected funds are under review", async () => {
    seed([]);
    fixture.rows("payment_receipts").push({
      paymentIntentId: "pi_review",
      bookingId: 2,
      settlementStatus: "review_required",
    });
    await cleanupExpiredBookings();
    expect(state.cancel.mock.calls.map(c => c[1].id).sort()).toEqual([1, 3]);
  });
});
