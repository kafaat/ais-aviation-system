import { afterEach, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { redactTelemetryRequest } from "../../shared/telemetry-privacy";

const { scope, captureException } = vi.hoisted(() => ({
  scope: {
    setTag: vi.fn(),
    setExtra: vi.fn(),
    setUser: vi.fn(),
    setLevel: vi.fn(),
  },
  captureException: vi.fn(() => "event-id"),
}));
vi.mock("@sentry/node", () => ({
  withScope: (callback: (value: typeof scope) => void) => callback(scope),
  captureException,
}));
import { sentryErrorMiddleware } from "../_core/middleware/sentry.middleware";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("removes payload, query, cookies and credential headers before automatic telemetry export", () => {
  const event = {
    request: {
      url: "https://name:secret@example.test/api/trpc/auth.login?input=secret#token",
      data: { nested: { password: "secret" } },
      query_string: "input=secret",
      cookies: { session: "secret" },
      headers: {
        Authorization: "secret",
        "X-API-Key": "secret",
        "content-type": "application/json",
      },
    },
  };
  expect(redactTelemetryRequest(event).request).toEqual({
    url: "https://example.test/api/trpc/auth.login",
    headers: { "content-type": "application/json" },
  });
  expect(event.request.data).toBeDefined();
});

it("does not expose serialized query credentials or mixed-case secrets in error context", () => {
  vi.stubEnv("SENTRY_DSN", "https://public@example.test/1");
  const body = {
    apiKey: "api-secret",
    credit_card: "card-secret",
    mfaCode: "123456",
    nested: { backupCode: "backup-secret", safe: 7 },
  };
  const request = {
    path: "/api/trpc/auth.login",
    method: "POST",
    query: { input: JSON.stringify({ password: "query-secret" }) },
    body,
    headers: {
      Authorization: "Bearer secret",
      COOKIE: "cookie-secret",
      "content-type": "application/json",
    },
  };
  const next = vi.fn();
  sentryErrorMiddleware(
    new Error("failure"),
    request as unknown as Request,
    { setHeader: vi.fn() } as unknown as Response,
    next as NextFunction
  );
  const extra = Object.fromEntries(scope.setExtra.mock.calls);
  expect(extra.query).toBeUndefined();
  expect(extra.body).toEqual({
    apiKey: "[REDACTED]",
    credit_card: "[REDACTED]",
    mfaCode: "[REDACTED]",
    nested: { backupCode: "[REDACTED]", safe: 7 },
  });
  expect(extra.headers).toEqual({
    Authorization: "[REDACTED]",
    COOKIE: "[REDACTED]",
    "content-type": "application/json",
  });
  expect(body.apiKey).toBe("api-secret");
  expect(captureException).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledOnce();
});
