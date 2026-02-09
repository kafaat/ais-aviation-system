/**
 * Payment Provider Types
 * Shared types for multi-provider payment gateway abstraction
 */

export type PaymentProviderType =
  | "stripe"
  | "hyperpay"
  | "tabby"
  | "tamara"
  | "stc_pay"
  | "moyasar"
  | "floosak"
  | "jawali"
  | "onecash"
  | "easycash";

export type PaymentMethodType =
  | "card"
  | "wallet"
  | "bank_transfer"
  | "mada"
  | "apple_pay"
  | "stc_pay"
  | "tabby"
  | "tamara";

export interface CheckoutSessionInput {
  bookingId: number;
  userId: number;
  amount: number; // in SAR cents
  currency: string;
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  bookingReference: string;
  pnr: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  provider: PaymentProviderType;
  sessionId: string;
  url: string | null;
  expiresAt?: Date;
}

export interface PaymentVerificationResult {
  status: "paid" | "pending" | "failed" | "expired";
  transactionId?: string;
  paidAt?: Date;
  customerEmail?: string;
}

export interface RefundInput {
  transactionId: string;
  amount: number; // in SAR cents
  reason?: string;
}

export interface RefundResult {
  refundId: string;
  status: "pending" | "completed" | "failed";
  amount: number;
}

export interface PaymentProviderInfo {
  id: PaymentProviderType;
  name: string;
  nameAr: string;
  methods: PaymentMethodType[];
  supportsBNPL: boolean;
  supportsRefund: boolean;
  supportsRecurring: boolean;
  minAmount: number; // in SAR cents
  maxAmount: number; // in SAR cents
  currencies: string[];
  region: "international" | "saudi" | "yemen" | "mena";
  enabled: boolean;
}

/**
 * Payment Provider Interface
 * All payment providers must implement this interface
 */
export interface PaymentProvider {
  readonly id: PaymentProviderType;
  readonly name: string;

  /** Check if this provider is configured and available */
  isAvailable(): boolean;

  /** Get provider info including supported methods */
  getInfo(): PaymentProviderInfo;

  /** Create a checkout session */
  createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult>;

  /** Verify payment status */
  verifyPayment(sessionId: string): Promise<PaymentVerificationResult>;

  /** Process refund */
  refund(input: RefundInput): Promise<RefundResult>;
}
