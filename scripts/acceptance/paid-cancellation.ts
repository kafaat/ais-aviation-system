import assert from "node:assert/strict";
import type Stripe from "stripe";
import type { TrpcContext } from "../../server/_core/context";
import { refundsRouter } from "../../server/routers/refunds";
import { stripe } from "../../server/stripe";

/**
 * Runs fn while Stripe refunds are answered locally as succeeded, then
 * restores the client. Returns the refunds the provider recorded.
 */
export async function withSucceededStripeRefunds<T>(
  fn: (provider: Map<string, Stripe.Refund>) => Promise<T>
): Promise<T> {
  const original = {
    create: stripe.refunds.create,
    list: stripe.refunds.list,
    retrieve: stripe.refunds.retrieve,
  };
  const provider = new Map<string, Stripe.Refund>();
  stripe.refunds.list = ((params: Stripe.RefundListParams) => ({
    async *[Symbol.asyncIterator]() {
      for (const r of provider.values())
        if (r.payment_intent === params.payment_intent) yield r;
    },
  })) as unknown as typeof stripe.refunds.list;
  stripe.refunds.create = (async (params: Stripe.RefundCreateParams) => {
    const intent = String(params.payment_intent);
    const refund = {
      id: `re_paid_cancel_${intent}`,
      object: "refund",
      amount: params.amount,
      currency: "sar",
      payment_intent: intent,
      charge: `ch_${intent}`,
      status: "succeeded",
      metadata: params.metadata ?? {},
    } as Stripe.Refund;
    provider.set(intent, refund);
    return refund;
  }) as typeof stripe.refunds.create;
  stripe.refunds.retrieve = (async (refundId: string) => {
    const r = [...provider.values()].find(r => r.id === refundId);
    assert(r);
    return r;
  }) as typeof stripe.refunds.retrieve;
  try {
    return await fn(provider);
  } finally {
    Object.assign(stripe.refunds, original);
  }
}

/**
 * Cancels a paid booking the way the client does: bookings.cancel refuses a
 * booking that is owed a refund, and refunds.create cancels and refunds it
 * together.
 */
export async function cancelPaidBookingThroughRefund(
  ctx: TrpcContext,
  bookingId: number
) {
  return withSucceededStripeRefunds(async provider => {
    const result = await refundsRouter.createCaller(ctx).create({ bookingId });
    assert.equal(result.success, true);
    assert.equal(provider.size, 1);
    return result;
  });
}
