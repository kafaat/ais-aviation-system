import crypto from "node:crypto";
import {
  and,
  eq,
  getTableName,
  gt,
  isNotNull,
  isNull,
  type SQL,
} from "drizzle-orm";
import { MySqlDialect, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshTokens } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

const state = vi.hoisted(() => ({ db: null as unknown, user: vi.fn() }));
vi.mock("../db", () => ({
  getDb: () => state.db,
  getUserById: state.user,
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));

const JWT = "auth-regression-signing-fixture-not-a-production-key";
const SECRET = "JBSWY3DPEHPK3PXP";
const family = "a".repeat(64);
const otherFamily = "b".repeat(64);
const dialect = new MySqlDialect();
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Where = (table: typeof refreshTokens, ops: typeof operators) => SQL;
const operators = { and, eq, gt, isNull, isNotNull };
let tables: Tables;
const hooks: {
  afterCommit?: () => Promise<void>;
  afterSettingsRead?: () => void;
  failBackupWrite?: boolean;
  locks?: FixtureLocks;
} = {};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => (resolve = done));
  return { promise, resolve };
}

// This fixture has one user. Table keys therefore represent the user's row
// locks. It executes the services concurrently and detects a wait-for cycle;
// it does not claim to implement MySQL isolation or native deadlock recovery.
class FixtureLocks {
  private owners = new Map<string, number>();
  private waits = new Map<number, number>();
  private changed = deferred();
  nextId = 0;
  afterAcquire?: (id: number, table: string) => Promise<void>;
  onWait?: (id: number, table: string) => void;

  async acquire(id: number, table: string) {
    while (this.owners.has(table) && this.owners.get(table) !== id) {
      this.waits.set(id, this.owners.get(table)!);
      this.onWait?.(id, table);
      let owner = this.waits.get(id);
      const seen = new Set<number>([id]);
      while (owner !== undefined) {
        if (seen.has(owner)) {
          this.waits.delete(id);
          throw new Error("Fixture detected a transaction deadlock");
        }
        seen.add(owner);
        owner = this.waits.get(owner);
      }
      await this.changed.promise;
      this.waits.delete(id);
    }
    const firstAcquisition = !this.owners.has(table);
    this.owners.set(table, id);
    if (firstAcquisition) await this.afterAcquire?.(id, table);
  }

  release(id: number) {
    for (const [table, owner] of this.owners)
      if (owner === id) this.owners.delete(table);
    this.waits.delete(id);
    const previous = this.changed;
    this.changed = deferred();
    previous.resolve();
  }
}

// A deliberately small commit/rollback adapter for deterministic regressions.
// Reads return detached records, as MySQL does. Native locking, isolation and
// the real SQL predicates are exercised in auth-session-mysql.test.ts.
function matches(row: Row, predicate?: SQL): boolean {
  if (!predicate) return true;
  const query = dialect.sqlToQuery(predicate);
  const comparisons = query.sql.matchAll(
    /`\w+`\.`(\w+)` (is not null|is null|=|>|<)(?: \?)?/g
  );
  let parameter = 0;
  for (const [, column, op] of comparisons) {
    const actual = row[column];
    if (op === "is null") {
      if (actual != null) return false;
    } else if (op === "is not null") {
      if (actual == null) return false;
    } else {
      const expected: unknown = query.params[parameter++];
      if (op === "=" && actual !== expected) return false;
      if (op === ">" || op === "<") {
        const isDate =
          Object.prototype.toString.call(actual) === "[object Date]";
        const a = Number(actual);
        const b = isDate
          ? new Date(String(expected).replace(" ", "T") + "Z").getTime()
          : Number(expected);
        if (op === ">" ? !(a > b) : !(a < b)) return false;
      }
    }
  }
  return true;
}

