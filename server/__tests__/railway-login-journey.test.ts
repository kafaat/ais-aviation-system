import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runLoginJourney,
  type SyntheticAccount,
} from "../../scripts/ci/railway-login-journey";

/**
 * A loopback stand-in for the deployed web's tRPC auth procedures, speaking
 * the same superjson envelope. Behaviour is switched per test to prove that
 * the journey passes only on the full register -> login -> me -> logout path
 * and that its report never carries the synthetic identity or any token.
 */
type Mode = "healthy" | "login-rejected" | "mfa" | "logout-rejected";
let mode: Mode = "healthy";
const seen: { procedure: string; authorization?: string; input: unknown }[] =
  [];
const users = new Map<string, { id: number; password: string }>();
const sessions = new Map<string, number>();
const access = "access-token-fixture-value";
const refresh = "refresh-token-fixture-value";

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as { json: unknown }).json : undefined;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const procedure = url.pathname.replace("/api/trpc/", "");
  const input =
    request.method === "POST"
      ? await readJson(request)
      : url.searchParams.get("input")
        ? (JSON.parse(url.searchParams.get("input")!) as { json: unknown }).json
        : undefined;
  seen.push({
    procedure,
    authorization: request.headers.authorization,
    input,
  });
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const ok = (json: unknown) => send(200, { result: { data: { json } } });
  const fail = (status: number, code: string, message: string) =>
    send(status, { error: { json: { message, code } } });

  if (procedure === "auth.register") {
    const { email, password } = input as { email: string; password: string };
    const id = users.size + 71;
    users.set(email, { id, password });
    return ok({
      success: true,
      user: { id, name: "Synthetic acceptance login", email, role: "user" },
    });
  }
  if (procedure === "auth.login") {
    const { email, password } = input as { email: string; password: string };
    const user = users.get(email);
    if (mode === "login-rejected" || !user || user.password !== password)
      return fail(401, "UNAUTHORIZED", "Invalid email or password");
    if (mode === "mfa")
      return ok({ mfaRequired: true, challengeToken: "challenge" });
    sessions.set(access, user.id);
    return ok({
      accessToken: access,
      refreshToken: refresh,
      expiresIn: 900,
      tokenType: "Bearer",
      user: { id: user.id, name: null, email, role: "user" },
    });
  }
  if (procedure === "auth.me") {
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    const id = token ? sessions.get(token) : undefined;
    return id === undefined ? ok(null) : ok({ id, role: "user" });
  }
  if (procedure === "auth.logout") {
    if (mode === "logout-rejected")
      return fail(400, "BAD_REQUEST", "Refresh token is required");
    return ok({ success: true });
  }
  return fail(404, "NOT_FOUND", `No procedure ${procedure}`);
});
let baseUrl: URL;

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = new URL(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  );
});
beforeEach(() => {
  mode = "healthy";
  seen.length = 0;
  users.clear();
  sessions.clear();
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
});

function recordingCleanup() {
  const removed: SyntheticAccount[] = [];
  return {
    removed,
    cleanup: async (account: SyntheticAccount) => {
      removed.push(account);
      return "deleted (users=1)";
    },
  };
}

describe("synthetic login journey through the deployed web", () => {
  it("passes only after register, login, accepted session and logout, then cleans up", async () => {
    const { removed, cleanup } = recordingCleanup();
    const report = await runLoginJourney(baseUrl, cleanup);
    expect(report).toMatchObject({
      passed: true,
      registerStatus: 200,
      loginStatus: 200,
      sessionIssued: true,
      sessionAccepted: true,
      logoutStatus: 200,
      cleanup: "deleted (users=1)",
      error: null,
    });
    expect(seen.map(s => s.procedure)).toEqual([
      "auth.register",
      "auth.login",
      "auth.me",
      "auth.logout",
    ]);
    // The issued bearer token was presented on the session check.
    expect(seen[2].authorization).toBe(`Bearer ${access}`);
    // The refresh token was the one revoked.
    expect(seen[3].input).toEqual({ refreshToken: refresh });
    // Cleanup received the account the web created, with its id.
    expect(removed).toHaveLength(1);
    expect(removed[0].userId).toBe(71);
    expect(removed[0].email).toMatch(
      /^acceptance-login-[0-9a-f]{24}@example\.com$/
    );
    // The report carries no identity, password or token.
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(removed[0].email);
    expect(serialized).not.toContain(access);
    expect(serialized).not.toContain(refresh);
    const registerInput = seen[0].input as { password: string; email: string };
    expect(serialized).not.toContain(registerInput.password);
  });

  it("uses a fresh identity and password on every run", async () => {
    const first = recordingCleanup();
    const second = recordingCleanup();
    await runLoginJourney(baseUrl, first.cleanup);
    await runLoginJourney(baseUrl, second.cleanup);
    expect(first.removed[0].email).not.toBe(second.removed[0].email);
    const passwords = seen
      .filter(s => s.procedure === "auth.register")
      .map(s => (s.input as { password: string }).password);
    expect(passwords[0]).not.toBe(passwords[1]);
    expect(passwords.every(p => p.length >= 8)).toBe(true);
  });

  it("fails and still cleans up when the web refuses the login", async () => {
    mode = "login-rejected";
    const { removed, cleanup } = recordingCleanup();
    const report = await runLoginJourney(baseUrl, cleanup);
    expect(report.passed).toBe(false);
    expect(report.registerStatus).toBe(200);
    expect(report.loginStatus).toBe(401);
    expect(report.sessionIssued).toBe(false);
    expect(report.error).toContain("login refused");
    expect(report.error).not.toContain(removed[0].email);
    expect(removed).toHaveLength(1);
    expect(seen.map(s => s.procedure)).toEqual(["auth.register", "auth.login"]);
  });

  it("fails when a brand-new account is answered with an MFA challenge", async () => {
    mode = "mfa";
    const { cleanup } = recordingCleanup();
    const report = await runLoginJourney(baseUrl, cleanup);
    expect(report.passed).toBe(false);
    expect(report.error).toContain("MFA");
  });

  it("fails when the session cannot be revoked", async () => {
    mode = "logout-rejected";
    const { cleanup } = recordingCleanup();
    const report = await runLoginJourney(baseUrl, cleanup);
    expect(report.passed).toBe(false);
    expect(report.sessionAccepted).toBe(true);
    expect(report.logoutStatus).toBe(400);
    expect(report.error).toContain("logout refused");
  });

  it("fails when cleanup cannot remove the synthetic account", async () => {
    const report = await runLoginJourney(baseUrl, async () => {
      throw new Error("synthetic-cleanup-failure");
    });
    expect(report.passed).toBe(false);
    expect(report.cleanup).toContain("failed: synthetic-cleanup-failure");
  });

  it("reports an unreachable web without throwing", async () => {
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>(resolve => closed.close(() => resolve()));
    const { removed, cleanup } = recordingCleanup();
    const report = await runLoginJourney(
      new URL(`http://127.0.0.1:${port}`),
      cleanup,
      { timeoutMs: 2_000 }
    );
    expect(report.passed).toBe(false);
    expect(report.registerStatus).toBeNull();
    expect(report.cleanup).toBe("nothing to remove");
    expect(removed).toHaveLength(0);
    expect(report.error).toBeTruthy();
  });
});
