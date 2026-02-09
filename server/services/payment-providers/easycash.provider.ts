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
 * EasyCash Payment Provider
 * Yemeni electronic wallet (محفظة إيزي كاش)
 */
export class EasyCashProvider implements PaymentProvider {
  readonly id = "easycash" as const;
  readonly name = "EasyCash";

  private get baseUrl(): string {
    return process.env.EASYCASH_BASE_URL || "https://api.easycash.ye/v1";
  }

  private get merchantId(): string {
    return process.env.EASYCASH_MERCHANT_ID || "";
  }

  private get apiKey(): string {
    return process.env.EASYCASH_API_KEY || "";
  }

  isAvailable(): boolean {
    return Boolean(
      process.env.EASYCASH_MERCHANT_ID && process.env.EASYCASH_API_KEY
    );
  }

  getInfo(): PaymentProviderInfo {
    return {
      id: "easycash",
      name: "EasyCash Wallet",
      nameAr: "محفظة إيزي كاش",
      methods: ["wallet"],
      supportsBNPL: false,
      supportsRefund: true,
      supportsRecurring: false,
      minAmount: 100,
      maxAmount: 10000000,
      currencies: ["YER", "USD"],
      region: "yemen",
      enabled: this.isAvailable(),
    };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const payload = {
      merchant_id: this.merchantId,
      amount: (input.amount / 100).toFixed(2),
      currency: input.currency,
      order_id: input.bookingReference,
      description: input.description,
      customer_phone: input.customerPhone || "",
      customer_name: input.customerName || "",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      webhook_url: `${process.env.VITE_APP_URL || "http://localhost:3000"}/api/webhooks/easycash`,
    };

    const response = await fetch(`${this.baseUrl}/checkout`, {
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
        `EasyCash checkout creation failed: ${data.message || "Unknown error"}`
      );
    }

    return {
      provider: "easycash",
      sessionId: data.checkout_id,
      url: data.checkout_url || null,
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
