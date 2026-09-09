import { describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
vi.mock("../db", () => ({ getDb: vi.fn() }));
import { settleVerifiedRefund } from "./payment-settlement.service";

describe("refund local reconciliation atomicity", () => {
  it("rolls back receipt, ledger and inventory together if the durable event cannot be recorded", async () => {
    const fixture = transactionMemory({
      payment_receipts: [
        {
          paymentIntentId: "pi_1",
          kind: "booking",
          amount: 10000,
          refundedAmount: 0,
          bookingId: 1,
          userId: 1,
          currency: "SAR",
        },
      ],
      bookings: [
        {
          id: 1,
          flightId: 1,
          userId: 1,
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
          cabinClass: "economy",
          numberOfPassengers: 1,
        },
      ],
      flights: [{ id: 1, economyAvailable: 4 }],
    });
    fixture.failInsert("outbox");
    await expect(
      fixture.db.transaction((tx: any) =>
        settleVerifiedRefund(tx, {
          paymentIntentId: "pi_1",
          chargeId: "ch_1",
          amount: 10000,
          amountRefunded: 10000,
          currency: "sar",
          eventId: "evt_1",
        })
      )
    ).rejects.toThrow("Injected insert failure");
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
    expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(0);
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
  });
});
