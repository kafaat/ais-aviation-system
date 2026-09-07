import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { authRouter } from "./auth";

const mocks = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  login: vi.fn(),
  getDb: vi.fn(),
  findFirst: vi.fn(),
  createSessionToken: vi.fn(),
  cookie: vi.fn(),
}));

vi.mock("../services/auth-service.client", () => ({
  authServiceClient: { verifyPassword: mocks.verifyPassword },
}));
vi.mock("../services/mobile-auth-v2.service", () => ({
  mobileAuthServiceV2: { login: mocks.login },
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../_core/sdk", () => ({
  sdk: { createSessionToken: mocks.createSessionToken },
}));
vi.mock("../_core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../services/rbac.service", () => ({
  isAdmin: (role: string) => role === "admin",
}));

const user = {
  id: 7,
  openId: "security-test-user",
  name: "Test User",
  email: "security@example.test",
  role: "admin",
};
const credentials = { email: user.email, password: "test-password" };
const tokens = {
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  expiresIn: 900,
  tokenType: "Bearer",
};

function anonymousContext(): TrpcContext {
  return {
    user: null,
    authMethod: null,
    tenantId: null,
    req: {
      protocol: "https",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    } as TrpcContext["req"],
    res: { cookie: mocks.cookie } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // A real account exists: its presence must NOT authorize a failed login.
  mocks.findFirst.mockResolvedValue(user);
  mocks.getDb.mockResolvedValue({
    query: { users: { findFirst: mocks.findFirst } },
  });
  mocks.login.mockResolvedValue(tokens);
  mocks.createSessionToken.mockResolvedValue("test-cookie-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(["development", "test", "staging", "production", undefined])(
  "password verification with NODE_ENV=%s",
  environment => {
    it.each([
      { success: false, message: "Invalid credentials" },
      { success: false, message: "Auth service unavailable" },
      { success: true },
    ])("rejects an unverified response: %j", async response => {
      vi.stubEnv("NODE_ENV", environment);
      mocks.verifyPassword.mockResolvedValue(response);
      const caller = authRouter.createCaller(anonymousContext());

      await expect(caller.login(credentials)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });

      expect(mocks.verifyPassword).toHaveBeenCalledWith(
        credentials.email,
        credentials.password
      );
      expect(mocks.getDb).not.toHaveBeenCalled();
      expect(mocks.findFirst).not.toHaveBeenCalled();
      expect(mocks.login).not.toHaveBeenCalled();
      expect(mocks.createSessionToken).not.toHaveBeenCalled();
      expect(mocks.cookie).not.toHaveBeenCalled();
    });
  }
);

describe("authentication security boundary", () => {
  it("does not issue tokens when the auth client throws", async () => {
    mocks.verifyPassword.mockRejectedValue(new Error("Connection refused"));
    const caller = authRouter.createCaller(anonymousContext());

    await expect(caller.login(credentials)).rejects.toThrow();

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.createSessionToken).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
  });

  it("issues tokens and a cookie only after successful verification", async () => {
    mocks.verifyPassword.mockResolvedValue({ success: true, user });
    const caller = authRouter.createCaller(anonymousContext());

    const result = await caller.login(credentials);

    expect(result).toEqual({
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
    expect(mocks.login).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ ipAddress: "127.0.0.1" })
    );
    expect(mocks.createSessionToken).toHaveBeenCalledWith(
      user.openId,
      expect.any(Object)
    );
    expect(mocks.cookie).toHaveBeenCalledTimes(1);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("keeps REST login and token refresh accessible without a prior session", () => {
    const procedures = authRouter._def.procedures;
    expect(procedures.login._def.meta?.openapi?.protect).not.toBe(true);
    expect(procedures.refreshToken._def.meta?.openapi?.protect).not.toBe(true);
  });
});
