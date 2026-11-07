import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../db", () => ({ getDb: () => null }));

/**
 * The shared service credential fails closed on the Node side: production
 * never starts without a usable AUTH_SERVICE_TOKEN, never sends a password to
 * the auth service under an unusable one, and always presents the credential
 * it has. The loopback server records what actually reached the wire.
 */
const requests: { path: string; token?: string }[] = [];
const server = createServer((request, response: ServerResponse) => {
  requests.push({
    path: request.url ?? "",
    token: request.headers["x-auth-service-token"] as string | undefined,
  });
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      success: true,
      user: { id: 1, openId: "o", name: null, email: null, role: "user" },
    })
  );
});
let origin: string;
const usable = "ci-auth-service-token-only-for-tests-not-a-deployment-key";

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  vi.resetModules();
  requests.length = 0;
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"])
    vi.stubEnv(name, "");
  vi.stubEnv("NO_PROXY", "127.0.0.1,localhost");
  vi.stubEnv("AUTH_SERVICE_URL", origin);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
});

async function load() {
  return import("../services/auth-service.client");
}

describe("auth service credential policy", () => {
  it.each([
    ["missing", undefined, "required in production"],
    ["blank", "   ", "required in production"],
    ["placeholder", "CHANGE_ME", "placeholder"],
    ["placeholder, other case", "changeme", "placeholder"],
    [
      "shipped development sample",
      "local-development-auth-service-token-not-for-production",
      "placeholder",
    ],
    ["repeated characters", "x".repeat(32), "repeated-character"],
    ["short", "x".repeat(31), "at least 32 characters"],
    ["whitespace inside", `${"a".repeat(20)} ${"b".repeat(20)}`, "whitespace"],
  ])(
    "production refuses to start with a %s credential",
    async (_label, value, message) => {
      vi.stubEnv("NODE_ENV", "production");
      if (value === undefined) vi.stubEnv("AUTH_SERVICE_TOKEN", undefined);
      else vi.stubEnv("AUTH_SERVICE_TOKEN", value);
      const { assertAuthServiceCredential, authServiceCredentialProblem } =
        await load();
      expect(authServiceCredentialProblem(value, true)).toContain(message);
      expect(() => assertAuthServiceCredential()).toThrow(message);
    }
  );

  it("production never sends a password under an unusable credential", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SERVICE_TOKEN", "short");
    const { authServiceClient } = await load();
    await expect(
      authServiceClient.login("someone@example.test", "secret-fixture")
    ).resolves.toEqual({
      success: false,
      message: "Auth service unavailable",
    });
    await expect(
      authServiceClient.verifyPassword("someone@example.test", "secret-fixture")
    ).resolves.toMatchObject({ success: false });
    expect(requests).toEqual([]);
  });

  it("production starts and presents a usable credential on every call", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SERVICE_TOKEN", `  ${usable}  `);
    const { assertAuthServiceCredential, authServiceClient } = await load();
    expect(() => assertAuthServiceCredential()).not.toThrow();
    await expect(
      authServiceClient.register("someone@example.test", "secret-fixture", "N")
    ).resolves.toMatchObject({ success: true });
    await authServiceClient.login("someone@example.test", "secret-fixture");
    await authServiceClient.verifyPassword(
      "someone@example.test",
      "secret-fixture"
    );
    expect(requests.map(r => r.path)).toEqual([
      "/auth/register",
      "/auth/login",
      "/auth/verify-password",
    ]);
    // Trimmed, never padded: the auth service compares the exact bytes.
    expect(requests.every(r => r.token === usable)).toBe(true);
  });

  it("development may boot without a credential but never sends passwords without one", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_SERVICE_TOKEN", "");
    const first = await load();
    expect(() => first.assertAuthServiceCredential()).not.toThrow();
    expect(first.authServiceCredentialProblem("local-fixture", false)).toBe(
      null
    );
    const responses = await Promise.all([
      first.authServiceClient.register(
        "someone@example.test",
        "password",
        "Name"
      ),
      first.authServiceClient.login("someone@example.test", "password"),
      first.authServiceClient.verifyPassword(
        "someone@example.test",
        "password"
      ),
    ]);
    expect(responses).toEqual([
      { success: false, message: "Auth service unavailable" },
      { success: false, message: "Auth service unavailable" },
      { success: false, message: "Auth service unavailable" },
    ]);
    expect(requests).toEqual([]);

    vi.resetModules();
    vi.stubEnv("AUTH_SERVICE_TOKEN", "CHANGE_ME");
    const second = await load();
    expect(() => second.assertAuthServiceCredential()).toThrow("placeholder");
  });
});
