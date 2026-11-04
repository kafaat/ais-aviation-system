import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertProviderBoundary,
  providerBoundaryReport,
} from "../_core/provider-boundary";
import {
  createStripeClient,
  STRIPE_API_VERSION,
} from "../services/stripe/client-factory";

const TEST_TOKEN = "sk_test_short_fixture";

beforeEach(() => {
  vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
  vi.stubEnv("STRIPE_MOCK_HOST", "http://stripe-mock.railway.internal:12111");
  vi.stubEnv("STRIPE_SECRET_KEY", TEST_TOKEN);
});
afterEach(() => vi.unstubAllEnvs());

describe("isolated Stripe transport", () => {
  it.each([
    [
      "stripe-mock.railway.internal:12111",
      "stripe-mock.railway.internal",
      "12111",
      "http",
    ],
    [
      "https://stripe-mock.railway.internal",
      "stripe-mock.railway.internal",
      "443",
      "https",
    ],
    ["http://127.0.0.1:12111/", "127.0.0.1", "12111", "http"],
    ["http://localhost:12111", "localhost", "12111", "http"],
    ["http://[::1]:12111", "::1", "12111", "http"],
  ])(
    "uses the approved endpoint %s with a short mock token",
    (url, host, port, protocol) => {
      vi.stubEnv("STRIPE_MOCK_HOST", url);
      const client = createStripeClient(TEST_TOKEN);
      expect(client.getApiField("host")).toBe(host);
      expect(client.getApiField("port")).toBe(port);
      expect(client.getApiField("protocol")).toBe(protocol);
      expect(client.getApiField("version")).toBe(STRIPE_API_VERSION);
      const report = assertProviderBoundary({
        AIS_PROVIDER_BOUNDARY: "isolated",
        STRIPE_SECRET_KEY: TEST_TOKEN,
        STRIPE_MOCK_HOST: url,
      });
      expect(report.findings.find(f => f.provider === "stripe")).toMatchObject({
        state: "mock",
        allowed: true,
      });
    }
  );

  it.each([
    "https://api.stripe.com",
    "https://stripe-mock.railway.internal.example.com",
    "http://stripe-mock.internal:12111",
    "http://stripe-mock.local:12111",
    "http://10.0.0.1:12111",
    "ftp://stripe-mock.railway.internal:12111",
    "http://secret_user:secret_password@stripe-mock.railway.internal:12111",
    "http://@localhost:12111",
    "http://stripe-mock.railway.internal:12111/v1",
    "http://stripe-mock.railway.internal:12111/.",
    "http://stripe-mock.railway.internal:12111/?token=private_marker",
    "http://stripe-mock.railway.internal:12111/#private_marker",
    "http://stripe-mock.railway.internal:0",
    "http://stripe-mock.railway.internal:65536",
    "http:///localhost:12111",
    "http://stripe-mock.railway.internal\\@example.com",
  ])(
    "refuses an external or malformed endpoint %s before constructing a client",
    url => {
      vi.stubEnv("STRIPE_MOCK_HOST", url);
      expect(() => createStripeClient(TEST_TOKEN)).toThrow(
        /STRIPE_MOCK_(URL_INVALID|HOST_EXTERNAL)/
      );
      const environment = {
        AIS_PROVIDER_BOUNDARY: "isolated",
        STRIPE_SECRET_KEY: TEST_TOKEN,
        STRIPE_MOCK_HOST: url,
      };
      const finding = providerBoundaryReport(environment).findings.find(
        f => f.provider === "stripe"
      );
      expect(finding).toMatchObject({ state: "blocked", allowed: false });
      expect(() => assertProviderBoundary(environment)).toThrow(
        /Isolated provider boundary refused: stripe/
      );
      expect(JSON.stringify(finding)).not.toContain(url);
      expect(JSON.stringify(finding)).not.toContain(TEST_TOKEN);
    }
  );

  it.each(["sk_live_local_fixture", "rk_live_local_fixture"])(
    "refuses the actual live client argument %s even when the environment contains a test token",
    key => {
      expect(() => createStripeClient(key)).toThrow("STRIPE_LIVE_KEY_REFUSED");
    }
  );

  it.each([
    "",
    "sk_test_",
    "untyped_fixture",
    "rk_test_fixture",
    "sk_test_with space",
  ])("refuses an absent or invalid isolated token %s", key => {
    expect(() => createStripeClient(key)).toThrow(
      /STRIPE_(KEY_MISSING|TEST_KEY_REQUIRED)/
    );
  });

  it.each([
    "host",
    "port",
    "protocol",
    "httpClient",
    "httpAgent",
    "authenticator",
  ])("refuses the runtime constructor override %s", field => {
    const options = {
      [field]: "private_override_marker",
    } as unknown as Parameters<typeof createStripeClient>[1];
    expect(() => createStripeClient(TEST_TOKEN, options)).toThrow(
      "STRIPE_TRANSPORT_OVERRIDE_REFUSED"
    );
  });

  it("keeps an isolated test token blocked when no mock was configured", () => {
    vi.stubEnv("STRIPE_MOCK_HOST", "");
    expect(() => createStripeClient(TEST_TOKEN)).toThrow(
      "STRIPE_MOCK_HOST_MISSING"
    );
    expect(
      providerBoundaryReport({
        AIS_PROVIDER_BOUNDARY: "isolated",
        STRIPE_SECRET_KEY: TEST_TOKEN,
      }).findings[0]
    ).toMatchObject({ state: "blocked", allowed: true });
  });

  it("preserves the open SDK endpoint and does not report an ignored mock as active", () => {
    vi.stubEnv("AIS_PROVIDER_BOUNDARY", "open");
    const client = createStripeClient(TEST_TOKEN);
    expect(client.getApiField("host")).toBe("api.stripe.com");
    expect(client.getApiField("protocol")).toBe("https");
    const report = providerBoundaryReport({
      AIS_PROVIDER_BOUNDARY: "open",
      STRIPE_SECRET_KEY: TEST_TOKEN,
      STRIPE_MOCK_HOST: "http://stripe-mock.railway.internal:12111",
    });
    expect(report.findings[0]).toMatchObject({
      state: "sandbox",
      allowed: true,
    });
  });

  it("reaches an IPv6 loopback mock through the actual SDK without URL brackets in the socket host", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          object: "balance",
          livemode: false,
          available: [],
          pending: [],
        })
      );
    });
    server.listen(0, "::1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing loopback address");
      vi.stubEnv("STRIPE_MOCK_HOST", `http://[::1]:${address.port}`);
      const client = createStripeClient(TEST_TOKEN, {
        timeout: 1000,
        maxNetworkRetries: 0,
      });
      expect(await client.balance.retrieve()).toMatchObject({
        object: "balance",
        livemode: false,
      });
      expect(requests).toEqual(["GET /v1/balance"]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });
});
