import { describe, it, expect, afterEach, vi } from "vitest";
import {
  assertProviderBoundary,
  isInternalHost,
  providerBoundary,
  providerBoundaryReport,
} from "../_core/provider-boundary";
import {
  createStripeClient,
  STRIPE_API_VERSION,
} from "../services/stripe/client-factory";

const PROVIDER_VARIABLES = [
  "AIS_PROVIDER_BOUNDARY",
  "STRIPE_SECRET_KEY",
  "STRIPE_MOCK_HOST",
  "RESEND_API_KEY",
  "SMS_PROVIDER",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "OPENAI_API_KEY",
  "SENTRY_DSN",
  "OUTBOX_PUBLISH_URL",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "HOTELBEDS_MODE",
  "AVIATION_WEATHER_MODE",
  "ONCALL_MODE",
  "HYPERPAY_ACCESS_TOKEN",
  "TABBY_SECRET_KEY",
];

function state(report: ReturnType<typeof providerBoundaryReport>, id: string) {
  const finding = report.findings.find(f => f.provider === id);
  if (!finding) throw new Error(`No finding for ${id}`);
  return finding;
}

describe("provider boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to open and rejects any other value than open or isolated", () => {
    expect(providerBoundary({})).toBe("open");
    expect(providerBoundary({ AIS_PROVIDER_BOUNDARY: " open " })).toBe("open");
    expect(providerBoundary({ AIS_PROVIDER_BOUNDARY: "isolated" })).toBe(
      "isolated"
    );
    expect(() => providerBoundary({ AIS_PROVIDER_BOUNDARY: "closed" })).toThrow(
      /Invalid AIS_PROVIDER_BOUNDARY/
    );
  });

  it("allows every provider under an open boundary, including live ones", () => {
    const report = providerBoundaryReport({
      STRIPE_SECRET_KEY: "sk_live_example",
      RESEND_API_KEY: "re_example",
      ONCALL_MODE: "live",
      OUTBOX_PUBLISH_URL: "https://receiver.example.com/events",
    });
    expect(report.boundary).toBe("open");
    expect(report.findings.every(f => f.allowed)).toBe(true);
    expect(state(report, "stripe").state).toBe("live");
    expect(() =>
      assertProviderBoundary({ STRIPE_SECRET_KEY: "sk_live_example" })
    ).not.toThrow();
  });

  it("refuses to start an isolated process that could reach a live provider", () => {
    const env = {
      AIS_PROVIDER_BOUNDARY: "isolated",
      STRIPE_SECRET_KEY: "rk_live_example",
      RESEND_API_KEY: "re_example",
      TWILIO_AUTH_TOKEN: "twilio-value-9c1d",
      OPENAI_API_KEY: "sk-example",
      SENTRY_DSN: "https://key@o1.ingest.sentry.io/1",
      OUTBOX_PUBLISH_URL: "https://receiver.example.com/events",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otlp.example.com/v1/traces",
      HOTELBEDS_MODE: "live",
      TABBY_SECRET_KEY: "tabby-value-7f3a",
    };
    const report = providerBoundaryReport(env);
    const refused = report.findings
      .filter(f => !f.allowed)
      .map(f => f.provider);
    expect(refused).toEqual([
      "stripe",
      "resend",
      "sms",
      "openai",
      "sentry",
      "outbox-receiver",
      "otel-collector",
      "hotelbeds",
      "alternative-payment-providers",
    ]);
    let message = "";
    try {
      assertProviderBoundary(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Isolated provider boundary refused: stripe/);
    // Names and variable names only; never a configured value.
    for (const value of Object.values(env).filter(v => v !== "isolated"))
      if (!/^(live)$/.test(value)) expect(message).not.toContain(value);
  });

  it("allows an isolated process whose providers are absent, mocked, internal or sandboxed", () => {
    const env = {
      AIS_PROVIDER_BOUNDARY: "isolated",
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_MOCK_HOST: "stripe-mock.railway.internal:12111",
      SMS_PROVIDER: "mock",
      OUTBOX_PUBLISH_URL: "http://ais-web.railway.internal:3000/api/outbox",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4318/v1/traces",
      HOTELBEDS_MODE: "sandbox",
      AVIATION_WEATHER_MODE: "disabled",
    };
    const report = assertProviderBoundary(env);
    expect(report.boundary).toBe("isolated");
    expect(state(report, "stripe").state).toBe("mock");
    expect(state(report, "sms").state).toBe("mock");
    expect(state(report, "outbox-receiver").state).toBe("mock");
    expect(state(report, "otel-collector").state).toBe("mock");
    expect(state(report, "hotelbeds").state).toBe("sandbox");
    expect(state(report, "weather").state).toBe("absent");
    expect(state(report, "resend").state).toBe("absent");
  });

  it("marks a test Stripe key without a mock host as blocked rather than live", () => {
    const report = assertProviderBoundary({
      AIS_PROVIDER_BOUNDARY: "isolated",
      STRIPE_SECRET_KEY: "sk_test_example",
    });
    expect(state(report, "stripe")).toMatchObject({
      state: "blocked",
      allowed: true,
    });
  });

  it("treats SMS_PROVIDER=twilio as live even without credentials", () => {
    expect(
      state(
        providerBoundaryReport({
          AIS_PROVIDER_BOUNDARY: "isolated",
          SMS_PROVIDER: "twilio",
        }),
        "sms"
      ).allowed
    ).toBe(false);
  });

  it("recognises loopback and Railway private hosts as internal", () => {
    expect(isInternalHost("http://localhost:3000")).toBe(true);
    expect(isInternalHost("http://127.0.0.1:4318/v1/traces")).toBe(true);
    expect(isInternalHost("http://ais-web.railway.internal:3000")).toBe(true);
    expect(isInternalHost("https://ais-web.up.railway.app")).toBe(false);
    expect(isInternalHost("https://api.stripe.com")).toBe(false);
    expect(isInternalHost("not a url")).toBe(false);
  });

  describe("Stripe client factory", () => {
    it("targets api.stripe.com under an open boundary", () => {
      for (const key of PROVIDER_VARIABLES) vi.stubEnv(key, "");
      const client = createStripeClient("sk_test_example");
      expect(client.getApiField("host")).toBe("api.stripe.com");
      expect(client.getApiField("protocol")).toBe("https");
      expect(client.getApiField("version")).toBe(STRIPE_API_VERSION);
    });

    it("refuses to construct a client under isolation without a mock host", () => {
      for (const key of PROVIDER_VARIABLES) vi.stubEnv(key, "");
      vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
      expect(() => createStripeClient("sk_test_example")).toThrow(
        /STRIPE_MOCK_HOST/
      );
    });

    it("redirects the client to the mock host under isolation", () => {
      for (const key of PROVIDER_VARIABLES) vi.stubEnv(key, "");
      vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
      vi.stubEnv("STRIPE_MOCK_HOST", "stripe-mock.railway.internal:12111");
      const client = createStripeClient("sk_test_example", {
        typescript: true,
      });
      expect(client.getApiField("host")).toBe("stripe-mock.railway.internal");
      expect(client.getApiField("port")).toBe("12111");
      expect(client.getApiField("protocol")).toBe("http");
      expect(client.getApiField("version")).toBe(STRIPE_API_VERSION);

      vi.stubEnv("STRIPE_MOCK_HOST", "https://stripe-mock.internal");
      const secure = createStripeClient("sk_test_example");
      expect(secure.getApiField("host")).toBe("stripe-mock.internal");
      expect(secure.getApiField("port")).toBe("443");
      expect(secure.getApiField("protocol")).toBe("https");
    });
  });
});
