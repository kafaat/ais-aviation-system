/**
 * Account-security rules closed by the October 2026 review.
 */
import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

process.env.JWT_SECRET ??= "unit-test-signing-key-at-least-32-characters-long";
vi.mock("../db", () => ({ getDb: () => null }));

import {
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from "../services/mfa.service";
import { registrationPassword } from "../routers/auth";

describe("backup codes", () => {
  it("are stored as keyed hashes that differ from a bare SHA-256", () => {
    const code = "abcd1234";
    const keyed = hashBackupCode(code);
    const bare = crypto.createHash("sha256").update(code).digest("hex");
    expect(keyed).toHaveLength(64);
    expect(keyed).not.toBe(bare);
    expect(hashBackupCode(" ABCD1234 ")).toBe(keyed);
  });

  it("verifies codes stored under either the keyed or the legacy hash, consuming the match", () => {
    const legacy = crypto.createHash("sha256").update("legacy01").digest("hex");
    const stored = [hashBackupCode("keyed001"), legacy];
    const keyedHit = verifyBackupCode("keyed001", stored);
    expect(keyedHit.valid).toBe(true);
    expect(keyedHit.remainingCodes).toEqual([legacy]);
    const legacyHit = verifyBackupCode("legacy01", stored);
    expect(legacyHit.valid).toBe(true);
    expect(legacyHit.remainingCodes).toEqual([stored[0]]);
    expect(verifyBackupCode("nope0000", stored)).toEqual({
      valid: false,
      remainingCodes: stored,
    });
  });

  it("generates ten distinct eight-character base-36 codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("registration password", () => {
  it("refuses anything bcrypt would silently truncate", () => {
    expect(registrationPassword.safeParse("a".repeat(72)).success).toBe(true);
    expect(registrationPassword.safeParse("a".repeat(73)).success).toBe(false);
    // 24 three-byte characters are 72 bytes; 25 are not.
    expect(registrationPassword.safeParse("م".repeat(36)).success).toBe(true);
    expect(registrationPassword.safeParse("م".repeat(37)).success).toBe(false);
    expect(registrationPassword.safeParse("short").success).toBe(false);
  });
});
