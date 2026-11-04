import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
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
import type { TrpcContext } from "../_core/context";

const boundary = vi.hoisted(() => ({
  login: vi.fn(),
  authenticateSession: vi.fn(),
  cookie: vi.fn(),
  recordAttempt: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => null }));
vi.mock("../services/mobile-auth-v2.service", () => ({
  mobileAuthServiceV2: {
    login: boundary.login,
    authenticateSession: boundary.authenticateSession,
  },
  SESSION_MAX_AGE_MS: 2592000000,
}));
vi.mock("../services/mfa.service", () => ({
  getMfaSettings: async () => null,
  createMfaChallenge: vi.fn(),
  completeMfaChallenge: vi.fn(),
}));
vi.mock("../services/account-lock.service", () => ({
  recordLoginAttempt: boundary.recordAttempt,
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));

const user = {
  id: 71,
  openId: "http-auth-fixture",
  name: "User",
  email: "auth-http@example.test",
  role: "user",
};
const credentials = {
  email: user.email,
  password: "synthetic-password-fixture",
};
const serviceToken = "local-auth-service-fixture";
const requests: { path: string; body: unknown; token?: string }[] = [];
let respond: (request: IncomingMessage, response: ServerResponse) => void;
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  requests.push({
    path: request.url ?? "",
    body: text ? JSON.parse(text) : null,
    token: request.headers["x-auth-service-token"] as string | undefined,
  });
  respond(request, response);
});
let origin: string;

function reply(body: unknown, status = 200) {
  respond = (_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
}

async function caller() {
  const { authRouter } = await import("../routers/auth");
  const context = {
    user: null,
    tenantId: null,
    authMethod: null,
    req: {
      protocol: "https",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    },
    res: { cookie: boundary.cookie },
  } as unknown as TrpcContext;
  return authRouter.createCaller(context);
}

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  requests.length = 0;
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"])
    vi.stubEnv(name, "");
  vi.stubEnv("NO_PROXY", "127.0.0.1,localhost");
  vi.stubEnv("AUTH_SERVICE_URL", origin);
  vi.stubEnv("AUTH_SERVICE_TOKEN", serviceToken);
  boundary.login.mockResolvedValue({
    accessToken: "access-fixture",
    refreshToken: "refresh-fixture",
    expiresIn: 900,
    tokenType: "Bearer",
    sessionId: "a".repeat(64),
  });
  boundary.authenticateSession.mockResolvedValue(user);
  reply({ success: true, user });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  server.closeAllConnections();
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
});

describe("password verification through the real local HTTP client", () => {
  it("sends register, login and verification requests with the service credential", async () => {
    const { authServiceClient } =
      await import("../services/auth-service.client");
    await expect(
      authServiceClient.register(
        credentials.email,
        credentials.password,
        "User"
      )
    ).resolves.toMatchObject({ success: true, user });
    await expect(
      authServiceClient.login(credentials.email, credentials.password)
    ).resolves.toMatchObject({ success: true, user });
    await expect(
      authServiceClient.verifyPassword(credentials.email, credentials.password)
    ).resolves.toMatchObject({ success: true, user });
    expect(requests).toEqual([
      {
        path: "/auth/register",
        token: serviceToken,
        body: { ...credentials, name: "User" },
      },
      { path: "/auth/login", token: serviceToken, body: credentials },
      { path: "/auth/verify-password", token: serviceToken, body: credentials },
    ]);
  });

  it("allows the router to issue its session and cookie after validated HTTP verification", async () => {
    const result = await (await caller()).login(credentials);
    expect(result).toMatchObject({
      accessToken: "access-fixture",
      user: { id: 71 },
    });
    expect(boundary.login).toHaveBeenCalledOnce();
    expect(boundary.cookie).toHaveBeenCalledOnce();
    expect(requests[0].path).toBe("/auth/verify-password");
  });

  it.each([
    ["wrong password", { success: false, message: "Invalid credentials" }, 401],
    ["unavailable service", { success: false, message: "Unavailable" }, 503],
    ["missing success", { user }, 200],
    ["string success", { success: "false", user }, 200],
    ["missing user", { success: true }, 200],
    [
      "missing user id",
      { success: true, user: { ...user, id: undefined } },
      200,
    ],
    ["fractional user id", { success: true, user: { ...user, id: 1.5 } }, 200],
    ["empty identity", { success: true, user: { ...user, openId: "" } }, 200],
    ["malformed name", { success: true, user: { ...user, name: {} } }, 200],
    ["null body", null, 200],
    ["error status carrying success", { success: true, user }, 503],
    ["unauthorized status carrying success", { success: true, user }, 401],
  ])(
    "refuses %s without reaching session issuance",
    async (_label, body, status) => {
      reply(body, Number(status));
      await expect((await caller()).login(credentials)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(boundary.login).not.toHaveBeenCalled();
      expect(boundary.cookie).not.toHaveBeenCalled();
      expect(requests).toHaveLength(1);
    }
  );

  it("does not fall back to account lookup when the service rejects a missing service token", async () => {
    vi.stubEnv("AUTH_SERVICE_TOKEN", "");
    respond = (request, response) => {
      response.writeHead(request.headers["x-auth-service-token"] ? 200 : 403, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({ success: false, message: "Service token required" })
      );
    };
    await expect((await caller()).login(credentials)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(requests[0].token).toBeUndefined();
    expect(boundary.login).not.toHaveBeenCalled();
  });

  it("bounds a service that never replies and does not issue a session", async () => {
    respond = () => {};
    const auth = await caller();
    const started = performance.now();
    await expect(auth.login(credentials)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(4500);
    expect(elapsed).toBeLessThan(8000);
    expect(requests).toHaveLength(1);
    expect(boundary.login).not.toHaveBeenCalled();
  }, 10000);

  it("opens after repeated transport failures, skips HTTP while open, then probes recovery", async () => {
    respond = request => request.socket.destroy();
    const auth = await caller();
    for (let i = 0; i < 6; i++) {
      await expect(auth.login(credentials)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    }
    expect(requests).toHaveLength(5);
    expect(boundary.login).not.toHaveBeenCalled();
    const { getCircuitBreakerStatus } =
      await import("../services/production.service");
    expect(getCircuitBreakerStatus()["auth-service"].state).toBe("OPEN");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31000);
    reply({ success: true, user });
    await expect(auth.login(credentials)).resolves.toMatchObject({
      accessToken: "access-fixture",
    });
    expect(requests).toHaveLength(6);
    expect(getCircuitBreakerStatus()["auth-service"].state).toBe("CLOSED");
  });

  it("requires the actual healthy status and handles health transport failure", async () => {
    const { authServiceClient } =
      await import("../services/auth-service.client");
    reply({ status: "healthy" });
    await expect(authServiceClient.isHealthy()).resolves.toBe(true);
    reply({ status: "unhealthy" });
    await expect(authServiceClient.isHealthy()).resolves.toBe(false);
    respond = request => request.socket.destroy();
    await expect(authServiceClient.isHealthy()).resolves.toBe(false);
  });
});
