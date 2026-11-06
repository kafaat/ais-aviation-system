import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { eq, getTableName } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import { COOKIE_NAME } from "../../shared/const";

const state = vi.hoisted(() => ({
  db: null as MySql2Database<typeof schema> | null,
}));
vi.mock("../db", () => ({
  getDb: () => state.db,
  getUserByOpenId: (openId: string) =>
    state.db!.query.users.findFirst({
      where: (user, { eq }) => eq(user.openId, openId),
    }),
  upsertUser: async (user: schema.InsertUser) => {
    await state
      .db!.insert(schema.users)
      .values(user)
      .onDuplicateKeyUpdate({
        set: {
          name: user.name,
          email: user.email,
          lastSignedIn: user.lastSignedIn,
        },
      });
  },
}));
// Exercise the production quota service's bounded in-memory counter. Redis
// persistence has its own acceptance gate; authentication below is not mocked.
vi.mock("../services/cache.service", () => ({
  cacheService: { isConnected: () => false },
}));

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
const tables = [
  schema.tenants,
  schema.users,
  schema.refreshTokens,
  schema.mfaSettings,
  schema.mfaChallenges,
  schema.accountLocks,
  schema.accountDeletionRequests,
  schema.oauthLoginStates,
  schema.ipBlacklist,
  schema.loyaltyAccounts,
];
const ownerId = 11;
const ownerOpenId = "native-oauth-owner";
const clientIp = "198.51.100.9";

