import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { transactionMemory } from "../helpers/transaction-memory";
const state = vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_compatibility_fixture";
  return { db: null as any, verify: vi.fn() };
});
vi.mock("../../db", () => ({ getDb: () => state.db }));
vi.mock("../../stripe", () => ({
  stripe: { webhooks: { constructEvent: state.verify } },
}));
vi.mock("../../services/email.service", () => ({}));
import { webhooksRouter } from "../../routers/webhooks";
import {
  reserveSplitRefundCancellation,
  getSplitRefundCancellation,
} from "../../services/split-refund.service";

const secret = "whsec_compatibility_fixture";
const signer = new Stripe("sk_test_fixture_no_network");
let fixture: ReturnType<typeof transactionMemory>;
const caller = () =>
  webhooksRouter.createCaller({
    user: null,
    authMethod: null,
    tenantId: null,
    req: { headers: {} },
    res: {},
  } as any);
function signed(event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  return {
    body,
    signature: signer.webhooks.generateTestHeaderString({
      payload: body,
      secret,
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.verify.mockImplementation((...args) =>
    signer.webhooks.constructEvent(
      ...(args as Parameters<typeof signer.webhooks.constructEvent>)
    )
  );
  fixture = transactionMemory({
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        totalAmount: 10000,
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        cabinClass: "economy",
        numberOfPassengers: 1,
        bookingReference: "REFUND",
      },
    ],
    flights: [
      {
        id: 4,
        status: "scheduled",
        economyAvailable: 4,
        departureTime: new Date(Date.now() + 5 * 86400000),
      },
    ],
    payment_splits: [4000, 6000].map((amount, i) => ({
      id: i + 1,
      bookingId: 7,
      amount,
      payerName: `Payer ${i}`,
      status: "paid",
      stripePaymentIntentId: `pi_${i}`,
    })),
    payment_receipts: [4000, 6000].map((amount, i) => ({
      paymentIntentId: `pi_${i}`,
      kind: "split_payment",
      targetId: i + 1,
      bookingId: 7,
      userId: 9,
      amount,
      currency: "SAR",
      refundedAmount: 0,
      settlementStatus: "applied",
    })),
  });
  state.db = fixture.db;
});
describe("signed tRPC compatibility webhook", () => {
  it("settles a planned payer refund through the canonical receipt and deduplicates replay", async () => {
    const actor = { id: 9, role: "user" };
    const quote = (await getSplitRefundCancellation(7, actor)).quote!;
    await reserveSplitRefundCancellation(
      {
        bookingId: 7,
        quoteHash: quote.quoteHash,
        reason: "requested_by_customer",
      },
      actor
    );
    const item = fixture.rows("booking_refund_items")[0];
    const event = {
      id: "evt_signed",
      object: "event",
      type: "refund.updated",
      data: {
        object: {
          id: "re_signed",
          payment_intent: item.paymentIntentId,
          charge: "ch_signed",
          amount: item.refundAmount,
          currency: "sar",
          metadata: JSON.parse(item.requestPayload).metadata,
          status: "succeeded",
        },
      },
    };
    const input = signed(event);
    expect(await caller().stripe(input)).toEqual({
      received: true,
      duplicate: false,
      eventId: "evt_signed",
    });
    expect(await caller().stripe(input)).toEqual({
      received: true,
      duplicate: true,
      eventId: "evt_signed",
    });
    expect(fixture.rows("financial_ledger")).toHaveLength(1);
    expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(3000);
    expect(fixture.rows("booking_refund_items")[0].status).toBe("succeeded");
  });
  it("rejects altered signed bodies before creating any provider-event receipt", async () => {
    const input = signed({
      id: "evt_invalid",
      type: "refund.updated",
      data: { object: {} },
    });
    await expect(
      caller().stripe({
        ...input,
        body: input.body.replace("evt_invalid", "evt_changed"),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("stripe_events")).toHaveLength(0);
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
  });
  it("keeps failed local writes retryable instead of acknowledging a refund", async () => {
    const input = signed({
      id: "evt_retry",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_retry",
          payment_intent: "pi_missing",
          amount: 4000,
          amount_refunded: 4000,
          currency: "sar",
        },
      },
    });
    await expect(caller().stripe(input)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(fixture.rows("stripe_events")[0].processed).toBe(false);
    expect(fixture.rows("stripe_events")[0].retryCount).toBe(1);
  });
});
