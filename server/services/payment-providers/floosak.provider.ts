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
 * FloosAk Payment Provider
 * Yemeni mobile wallet and payment gateway
 */
export class FloosAkProvider implements PaymentProvider {
  readonly id = "floosak" as const;
  readonly name = "FloosAk";

  private get baseUrl(): string {
    return process.env.FLOOSAK_BASE_URL || "https://api.floosak.com/v1";
  }

  private get merchantId(): string {
    return process.env.FLOOSAK_MERCHANT_ID || "";
  }

  private get apiKey(): string {
    return process.env.FLOOSAK_API_KEY || "";
  }

  isAvailable(): boolean {
    return Boolean(
      process.env.FLOOSAK_MERCHANT_ID && process.env.FLOOSAK_API_KEY
    );
  }

  getInfo(): PaymentProviderInfo {
    return {
      id: "floosak",
      name: "FloosAk",
      nameAr: "فلوسك",
      methods: ["wallet"],
      supportsBNPL: false,
      supportsRefund: true,
      supportsRecurring: false,
      minAmount: 100, // 1 YER equivalent
      maxAmount: 50000000, // 500,000 YER equivalent
      currencies: ["YER", "SAR", "USD"],
      region: "yemen",
      enabled: this.isAvailable(),
    };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const amountInCurrency = (input.amount / 100).toFixed(2);

    const payload = {
      merchant_id: this.merchantId,
      amount: amountInCurrency,
      currency: input.currency,
      order_id: input.bookingReference,
      description: input.description,
      customer_email: input.customerEmail || "",
      customer_phone: input.customerPhone || "",
      customer_name: input.customerName || "",
      return_url: input.successUrl,
      cancel_url: input.cancelUrl,
      webhook_url: `${process.env.VITE_APP_URL || "http://localhost:3000"}/api/webhooks/floosak`,
      metadata: {
        bookingId: input.bookingId.toString(),
        userId: input.userId.toString(),
      },
    };

    const response = await fetch(`${this.baseUrl}/checkout/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!data.checkout_id) {
      throw new Error(
        `FloosAk checkout creation failed: ${data.message || "Unknown error"}`
      );
    }

    return {
      provider: "floosak",
      sessionId: data.checkout_id,
      url: data.checkout_url || null,
      expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerificationResult> {
    const response = await fetch(
      `${this.baseUrl}/checkout/${sessionId}/status`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    const data = await response.json();

    const statusMap: Record<string, PaymentVerificationResult["status"]> = {
      completed: "paid",
      paid: "paid",
      pending: "pending",
      failed: "failed",
      expired: "expired",
    };

    return {
      status: statusMap[data.status] || "pending",
      transactionId: data.transaction_id,
      customerEmail: data.customer_email,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const response = await fetch(
      `${this.baseUrl}/transactions/${input.transactionId}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: (input.amount / 100).toFixed(2),
          reason: input.reason || "Refund requested",
        }),
      }
    );

    const data = await response.json();

    return {
      refundId: data.refund_id || `RF-${Date.now()}`,
      status: data.status === "completed" ? "completed" : "pending",
      amount: input.amount,
    };
  }
}
