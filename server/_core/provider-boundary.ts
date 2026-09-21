/** Provider boundary.
 *
 * The staging runbook blocks the worker for one stated reason: "a synthetic
 * Stripe key does not prevent outbound requests." A process that merely fails
 * authentication at api.stripe.com has still called api.stripe.com, and the
 * same is true of every other external provider the worker's jobs can reach.
 * This module makes that boundary a configured, inspectable fact rather than a
 * hope about which variables happen to be set.
 *
 * `AIS_PROVIDER_BOUNDARY=open` (the default) changes nothing: production and
 * development behave exactly as before. `isolated` is for a copy of the system
 * that must not touch any live provider. Under it:
 *
 *  - a credential that can only mean a live account (`sk_live_`, a real Resend,
 *    Twilio, OpenAI or Sentry key, an external outbox receiver, a provider mode
 *    of `live`) **refuses to start** the process;
 *  - a Stripe test key is allowed to exist but is **blocked at the client
 *    factory**: no client targeting api.stripe.com is ever constructed, so a
 *    job that reaches for Stripe fails closed before any request, and its
 *    durable retry machinery records the failure;
 *  - `STRIPE_MOCK_HOST` redirects the client to a stripe-mock instance instead,
 *    which is the only way Stripe-dependent jobs run under isolation.
 *
 * Values are never included in findings or errors; only provider names and
 * states are, because this report is written to logs.
 */

export type ProviderBoundary = "open" | "isolated";

export type BoundaryState =
  /** No credential or mode present; nothing can be called. */
  | "absent"
  /** A test credential exists; calls are refused at the client factory. */
  | "blocked"
  /** Redirected to a mock or an internal host; calls stay inside. */
  | "mock"
  /** A sandbox mode for an adapter that enforces its own sandbox. */
  | "sandbox"
  /** Would reach a live provider. */
  | "live";

export interface BoundaryFinding {
  provider: string;
  state: BoundaryState;
  /** False only for `live` under an isolated boundary. */
  allowed: boolean;
  reason: string;
}

export interface BoundaryReport {
  boundary: ProviderBoundary;
  findings: BoundaryFinding[];
}

type Env = Record<string, string | undefined>;

export function providerBoundary(env: Env = process.env): ProviderBoundary {
  const value = env.AIS_PROVIDER_BOUNDARY?.trim();
  if (!value || value === "open") return "open";
  if (value === "isolated") return "isolated";
  throw new Error("Invalid AIS_PROVIDER_BOUNDARY; expected open or isolated");
}

const present = (value: string | undefined): boolean =>
  Boolean(value && value.trim());

/** Railway private networking and loopback never leave the environment. */
export function isInternalHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".railway.internal") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function stripeFinding(env: Env): BoundaryFinding {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key)
    return {
      provider: "stripe",
      state: "absent",
      allowed: true,
      reason: "No secret key",
    };
  if (/^(sk|rk)_live_/.test(key))
    return {
      provider: "stripe",
      state: "live",
      allowed: false,
      reason: "Live secret key present",
    };
  if (present(env.STRIPE_MOCK_HOST))
    return {
      provider: "stripe",
      state: "mock",
      allowed: true,
      reason: "Client redirected to STRIPE_MOCK_HOST",
    };
  return {
    provider: "stripe",
    state: "blocked",
    allowed: true,
    reason:
      "Test key present without STRIPE_MOCK_HOST; the client factory refuses to construct a client, so no request reaches api.stripe.com",
  };
}

function credentialFinding(
  provider: string,
  variables: readonly string[],
  env: Env
): BoundaryFinding {
  const set = variables.filter(name => present(env[name]));
  if (!set.length)
    return {
      provider,
      state: "absent",
      allowed: true,
      reason: "No credential",
    };
  return {
    provider,
    state: "live",
    allowed: false,
    reason: `Credential present (${set.join(", ")}); this provider has no sandbox switch`,
  };
}

