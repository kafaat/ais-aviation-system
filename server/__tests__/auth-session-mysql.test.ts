import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { eq, getTableName } from "drizzle-orm";
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
import * as schema from "../../drizzle/schema";
import type { AuthTokens } from "../services/mobile-auth-v2.service";

const state = vi.hoisted(() => ({
  db: null as MySql2Database<typeof schema> | null,
}));
vi.mock("../db", () => ({
  getDb: () => state.db,
  getUserById: (id: number) =>
    state.db!.query.users.findFirst({
      where: (user, { eq }) => eq(user.id, id),
    }),
  getUserByEmail: (email: string) =>
    state.db!.query.users.findFirst({
      where: (user, { eq }) => eq(user.email, email),
    }),
  getUserByOpenId: (openId: string) =>
    state.db!.query.users.findFirst({
      where: (user, { eq }) => eq(user.openId, openId),
    }),
}));
// Rate-limit persistence has a separate Redis acceptance gate. All identity,
// session, MFA, HTTP transport and MySQL transaction code below is real.
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
const JWT = "native-auth-session-signing-fixture-not-for-production";
const MFA_KEY = "native-auth-session-encryption-fixture";
const PASSWORD = "controlled-auth-transport-fixture";
const SERVICE_TOKEN = "controlled-auth-service-token";
const SECRET = "JBSWY3DPEHPK3PXP";
const ownerId = 11;
const otherId = 22;
const fixtureTables = [
  schema.tenants,
  schema.users,
  schema.refreshTokens,
  schema.mfaSettings,
  schema.mfaChallenges,
  schema.accountLocks,
  schema.accountDeletionRequests,
  schema.loginAttempts,
  schema.securityEvents,
];

