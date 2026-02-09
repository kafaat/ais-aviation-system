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
 * Tamara Payment Provider
 * Buy Now Pay Later (BNPL) - Split into 3 payments
 * Popular in Saudi Arabia
 */
export class TamaraProvider implements PaymentProvider {
  readonly id = "tamara" as const;
  readonly name = "Tamara";

  private get baseUrl(): string {
    return process.env.TAMARA_ENV === "production"
      ? "https://api.tamara.co"
      : "https://api-sandbox.tamara.co";
  }

  private get apiToken(): string {
    return process.env.TAMARA_API_TOKEN || "";
  }

  isAvailable(): boolean {
    return Boolean(process.env.TAMARA_API_TOKEN);
  }

  getInfo(): PaymentProviderInfo {
    return {
      id: "tamara",
      name: "Tamara - Split in 3",
      nameAr: "تمارا - قسّمها على 3",
      methods: ["tamara"],
      supportsBNPL: true,
      supportsRefund: true,
      supportsRecurring: false,
      minAmount: 100, // 1 SAR
      maxAmount: 400000, // 4,000 SAR
      currencies: ["SAR", "AED"],
      region: "mena",
      enabled: this.isAvailable(),
    };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const amountInSAR = (input.amount / 100).toFixed(2);

    const payload = {
      order_reference_id: input.bookingReference,
      total_amount: {
        amount: amountInSAR,
        currency: input.currency,
      },
      description: input.description,
      country_code: "SA",
      payment_type: "PAY_BY_INSTALMENTS",
      instalments: 3,
      locale: "ar_SA",
      items: [
        {
          reference_id: `flight-${input.bookingId}`,
          type: "travel",
          name: input.description,
          quantity: 1,
          total_amount: {
            amount: amountInSAR,
            currency: input.currency,
          },
        },
      ],
      consumer: {
        email: input.customerEmail || "",
        first_name: input.customerName?.split(" ")[0] || "Customer",
        last_name: input.customerName?.split(" ").slice(1).join(" ") || "",
        phone_number: input.customerPhone || "",
      },
      merchant_url: {
        success: input.successUrl,
        failure: input.cancelUrl,
        cancel: input.cancelUrl,
        notification: `${process.env.VITE_APP_URL || "http://localhost:3000"}/api/webhooks/tamara`,
      },
    };

    const response = await fetch(`${this.baseUrl}/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!data.order_id) {
      throw new Error(
        `Tamara checkout creation failed: ${JSON.stringify(data.errors || data.message || "Unknown error")}`
      );
    }

    return {
      provider: "tamara",
      sessionId: data.order_id,
      url: data.checkout_url || null,
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerificationResult> {
    const response = await fetch(`${this.baseUrl}/orders/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    const data = await response.json();

    const statusMap: Record<string, PaymentVerificationResult["status"]> = {
      approved: "paid",
      fully_captured: "paid",
      new: "pending",
      declined: "failed",
      expired: "expired",
    };

    return {
      status: statusMap[data.status] || "pending",
      transactionId: data.order_id,
      customerEmail: data.consumer?.email,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const response = await fetch(
      `${this.baseUrl}/orders/${input.transactionId}/refunds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          total_amount: {
            amount: (input.amount / 100).toFixed(2),
            currency: "SAR",
          },
          comment: input.reason || "Refund requested",
        }),
      }
    );

    const data = await response.json();

    return {
      refundId: data.refund_id || `RF-${Date.now()}`,
      status: data.status === "fully_refunded" ? "completed" : "pending",
      amount: input.amount,
    };
  }
}