function persistence(
  data: Tables,
  transaction?: { id: number; source: Tables; hasLock: boolean }
) {
  const lock = async (name: string) => {
    if (!transaction || !hooks.locks) return;
    await hooks.locks.acquire(transaction.id, name);
    if (!transaction.hasLock) {
      // A locking read sees the committed state after waiting for its owner.
      Object.assign(data, structuredClone(transaction.source));
      transaction.hasLock = true;
    }
  };
  const db = {
    query: {
      refreshTokens: {
        async findFirst(options: { where: Where }) {
          const predicate = options.where(refreshTokens, operators);
          return structuredClone(
            data.refresh_tokens.find(row => matches(row, predicate))
          );
        },
      },
    },
    async transaction<T>(run: (tx: unknown) => Promise<T>): Promise<T> {
      const pending = structuredClone(data);
      const id = hooks.locks ? ++hooks.locks.nextId : 0;
      let result: T;
      try {
        result = await run(
          persistence(pending, { id, source: data, hasLock: false })
        );
        // A thrown callback never publishes its writes.
        Object.assign(data, pending);
      } finally {
        hooks.locks?.release(id);
      }
      await hooks.afterCommit?.();
      return result;
    },
    select(projection?: unknown) {
      let name = "";
      let predicate: SQL | undefined;
      const read = () => {
        const selected = (data[name] ?? []).filter(row =>
          matches(row, predicate)
        );
        return structuredClone(
          name === "refresh_tokens" && projection
            ? selected.map(row => ({
                user: data.users.find(user => user.id === row.userId),
                mfaEnabled: data.mfa_settings[0]?.isEnabled ?? false,
                mfaVerified: row.mfaVerified,
              }))
            : selected
        );
      };
      const chain = {
        from(table: AnyMySqlTable) {
          name = getTableName(table);
          return chain;
        },
        where(value: SQL) {
          predicate = value;
          return chain;
        },
        innerJoin: () => chain,
        leftJoin: () => chain,
        limit: () => chain,
        for: async () => {
          await lock(name);
          return read();
        },
        then: <T>(resolve: (value: Row[]) => T) =>
          Promise.resolve(read()).then(resolve),
      };
      return chain;
    },
    update(table: AnyMySqlTable) {
      return {
        set: (values: Row) => ({
          async where(predicate: SQL) {
            await lock(getTableName(table));
            if (hooks.failBackupWrite && values.backupCodes !== undefined)
              throw new Error("Fixture backup-code persistence failure");
            const rows = (data[getTableName(table)] ?? []).filter(row =>
              matches(row, predicate)
            );
            for (const row of rows) Object.assign(row, values);
            return [{ affectedRows: rows.length }];
          },
        }),
      };
    },
    insert(table: AnyMySqlTable) {
      return {
        async values(value: Row) {
          const rows = data[getTableName(table)];
          const id = Math.max(0, ...rows.map(row => Number(row.id))) + 1;
          rows.push({ id, revokedAt: null, createdAt: new Date(), ...value });
          return [{ insertId: id }];
        },
      };
    },
    delete(table: AnyMySqlTable) {
      return {
        async where(predicate: SQL) {
          const name = getTableName(table);
          await lock(name);
          const before = data[name].length;
          data[name] = data[name].filter(row => !matches(row, predicate));
          return [{ affectedRows: before - data[name].length }];
        },
      };
    },
    async execute(query: SQL) {
      const { sql, params } = dialect.sqlToQuery(query);
      if (sql.startsWith("UPDATE mfa_settings SET backupCodes")) {
        if (hooks.failBackupWrite)
          throw new Error("Fixture backup-code persistence failure");
        const row = data.mfa_settings.find(row => row.userId === params[2]);
        if (row) Object.assign(row, { backupCodes: params[0] });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (!sql.includes("FROM mfa_settings"))
        throw new Error("Unsupported regression fixture query");
      const rows = structuredClone(
        data.mfa_settings.filter(row => row.userId === params[0])
      );
      hooks.afterSettingsRead?.();
      return [rows];
    },
  };
  return db;
}

function legacyCiphertext() {
  const key = crypto.createHash("sha256").update(JWT).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = cipher.update(SECRET, "utf8", "hex") + cipher.final("hex");
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted}`;
}

function tokenRow(
  id: number,
  token: string,
  sessionId: string,
  revoked = false
) {
  return {
    id,
    userId: 1,
    familyId: sessionId,
    token: crypto.createHmac("sha256", JWT).update(token).digest("hex"),
    mfaVerified: true,
    expiresAt: new Date(Date.now() + 600000),
    revokedAt: revoked ? new Date() : null,
    deviceInfo: null,
    ipAddress: null,
  };
}

beforeEach(() => {
  for (const name of Object.keys(hooks))
    delete hooks[name as keyof typeof hooks];
  vi.resetModules();
  vi.stubEnv("JWT_SECRET", JWT);
  vi.stubEnv("REFRESH_TOKEN_PEPPER", JWT);
  vi.stubEnv("MFA_ENCRYPTION_KEY", "auth-regression-dedicated-mfa-fixture");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T12:00:05Z"));
  tables = {
    users: [
      {
        id: 1,
        openId: "fixture",
        email: "user@example.test",
        name: "User",
        role: "user",
      },
    ],
    mfa_settings: [],
    mfa_challenges: [],
    account_deletion_requests: [],
    account_locks: [],
    refresh_tokens: [],
  };
  state.db = persistence(tables);
  state.user.mockImplementation(() => structuredClone(tables.users[0]));
});

afterEach(() => {
  state.db = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("authentication transaction regressions", () => {
  async function enabledMfa() {
    const mfa = await import("../services/mfa.service");
    const secret = mfa.encryptSecret(SECRET);
    tables.mfa_settings.push({
      id: 1,
      userId: 1,
      secret,
      isEnabled: true,
      backupCodes: JSON.stringify([mfa.hashBackupCode("backup01")]),
      lastUsedStep: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { mfaRouter } = await import("../routers/mfa");
    const caller = mfaRouter.createCaller({
      user: tables.users[0],
      tenantId: null,
      authMethod: "bearer",
      req: { headers: {} },
      res: {},
    } as unknown as TrpcContext);
    return { mfa, secret, caller };
  }

  it("cannot overwrite a replacement enrollment after committing the regeneration factor", async () => {
    const { mfa, caller } = await enabledMfa();
    const replacement = {
      ...tables.mfa_settings[0],
      id: 2,
      secret: mfa.encryptSecret(SECRET),
      backupCodes: JSON.stringify([mfa.hashBackupCode("newcode1")]),
      lastUsedStep: null,
    };
    // A second request commits disable/setup/enable at the first request's
    // transaction boundary. An unconditional later write must not touch it.
    hooks.afterCommit = async () => {
      delete hooks.afterCommit;
      tables.mfa_settings = [structuredClone(replacement)];
    };
    const result = await caller.regenerateBackupCodes({ token: "379410" });
    expect(result.backupCodes).toHaveLength(10);
    expect(tables.mfa_settings).toEqual([replacement]);
    expect(
      result.backupCodes.some(
        code =>
          mfa.verifyBackupCode(code, JSON.parse(replacement.backupCodes)).valid
      )
    ).toBe(false);
  });

  it("rejects a stale regeneration enrollment without consuming its factor or changing replacement codes", async () => {
    const { mfa, caller } = await enabledMfa();
    const replacement = {
      ...tables.mfa_settings[0],
      id: 2,
      secret: mfa.encryptSecret(SECRET),
      backupCodes: JSON.stringify([mfa.hashBackupCode("newcode1")]),
    };
    hooks.afterSettingsRead = () => {
      delete hooks.afterSettingsRead;
      tables.mfa_settings = [structuredClone(replacement)];
    };
    await expect(
      caller.regenerateBackupCodes({ token: "379410" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tables.mfa_settings).toEqual([replacement]);
  });

  it("rolls the regeneration factor back when backup-code persistence fails", async () => {
    const { caller } = await enabledMfa();
    const original = structuredClone(tables.mfa_settings);
    hooks.failBackupWrite = true;
    await expect(
      caller.regenerateBackupCodes({ token: "379410" })
    ).rejects.toThrow("Fixture backup-code persistence failure");
    expect(tables.mfa_settings).toEqual(original);
    hooks.failBackupWrite = false;
    await expect(
      caller.regenerateBackupCodes({ token: "379410" })
    ).resolves.toMatchObject({ backupCodes: expect.any(Array) });
  });

  it("regenerates legacy-key backup codes atomically and refuses a reused TOTP", async () => {
    const { mfa, caller } = await enabledMfa();
    tables.mfa_settings[0].secret = legacyCiphertext();
    const result = await caller.regenerateBackupCodes({ token: "379410" });
    expect(tables.mfa_settings[0].secret).toMatch(/^k2:/);
    const stored = JSON.parse(String(tables.mfa_settings[0].backupCodes));
    expect(result.backupCodes).toHaveLength(10);
    for (const code of result.backupCodes)
      expect(mfa.verifyBackupCode(code, stored).valid).toBe(true);
    expect(mfa.verifyBackupCode("backup01", stored).valid).toBe(false);
    const beforeReplay = structuredClone(tables.mfa_settings);
    await expect(
      caller.regenerateBackupCodes({ token: "379410" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(tables.mfa_settings).toEqual(beforeReplay);
  });

  it("completes a login challenge while a disable request contends without a lock cycle", async () => {
    const { mfa, secret } = await enabledMfa();
    const challenge = await mfa.createMfaChallenge(1);
    // The adapter supplies schema defaults for this directly-created row.
    Object.assign(tables.mfa_challenges[0], { consumedAt: null, attempts: 0 });
    const firstLock = deferred();
    const resumeCompletion = deferred();
    const completionWaitsForSettings = deferred();
    const locks = new FixtureLocks();
    hooks.locks = locks;
    let completionPaused = false;
    locks.afterAcquire = async (id, table) => {
      if (id === 1 && !completionPaused) {
        completionPaused = true;
        firstLock.resolve();
        await resumeCompletion.promise;
      }
      if (id === 2 && table === "mfa_settings") {
        resumeCompletion.resolve();
        // With the old order, completion owns the challenge while disable
        // owns settings. Let completion wait before disable revokes it.
        if (locks.nextId === 2 && !tables.mfa_challenges[0].consumedAt)
          await completionWaitsForSettings.promise;
      }
    };
    locks.onWait = (id, table) => {
      if (id === 1 && table === "mfa_settings")
        completionWaitsForSettings.resolve();
      if (id === 2 && table === "users") resumeCompletion.resolve();
    };
    const completion = mfa.completeMfaChallenge(challenge, "backup01");
    await firstLock.promise;
    const disabling = mfa.disableMfa(1, secret, "379410");
    const results = await Promise.allSettled([completion, disabling]);
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      expect(result).toMatchObject({ status: "fulfilled" });
    }
    expect(tables.mfa_settings).toEqual([]);
    expect(tables.mfa_challenges[0].consumedAt).toBeInstanceOf(Date);
  });

  it.each(["removed", "disabled"])(
    "rejects a captured MFA proof after enrollment is %s but permits ordinary password login",
    async enrollment => {
      const { mfa } = await enabledMfa();
      const { mobileAuthServiceV2: auth } =
        await import("../services/mobile-auth-v2.service");
      const challenge = await mfa.createMfaChallenge(1);
      Object.assign(tables.mfa_challenges[0], {
        consumedAt: null,
        attempts: 0,
      });
      const proof = await mfa.completeMfaChallenge(challenge, "backup01");
      if (enrollment === "removed") tables.mfa_settings = [];
      else tables.mfa_settings[0].isEnabled = false;
      await expect(auth.login(1, undefined, proof)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "MFA_REQUIRED",
      });
      expect(tables.refresh_tokens).toEqual([]);
      await expect(auth.login(1)).resolves.toMatchObject({
        tokenType: "Bearer",
      });
      expect(tables.refresh_tokens).toHaveLength(1);
      expect(tables.refresh_tokens[0].mfaVerified).toBe(false);
    }
  );

  it("keeps the enrollment and TOTP step unchanged when verification or the expected enrollment fails", async () => {
    const mfa = await import("../services/mfa.service");
    const secret = legacyCiphertext();
    tables.mfa_settings.push({
      id: 1,
      userId: 1,
      secret,
      isEnabled: false,
      backupCodes: "[]",
      lastUsedStep: null,
    });
    await expect(
      mfa.enableMfa(1, "stale-enrollment", "379410")
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(mfa.enableMfa(1, secret, "000000")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(tables.mfa_settings[0]).toMatchObject({
      secret,
      isEnabled: false,
      lastUsedStep: null,
    });
    expect(tables.refresh_tokens).toEqual([]);
  });

  it.each([false, true])(
    "commits an MFA account change while migrating legacy encryption (already enabled: %s)",
    async enabled => {
      const { mfaRouter } = await import("../routers/mfa");
      tables.mfa_settings.push({
        id: 1,
        userId: 1,
        secret: legacyCiphertext(),
        isEnabled: enabled,
        backupCodes: "[]",
        lastUsedStep: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      tables.refresh_tokens.push(tokenRow(1, "current-token", family));
      tables.mfa_challenges.push({ id: 1, userId: 1, consumedAt: null });
      const ctx = {
        user: tables.users[0],
        tenantId: null,
        authMethod: "bearer",
        req: { headers: {} },
        res: {},
      } as unknown as TrpcContext;
      const caller = mfaRouter.createCaller(ctx);
      await expect(
        enabled
          ? caller.disable({ token: "379410" })
          : caller.verify({ token: "379410" })
      ).resolves.toMatchObject({ success: true });
      if (enabled) expect(tables.mfa_settings).toEqual([]);
      else
        expect(tables.mfa_settings[0]).toMatchObject({
          isEnabled: true,
          secret: expect.stringMatching(/^k2:/),
        });
      expect(tables.refresh_tokens[0].revokedAt).toBeInstanceOf(Date);
      expect(tables.mfa_challenges[0].consumedAt).toBeInstanceOf(Date);
    }
  );

  it("commits replay revocation before rejecting and leaves another family usable", async () => {
    const { mobileAuthServiceV2: auth } =
      await import("../services/mobile-auth-v2.service");
    tables.refresh_tokens.push(
      tokenRow(1, "old-token", family, true),
      tokenRow(2, "current-token", family),
      tokenRow(3, "other-token", otherFamily)
    );
    await expect(auth.refreshTokens("old-token")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(
      tables.refresh_tokens.find(row => row.id === 2)?.revokedAt
    ).toBeInstanceOf(Date);
    await expect(auth.authenticateSession(family)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(auth.authenticateSession(otherFamily)).resolves.toMatchObject({
      id: 1,
    });
    expect(
      tables.refresh_tokens.find(row => row.id === 3)?.revokedAt
    ).toBeNull();
  });

  it("issues the real router session using the migrated MFA proof, then refuses code replay", async () => {
    const mfa = await import("../services/mfa.service");
    const { authRouter } = await import("../routers/auth");
    const { mobileAuthServiceV2: auth } =
      await import("../services/mobile-auth-v2.service");
    const challenge = "c".repeat(64);
    const oldSecret = legacyCiphertext();
    tables.mfa_settings.push({
      id: 1,
      userId: 1,
      secret: oldSecret,
      isEnabled: true,
      backupCodes: "[]",
      lastUsedStep: null,
    });
    tables.mfa_challenges.push({
      id: 1,
      userId: 1,
      tokenHash: crypto.createHash("sha256").update(challenge).digest("hex"),
      expiresAt: new Date(Date.now() + 300000),
      consumedAt: null,
      attempts: 0,
    });
    const cookie = vi.fn();
    const ctx = {
      user: null,
      tenantId: null,
      authMethod: null,
      req: {
        protocol: "https",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      },
      res: { cookie },
    } as unknown as TrpcContext;
    // Independent RFC 6238 fixture at 2026-11-04T12:00:05Z.
    const code = "379410";
    expect(mfa.verifyTOTP(SECRET, code)).toBe(true);
    const session = await authRouter
      .createCaller(ctx)
      .completeMfa({ challengeToken: challenge, code });
    expect(session).toMatchObject({ tokenType: "Bearer", user: { id: 1 } });
    expect(cookie).toHaveBeenCalledOnce();
    expect(tables.mfa_settings[0].secret).toMatch(/^k2:/);
    expect(tables.mfa_settings[0].secret).not.toBe(oldSecret);
    expect(mfa.decryptSecret(String(tables.mfa_settings[0].secret))).toBe(
      SECRET
    );
    expect(tables.mfa_challenges[0].consumedAt).toBeInstanceOf(Date);
    await expect(
      auth.authenticateAccessToken(session.accessToken)
    ).resolves.toMatchObject({ id: 1 });
    await expect(
      authRouter
        .createCaller(ctx)
        .completeMfa({ challengeToken: challenge, code })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(tables.refresh_tokens).toHaveLength(1);
  });
});