nativeDescribe(
  "native OAuth browser binding and HTTP request quota identity",
  () => {
    let admin: mysql.Connection | undefined;
    let pool: mysql.Pool | undefined;
    let databaseName = "";
    let created = false;
    let api: Server | undefined;
    let provider: Server | undefined;
    let apiOrigin = "";
    let providerOrigin = "";
    let callbackUri = "";
    let sdk: typeof import("../_core/sdk").sdk;
    let auth: typeof import("../services/mobile-auth-v2.service").mobileAuthServiceV2;
    let mfa: typeof import("../services/mfa.service");
    let limits: typeof import("../services/rate-limit.service").rateLimitService;
    const exchanges: Record<string, unknown>[] = [];
    const authorizations: Array<{ state: string; redirectUri: string }> = [];
    let providerFailure = false;

    async function serve(server: Server) {
      await new Promise<void>(resolve =>
        server.listen(0, "127.0.0.1", resolve)
      );
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    async function start(returnTo = "/", headers: Record<string, string> = {}) {
      const response = await fetch(
        `${apiOrigin}/api/oauth/start?${new URLSearchParams({ returnTo })}`,
        { redirect: "manual", headers }
      );
      expect(response.status).toBe(302);
      const location = response.headers.get("location")!;
      const nonceCookie = response.headers.get("set-cookie")!.split(";")[0];
      return {
        location,
        nonceCookie,
        state: new URL(location).searchParams.get("state")!,
      };
    }

    async function callback(
      login: { state: string; nonceCookie?: string },
      extras: Record<string, string> = {}
    ) {
      return fetch(
        `${apiOrigin}/api/oauth/callback?${new URLSearchParams({ code: "controlled-provider-code", state: login.state, ...extras })}`,
        {
          redirect: "manual",
          headers: login.nonceCookie ? { cookie: login.nonceCookie } : {},
        }
      );
    }

    async function credentials() {
      const tokens = await auth.login(ownerId);
      const token = await sdk.createSessionToken(ownerOpenId, {
        sessionId: tokens.sessionId,
      });
      return {
        bearer: `Bearer ${tokens.accessToken}`,
        cookie: `${COOKIE_NAME}=${token}`,
        sessionId: tokens.sessionId,
      };
    }

    async function identity(
      headers: Record<string, string>,
      path = "/api/identity"
    ) {
      const response = await fetch(apiOrigin + path, {
        headers: { "x-forwarded-for": clientIp, ...headers },
      });
      return {
        response,
        body: (await response.json()) as {
          userId: number | null;
          authMethod: string | null;
          tenantId: number | null;
        },
      };
    }

    async function waitForStateWaiters(expected: number) {
      const deadline = performance.now() + 5000;
      let count = 0;
      do {
        const [rows] = await pool!.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(DISTINCT waits.REQUESTING_THREAD_ID) AS count
         FROM performance_schema.data_lock_waits AS waits
         JOIN performance_schema.data_locks AS locks
           ON locks.ENGINE = waits.ENGINE AND locks.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
         WHERE locks.OBJECT_SCHEMA = ? AND locks.OBJECT_NAME = 'oauth_login_states'`,
          [databaseName]
        );
        count = Number(rows[0].count);
        if (count === expected) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      } while (performance.now() < deadline);
      expect(
        count,
        "callbacks waiting on the owned native state row lock"
      ).toBe(expected);
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
          "Native identity acceptance requires an explicit loopback ais_*test database"
        );
      }
      const options = {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
      };
      databaseName =
        "ais_request_identity_" + crypto.randomBytes(6).toString("hex");
      if (!/^ais_request_identity_[a-f0-9]{12}$/.test(databaseName))
        throw new Error("Invalid owned schema name");
      admin = await mysql.createConnection(options);
      await admin.query("CREATE DATABASE " + databaseName);
      created = true;
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 12,
      });
      for (const table of tables) {
        const name = getTableName(table);
        await pool.query(
          `CREATE TABLE \`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
        );
      }
      state.db = drizzle(pool, { schema, mode: "default" });
      const app = express();
      app.set("trust proxy", "loopback");
      api = createServer(app);
      apiOrigin = await serve(api);
      callbackUri = apiOrigin + "/api/oauth/callback";

      // Controlled HTTP provider fixture: preserves the documented application
      // fields and opaque state echo. This is not live provider acceptance.
      provider = createServer(async (request, response) => {
        const requestUrl = new URL(request.url!, "http://fixture.invalid");
        if (requestUrl.pathname === "/portal/app-auth") {
          const state = requestUrl.searchParams.get("state")!;
          const redirectUri = requestUrl.searchParams.get("redirectUri")!;
          authorizations.push({ state, redirectUri });
          const destination = new URL(redirectUri);
          destination.searchParams.set("state", state);
          destination.searchParams.set("code", "controlled-provider-code");
          response.writeHead(302, { location: destination.toString() });
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const input = JSON.parse(
          Buffer.concat(chunks).toString("utf8")
        ) as Record<string, unknown>;
        response.setHeader("content-type", "application/json");
        if (requestUrl.pathname.endsWith("/ExchangeToken")) {
          exchanges.push(input);
          response.statusCode = providerFailure ? 503 : 200;
          response.end(
            JSON.stringify(
              providerFailure
                ? { error: "controlled failure" }
                : { accessToken: "controlled-provider-token" }
            )
          );
        } else if (requestUrl.pathname.endsWith("/GetUserInfo")) {
          response.end(
            JSON.stringify({
              openId: ownerOpenId,
              name: "Controlled OAuth User",
              email: "native-oauth@example.test",
            })
          );
        } else {
          response.statusCode = 404;
          response.end("{}");
        }
      });
      providerOrigin = await serve(provider);
      vi.stubEnv(
        "JWT_SECRET",
        "controlled-native-request-identity-signing-secret"
      );
      vi.stubEnv(
        "REFRESH_TOKEN_PEPPER",
        "controlled-native-request-identity-pepper"
      );
      vi.stubEnv(
        "MFA_ENCRYPTION_KEY",
        "controlled-native-request-identity-mfa-key"
      );
      vi.stubEnv("VITE_APP_ID", "native-request-identity-app");
      vi.stubEnv("OAUTH_REDIRECT_URI", callbackUri);
      vi.stubEnv("OAUTH_PORTAL_URL", providerOrigin + "/portal");
      vi.stubEnv("OAUTH_SERVER_URL", providerOrigin);
      vi.stubEnv("CACHE_PREFIX", databaseName);
      for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"])
        vi.stubEnv(name, "");
      vi.stubEnv("NO_PROXY", "127.0.0.1,localhost");
      vi.resetModules();
      sdk = (await import("../_core/sdk")).sdk;
      auth = (await import("../services/mobile-auth-v2.service"))
        .mobileAuthServiceV2;
      mfa = await import("../services/mfa.service");
      limits = (await import("../services/rate-limit.service"))
        .rateLimitService;
      const { blockedIpAdmission } =
        await import("../_core/middleware/blocked-ip.middleware");
      const { createUserRateLimitMiddleware, createStrictRateLimitMiddleware } =
        await import("../_core/middleware/user-rate-limit.middleware");
      const { createContext } = await import("../_core/context");
      const { registerOAuthRoutes } = await import("../_core/oauth");
      app.use("/api", blockedIpAdmission);
      registerOAuthRoutes(app);
      const currentIdentity: express.RequestHandler = async (req, res) => {
        const context = await createContext({ req, res });
        res.json({
          userId: context.user?.id ?? null,
          authMethod: context.authMethod,
          tenantId: context.tenantId,
        });
      };
      app.get(
        "/api/identity",
        createUserRateLimitMiddleware({
          skipInDevelopment: false,
          scope: "native-identity",
        }),
        currentIdentity
      );
      app.get(
        "/api/strict-identity",
        createStrictRateLimitMiddleware("auth"),
        currentIdentity
      );
      app.get("/api/rest/health/live", (_req, res) =>
        res.json({ alive: true })
      );
    }, 30000);

    beforeEach(async () => {
      exchanges.length = 0;
      authorizations.length = 0;
      providerFailure = false;
      for (const table of [...tables].reverse())
        await pool!.query("DELETE FROM `" + getTableName(table) + "`");
      await state.db!.insert(schema.tenants).values({
        id: 101,
        slug: "native-identity",
        name: "Native Identity",
        status: "active",
      });
      await state.db!.insert(schema.users).values({
        id: ownerId,
        openId: ownerOpenId,
        name: "Controlled OAuth User",
        email: "native-oauth@example.test",
        tenantId: 101,
      });
      for (const identifier of [
        "user:11",
        `ip:${clientIp}`,
        "ip:198.51.100.10",
      ]) {
        await limits.resetRateLimit(identifier, "native-identity");
        await limits.resetRateLimit(identifier, "strict:auth");
      }
    });

    afterAll(async () => {
      for (const server of [api, provider])
        if (server)
          await new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve()))
          );
      state.db = null;
      if (pool) await pool.end();
      if (created && admin) await admin.query("DROP DATABASE " + databaseName);
      if (admin) await admin.end();
      vi.unstubAllEnvs();
    });

    it("keeps the portal path, opaque state echo, and identical start/exchange redirect URI", async () => {
      const login = await start("/checkout/700?currency=USD", {
        host: "spoofed.test",
        "x-forwarded-host": "spoofed.test",
        "x-forwarded-proto": "https",
      });
      const portal = new URL(login.location);
      expect(portal.origin + portal.pathname).toBe(
        providerOrigin + "/portal/app-auth"
      );
      expect(portal.searchParams.get("redirectUri")).toBe(callbackUri);
      expect(portal.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const providerRedirect = await fetch(login.location, {
        redirect: "manual",
      });
      const destination = new URL(providerRedirect.headers.get("location")!);
      expect(destination.searchParams.get("state")).toBe(login.state);
      expect(authorizations).toEqual([
        { state: login.state, redirectUri: callbackUri },
      ]);
      const response = await callback(login, { returnTo: "//evil.test" });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "/checkout/700?currency=USD"
      );
      expect(exchanges).toEqual([
        {
          clientId: "native-request-identity-app",
          grantType: "authorization_code",
          code: "controlled-provider-code",
          redirectUri: callbackUri,
        },
      ]);
      const sessionCookie = response.headers
        .getSetCookie()
        .find(value => value.startsWith(COOKIE_NAME + "="))
        ?.split(";")[0];
      expect(sessionCookie).toBeTruthy();
      expect((await identity({ cookie: sessionCookie! })).body).toMatchObject({
        userId: ownerId,
        authMethod: "cookie",
        tenantId: 101,
      });
    });

    it("rejects unsolicited, wrong-browser, and replayed callbacks before exchange", async () => {
      const first = await start();
      const second = await start();
      expect((await callback({ state: first.state })).status).toBe(400);
      expect(
        (
          await callback({
            state: first.state,
            nonceCookie: second.nonceCookie,
          })
        ).status
      ).toBe(400);
      expect(
        (
          await callback({
            state: Buffer.from(callbackUri).toString("base64"),
            nonceCookie: first.nonceCookie,
          })
        ).status
      ).toBe(400);
      expect(exchanges).toHaveLength(0);
      expect((await callback(first)).status).toBe(302);
      expect((await callback(first)).status).toBe(400);
      expect(exchanges).toHaveLength(1);
    });

    it("rejects expired, different-redirect and unsafe stored targets before exchange", async () => {
      const expired = await start();
      await state
        .db!.update(schema.oauthLoginStates)
        .set({ expiresAt: new Date(Date.now() - 60000) });
      expect((await callback(expired)).status).toBe(400);
      const changed = await start();
      await state
        .db!.update(schema.oauthLoginStates)
        .set({ redirectUri: "https://other.test/api/oauth/callback" });
      expect((await callback(changed)).status).toBe(400);
      const unsafe = await start();
      await state
        .db!.update(schema.oauthLoginStates)
        .set({ returnTo: "//evil.test" });
      expect((await callback(unsafe)).status).toBe(400);
      expect(exchanges).toHaveLength(0);
    });

    it("claims one state exactly once under observed concurrent MySQL update waiters", async () => {
      const login = await start();
      const connection = await pool!.getConnection();
      let requests: Promise<Response>[] = [];
      let responses: Response[] = [];
      try {
        await connection.beginTransaction();
        await connection.query(
          "SELECT stateHash FROM oauth_login_states FOR UPDATE"
        );
        requests = Array.from({ length: 4 }, () => callback(login));
        await waitForStateWaiters(4);
      } finally {
        await connection.commit();
        connection.release();
        responses = await Promise.all(requests);
      }
      expect(responses.map(response => response.status).sort()).toEqual([
        302, 400, 400, 400,
      ]);
      expect(exchanges).toHaveLength(1);
      const sessions = await state.db!.select().from(schema.refreshTokens);
      expect(sessions).toHaveLength(1);
    }, 20000);

    it("consumes state after a failed provider exchange and logs no credential payload", async () => {
      const login = await start();
      providerFailure = true;
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      try {
        expect((await callback(login)).status).toBe(500);
        expect((await callback(login)).status).toBe(400);
        expect(exchanges).toHaveLength(1);
        expect(JSON.stringify(error.mock.calls)).not.toContain(
          "controlled-provider-code"
        );
        expect(JSON.stringify(error.mock.calls)).not.toContain(
          "controlled-provider-token"
        );
      } finally {
        error.mockRestore();
      }
    });

    it("preserves the real MFA challenge without issuing a pre-MFA session", async () => {
      await state.db!.insert(schema.mfaSettings).values({
        userId: ownerId,
        secret: mfa.encryptSecret("JBSWY3DPEHPK3PXP"),
        isEnabled: true,
        backupCodes: "[]",
      });
      const response = await callback(await start("/my-bookings"));
      expect(response.status).toBe(302);
      const destination = new URL(response.headers.get("location")!, apiOrigin);
      expect(destination.pathname).toBe("/login");
      expect(destination.searchParams.get("returnTo")).toBe("/my-bookings");
      expect(destination.searchParams.get("mfaChallenge")).toBeTruthy();
      expect(
        response.headers
          .getSetCookie()
          .some(value => value.startsWith(COOKIE_NAME + "="))
      ).toBe(false);
      expect(await state.db!.select().from(schema.refreshTokens)).toHaveLength(
        0
      );
      expect(await state.db!.select().from(schema.mfaChallenges)).toHaveLength(
        1
      );
    });

    it("shares an actual user counter across signed Cookie and Bearer requests from different IPs", async () => {
      const session = await credentials();
      const cookie = await identity({ cookie: session.cookie });
      const bearer = await identity({
        authorization: session.bearer,
        "x-forwarded-for": "198.51.100.10",
      });
      expect(cookie.body).toMatchObject({
        userId: ownerId,
        authMethod: "cookie",
      });
      expect(bearer.body).toMatchObject({
        userId: ownerId,
        authMethod: "bearer",
      });
      expect(cookie.response.headers.get("x-ratelimit-tier")).toBe(
        "authenticated"
      );
      expect(bearer.response.headers.get("x-ratelimit-tier")).toBe(
        "authenticated"
      );
      expect(cookie.response.headers.get("x-ratelimit-remaining")).toBe("119");
      expect(bearer.response.headers.get("x-ratelimit-remaining")).toBe("118");
      const strictCookie = await identity(
        { cookie: session.cookie },
        "/api/strict-identity"
      );
      const strictBearer = await identity(
        { authorization: session.bearer, "x-forwarded-for": "198.51.100.10" },
        "/api/strict-identity"
      );
      expect(
        Number(strictBearer.response.headers.get("x-ratelimit-remaining"))
      ).toBe(
        Number(strictCookie.response.headers.get("x-ratelimit-remaining")) - 1
      );
    });

    it.each(["Bearer invalid-token", "Bearer"])(
      "does not inherit signed-cookie identity or quota for %s",
      async authorization => {
        const session = await credentials();
        const result = await identity({
          cookie: session.cookie,
          authorization,
        });
        expect(result.body).toEqual({
          userId: null,
          authMethod: null,
          tenantId: null,
        });
        expect(result.response.headers.get("x-ratelimit-tier")).toBe(
          "anonymous"
        );
        expect(result.response.headers.get("x-ratelimit-remaining")).toBe("59");
        expect(
          (await identity({ cookie: session.cookie })).response.headers.get(
            "x-ratelimit-remaining"
          )
        ).toBe("119");
      }
    );

    it.each(["revoked", "locked", "inactive tenant"])(
      "removes Cookie and Bearer identities and user quotas for a %s session",
      async condition => {
        const session = await credentials();
        if (condition === "revoked") await auth.logoutAllDevices(ownerId);
        if (condition === "locked")
          await state.db!.insert(schema.accountLocks).values({
            userId: ownerId,
            reason: "Native fixture lock",
            lockedBy: "controlled-admin",
            isActive: true,
          });
        if (condition === "inactive tenant")
          await state
            .db!.update(schema.tenants)
            .set({ status: "suspended" })
            .where(eq(schema.tenants.id, 101));
        const credentialHeaders: Record<string, string>[] = [
          { cookie: session.cookie },
          { authorization: session.bearer },
        ];
        for (const headers of credentialHeaders) {
          const result = await identity(headers);
          expect(result.body).toEqual({
            userId: null,
            authMethod: null,
            tenantId: null,
          });
          expect(result.response.headers.get("x-ratelimit-tier")).toBe(
            "anonymous"
          );
        }
      }
    );

    it("enforces native persisted IP blocks ahead of signed authentication and preserves liveness", async () => {
      const session = await credentials();
      await state.db!.insert(schema.ipBlacklist).values({
        ipAddress: clientIp,
        reason: "Native fixture IP block",
        blockedBy: "controlled-admin",
        isActive: true,
      });
      expect(
        (await identity({ authorization: session.bearer })).response.status
      ).toBe(403);
      expect(
        (
          await fetch(apiOrigin + "/api/rest/health/live", {
            headers: { "x-forwarded-for": clientIp },
          })
        ).status
      ).toBe(200);
      await state
        .db!.update(schema.ipBlacklist)
        .set({ autoUnblockAt: new Date(Date.now() - 60000) });
      expect(
        (await identity({ authorization: session.bearer })).body.userId
      ).toBe(ownerId);
    });
  }
);
