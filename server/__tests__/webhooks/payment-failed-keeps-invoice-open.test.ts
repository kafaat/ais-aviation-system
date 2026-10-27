/**
 * A declined card inside Checkout is not terminal. The webhook used to write
 * paymentStatus "failed", which no checkout, expiry or voucher-release path
 * accepted and nothing ever reset, so one decline stranded the booking.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { transactionMemory } from "../helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as any, notify: vi.fn() }));
vi.mock("../../db", () => ({ getDb: () => state.db }));
vi.mock("../../stripe", () => ({ stripe: {} }));
vi.mock("../../services/email.service", () => ({}));
vi.mock("../../services/notification.service", () => ({
  createNotification: state.notify,
}));

import { processStripeEvent } from "../../webhooks/stripe";

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  state.notify.mockReset().mockResolvedValue({ id: 1 });
  fixture = transactionMemory({
    bookings: [
      {
        id: 7,
        userId: 9,
        status: "pending",
        paymentStatus: "pending",
        bookingReference: "OPEN01",
        stripePaymentIntentId: "pi_open",
      },
    ],
    booking_status_history: [],
  });
  state.db = fixture.db;
});

const failedEvent = (id: string) =>
  ({
    id,
    type: "payment_intent.payment_failed",
    data: {
      object: {
        id: "pi_open",
        metadata: { type: "booking", bookingId: "7" },
        last_payment_error: { message: "Your card was declined." },
      },
    },
  }) as unknown as Stripe.Event;

describe("payment_intent.payment_failed", () => {
  it("records the attempt and notifies, but keeps the invoice payable", async () => {
    await state.db.transaction((tx: any) =>
      processStripeEvent(tx, failedEvent("evt_declined"))
    );
    const [booking] = fixture.rows("bookings");
    expect(booking.status).toBe("pending");
    expect(booking.paymentStatus).toBe("pending");
    expect(fixture.rows("booking_status_history")).toMatchObject([
      {
        bookingId: 7,
        previousStatus: "pending",
        newStatus: "payment_failed",
        transitionReason: "Payment failed: Your card was declined.",
      },
    ]);
    expect(state.notify).toHaveBeenCalledTimes(1);
  });

  it("ignores a decline for a booking that is no longer pending", async () => {
    fixture.rows("bookings")[0].status = "confirmed";
    fixture.rows("bookings")[0].paymentStatus = "paid";
    await state.db.transaction((tx: any) =>
      processStripeEvent(tx, failedEvent("evt_late"))
    );
    expect(fixture.rows("bookings")[0].paymentStatus).toBe("paid");
    expect(fixture.rows("booking_status_history")).toHaveLength(0);
    expect(state.notify).not.toHaveBeenCalled();
  });
});
