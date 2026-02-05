/**
 * Auth Token Refresh Tests
 *
 * Tests for JWT token refresh mechanism types and constants.
 * Service-level tests that require database are in integration tests.
 */

import { describe, it, expect } from "vitest";

describe("Auth Token Types", () => {
  it("should export correct type definitions", async () => {
    const { AUTH_STORAGE_KEYS, TOKEN_TIMING } =
      await import("../../shared/auth.types");

    expect(AUTH_STORAGE_KEYS.ACCESS_TOKEN).toBe("ais_access_token");
    expect(AUTH_STORAGE_KEYS.REFRESH_TOKEN).toBe("ais_refresh_token");
    expect(TOKEN_TIMING.REFRESH_BUFFER_MS).toBe(5 * 60 * 1000);
    expect(TOKEN_TIMING.ACCESS_TOKEN_LIFETIME_MS).toBe(15 * 60 * 1000);
  });
});

describe("Auth Error Codes", () => {
  it("should have correct auth error codes defined", async () => {
    const { AuthErrorCode } = await import("../../shared/auth.types");

    expect(AuthErrorCode.INVALID_CREDENTIALS).toBe("INVALID_CREDENTIALS");
    expect(AuthErrorCode.TOKEN_EXPIRED).toBe("TOKEN_EXPIRED");
    expect(AuthErrorCode.TOKEN_INVALID).toBe("TOKEN_INVALID");
    expect(AuthErrorCode.REFRESH_TOKEN_EXPIRED).toBe("REFRESH_TOKEN_EXPIRED");
    expect(AuthErrorCode.REFRESH_TOKEN_REVOKED).toBe("REFRESH_TOKEN_REVOKED");
  });
});
