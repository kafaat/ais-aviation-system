/**
 * Payment Provider Registry
 * Central factory for all payment providers
 */

import type {
  PaymentProvider,
  PaymentProviderType,
  PaymentProviderInfo,
  CheckoutSessionInput,
  CheckoutSessionResult,
  PaymentVerificationResult,
} from "./types";
import { StripeProvider } from "./stripe.provider";
import { HyperPayProvider } from "./hyperpay.provider";
import { TabbyProvider } from "./tabby.provider";
import { TamaraProvider } from "./tamara.provider";
import { STCPayProvider } from "./stc-pay.provider";
import { FloosAkProvider } from "./floosak.provider";
import { JawaliProvider } from "./jawali.provider";
import { OneCashProvider } from "./onecash.provider";
import { EasyCashProvider } from "./easycash.provider";

export type {
  PaymentProvider,
  PaymentProviderType,
  PaymentProviderInfo,
  CheckoutSessionInput,
  CheckoutSessionResult,
  PaymentVerificationResult,
};

// Singleton instances for all providers
const providers: Map<PaymentProviderType, PaymentProvider> = new Map();

function initProviders() {
  if (providers.size > 0) return;

  const allProviders: PaymentProvider[] = [
    new StripeProvider(),
    new HyperPayProvider(),
    new TabbyProvider(),
    new TamaraProvider(),
    new STCPayProvider(),
    new FloosAkProvider(),
    new JawaliProvider(),
    new OneCashProvider(),
    new EasyCashProvider(),
  ];

  for (const provider of allProviders) {
    providers.set(provider.id, provider);
  }
}

/**
 * Get a specific payment provider by ID
 */
export function getProvider(id: PaymentProviderType): PaymentProvider {
  initProviders();
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`Payment provider '${id}' not found`);
  }
  return provider;
}

/**
 * Get all registered payment providers (including unavailable ones)
 */
export function getAllProviders(): PaymentProvider[] {
  initProviders();
  return Array.from(providers.values());
}

/**
 * Get only available (configured) payment providers
 */
export function getAvailableProviders(): PaymentProvider[] {
  initProviders();
  return Array.from(providers.values()).filter(p => p.isAvailable());
}

/**
 * Get provider info for all registered providers
 */
export function getAllProviderInfo(): PaymentProviderInfo[] {
  initProviders();
  return Array.from(providers.values()).map(p => p.getInfo());
}

/**
 * Get provider info for available providers only
 */
export function getAvailableProviderInfo(): PaymentProviderInfo[] {
  initProviders();
  return Array.from(providers.values())
    .filter(p => p.isAvailable())
    .map(p => p.getInfo());
}

/**
 * Create checkout session with a specific provider
 */
export function createCheckoutWithProvider(
  providerId: PaymentProviderType,
  input: CheckoutSessionInput
): Promise<CheckoutSessionResult> {
  const provider = getProvider(providerId);

  if (!provider.isAvailable()) {
    throw new Error(`Payment provider '${providerId}' is not configured`);
  }

  const info = provider.getInfo();
  if (input.amount < info.minAmount) {
    throw new Error(
      `Amount below minimum for ${provider.name}: ${info.minAmount / 100} ${input.currency}`
    );
  }
  if (input.amount > info.maxAmount) {
    throw new Error(
      `Amount exceeds maximum for ${provider.name}: ${info.maxAmount / 100} ${input.currency}`
    );
  }

  return provider.createCheckoutSession(input);
}

/**
 * Verify payment with a specific provider
 */
export function verifyPaymentWithProvider(
  providerId: PaymentProviderType,
  sessionId: string
): Promise<PaymentVerificationResult> {
  const provider = getProvider(providerId);
  return provider.verifyPayment(sessionId);
}
