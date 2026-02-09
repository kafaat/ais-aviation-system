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
 * HyperPay Payment Provider
 * Saudi Arabia's leading payment gateway
 * Supports: mada, Visa, MasterCard, Apple Pay, STC Pay
 */
export class HyperPayProvider implements PaymentProvider {
  readonly id = "hyperpay" as const;
  readonly name = "HyperPay";

  private get baseUrl(): string {
    return process.env.HYPERPAY_ENV === "production"
      ? "https://eu-prod.oppwa.com"
      : "https://eu-test.oppwa.com";
  }

  private get entityId(): string {
    return process.env.HYPERPAY_ENTITY_ID || "";
  }

  private get accessToken(): string {
    return process.env.HYPERPAY_ACCESS_TOKEN || "";
  }

  isAvailable(): boolean {
    return Boolean(
      process.env.HYPERPAY_ENTITY_ID && process.env.HYPERPAY_ACCESS_TOKEN
    );
  }

  getInfo(): PaymentProviderInfo {
    return {
      id: "hyperpay",
      name: "HyperPay (mada, Visa, MC)",
      nameAr: "هايبر باي (مدى، فيزا، ماستركارد)",
      methods: ["card", "mada", "apple_pay"],
      supportsBNPL: false,
      supportsRefund: true,
      supportsRecurring: true,
      minAmount: 100, // 1 SAR
      maxAmount: 99999900,
      currencies: ["SAR"],
      region: "saudi",
      enabled: this.isAvailable(),
    };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const amountInSAR = (input.amount / 100).toFixed(2);

    const params = new URLSearchParams({
      entityId: this.entityId,
      amount: amountInSAR,
      currency: input.currency,
      paymentType: "DB", // Debit (immediate capture)
      "customer.email": input.customerEmail || "",
      "customer.givenName": input.customerName || "Customer",
      merchantTransactionId: `BK-${input.bookingId}-${Date.now()}`,
      "customParameters[bookingId]": input.bookingId.toString(),
      "customParameters[userId]": input.userId.toString(),
      "customParameters[bookingReference]": input.bookingReference,
      shopperResultUrl: input.successUrl,
    });

    const response = await fetch(`${this.baseUrl}/v1/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!data.id) {
      throw new Error(
        `HyperPay checkout creation failed: ${data.result?.description || "Unknown error"}`
      );
    }

    const checkoutUrl = `${this.baseUrl}/v1/paymentWidgets.js?checkoutId=${data.id}`;

    return {
      provider: "hyperpay",
      sessionId: data.id,
      url: checkoutUrl,
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerificationResult> {
    const response = await fetch(
      `${this.baseUrl}/v1/checkouts/${sessionId}/payment?entityId=${this.entityId}`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    const data = await response.json();
    const code = data.result?.code || "";

    // HyperPay success codes start with "000."
    const isSuccess = /^(000\.000\.|000\.100\.1|000\.[36])/.test(code);
    const isPending = /^(000\.200|800\.400\.5|100\.400\.500)/.test(code);

    return {
      status: isSuccess ? "paid" : isPending ? "pending" : "failed",
      transactionId: data.id,
      customerEmail: data.customer?.email,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const params = new URLSearchParams({
      entityId: this.entityId,
      amount: (input.amount / 100).toFixed(2),
      currency: "SAR",
      paymentType: "RF", // Refund
    });

    const response = await fetch(
      `${this.baseUrl}/v1/payments/${input.transactionId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );

    const data = await response.json();
    const code = data.result?.code || "";
    const isSuccess = /^(000\.000\.|000\.100\.1|000\.[36])/.test(code);

    return {
      refundId: data.id || `RF-${Date.now()}`,
      status: isSuccess ? "completed" : "pending",
      amount: input.amount,
    };
  }
}
