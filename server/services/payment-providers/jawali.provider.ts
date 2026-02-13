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
 * Jawali Payment Provider
 * Yemen Mobile Money - MTN Yemen
 */
export class JawaliProvider implements PaymentProvider {
  readonly id = "jawali" as const;
  readonly name = "Jawali";

  private get baseUrl(): string {
    return process.env.JAWALI_BASE_URL || "https://api.jawali.ye/v1";
  }

  private get merchantId(): string {
    return process.env.JAWALI_MERCHANT_ID || "";
  }

  private get apiKey(): string {
    return process.env.JAWALI_API_KEY || "";
  }

  isAvailable(): boolean {
    return Boolean(
      process.env.JAWALI_MERCHANT_ID && process.env.JAWALI_API_KEY
    );
  }

  getInfo(): PaymentProviderInfo {
    return {
      id: "jawali",
      name: "Jawali Mobile Money",
      nameAr: "جوالي - موبايل موني",
      methods: ["wallet"],
      supportsBNPL: false,
      supportsRefund: true,
      supportsRecurring: false,
      minAmount: 100,
      maxAmount: 10000000, // 100,000 YER
      currencies: ["YER"],
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
      reference: input.bookingReference,
      description: input.description,
      customer_phone: input.customerPhone || "",
      customer_name: input.customerName || "",
      callback_url: input.successUrl,
      webhook_url: `${process.env.VITE_APP_URL || "http://localhost:3000"}/api/webhooks/jawali`,
    };

    const response = await fetch(`${this.baseUrl}/payments/initiate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!data.payment_id) {
      throw new Error(
        `Jawali payment initiation failed: ${data.message || "Unknown error"}`
      );
    }

    return {
      provider: "jawali",
      sessionId: data.payment_id,
      url: data.payment_url || null,
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerificationResult> {
    const response = await fetch(`${this.baseUrl}/payments/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    const data = await response.json();

    const statusMap: Record<string, PaymentVerificationResult["status"]> = {
      completed: "paid",
      success: "paid",
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
      `${this.baseUrl}/payments/${input.transactionId}/refund`,
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
