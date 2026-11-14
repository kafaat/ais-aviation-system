import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { authRouter } from "./auth";

const mocks = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  login: vi.fn(),
  getDb: vi.fn(),
  recordLoginAttempt: vi.fn(),
  isAccountLocked: vi.fn(),
  findFirst: vi.fn(),
  createSessionToken: vi.fn(),
  cookie: vi.fn(),
  getMfaSettings: vi.fn(),
  createMfaChallenge: vi.fn(),
}));

vi.mock("../services/auth-service.client", () => ({
  authServiceClient: { verifyPassword: mocks.verifyPassword },
}));
vi.mock("../services/mobile-auth-v2.service", () => ({
  mobileAuthServiceV2: { login: mocks.login },
  SESSION_MAX_AGE_MS: 2592000000,
}));
vi.mock("../services/mfa.service", () => ({
  getMfaSettings: mocks.getMfaSettings,
  createMfaChallenge: mocks.createMfaChallenge,
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../services/account-lock.service", () => ({
  recordLoginAttempt: mocks.recordLoginAttempt,
  isAccountLocked: mocks.isAccountLocked,
}));
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
  mocks.getMfaSettings.mockResolvedValue(null);
  mocks.isAccountLocked.mockResolvedValue(false);
  mocks.login.mockResolvedValue(tokens);
  mocks.createSessionToken.mockResolvedValue("test-cookie-token");
});

it("returns the authenticated tenant context for recovery isolation without exposing user secrets", async () => {
  const context = anonymousContext();
  context.tenantId = 4;
  context.user = {
    ...user,
    tenantId: 4,
    passwordHash: "not-for-the-browser",
  } as NonNullable<TrpcContext["user"]>;
  expect(await authRouter.createCaller(context).me()).toEqual({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: 4,
  });
  expect(await authRouter.createCaller(anonymousContext()).me()).toBeNull();
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
      expect.objectContaining({ ipAddress: "127.0.0.1" }),
      undefined
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

it("issues only a challenge after a valid password for an MFA account", async () => {
  mocks.verifyPassword.mockResolvedValue({ success: true, user });
  mocks.getMfaSettings.mockResolvedValue({ isEnabled: true });
  mocks.createMfaChallenge.mockResolvedValue("a".repeat(64));
  const result = await authRouter
    .createCaller(anonymousContext())
    .login(credentials);
  expect(result).toEqual({ mfaRequired: true, challengeToken: "a".repeat(64) });
  expect(mocks.login).not.toHaveBeenCalled();
  expect(mocks.createSessionToken).not.toHaveBeenCalled();
  expect(mocks.cookie).not.toHaveBeenCalled();
});

describe("a locked account gives no password oracle", () => {
  const wrongPassword = { success: false, message: "Invalid credentials" };
  const rightPassword = { success: true, user };

  /** The code and message a login answers with, for a given verification. */
  async function loginFailure(verification: unknown) {
    mocks.verifyPassword.mockResolvedValue(verification);
    const error = await authRouter
      .createCaller(anonymousContext())
      .login(credentials)
      .then(
        () => {
          throw new Error("login unexpectedly succeeded");
        },
        (rejection: unknown) => rejection
      );
    expect(error).toBeInstanceOf(TRPCError);
    const { code, message } = error as TRPCError;
    return { code, message };
  }

  function lockAccount() {
    mocks.isAccountLocked.mockResolvedValue(true);
    // The real session gate (assertAccountAccessible) refuses a locked
    // account with its own message; the router must not let it surface.
    mocks.login.mockRejectedValue(
      new TRPCError({ code: "UNAUTHORIZED", message: "Account is locked" })
    );
  }

  it("answers a locked account's correct password exactly like a wrong one", async () => {
    lockAccount();
    const wrong = await loginFailure(wrongPassword);
    const right = await loginFailure(rightPassword);

    expect(wrong).toEqual({
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
    expect(right).toEqual(wrong);
    expect(mocks.isAccountLocked).toHaveBeenCalledWith(user.id);
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.createSessionToken).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
  });

  it("issues no MFA challenge to a locked MFA account with the correct password", async () => {
    lockAccount();
    mocks.getMfaSettings.mockResolvedValue({ isEnabled: true });
    mocks.createMfaChallenge.mockResolvedValue("a".repeat(64));

    const right = await loginFailure(rightPassword);

    expect(right).toEqual(await loginFailure(wrongPassword));
    expect(mocks.createMfaChallenge).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("denies with the wrong-password answer when the lock cannot be read", async () => {
    mocks.isAccountLocked.mockRejectedValue(new Error("Connection lost"));

    expect(await loginFailure(rightPassword)).toEqual({
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.createMfaChallenge).not.toHaveBeenCalled();
  });

  it("still signs in an unlocked account, after consulting its lock", async () => {
    mocks.verifyPassword.mockResolvedValue(rightPassword);

    const result = await authRouter
      .createCaller(anonymousContext())
      .login(credentials);

    expect(result).toMatchObject({ ...tokens, user: { id: user.id } });
    expect(mocks.isAccountLocked).toHaveBeenCalledWith(user.id);
    expect(mocks.isAccountLocked.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.login.mock.invocationCallOrder[0]
    );
    expect(mocks.recordLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ email: user.email, success: true })
    );
  });

  it("still counts failed attempts, including a locked account's correct password", async () => {
    await loginFailure(wrongPassword);
    lockAccount();
    await loginFailure(wrongPassword);
    await loginFailure(rightPassword);

    expect(
      mocks.recordLoginAttempt.mock.calls.map(([attempt]) => ({
        email: attempt.email,
        success: attempt.success,
        failureReason: attempt.failureReason,
      }))
    ).toEqual([
      {
        email: user.email,
        success: false,
        failureReason: "invalid_credentials",
      },
      {
        email: user.email,
        success: false,
        failureReason: "invalid_credentials",
      },
      { email: user.email, success: false, failureReason: "account_locked" },
    ]);
  });
});
