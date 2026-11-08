/** Synthetic registered-user login through the deployed web service.
 *
 * The Railway acceptance runner calls this against the private web base URL.
 * It drives the real tRPC procedures the browser uses, so the request path is
 * web -> Node auth client (with the service's own AUTH_SERVICE_TOKEN) ->
 * FastAPI auth service -> web session issuance:
 *
 *   1. `auth.register` with a fresh synthetic account (creates the user)
 *   2. `auth.login` with that password (session issued; no MFA on a new user)
 *   3. `auth.me` with the issued bearer token (the session is accepted)
 *   4. `auth.logout` with the refresh token (the session is revoked)
 *   5. the caller's cleanup removes the synthetic rows
 *
 * The report never carries the e-mail, the password, a token or a raw body;
 * it carries statuses, booleans and bounded error text so it can sit in the
 * acceptance summary that is printed to the deployment log.
 */
import { randomBytes } from "node:crypto";

export interface SyntheticAccount {
  email: string;
  userId: number;
}

export interface LoginJourneyReport {
  passed: boolean;
  registerStatus: number | null;
  loginStatus: number | null;
  sessionIssued: boolean;
  sessionAccepted: boolean;
  logoutStatus: number | null;
  cleanup: string;
  latencyMs: number;
  error: string | null;
}

/** Removes the synthetic account's rows; returns a short human-readable
 * description of what was removed (no identifiers). */
export type CleanupSyntheticAccount = (
  account: SyntheticAccount
) => Promise<string>;

export interface LoginJourneyOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const SYNTHETIC_DOMAIN = "example.com";

function trpcBody(input: unknown): string {
  // Matches the superjson envelope the server's transformer expects.
  return JSON.stringify({ json: input });
}

function bounded(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 160);
}

async function call(
  fetchImpl: typeof fetch,
  baseUrl: URL,
  procedure: string,
  init: { method: "GET" | "POST"; input?: unknown; bearer?: string },
  timeoutMs: number
): Promise<{ status: number; data: unknown; errorMessage: string | null }> {
  const url = new URL(`/api/trpc/${procedure}`, baseUrl);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "ais-railway-acceptance/login-journey",
  };
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  let body: string | undefined;
  if (init.method === "POST") {
    headers["content-type"] = "application/json";
    body = trpcBody(init.input ?? {});
  } else if (init.input !== undefined) {
    url.searchParams.set("input", trpcBody(init.input));
  }
  const response = await fetchImpl(url, {
    method: init.method,
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const envelope = parsed as {
    result?: { data?: { json?: unknown } };
    error?: { json?: { message?: string; code?: string } };
  } | null;
  return {
    status: response.status,
    data: envelope?.result?.data?.json ?? null,
    errorMessage:
      envelope?.error?.json?.message !== undefined
        ? bounded(String(envelope.error.json.message))
        : response.ok
          ? null
          : bounded(text || `HTTP ${response.status}`),
  };
}

export async function runLoginJourney(
  baseUrl: URL,
  cleanup: CleanupSyntheticAccount,
  options: LoginJourneyOptions = {}
): Promise<LoginJourneyReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const started = Date.now();
  const report: LoginJourneyReport = {
    passed: false,
    registerStatus: null,
    loginStatus: null,
    sessionIssued: false,
    sessionAccepted: false,
    logoutStatus: null,
    cleanup: "not attempted",
    latencyMs: 0,
    error: null,
  };
  // Fresh identity per run: nothing is reused and nothing is predictable.
  const email = `acceptance-login-${randomBytes(12).toString("hex")}@${SYNTHETIC_DOMAIN}`;
  const password = `Acc-${randomBytes(24).toString("base64url")}!`;
  let account: SyntheticAccount | null = null;

  try {
    const registered = await call(
      fetchImpl,
      baseUrl,
      "auth.register",
      {
        method: "POST",
        input: { email, password, name: "Synthetic acceptance login" },
      },
      timeoutMs
    );
    report.registerStatus = registered.status;
    const registeredData = registered.data as {
      success?: boolean;
      user?: { id?: number; email?: string | null };
    } | null;
    if (
      registered.status !== 200 ||
      registeredData?.success !== true ||
      typeof registeredData.user?.id !== "number"
    ) {
      report.error = `register refused: ${registered.errorMessage ?? "no user in response"}`;
      return report;
    }
    account = { email, userId: registeredData.user.id };

    const loggedIn = await call(
      fetchImpl,
      baseUrl,
      "auth.login",
      { method: "POST", input: { email, password } },
      timeoutMs
    );
    report.loginStatus = loggedIn.status;
    const session = loggedIn.data as {
      accessToken?: string;
      refreshToken?: string;
      tokenType?: string;
      user?: { id?: number };
      mfaRequired?: boolean;
    } | null;
    if (
      loggedIn.status !== 200 ||
      typeof session?.accessToken !== "string" ||
      typeof session.refreshToken !== "string" ||
      session.tokenType !== "Bearer" ||
      session.user?.id !== account.userId
    ) {
      report.error = session?.mfaRequired
        ? "login returned an MFA challenge for a brand-new account"
        : `login refused: ${loggedIn.errorMessage ?? "no session in response"}`;
      return report;
    }
    report.sessionIssued = true;

    const me = await call(
      fetchImpl,
      baseUrl,
      "auth.me",
      { method: "GET", bearer: session.accessToken },
      timeoutMs
    );
    const identity = me.data as { id?: number } | null;
    report.sessionAccepted =
      me.status === 200 && identity?.id === account.userId;
    if (!report.sessionAccepted) {
      report.error = `issued session not accepted: ${me.errorMessage ?? `HTTP ${me.status}`}`;
      return report;
    }

    const loggedOut = await call(
      fetchImpl,
      baseUrl,
      "auth.logout",
      { method: "POST", input: { refreshToken: session.refreshToken } },
      timeoutMs
    );
    report.logoutStatus = loggedOut.status;
    if (loggedOut.status !== 200) {
      report.error = `logout refused: ${loggedOut.errorMessage ?? `HTTP ${loggedOut.status}`}`;
      return report;
    }
    report.passed = true;
    return report;
  } catch (error) {
    report.error = bounded(
      error instanceof Error ? error.message : String(error)
    );
    return report;
  } finally {
    if (account) {
      try {
        report.cleanup = await cleanup(account);
      } catch (error) {
        report.cleanup = `failed: ${bounded(error instanceof Error ? error.message : String(error))}`;
        // A synthetic row left behind is a defect of the evidence run.
        report.passed = false;
      }
    } else {
      report.cleanup = "nothing to remove";
    }
    report.latencyMs = Date.now() - started;
  }
}
