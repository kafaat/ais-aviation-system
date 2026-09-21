/** The one place a Stripe client is constructed.
 *
 * Three call sites used to build their own client with the same API version.
 * Centralising them is what lets the provider boundary hold: under
 * `AIS_PROVIDER_BOUNDARY=isolated` a client is only ever constructed against
 * `STRIPE_MOCK_HOST`, and without one this throws before any client exists —
 * so no request can reach api.stripe.com, however a job is triggered.
 */
import Stripe from "stripe";
import { providerBoundary } from "../../_core/provider-boundary";

export const STRIPE_API_VERSION = "2025-12-15.clover";

export function createStripeClient(
  secretKey: string,
  options: Omit<
    Stripe.StripeConfig,
    "apiVersion" | "host" | "port" | "protocol"
  > = {}
): Stripe {
  if (providerBoundary() === "isolated") {
    const mock = process.env.STRIPE_MOCK_HOST?.trim();
    if (!mock)
      throw new Error(
        "Stripe is unavailable under the isolated provider boundary: set STRIPE_MOCK_HOST to a stripe-mock instance or run with AIS_PROVIDER_BOUNDARY=open"
      );
    const url = new URL(mock.includes("://") ? mock : `http://${mock}`);
    const protocol = url.protocol === "https:" ? "https" : "http";
    return new Stripe(secretKey, {
      ...options,
      apiVersion: STRIPE_API_VERSION,
      host: url.hostname,
      port: url.port || (protocol === "https" ? "443" : "80"),
      protocol,
    });
  }
  return new Stripe(secretKey, { ...options, apiVersion: STRIPE_API_VERSION });
}
