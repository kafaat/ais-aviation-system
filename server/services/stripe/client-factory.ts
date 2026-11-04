/** The one place a Stripe client is constructed.
 *
 * Three call sites used to build their own client with the same API version.
 * Centralising them is what lets the provider boundary hold: under
 * `AIS_PROVIDER_BOUNDARY=isolated` a client is only ever constructed against
 * `STRIPE_MOCK_HOST`, and without one this throws before any client exists —
 * so no request can reach api.stripe.com, however a job is triggered.
 */
import Stripe from "stripe";
import {
  resolveStripeTransport,
  StripeConfigurationError,
} from "../../_core/stripe-transport";

export const STRIPE_API_VERSION = "2025-12-15.clover";

export function createStripeClient(
  secretKey: string,
  options: Omit<
    Stripe.StripeConfig,
    "apiVersion" | "host" | "port" | "protocol"
  > = {}
): Stripe {
  const transport = resolveStripeTransport(secretKey);
  if (transport.mode === "mock") {
    // TypeScript's Omit does not protect JavaScript or untyped call sites.
    for (const name of [
      "host",
      "port",
      "protocol",
      "httpClient",
      "httpAgent",
      "authenticator",
    ]) {
      if (Object.hasOwn(options, name))
        throw new StripeConfigurationError("STRIPE_TRANSPORT_OVERRIDE_REFUSED");
    }
    return new Stripe(secretKey.trim(), {
      ...options,
      apiVersion: STRIPE_API_VERSION,
      host: transport.host,
      port: transport.port,
      protocol: transport.protocol,
    });
  }
  return new Stripe(secretKey, { ...options, apiVersion: STRIPE_API_VERSION });
}
