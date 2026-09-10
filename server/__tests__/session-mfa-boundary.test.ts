import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  mfaChallenges,
  mfaSettings,
  refreshTokens,
  users,
} from "../../drizzle/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
import { mobileAuthServiceV2 as auth } from "../services/mobile-auth-v2.service";
import {
  completeMfaChallenge,
  encryptSecret,
  hashBackupCode,
} from "../services/mfa.service";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "../../shared/const";

const dialect = new MySqlDialect();
const family = "a".repeat(64);
const user = {
  id: 1,
  openId: "test-user",
  name: "Test",
  email: "test@example.test",
  role: "user",
};
let revoked: boolean;
let mfa: any;
let challenge: any;
let inserts: any[];
let claimSql: string[];

// Deterministic persistence adapter: exercises real crypto and services, not MySQL locking.
beforeEach(() => {
  revoked = false;
  inserts = [];
  claimSql = [];
  mfa = {
    id: 1,
    userId: 1,
    isEnabled: true,
    secret: encryptSecret("JBSWY3DPEHPK3PXP"),
    backupCodes: JSON.stringify([hashBackupCode("abcd1234")]),
    lastUsedStep: null,
  };
  challenge = {
    id: 1,
    userId: 1,
    attempts: 0,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 300000),
  };
  const query = {
    refreshTokens: {
      findFirst: async () => ({
        id: 1,
        userId: 1,
        familyId: family,
        mfaVerified: true,
      }),
    },
    users: { findFirst: async () => user },
  };
  state.db = {
    query,
    transaction: async (fn: any) => fn(state.db),
    select: (projection: any) => {
      let table: any;
      const rows = () =>
        table === users
          ? [user]
          : table === mfaSettings
            ? [mfa]
            : table === mfaChallenges
              ? challenge.consumedAt
                ? []
                : [challenge]
              : revoked
                ? []
                : [{ user, mfaEnabled: mfa.isEnabled, mfaVerified: true }];
      const chain: any = {
        from(t: any) {
          table = t;
          return chain;
        },
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        limit: () => chain,
        for: () => Promise.resolve(rows()),
        then: (resolve: any) => Promise.resolve(rows()).then(resolve),
      };
      return chain;
    },
    update: (table: any) => ({
      set: (values: any) => ({
        where: async (predicate: any) => {
          if (table === refreshTokens) {
            const sql = dialect.sqlToQuery(predicate).sql;
            claimSql.push(sql);
            const affectedRows = revoked && sql.includes("is null") ? 0 : 1;
            revoked = true;
            return [{ affectedRows }];
          }
          Object.assign(table === mfaChallenges ? challenge : mfa, values);
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    insert: () => ({
      values: async (value: any) => {
        inserts.push(value);
        return [{ insertId: 2 }];
      },
    }),
  };
});

describe("revocable session families", () => {
  it("revokes the same cookie and Bearer identity immediately", async () => {
    const access = auth.generateAccessToken(user, family);
    const cookie = await sdk.createSessionToken(user.openId, {
      sessionId: family,
    });
    const req = { headers: { cookie: `${COOKIE_NAME}=${cookie}` } } as any;
    expect((await auth.authenticateAccessToken(access)).id).toBe(1);
    expect((await sdk.authenticateRequest(req)).id).toBe(1);
    await auth.revokeFamily(family);
    await expect(auth.authenticateAccessToken(access)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(sdk.authenticateRequest(req)).rejects.toThrow();
  });

  it("allows only one refresh claimant when both transactions read the old token", async () => {
    const results = await Promise.allSettled([
      auth.refreshTokens("same-token"),
      auth.refreshTokens("same-token"),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].familyId).toBe(family);
    expect(
      claimSql.every(
        sql =>
          sql.includes("`revokedAt` is null") && sql.includes("`expiresAt` >")
      )
    ).toBe(true);
  });

  it("refuses to create an MFA session without a matching verified enrollment", async () => {
    await expect(auth.login(1)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      auth.login(1, undefined, { userId: 1, secret: "old-enrollment" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(inserts).toHaveLength(0);
  });
});

describe("MFA challenge consumption", () => {
  it("consumes a backup code and challenge once", async () => {
    expect(await completeMfaChallenge("challenge", "abcd1234")).toEqual({
      userId: 1,
      secret: mfa.secret,
    });
    expect(JSON.parse(mfa.backupCodes)).toEqual([]);
    expect(challenge.consumedAt).toBeInstanceOf(Date);
    await expect(
      completeMfaChallenge("challenge", "abcd1234")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // A fresh challenge cannot reuse the consumed backup code either.
    challenge.consumedAt = null;
    await expect(
      completeMfaChallenge("new-challenge", "abcd1234")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("commits failed attempts and closes the challenge at five attempts", async () => {
    for (let i = 0; i < 5; i++)
      await expect(
        completeMfaChallenge("challenge", "wrong123")
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(challenge.attempts).toBe(5);
    expect(challenge.consumedAt).toBeInstanceOf(Date);
    await expect(
      completeMfaChallenge("challenge", "abcd1234")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(JSON.parse(mfa.backupCodes)).toHaveLength(1);
  });
});
