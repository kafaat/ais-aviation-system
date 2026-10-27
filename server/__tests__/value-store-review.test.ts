/**
 * Value-store rules closed by the October 2026 review: a wallet-funded
 * booking must not be cancelled without a refund path, and one invoice
 * carries at most one voucher.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/notification.service", () => ({
  createNotification: vi.fn(),
  notifyBookingCancelled: vi.fn(),
}));
vi.mock("../services/metrics.service", () => ({
  trackBookingCancelled: vi.fn(),
  trackRefundIssued: vi.fn(),
}));

import { cancelBookingResources } from "../services/booking-settlement.service";
import { applyVoucher } from "../services/voucher.service";

let fixture: ReturnType<typeof transactionMemory>;

describe("wallet-funded bookings keep their money", () => {
  beforeEach(() => {
    fixture = transactionMemory({
      bookings: [
        {
          id: 7,
          userId: 9,
          tenantId: null,
          flightId: 4,
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
          cabinClass: "economy",
          numberOfPassengers: 1,
          bookingReference: "WALLET",
          inventoryLockId: null,
        },
      ],
      flights: [{ id: 4, status: "scheduled", economyAvailable: 3 }],
      financial_ledger: [
        {
          id: 1,
          bookingId: 7,
          userId: 9,
          type: "charge",
          amount: "100.00",
          currency: "SAR",
          stripeEventId: "wallet-credit:7",
          metadata: JSON.stringify({ tender: "wallet", walletId: 1 }),
        },
      ],
      payment_receipts: [],
      payment_splits: [],
    });
    state.db = fixture.db;
  });

  it("refuses to cancel a wallet-paid booking until finance refunds it", async () => {
    const [booking] = fixture.rows("bookings");
    await expect(
      fixture.db.transaction((tx: any) =>
        cancelBookingResources(tx, booking, "customer request", 9)
      )
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("bookings")[0].status).toBe("confirmed");
    expect(fixture.rows("flights")[0].economyAvailable).toBe(3);
  });
});

describe("one voucher per invoice", () => {
  beforeEach(() => {
    const now = Date.now();
    const voucher = (id: number, code: string) => ({
      id,
      code,
      type: "percentage",
      value: 50,
      maxDiscount: null,
      minPurchase: 0,
      maxUses: 10,
      usedCount: 1,
      isActive: true,
      validFrom: new Date(now - 86400000),
      validUntil: new Date(now + 86400000),
    });
    fixture = transactionMemory({
      bookings: [
        {
          id: 7,
          userId: 9,
          tenantId: null,
          flightId: 4,
          status: "pending",
          paymentStatus: "pending",
          seatsReserved: false,
          totalAmount: 50000,
          bookingReference: "STACK",
          stripeCheckoutSessionId: null,
        },
      ],
      vouchers: [voucher(1, "FIRST50"), voucher(2, "SECOND50")],
      voucher_usage: [
        {
          id: 1,
          voucherId: 1,
          bookingId: 7,
          userId: 9,
          discountApplied: 50000,
          releasedAt: null,
        },
      ],
      booking_checkout_requests: [],
      payment_splits: [],
      ndc_orders: [],
    });
    state.db = fixture.db;
  });

  it("rejects a second code on an invoice that already carries one", async () => {
    await expect(applyVoucher("SECOND50", 7, 9, 50000)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "A voucher is already applied to this booking",
    });
    expect(fixture.rows("vouchers")[1].usedCount).toBe(1);
    expect(fixture.rows("voucher_usage")).toHaveLength(1);
    expect(fixture.rows("bookings")[0].totalAmount).toBe(50000);
  });

  it("still returns the same result when the same code is replayed", async () => {
    const result = await applyVoucher("FIRST50", 7, 9, 50000);
    expect(result).toMatchObject({ success: true, discountApplied: 50000 });
    expect(fixture.rows("voucher_usage")).toHaveLength(1);
  });
});