function legacyCiphertext() {
  const key = crypto.createHash("sha256").update(JWT).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const value = cipher.update(SECRET, "utf8", "hex") + cipher.final("hex");
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${value}`;
}

// Test-side authenticator, independent of the service's private generator.
function authenticatorCode(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map(character => alphabet.indexOf(character).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2))
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}

nativeDescribe("native authentication sessions, rotation and MFA", () => {
  let admin: mysql.Connection | undefined;
  let pool: mysql.Pool | undefined;
  let created = false;
  let databaseName = "";
  let api: Server | undefined;
  let provider: Server | undefined;
  let apiOrigin = "";
  let auth: typeof import("../services/mobile-auth-v2.service").mobileAuthServiceV2;
  let mfa: typeof import("../services/mfa.service");
  let fault: { status: number; body: unknown } | null = null;

  async function serve(server: Server) {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  async function post(
    path: string,
    input: unknown,
    headers: Record<string, string> = {}
  ) {
    return fetch(apiOrigin + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(input),
    });
  }
  async function login(email = "owner@example.test") {
    const response = await post("/auth/login", { email, password: PASSWORD });
    expect(response.status).toBe(200);
    const session = (await response.json()) as Pick<
      AuthTokens,
      "accessToken" | "refreshToken" | "expiresIn" | "tokenType"
    >;
    expect(session.tokenType).toBe("Bearer");
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    return { ...session, cookie: cookie! };
  }
  async function currentUser(headers: Record<string, string>) {
    return (await fetch(apiOrigin + "/auth/me", { headers })).json();
  }
  async function enroll(secret = mfa.encryptSecret(SECRET)) {
    await state.db!.insert(schema.mfaSettings).values({
      userId: ownerId,
      secret,
      isEnabled: true,
      backupCodes: JSON.stringify([
        mfa.hashBackupCode("backup01"),
        mfa.hashBackupCode("backup02"),
      ]),
    });
  }
  async function familyRows(familyId: string) {
    return state
      .db!.select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.familyId, familyId));
  }
  async function lockUser() {
    const connection = await pool!.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [
        ownerId,
      ]);
      return connection;
    } catch (error) {
      connection.release();
      throw error;
    }
  }
  async function waitForUserWaiters(expected: number) {
    // MySQL 8/9 native lock evidence, restricted to this test's owned schema.
    // Date is faked for TOTP, so use a monotonic deadline for coordination.
    const deadline = performance.now() + 5000;
    let actual = 0;
    do {
      const [rows] = await pool!.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(DISTINCT waits.REQUESTING_THREAD_ID) AS count
           FROM performance_schema.data_lock_waits AS waits
           JOIN performance_schema.data_locks AS locks
             ON locks.ENGINE = waits.ENGINE
            AND locks.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
          WHERE locks.OBJECT_SCHEMA = ? AND locks.OBJECT_NAME = 'users'`,
        [databaseName]
      );
      actual = Number(rows[0].count);
      if (actual === expected) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (performance.now() < deadline);
    expect(actual, "contenders waiting on the owned user's native lock").toBe(
      expected
    );
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const sourceDatabase = url.pathname.slice(1);
    if (
      url.protocol !== "mysql:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^ais_[a-z0-9_]*test$/.test(sourceDatabase)
    ) {
      throw new Error(
        "Native auth acceptance requires an explicit loopback ais_*test database"
      );
    }
    const options = {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      timezone: "Z",
    };
    databaseName = "ais_auth_session_" + crypto.randomBytes(6).toString("hex");
    if (!/^ais_auth_session_[a-f0-9]{12}$/.test(databaseName))
      throw new Error("Invalid isolated schema name");
    admin = await mysql.createConnection(options);
    await admin.query("CREATE DATABASE " + databaseName);
    created = true;
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 6,
    });
    // Use the committed migrations' exact columns and indexes, with no user
    // data copied and no writes to the runner's source database.
    for (const table of fixtureTables) {
      const name = getTableName(table);
      await pool.query(
        `CREATE TABLE \`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
      );
    }
    state.db = drizzle(pool, { schema, mode: "default" });
    vi.stubEnv("JWT_SECRET", JWT);
    vi.stubEnv("REFRESH_TOKEN_PEPPER", JWT);
    vi.stubEnv("MFA_ENCRYPTION_KEY", MFA_KEY);
    vi.stubEnv("AUTH_SERVICE_TOKEN", SERVICE_TOKEN);
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"])
      vi.stubEnv(name, "");
    vi.stubEnv("NO_PROXY", "127.0.0.1,localhost");
    // A controlled password-provider HTTP fixture, not FastAPI/bcrypt acceptance.
    provider = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          email: string;
          password: string;
          name?: string;
        };
        response.setHeader("content-type", "application/json");
        if (fault) {
          response.writeHead(fault.status);
          response.end(JSON.stringify(fault.body));
          return;
        }
        if (
          request.headers["x-auth-service-token"] !== SERVICE_TOKEN ||
          input.password !== PASSWORD
        ) {
          response.writeHead(401);
          response.end(
            JSON.stringify({ success: false, message: "Invalid credentials" })
          );
          return;
        }
        if (request.url === "/auth/register")
          await state.db!.insert(schema.users).values({
            openId: crypto.randomUUID(),
            email: input.email,
            name: input.name ?? null,
            tenantId: 101,
          });
        const user = await state.db!.query.users.findFirst({
          where: eq(schema.users.email, input.email),
        });
        response.end(
          JSON.stringify(user ? { success: true, user } : { success: false })
        );
      } catch {
        response.writeHead(500);
        response.end(JSON.stringify({ success: false }));
      }
    });
    vi.stubEnv("AUTH_SERVICE_URL", await serve(provider));
    vi.resetModules();
    auth = (await import("../services/mobile-auth-v2.service"))
      .mobileAuthServiceV2;
    mfa = await import("../services/mfa.service");
    const { authRouter } = await import("../routers/auth");
    const { mfaRouter } = await import("../routers/mfa");
    const { router } = await import("../_core/trpc");
    const { createContext } = await import("../_core/context");
    const { createRestMiddleware } = await import("../_core/rest");
    const app = express();
    app.use(express.json());
    app.use(
      createRestMiddleware({
        router: router({ auth: authRouter, mfa: mfaRouter }),
        createContext,
      })
    );
    api = createServer(app);
    apiOrigin = await serve(api);
  }, 30000);

  beforeEach(async () => {
    fault = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T12:00:05Z"));
    for (const table of [...fixtureTables].reverse())
      await pool!.query("DELETE FROM `" + getTableName(table) + "`");
    await state.db!.insert(schema.tenants).values([
      { id: 101, slug: "auth-one", name: "One" },
      { id: 202, slug: "auth-two", name: "Two" },
    ]);
    await state.db!.insert(schema.users).values([
      {
        id: ownerId,
        openId: "auth-owner",
        name: "Owner",
        email: "owner@example.test",
        tenantId: 101,
      },
      {
        id: otherId,
        openId: "auth-other",
        name: "Other",
        email: "other@example.test",
        tenantId: 202,
      },
    ]);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    for (const server of [api, provider]) {
      if (!server) continue;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
    state.db = null;
    await pool?.end();
    if (admin) {
      try {
        if (created) await admin.query("DROP DATABASE " + databaseName);
      } finally {
        await admin.end();
      }
    }
    vi.unstubAllEnvs();
  });

  it("registers and logs in over HTTP, authenticates cookie and Bearer, rotates and logs out with an old token", async () => {
    const registered = await post("/auth/register", {
      email: "new@example.test",
      password: PASSWORD,
      name: "New",
    });
    expect(registered.status).toBe(200);
    const initial = await login("new@example.test");
    expect(await currentUser({ cookie: initial.cookie })).toMatchObject({
      email: "new@example.test",
      tenantId: 101,
    });
    expect(
      await currentUser({ authorization: `Bearer ${initial.accessToken}` })
    ).toMatchObject({ email: "new@example.test" });
    const refreshed = await post("/auth/refresh", {
      refreshToken: initial.refreshToken,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as AuthTokens;
    expect(next.refreshToken).not.toBe(initial.refreshToken);
    expect(await auth.verifyRefreshToken(initial.refreshToken)).toBeNull();
    expect(await auth.verifyRefreshToken(next.refreshToken)).toBeTruthy();
    const outsider = await auth.login(otherId);
    // No cookie accompanies logout: the rotated token itself must find and
    // revoke its family, including the browser cookie asserted below.
    const logout = await post("/auth/logout", {
      refreshToken: initial.refreshToken,
    });
    expect(logout.status).toBe(200);
    expect(await currentUser({ cookie: initial.cookie })).toBeNull();
    expect(
      await currentUser({ authorization: `Bearer ${next.accessToken}` })
    ).toBeNull();
    await expect(auth.refreshTokens(next.refreshToken)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      auth.authenticateAccessToken(outsider.accessToken)
    ).resolves.toMatchObject({ id: otherId });
  });

  it("persists replay revocation of the entire family while preserving unrelated sessions", async () => {
    const initial = await auth.login(ownerId);
    const otherFamily = await auth.login(ownerId);
    const outsider = await auth.login(otherId);
    const current = await auth.refreshTokens(initial.refreshToken);
    await expect(
      auth.refreshTokens(initial.refreshToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const rows = await familyRows(initial.sessionId);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.revokedAt !== null)).toBe(true);
    await expect(
      auth.authenticateAccessToken(current.accessToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      auth.refreshTokens(current.refreshToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      auth.authenticateAccessToken(otherFamily.accessToken)
    ).resolves.toMatchObject({ id: ownerId });
    await expect(
      auth.authenticateAccessToken(outsider.accessToken)
    ).resolves.toMatchObject({ id: otherId });
  });

  it("inserts one successor under concurrent refresh and commits family revocation by the replay loser", async () => {
    const initial = await auth.login(ownerId);
    const unrelated = await auth.login(ownerId);
    const results = await Promise.allSettled([
      auth.refreshTokens(initial.refreshToken),
      auth.refreshTokens(initial.refreshToken),
    ]);
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = results.find(
      result => result.status === "rejected"
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "UNAUTHORIZED" });
    const rows = await familyRows(initial.sessionId);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.revokedAt !== null)).toBe(true);
    await expect(
      auth.authenticateSession(initial.sessionId)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      auth.authenticateSession(unrelated.sessionId)
    ).resolves.toMatchObject({ id: ownerId });
  });

  it("does not leave a live successor when replay and a later rotation overlap", async () => {
    const initial = await auth.login(ownerId);
    const current = await auth.refreshTokens(initial.refreshToken);
    const results = await Promise.allSettled([
      auth.refreshTokens(initial.refreshToken),
      auth.refreshTokens(current.refreshToken),
    ]);
    expect(results[0].status).toBe("rejected");
    const rows = await familyRows(initial.sessionId);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows.every(row => row.revokedAt !== null)).toBe(true);
    await expect(
      auth.authenticateSession(initial.sessionId)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rolls back the token claim when successor persistence fails", async () => {
    const initial = await auth.login(ownerId);
    await pool!.query(
      "CREATE TRIGGER refuse_auth_successor BEFORE INSERT ON refresh_tokens FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'owned auth fixture failure'"
    );
    try {
      await expect(auth.refreshTokens(initial.refreshToken)).rejects.toThrow();
      const rows = await familyRows(initial.sessionId);
      expect(rows).toHaveLength(1);
      expect(rows[0].revokedAt).toBeNull();
      await expect(
        auth.authenticateSession(initial.sessionId)
      ).resolves.toMatchObject({ id: ownerId });
    } finally {
      await pool!.query("DROP TRIGGER refuse_auth_successor");
    }
  });

  it("scopes session listing and revocation to the owner and revokes all devices without affecting another user", async () => {
    const first = await auth.login(ownerId, {
      userAgent: "Primary",
      deviceId: "primary",
      ipAddress: "127.0.0.1",
    });
    const second = await auth.login(ownerId);
    const outsider = await auth.login(otherId);
    const headers = { authorization: `Bearer ${second.accessToken}` };
    const outsiderRow = (await familyRows(outsider.sessionId))[0];
    const denied = await fetch(apiOrigin + `/auth/sessions/${outsiderRow.id}`, {
      method: "DELETE",
      headers,
    });
    expect(denied.status).toBe(404);
    const listing = await fetch(apiOrigin + "/auth/sessions", { headers });
    expect(listing.status).toBe(200);
    const listed = (await listing.json()) as Record<string, unknown>[];
    expect(listed).toHaveLength(2);
    expect(listed.every(row => !("token" in row) && !("familyId" in row))).toBe(
      true
    );
    const revoked = await fetch(
      apiOrigin + `/auth/sessions/${(await familyRows(first.sessionId))[0].id}`,
      { method: "DELETE", headers }
    );
    expect(revoked.status).toBe(200);
    await expect(
      auth.authenticateSession(first.sessionId)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const logout = await post("/auth/logout-all", {}, headers);
    expect(logout.status).toBe(200);
    expect(await logout.json()).toMatchObject({
      success: true,
      revokedCount: 1,
    });
    await expect(
      auth.authenticateSession(second.sessionId)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      auth.authenticateSession(outsider.sessionId)
    ).resolves.toMatchObject({ id: otherId });
    expect(await auth.getActiveSessions(ownerId)).toEqual([]);
  });

  it("rejects legacy and expired records and cleans only expired rows", async () => {
    const active = await auth.login(ownerId);
    const expired = await auth.login(ownerId);
    await state
      .db!.update(schema.refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 10000) })
      .where(eq(schema.refreshTokens.familyId, expired.sessionId));
    await state.db!.insert(schema.refreshTokens).values({
      userId: ownerId,
      token: crypto.createHmac("sha256", JWT).update("legacy").digest("hex"),
      expiresAt: new Date(Date.now() + 60000),
    });
    expect(await auth.verifyRefreshToken("legacy")).toBeNull();
    await expect(auth.refreshTokens("legacy")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      auth.refreshTokens(expired.refreshToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await auth.cleanupExpiredTokens()).toBe(1);
    expect(await familyRows(expired.sessionId)).toEqual([]);
    await expect(
      auth.authenticateSession(active.sessionId)
    ).resolves.toMatchObject({ id: ownerId });
  });

  it("enforces locks and deletion suspension while resolving current role and tenant from storage", async () => {
    const session = await login();
    await state.db!.insert(schema.accountLocks).values({
      userId: ownerId,
      reason: "Owned test lock",
      lockedBy: "fixture",
    });
    await expect(auth.login(ownerId)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      auth.refreshTokens(session.refreshToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await currentUser({ cookie: session.cookie })).toBeNull();
    expect(
      await currentUser({ authorization: `Bearer ${session.accessToken}` })
    ).toBeNull();
    await state
      .db!.update(schema.accountLocks)
      .set({ autoUnlockAt: new Date(Date.now() - 1000) })
      .where(eq(schema.accountLocks.userId, ownerId));
    await state
      .db!.update(schema.users)
      .set({ role: "ops", tenantId: 202 })
      .where(eq(schema.users.id, ownerId));
    expect(
      await currentUser({ authorization: `Bearer ${session.accessToken}` })
    ).toMatchObject({ id: ownerId, role: "ops", tenantId: 202 });
    await state.db!.insert(schema.accountDeletionRequests).values({
      userId: ownerId,
      status: "processing",
      confirmedAt: new Date(),
      scheduledDeletionAt: new Date(Date.now() - 1000),
    });
    await expect(
      auth.authenticateAccessToken(session.accessToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await state
      .db!.update(schema.accountDeletionRequests)
      .set({ status: "cancelled" })
      .where(eq(schema.accountDeletionRequests.userId, ownerId));
    await expect(
      auth.authenticateAccessToken(session.accessToken)
    ).resolves.toMatchObject({ id: ownerId });
  });

  it("rejects malformed success and HTTP error success bodies before any persisted session or cookie", async () => {
    const user = await state.db!.query.users.findFirst({
      where: eq(schema.users.id, ownerId),
    });
    for (const response of [
      { status: 200, body: { success: "false", user } },
      { status: 503, body: { success: true, user } },
      { status: 200, body: { success: true, user: { ...user, id: -1 } } },
    ]) {
      fault = response;
      const rejected = await post("/auth/login", {
        email: "owner@example.test",
        password: PASSWORD,
      });
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get("set-cookie")).toBeNull();
      expect(await state.db!.select().from(schema.refreshTokens)).toEqual([]);
    }
  });

  it("migrates a legacy TOTP secret and completes the real HTTP session before refusing challenge and code reuse", async () => {
    const oldSecret = legacyCiphertext();
    await enroll(oldSecret);
    const password = await post("/auth/login", {
      email: "owner@example.test",
      password: PASSWORD,
    });
    expect(password.status).toBe(200);
    expect(password.headers.get("set-cookie")).toBeNull();
    const challenge = (await password.json()) as {
      mfaRequired: boolean;
      challengeToken: string;
    };
    expect(challenge.mfaRequired).toBe(true);
    const code = authenticatorCode(SECRET);
    expect(code).toBe("379410");
    const complete = await post("/auth/mfa/complete", {
      challengeToken: challenge.challengeToken,
      code,
    });
    expect(complete.status).toBe(200);
    const session = (await complete.json()) as AuthTokens;
    expect(complete.headers.get("set-cookie")).toBeTruthy();
    await expect(
      auth.authenticateAccessToken(session.accessToken)
    ).resolves.toMatchObject({ id: ownerId });
    const setting = await state.db!.query.mfaSettings.findFirst({
      where: eq(schema.mfaSettings.userId, ownerId),
    });
    expect(setting!.secret).toMatch(/^k2:/);
    expect(setting!.secret).not.toBe(oldSecret);
    expect(mfa.decryptSecret(setting!.secret)).toBe(SECRET);
    await expect(
      mfa.completeMfaChallenge(challenge.challengeToken, code)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      mfa.completeMfaChallenge(await mfa.createMfaChallenge(ownerId), code)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await state.db!.select().from(schema.refreshTokens)).toHaveLength(1);
  });

  it("consumes backup codes once, persists failed attempts, expires challenges and rejects changed enrollment proofs", async () => {
    await enroll();
    const challenge = await mfa.createMfaChallenge(ownerId);
    const proof = await mfa.completeMfaChallenge(challenge, "backup01");
    await expect(auth.login(ownerId, undefined, proof)).resolves.toMatchObject({
      tokenType: "Bearer",
    });
    await expect(
      mfa.completeMfaChallenge(
        await mfa.createMfaChallenge(ownerId),
        "backup01"
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const attempts = await mfa.createMfaChallenge(ownerId);
    for (let i = 0; i < 5; i++)
      await expect(
        mfa.completeMfaChallenge(attempts, "wrong000")
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const used = await state.db!.query.mfaChallenges.findFirst({
      where: eq(
        schema.mfaChallenges.tokenHash,
        crypto.createHash("sha256").update(attempts).digest("hex")
      ),
    });
    expect(used).toMatchObject({ attempts: 5, consumedAt: expect.any(Date) });
    await expect(
      mfa.completeMfaChallenge(attempts, "backup02")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const expired = await mfa.createMfaChallenge(ownerId);
    vi.setSystemTime(Date.now() + 301000);
    await expect(
      mfa.completeMfaChallenge(expired, "backup02")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const fresh = await mfa.completeMfaChallenge(
      await mfa.createMfaChallenge(ownerId),
      "backup02"
    );
    await state
      .db!.update(schema.mfaSettings)
      .set({ secret: mfa.encryptSecret(SECRET) })
      .where(eq(schema.mfaSettings.userId, ownerId));
    await expect(auth.login(ownerId, undefined, fresh)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "MFA_REQUIRED",
    });
  });

  it("regenerates legacy-key backup codes over HTTP and consumes both the TOTP and replacement codes once", async () => {
    await enroll(legacyCiphertext());
    const proof = await mfa.completeMfaChallenge(
      await mfa.createMfaChallenge(ownerId),
      "backup01"
    );
    const session = await auth.login(ownerId, undefined, proof);
    const headers = { authorization: `Bearer ${session.accessToken}` };
    const regenerated = await post(
      "/mfa/regenerate-backup-codes",
      { token: authenticatorCode(SECRET) },
      headers
    );
    expect(regenerated.status).toBe(200);
    const { backupCodes } = (await regenerated.json()) as {
      backupCodes: string[];
    };
    expect(backupCodes).toHaveLength(10);
    const settings = await mfa.getMfaSettings(ownerId);
    expect(settings!.secret).toMatch(/^k2:/);
    expect(JSON.parse(settings!.backupCodes)).toEqual(
      backupCodes.map(mfa.hashBackupCode)
    );
    expect(
      (
        await post(
          "/mfa/regenerate-backup-codes",
          { token: authenticatorCode(SECRET) },
          headers
        )
      ).status
    ).toBe(400);
    expect((await mfa.getMfaSettings(ownerId))!.backupCodes).toBe(
      settings!.backupCodes
    );
    await expect(
      mfa.completeMfaChallenge(
        await mfa.createMfaChallenge(ownerId),
        "backup02"
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const fresh = await mfa.completeMfaChallenge(
      await mfa.createMfaChallenge(ownerId),
      backupCodes[0]
    );
    await expect(auth.login(ownerId, undefined, fresh)).resolves.toMatchObject({
      tokenType: "Bearer",
    });
    await expect(
      mfa.completeMfaChallenge(
        await mfa.createMfaChallenge(ownerId),
        backupCodes[0]
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // Regeneration does not revoke existing sessions; enable/disable does.
    await expect(
      auth.authenticateAccessToken(session.accessToken)
    ).resolves.toMatchObject({ id: ownerId });
  });

  it("cannot overwrite an enrollment replaced at regeneration's commit boundary", async () => {
    await enroll();
    const proof = await mfa.completeMfaChallenge(
      await mfa.createMfaChallenge(ownerId),
      "backup01"
    );
    const session = await auth.login(ownerId, undefined, proof);
    const database = state.db!;
    let replace = true;
    let replacement: Awaited<ReturnType<typeof mfa.getMfaSettings>> = null;
    // Intercept only the boundary after a real MySQL commit. Enrollment
    // replacement also executes the real disable/setup/enable transactions.
    state.db = new Proxy(database, {
      get(target, key, receiver) {
        if (key === "transaction")
          return async (...args: Parameters<typeof database.transaction>) => {
            const result = await database.transaction(...args);
            if (replace) {
              replace = false;
              vi.setSystemTime(Date.now() + 60000);
              const current = await mfa.getMfaSettings(ownerId);
              await mfa.disableMfa(
                ownerId,
                current!.secret,
                authenticatorCode(SECRET)
              );
              const newSecret = mfa.generateSecret();
              const encrypted = mfa.encryptSecret(newSecret);
              await mfa.upsertMfaSetup(ownerId, encrypted, [
                mfa.hashBackupCode("newcode1"),
              ]);
              await mfa.enableMfa(
                ownerId,
                encrypted,
                authenticatorCode(newSecret)
              );
              replacement = await mfa.getMfaSettings(ownerId);
            }
            return result;
          };
        const value = Reflect.get(target, key, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      const response = await post(
        "/mfa/regenerate-backup-codes",
        { token: authenticatorCode(SECRET) },
        { authorization: `Bearer ${session.accessToken}` }
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as { backupCodes: string[] };
      const persisted = await mfa.getMfaSettings(ownerId);
      expect(replacement).not.toBeNull();
      expect(persisted).toEqual(replacement);
      expect(JSON.parse(persisted!.backupCodes)).toEqual([
        mfa.hashBackupCode("newcode1"),
      ]);
      for (const code of result.backupCodes)
        expect(
          mfa.verifyBackupCode(code, JSON.parse(persisted!.backupCodes)).valid
        ).toBe(false);
    } finally {
      state.db = database;
    }
  });

  it("refuses regeneration after an enrollment replacement commits while it waits for the user lock", async () => {
    await enroll();
    const expected = (await mfa.getMfaSettings(ownerId))!.secret;
    const holder = await lockUser();
    const result = Promise.allSettled([
      mfa.regenerateBackupCodes(ownerId, expected, authenticatorCode(SECRET)),
    ]);
    const replacementCodes = JSON.stringify([mfa.hashBackupCode("newcode1")]);
    const replacementSecret = mfa.encryptSecret(SECRET);
    try {
      await waitForUserWaiters(1);
      // Commit a replacement enrollment under the same user lock as setup.
      await holder.query("DELETE FROM mfa_settings WHERE userId = ?", [
        ownerId,
      ]);
      await holder.query(
        "INSERT INTO mfa_settings (userId, secret, isEnabled, backupCodes) VALUES (?, ?, 1, ?)",
        [ownerId, replacementSecret, replacementCodes]
      );
      await holder.commit();
      expect((await result)[0]).toMatchObject({
        status: "rejected",
        reason: { code: "CONFLICT" },
      });
      expect(
        await state.db!.query.mfaSettings.findFirst({
          where: eq(schema.mfaSettings.userId, ownerId),
        })
      ).toMatchObject({
        secret: replacementSecret,
        backupCodes: replacementCodes,
        lastUsedStep: null,
      });
    } finally {
      await holder.rollback();
      holder.release();
      await result;
    }
  });

  it("rolls back TOTP consumption and key migration when replacement backup persistence fails", async () => {
    await enroll(legacyCiphertext());
    const original = await state.db!.query.mfaSettings.findFirst({
      where: eq(schema.mfaSettings.userId, ownerId),
    });
    await pool!.query(`CREATE TRIGGER reject_backup_replacement
      BEFORE UPDATE ON mfa_settings FOR EACH ROW
      BEGIN
        IF NEW.backupCodes <> OLD.backupCodes THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fixture backup persistence failure';
        END IF;
      END`);
    try {
      await expect(
        mfa.regenerateBackupCodes(
          ownerId,
          original!.secret,
          authenticatorCode(SECRET)
        )
      ).rejects.toThrow();
      expect(
        await state.db!.query.mfaSettings.findFirst({
          where: eq(schema.mfaSettings.userId, ownerId),
        })
      ).toEqual(original);
    } finally {
      await pool!.query("DROP TRIGGER reject_backup_replacement");
    }
    const codes = await mfa.regenerateBackupCodes(
      ownerId,
      original!.secret,
      authenticatorCode(SECRET)
    );
    expect(codes).toHaveLength(10);
    expect((await mfa.getMfaSettings(ownerId))!.secret).toMatch(/^k2:/);
  });

  it("serializes challenge completion and disabling at the user lock without deadlock", async () => {
    await enroll();
    const settings = (await mfa.getMfaSettings(ownerId))!;
    const challenge = await mfa.createMfaChallenge(ownerId);
    const holder = await lockUser();
    const result = Promise.allSettled([
      mfa.completeMfaChallenge(challenge, "backup01"),
      mfa.disableMfa(ownerId, settings.secret, authenticatorCode(SECRET)),
    ]);
    try {
      await waitForUserWaiters(2);
      await holder.commit();
      const [completion, disabled] = await result;
      expect(disabled).toMatchObject({ status: "fulfilled" });
      if (completion.status === "rejected")
        expect(completion.reason).toMatchObject({ code: "UNAUTHORIZED" });
      else
        await expect(
          auth.login(ownerId, undefined, completion.value)
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: "MFA_REQUIRED",
        });
      expect(await mfa.getMfaSettings(ownerId)).toBeNull();
      await expect(
        mfa.completeMfaChallenge(challenge, "backup02")
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      await holder.rollback();
      holder.release();
      await result;
    }
  });

  it("allows only one of two concurrent challenges to consume the same TOTP", async () => {
    await enroll();
    const challenges = await Promise.all([
      mfa.createMfaChallenge(ownerId),
      mfa.createMfaChallenge(ownerId),
    ]);
    const results = await Promise.allSettled(
      challenges.map(token =>
        mfa.completeMfaChallenge(token, authenticatorCode(SECRET))
      )
    );
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({
      reason: { code: "UNAUTHORIZED" },
    });
    const attempts = await state.db!.select().from(schema.mfaChallenges);
    expect(attempts.map(row => row.attempts)).toEqual([1, 1]);
    expect(attempts.filter(row => row.consumedAt !== null)).toHaveLength(1);
  });

  it.each(["expired", "consumed"])(
    "revalidates a challenge that became %s while completion waited for the user lock",
    async stateChange => {
      await enroll();
      const before = (await mfa.getMfaSettings(ownerId))!;
      const challenge = await mfa.createMfaChallenge(ownerId);
      const holder = await lockUser();
      const result = Promise.allSettled([
        mfa.completeMfaChallenge(challenge, "backup01"),
      ]);
      try {
        await waitForUserWaiters(1);
        if (stateChange === "expired") vi.setSystemTime(Date.now() + 301000);
        else
          await holder.query(
            "UPDATE mfa_challenges SET consumedAt = ? WHERE userId = ?",
            [new Date(), ownerId]
          );
        await holder.commit();
        expect((await result)[0]).toMatchObject({
          status: "rejected",
          reason: { code: "UNAUTHORIZED" },
        });
        expect((await mfa.getMfaSettings(ownerId))!.backupCodes).toBe(
          before.backupCodes
        );
        expect(
          await state.db!.select().from(schema.mfaChallenges)
        ).toMatchObject([{ attempts: 0 }]);
      } finally {
        await holder.rollback();
        holder.release();
        await result;
      }
    }
  );

  it.each(["removed", "pending"])(
    "rejects a captured proof after the enabled enrollment is %s and still permits ordinary password login",
    async enrollment => {
      await enroll();
      const proof = await mfa.completeMfaChallenge(
        await mfa.createMfaChallenge(ownerId),
        "backup01"
      );
      await mfa.disableMfa(ownerId, proof.secret, authenticatorCode(SECRET));
      if (enrollment === "pending")
        await mfa.upsertMfaSetup(ownerId, mfa.encryptSecret(SECRET), [
          mfa.hashBackupCode("newcode1"),
        ]);
      await expect(auth.login(ownerId, undefined, proof)).rejects.toMatchObject(
        {
          code: "PRECONDITION_FAILED",
          message: "MFA_REQUIRED",
        }
      );
      expect(await state.db!.select().from(schema.refreshTokens)).toEqual([]);
      const ordinary = await login();
      await expect(
        auth.authenticateAccessToken(ordinary.accessToken)
      ).resolves.toMatchObject({ id: ownerId });
      expect(await state.db!.select().from(schema.refreshTokens)).toMatchObject(
        [{ mfaVerified: false }]
      );
    }
  );

  it.each([false, true])(
    "changes legacy-key enrollment atomically through HTTP (already enabled: %s)",
    async enabled => {
      await enroll(legacyCiphertext());
      if (!enabled)
        await state
          .db!.update(schema.mfaSettings)
          .set({ isEnabled: false })
          .where(eq(schema.mfaSettings.userId, ownerId));
      const proof = enabled
        ? await mfa.completeMfaChallenge(
            await mfa.createMfaChallenge(ownerId),
            "backup01"
          )
        : undefined;
      const session = await auth.login(ownerId, undefined, proof);
      const pending = await mfa.createMfaChallenge(ownerId);
      const changed = await post(
        enabled ? "/mfa/disable" : "/mfa/verify",
        { token: authenticatorCode(SECRET) },
        { authorization: `Bearer ${session.accessToken}` }
      );
      expect(changed.status).toBe(200);
      const setting = await mfa.getMfaSettings(ownerId);
      if (enabled) expect(setting).toBeNull();
      else
        expect(setting).toMatchObject({
          isEnabled: true,
          secret: expect.stringMatching(/^k2:/),
        });
      await expect(
        auth.authenticateAccessToken(session.accessToken)
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        mfa.completeMfaChallenge(pending, "backup02")
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  );

  it("enrolls, verifies and disables MFA through the router, revoking existing sessions and challenges at each change", async () => {
    const original = await login();
    const setupResponse = await post(
      "/mfa/setup",
      {},
      { authorization: `Bearer ${original.accessToken}` }
    );
    expect(setupResponse.status).toBe(200);
    const setup = (await setupResponse.json()) as {
      secret: string;
      backupCodes: string[];
    };
    const pending = await mfa.createMfaChallenge(ownerId);
    const verified = await post(
      "/mfa/verify",
      { token: authenticatorCode(setup.secret) },
      { authorization: `Bearer ${original.accessToken}` }
    );
    expect(verified.status).toBe(200);
    await expect(
      auth.authenticateAccessToken(original.accessToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      mfa.completeMfaChallenge(pending, setup.backupCodes[0])
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const proof = await mfa.completeMfaChallenge(
      await mfa.createMfaChallenge(ownerId),
      setup.backupCodes[0]
    );
    const session = await auth.login(ownerId, undefined, proof);
    const pendingDisable = await mfa.createMfaChallenge(ownerId);
    vi.setSystemTime(Date.now() + 60000);
    const disabled = await post(
      "/mfa/disable",
      { token: authenticatorCode(setup.secret) },
      { authorization: `Bearer ${session.accessToken}` }
    );
    expect(disabled.status).toBe(200);
    expect(await mfa.getMfaSettings(ownerId)).toBeNull();
    await expect(
      auth.authenticateAccessToken(session.accessToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      mfa.completeMfaChallenge(pendingDisable, setup.backupCodes[1])
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(auth.login(ownerId)).resolves.toMatchObject({
      tokenType: "Bearer",
    });
  });
});
