/**
 * MFA material must survive a JWT_SECRET rotation: with MFA_ENCRYPTION_KEY
 * set, new secrets use the dedicated key, legacy secrets still decrypt and
 * are re-encrypted on use, and backup codes verify under every key they
 * may have been hashed with.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

vi.mock("../db", () => ({ getDb: () => null }));

const JWT = "unit-test-jwt-secret-at-least-32-characters-long";
const MFA = "unit-test-mfa-key-at-least-32-characters-long!!";

async function loadMfa(env: {
  JWT_SECRET: string;
  MFA_ENCRYPTION_KEY?: string;
}) {
  vi.resetModules();
  process.env.JWT_SECRET = env.JWT_SECRET;
  if (env.MFA_ENCRYPTION_KEY)
    process.env.MFA_ENCRYPTION_KEY = env.MFA_ENCRYPTION_KEY;
  else delete process.env.MFA_ENCRYPTION_KEY;
  return import("../services/mfa.service");
}

afterEach(() => {
  delete process.env.MFA_ENCRYPTION_KEY;
});

describe("MFA secret encryption keys", () => {
  it("writes with the JWT-derived key when no dedicated key is set", async () => {
    const legacy = await loadMfa({ JWT_SECRET: JWT });
    const stored = legacy.encryptSecret("JBSWY3DPEHPK3PXP");
    expect(stored.startsWith("k2:")).toBe(false);
    expect(legacy.decryptSecret(stored)).toBe("JBSWY3DPEHPK3PXP");
    expect(legacy.secretNeedsReencryption(stored)).toBe(false);
  });

  it("reads legacy material under the dedicated key and marks it for re-encryption", async () => {
    const legacy = await loadMfa({ JWT_SECRET: JWT });
    const legacyStored = legacy.encryptSecret("JBSWY3DPEHPK3PXP");
    const legacyCode = legacy.hashBackupCode("abcd1234");

    const keyed = await loadMfa({ JWT_SECRET: JWT, MFA_ENCRYPTION_KEY: MFA });
    expect(keyed.decryptSecret(legacyStored)).toBe("JBSWY3DPEHPK3PXP");
    expect(keyed.secretNeedsReencryption(legacyStored)).toBe(true);
    const fresh = keyed.encryptSecret("JBSWY3DPEHPK3PXP");
    expect(fresh.startsWith("k2:")).toBe(true);
    expect(keyed.secretNeedsReencryption(fresh)).toBe(false);
    expect(keyed.decryptSecret(fresh)).toBe("JBSWY3DPEHPK3PXP");
    // Backup codes hashed under the JWT-derived key, the dedicated key and
    // the pre-keyed SHA-256 all still verify.
    const bare = crypto.createHash("sha256").update("zzzz9999").digest("hex");
    const stored = [legacyCode, keyed.hashBackupCode("keyed001"), bare];
    expect(keyed.verifyBackupCode("abcd1234", stored).valid).toBe(true);
    expect(keyed.verifyBackupCode("keyed001", stored).valid).toBe(true);
    expect(keyed.verifyBackupCode("zzzz9999", stored).valid).toBe(true);
    expect(keyed.hashBackupCode("abcd1234")).not.toBe(legacyCode);
  });

  it("survives a JWT_SECRET rotation once the dedicated key is in place", async () => {
    const before = await loadMfa({ JWT_SECRET: JWT, MFA_ENCRYPTION_KEY: MFA });
    const stored = before.encryptSecret("JBSWY3DPEHPK3PXP");
    const after = await loadMfa({
      JWT_SECRET: "rotated-jwt-secret-also-32-characters-long!!",
      MFA_ENCRYPTION_KEY: MFA,
    });
    expect(after.decryptSecret(stored)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("refuses dedicated-key material when the key is missing instead of guessing", async () => {
    const keyed = await loadMfa({ JWT_SECRET: JWT, MFA_ENCRYPTION_KEY: MFA });
    const stored = keyed.encryptSecret("JBSWY3DPEHPK3PXP");
    const without = await loadMfa({ JWT_SECRET: JWT });
    expect(() => without.decryptSecret(stored)).toThrow(/MFA_ENCRYPTION_KEY/);
  });
});
