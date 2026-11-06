import { TRPCError } from "@trpc/server";
import type { PaymentProviderInfo, PaymentProviderType } from "./types";

export const UNVERIFIED_PAYMENT_INTEGRATION =
  "This provider requires verified invoice/session binding, amount and currency checks, settlement and refund integration before activation";

/** Credentials are configuration, not financial acceptance or live readiness. */
export function hasAcceptedPaymentIntegration(
  id: PaymentProviderType
): boolean {
  return id === "stripe";
}

/** Applies to registry selection AND direct adapter calls, before any HTTP work. */
export function requireAcceptedPaymentIntegration(
  id: PaymentProviderType
): void {
  if (!hasAcceptedPaymentIntegration(id))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: UNVERIFIED_PAYMENT_INTEGRATION,
    });
}

export function paymentIntegrationInfo(
  id: PaymentProviderType
): Pick<PaymentProviderInfo, "integrationState" | "unavailableReason"> {
  return hasAcceptedPaymentIntegration(id)
    ? { integrationState: "implemented" }
    : {
        integrationState: "unverified",
        unavailableReason: UNVERIFIED_PAYMENT_INTEGRATION,
      };
}
