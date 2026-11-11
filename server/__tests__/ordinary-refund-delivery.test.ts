import { beforeEach, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as any, send: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/email.service", () => ({
  sendRefundConfirmation: state.send,
}));
import { consumeLocalEvent } from "../services/event-inbox.service";
const event = {
  eventId: "a21a5afe-cf4a-4223-ad6d-39aaff08d781",
  eventType: "booking.ordinary_refund_completed",
  aggregateType: "booking",
  aggregateId: "7",
  tenantId: 3,
  payload: {
    bookingId: 7,
    userId: 9,
    actorId: 9,
    amount: 5000,
    refundId: "re_test",
    paymentIntentId: "pi_test",
  },
};
let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        bookingReference: "TEST07",
      },
    ],
    users: [{ id: 9, name: "Test", email: "test@example.test" }],
    flights: [{ id: 4, flightNumber: "TEST04" }],
    ordinary_booking_refunds: [
      { bookingId: 7, amount: 5000, refundId: "re_test", status: "succeeded" },
    ],
  });
  state.db = fixture.db;
  state.send.mockReset().mockResolvedValue(true);
});
it("delivers verified completion once through consumer receipts", async () => {
  await consumeLocalEvent(event);
  await consumeLocalEvent(event);
  expect(fixture.rows("notifications")).toHaveLength(1);
  expect(fixture.rows("audit_logs")).toMatchObject([
    { eventType: "REFUND_COMPLETED" },
  ]);
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(state.send).toHaveBeenCalledWith(
    expect.objectContaining({
      refundAmount: 5000,
      idempotencyKey: "ordinary-refund:re_test",
    })
  );
});
it("retries failed delivery without repeating the local notification or changing the email key", async () => {
  state.send.mockResolvedValueOnce(false);
  await expect(consumeLocalEvent(event)).rejects.toThrow();
  await consumeLocalEvent(event);
  expect(fixture.rows("notifications")).toHaveLength(1);
  expect(state.send).toHaveBeenCalledTimes(2);
  expect(state.send.mock.calls[0][0].idempotencyKey).toBe(
    state.send.mock.calls[1][0].idempotencyKey
  );
});
it("rejects a cross-tenant completion before notification or email", async () => {
  await expect(consumeLocalEvent({ ...event, tenantId: 99 })).rejects.toThrow();
  expect(fixture.rows("notifications")).toHaveLength(0);
  expect(state.send).not.toHaveBeenCalled();
});

it("does not announce a command that has no verified success", async () => {
  fixture.rows("ordinary_booking_refunds")[0].status = "pending";
  await expect(consumeLocalEvent(event)).rejects.toThrow();
  expect(fixture.rows("notifications")).toHaveLength(0);
  expect(state.send).not.toHaveBeenCalled();
});