function modeFinding(
  provider: string,
  variable: string,
  env: Env
): BoundaryFinding {
  const mode = env[variable]?.trim() || "disabled";
  if (mode === "live")
    return {
      provider,
      state: "live",
      allowed: false,
      reason: `${variable}=live`,
    };
  if (mode === "sandbox")
    return {
      provider,
      state: "sandbox",
      allowed: true,
      reason: `${variable}=sandbox; the adapter enforces its own sandbox`,
    };
  return {
    provider,
    state: "absent",
    allowed: true,
    reason: `${variable}=${mode}`,
  };
}

function endpointFinding(
  provider: string,
  variable: string,
  env: Env
): BoundaryFinding {
  const url = env[variable]?.trim();
  if (!url)
    return { provider, state: "absent", allowed: true, reason: "No endpoint" };
  if (isInternalHost(url))
    return {
      provider,
      state: "mock",
      allowed: true,
      reason: `${variable} points at an internal host`,
    };
  return {
    provider,
    state: "live",
    allowed: false,
    reason: `${variable} points outside the environment`,
  };
}

function smsFinding(env: Env): BoundaryFinding {
  const provider = env.SMS_PROVIDER?.trim();
  const credentials = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
  ].filter(name => present(env[name]));
  if (provider === "twilio" || credentials.length)
    return {
      provider: "sms",
      state: "live",
      allowed: false,
      reason: credentials.length
        ? `Twilio credential present (${credentials.join(", ")})`
        : "SMS_PROVIDER=twilio",
    };
  if (provider === "mock")
    return {
      provider: "sms",
      state: "mock",
      allowed: true,
      reason: "SMS_PROVIDER=mock",
    };
  return {
    provider: "sms",
    state: "absent",
    allowed: true,
    reason: "No SMS provider",
  };
}

/** Every external provider a worker job can reach, judged against the
 * configured boundary. Under `open` every finding is allowed and the report is
 * informational. */
export function providerBoundaryReport(env: Env = process.env): BoundaryReport {
  const boundary = providerBoundary(env);
  const findings: BoundaryFinding[] = [
    stripeFinding(env),
    credentialFinding("resend", ["RESEND_API_KEY"], env),
    smsFinding(env),
    credentialFinding("openai", ["OPENAI_API_KEY"], env),
    credentialFinding("sentry", ["SENTRY_DSN"], env),
    endpointFinding("outbox-receiver", "OUTBOX_PUBLISH_URL", env),
    endpointFinding(
      "otel-collector",
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
      env
    ),
    modeFinding("hotelbeds", "HOTELBEDS_MODE", env),
    modeFinding("weather", "AVIATION_WEATHER_MODE", env),
    modeFinding("oncall", "ONCALL_MODE", env),
    credentialFinding(
      "alternative-payment-providers",
      [
        "HYPERPAY_ACCESS_TOKEN",
        "TABBY_SECRET_KEY",
        "TAMARA_API_TOKEN",
        "STC_PAY_API_KEY",
        "FLOOSAK_API_KEY",
        "JAWALI_API_KEY",
        "ONECASH_API_KEY",
        "EASYCASH_API_KEY",
      ],
      env
    ),
  ];
  if (boundary === "open")
    return {
      boundary,
      findings: findings.map(finding => ({ ...finding, allowed: true })),
    };
  return { boundary, findings };
}

/** Refuses to let a process start when the boundary is isolated and any
 * finding would reach a live provider. Names only; never values. */
export function assertProviderBoundary(env: Env = process.env): BoundaryReport {
  const report = providerBoundaryReport(env);
  const refused = report.findings.filter(finding => !finding.allowed);
  if (refused.length)
    throw new Error(
      `Isolated provider boundary refused: ${refused
        .map(finding => `${finding.provider} (${finding.reason})`)
        .join("; ")}`
    );
  return report;
}
