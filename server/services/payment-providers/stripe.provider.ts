import Stripe from "stripe";
import type {
  PaymentProvider,
  PaymentProviderInfo,
  CheckoutSessionInput,
  CheckoutSessionResult,
  PaymentVerificationResult,
  RefundInput,
  RefundResult,
} from "./types";

/**
 * Stripe Payment Provider
 * International card payments (Visa, MasterCard, AMEX)
 */
export class StripeProvider implements PaymentProvider {
  readonly id = "stripe" as const;
  readonly name = "Stripe";
  private client: Stripe | null = null;

  private getClient(): Stripe {
    if (!this.client) {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new Error("STRIPE_SECRET_KEY environment variable is not set");
      }
      this.client = new Stripe(stripeKey, {
        apiVersion: "2025-12-15.clover",
      });
    }
    return this.client;
  }

  isAvailable(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  }

  getInfo(): PaymentProviderInfo {
    return {
      id: "stripe",
      name: "Credit/Debit Card",
      nameAr: "بطاقة ائتمان / خصم",
      methods: ["card", "apple_pay"],
      supportsBNPL: false,
      supportsRefund: true,
      supportsRecurring: true,
      minAmount: 200, // 2 SAR
      maxAmount: 99999900, // 999,999 SAR
      currencies: ["SAR", "USD", "EUR", "GBP"],
      region: "international",
      enabled: this.isAvailable(),
    };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const stripe = this.getClient();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            product_data: {
              name: input.description,
              description: `PNR: ${input.pnr} - Ref: ${input.bookingReference}`,
              metadata: {
                bookingReference: input.bookingReference,
                pnr: input.pnr,
              },
            },
            unit_amount: input.amount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail || undefined,
      client_reference_id: input.userId.toString(),
      metadata: {
        bookingId: input.bookingId.toString(),
        userId: input.userId.toString(),
        bookingReference: input.bookingReference,
        provider: "stripe",
        ...(input.metadata || {}),
      },
      allow_promotion_codes: true,
    });

    return {
      provider: "stripe",
      sessionId: session.id,
      url: session.url,
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerificationResult> {
    const stripe = this.getClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const statusMap: Record<string, PaymentVerificationResult["status"]> = {
      paid: "paid",
      unpaid: "pending",
      no_payment_required: "paid",
    };

    return {
      status: statusMap[session.payment_status] || "pending",
      transactionId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id,
      customerEmail: session.customer_email || undefined,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const stripe = this.getClient();
    const refund = await stripe.refunds.create({
      payment_intent: input.transactionId,
      amount: input.amount,
      reason: "requested_by_customer",
    });

    return {
      refundId: refund.id,
      status: refund.status === "succeeded" ? "completed" : "pending",
      amount: refund.amount || input.amount,
    };
  }
}
