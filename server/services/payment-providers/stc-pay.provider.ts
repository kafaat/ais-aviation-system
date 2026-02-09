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
 * STC Pay Payment Provider
 * Saudi Arabia's leading mobile wallet by STC
 */
export class STCPayProvider implements PaymentProvider {
  readonly id = "stc_pay" as const;
  readonly name = "STC Pay";

  private get baseUrl(): string {
    return process.env.STC_PAY_ENV === "production"
      ? "https://b2b.stcpay.com.sa/B2B/api"
      : "https://b2b-sandbox.stcpay.com.sa/B2B/api";
  }

  private get merchantId(): string {
    return process.env.STC_PAY_MERCHANT_ID || "";
  }

  private get apiKey(): string {
    return process.env.STC_PAY_API_KEY || "";
  }

  isAvailable(): boolean {
    return Boolean(
      process.env.STC_PAY_MERCHANT_ID && process.env.STC_PAY_API_KEY
    );
  }

  getInfo(): PaymentProviderInfo {
    return {
      id: "stc_pay",
      name: "STC Pay",
      nameAr: "STC Pay - محفظة إس تي سي",
      methods: ["stc_pay", "wallet"],
      supportsBNPL: false,
      supportsRefund: true,
      supportsRecurring: false,
      minAmount: 100, // 1 SAR
      maxAmount: 2000000, // 20,000 SAR
      currencies: ["SAR"],
      region: "saudi",
      enabled: this.isAvailable(),
    };
  }

  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const amountInSAR = (input.amount / 100).toFixed(2);

    const payload = {
      MerchantId: this.merchantId,
      BranchID: "1",
      TellerID: "1",
      DeviceID: "web",
      RefNum: `BK-${input.bookingId}-${Date.now()}`,
      BillNumber: input.bookingReference,
      Amount: amountInSAR,
      MerchantNote: input.description,
      MobileNo: input.customerPhone || "",
    };

    const response = await fetch(`${this.baseUrl}/DirectPayment/V4/Payment`, {
      method: "POST",
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.StatusCode !== 0) {
      throw new Error(
        `STC Pay payment failed: ${data.StatusDescription || "Unknown error"}`
      );
    }

    return {
      provider: "stc_pay",
      sessionId: data.STCPayPmtReference || `STCPAY-${Date.now()}`,
      url: data.PaymentURL || null,
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerificationResult> {
    const response = await fetch(`${this.baseUrl}/DirectPayment/V4/Status`, {
      method: "POST",
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        MerchantId: this.merchantId,
        STCPayPmtReference: sessionId,
      }),
    });

    const data = await response.json();

    return {
      status:
        data.PaymentStatus === "Paid"
          ? "paid"
          : data.PaymentStatus === "Pending"
            ? "pending"
            : "failed",
      transactionId: data.STCPayPmtReference,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const response = await fetch(`${this.baseUrl}/DirectPayment/V4/Refund`, {
      method: "POST",
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        MerchantId: this.merchantId,
        STCPayPmtReference: input.transactionId,
        Amount: (input.amount / 100).toFixed(2),
        Reason: input.reason || "Refund requested",
      }),
    });

    const data = await response.json();

    return {
      refundId: data.RefundReference || `RF-${Date.now()}`,
      status: data.StatusCode === 0 ? "completed" : "pending",
      amount: input.amount,
    };
  }
}
