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
 * Tabby Payment Provider
 * Buy Now Pay Later (BNPL) - Split into 4 interest-free payments
 * Popular in Saudi Arabia and UAE
 */
export class TabbyProvider implements PaymentProvider {
  readonly id = "tabby" as const;
  readonly name = "Tabby";

  private get baseUrl(): string {
    return process.env.TABBY_ENV === "production"
      ? "https://api.tabby.ai/api/v2"
      : "https://api.tabby.ai/api/v2";
  }

  private get publicKey(): string {
    return process.env.TABBY_PUBLIC_KEY || "";
  }

  private get secretKey(): string {
    return process.env.TABBY_SECRET_KEY || "";
  }

  isAvailable(): boolean {
    return Boolean(
      process.env.TABBY_PUBLIC_KEY && process.env.TABBY_SECRET_KEY
    );
  }

  getInfo(): PaymentProviderInfo {
    return {
      id: "tabby",
      name: "Tabby - Pay in 4",
      nameAr: "تابي - قسّمها على 4",
      methods: ["tabby"],
      supportsBNPL: true,
      supportsRefund: true,
      supportsRecurring: false,
      minAmount: 100, // 1 SAR
      maxAmount: 500000, // 5,000 SAR
      currencies: ["SAR", "AED", "KWD", "BHD"],
      region: "mena",
      enabled: this.isAvailable(),
    };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const amountInSAR = (input.amount / 100).toFixed(2);

    const payload = {
      payment: {
        amount: amountInSAR,
        currency: input.currency,
        description: input.description,
        buyer: {
          phone: input.customerPhone || "",
          email: input.customerEmail || "",
          name: input.customerName || "Customer",
        },
        order: {
          reference_id: input.bookingReference,
          items: [
            {
              title: input.description,
              quantity: 1,
              unit_price: amountInSAR,
              category: "travel",
            },
          ],
        },
      },
      lang: "ar",
      merchant_code: this.publicKey,
      merchant_urls: {
        success: input.successUrl,
        cancel: input.cancelUrl,
        failure: input.cancelUrl,
      },
    };

    const response = await fetch(`${this.baseUrl}/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!data.id) {
      throw new Error(
        `Tabby checkout creation failed: ${data.error || "Unknown error"}`
      );
    }

    const webUrl =
      data.configuration?.available_products?.installments?.[0]?.web_url;

    return {
      provider: "tabby",
      sessionId: data.id,
      url: webUrl || data.payment?.checkout_url || null,
      expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerificationResult> {
    const response = await fetch(`${this.baseUrl}/payments/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
      },
    });

    const data = await response.json();

    const statusMap: Record<string, PaymentVerificationResult["status"]> = {
      AUTHORIZED: "paid",
      CLOSED: "paid",
      CREATED: "pending",
      REJECTED: "failed",
      EXPIRED: "expired",
    };

    return {
      status: statusMap[data.status] || "pending",
      transactionId: data.id,
      customerEmail: data.buyer?.email,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const response = await fetch(
      `${this.baseUrl}/payments/${input.transactionId}/refunds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: (input.amount / 100).toFixed(2),
        }),
      }
    );

    const data = await response.json();

    return {
      refundId: data.id || `RF-${Date.now()}`,
      status: data.status === "CREATED" ? "completed" : "pending",
      amount: input.amount,
    };
  }
}
