/** Shared configuration for the Stripe SDK and the isolated readiness probe.
 * No configured values are included in errors or diagnostic reason codes.
 */
export type ProviderBoundary = "open" | "isolated";
export type StripeTransportEnvironment = Record<string, string | undefined>;

export function providerBoundary(
  env: StripeTransportEnvironment = process.env
): ProviderBoundary {
  const value = env.AIS_PROVIDER_BOUNDARY?.trim();
  if (!value || value === "open") return "open";
  if (value === "isolated") return "isolated";
  throw new Error("Invalid AIS_PROVIDER_BOUNDARY; expected open or isolated");
}

export type StripeConfigurationReason =
  | "STRIPE_KEY_MISSING"
  | "STRIPE_LIVE_KEY_REFUSED"
  | "STRIPE_TEST_KEY_REQUIRED"
  | "STRIPE_MOCK_HOST_MISSING"
  | "STRIPE_MOCK_URL_INVALID"
  | "STRIPE_MOCK_HOST_EXTERNAL"
  | "STRIPE_TRANSPORT_OVERRIDE_REFUSED";

export class StripeConfigurationError extends Error {
  constructor(readonly reason: StripeConfigurationReason) {
    super(reason);
    this.name = "StripeConfigurationError";
  }
}

export type StripeTransport =
  | { mode: "configuration" }
  | {
      mode: "mock";
      origin: string;
      host: string;
      port: string;
      protocol: "http" | "https";
    };

export function resolveStripeTransport(
  secretKey: string | undefined,
  env: StripeTransportEnvironment = process.env
): StripeTransport {
  if (providerBoundary(env) === "open") return { mode: "configuration" };

  const key = secretKey?.trim();
  if (!key) throw new StripeConfigurationError("STRIPE_KEY_MISSING");
  if (/^(sk|rk)_live_/.test(key))
    throw new StripeConfigurationError("STRIPE_LIVE_KEY_REFUSED");
  // stripe-mock accepts short test tokens. They are not live API credentials.
  if (!/^sk_test_[A-Za-z0-9_]+$/.test(key))
    throw new StripeConfigurationError("STRIPE_TEST_KEY_REQUIRED");

  const mock = env.STRIPE_MOCK_HOST?.trim();
  if (!mock) throw new StripeConfigurationError("STRIPE_MOCK_HOST_MISSING");
  let url: URL;
  try {
    if (/[\s\\?#]/.test(mock)) throw new Error();
    const target = mock.includes("://") ? mock : `http://${mock}`;
    if (!/^https?:\/\/[^/]+\/?$/i.test(target) || target.includes("@"))
      throw new Error();
    url = new URL(target);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.port === "0"
    )
      throw new Error();
  } catch {
    throw new StripeConfigurationError("STRIPE_MOCK_URL_INVALID");
  }
  const host = url.hostname;
  // The approved mock is on Railway private DNS or loopback. Generic
  // .internal/.local names and other private IP ranges are not approved here.
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(host) &&
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.railway\.internal$/.test(
      host
    )
  )
    throw new StripeConfigurationError("STRIPE_MOCK_HOST_EXTERNAL");

  const protocol = url.protocol === "https:" ? "https" : "http";
  return {
    mode: "mock",
    origin: url.origin,
    // Node's HTTP client expects an IPv6 address without URL brackets.
    // The origin retains its brackets for fetch and URL construction.
    host: host === "[::1]" ? "::1" : host,
    port: url.port || (protocol === "https" ? "443" : "80"),
    protocol,
  };
}
