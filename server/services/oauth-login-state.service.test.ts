import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oauthLoginStates } from "../../drizzle/schema";
import { authorityRelationalFixture } from "../__tests__/helpers/authority-relational-fixture";
import {
  beginOAuthLogin,
  consumeOAuthLogin,
  OAUTH_STATE_MAX_AGE_MS,
  OAUTH_STATE_PURGE_BATCH,
  OAuthStateUnavailableError,
} from "./oauth-login-state.service";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
let fixture: ReturnType<typeof authorityRelationalFixture>;
const redirectUri = "https://ais.test/api/oauth/callback";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  fixture = authorityRelationalFixture([oauthLoginStates]);
  mocks.getDb.mockReset().mockReturnValue(fixture.db);
});
afterEach(() => {
  fixture.sqlite.close();
  vi.useRealTimers();
});

describe("OAuth one-use browser binding through production SQL predicates", () => {
  it("stores only independent random token hashes, callback, safe target and expiry", async () => {
    const login = await beginOAuthLogin(redirectUri, "/checkout/700");
    const other = await beginOAuthLogin(redirectUri, "/");
    expect(login.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(login.browserNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      new Set([
        login.state,
        login.browserNonce,
        other.state,
        other.browserNonce,
      ]).size
    ).toBe(4);
    const row = fixture.sqlite
      .prepare("SELECT * FROM oauth_login_states WHERE stateHash = ?")
      .get(hash(login.state));
    expect(row).toMatchObject({
      stateHash: hash(login.state),
      browserNonceHash: hash(login.browserNonce),
      redirectUri,
      returnTo: "/checkout/700",
      consumedAt: null,
    });
    expect(JSON.stringify(row)).not.toContain(login.state);
    expect(JSON.stringify(row)).not.toContain(login.browserNonce);
    expect(new Date(`${row!.expiresAt}Z`).getTime() - Date.now()).toBe(
      OAUTH_STATE_MAX_AGE_MS
    );
  });

  it("claims once and rejects a replay", async () => {
    const login = await beginOAuthLogin(redirectUri, "/my-bookings?x=1");
    expect(await consumeOAuthLogin({ ...login, redirectUri })).toEqual({
      redirectUri,
      returnTo: "/my-bookings?x=1",
    });
    expect(await consumeOAuthLogin({ ...login, redirectUri })).toBeNull();
  });

  it("uses a conditional atomic update when callbacks race (relational fixture, not native lock evidence)", async () => {
    const login = await beginOAuthLogin(redirectUri, "/");
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        consumeOAuthLogin({ ...login, redirectUri })
      )
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("rejects missing or malformed browser/state credentials before storage", async () => {
    expect(
      await consumeOAuthLogin({
        state: "x".repeat(43),
        browserNonce: undefined,
        redirectUri,
      })
    ).toBeNull();
    expect(
      await consumeOAuthLogin({
        state: "not-a-token",
        browserNonce: "x".repeat(43),
        redirectUri,
      })
    ).toBeNull();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects another browser without burning the legitimate browser's state", async () => {
    const first = await beginOAuthLogin(redirectUri, "/");
    const second = await beginOAuthLogin(redirectUri, "/");
    expect(
      await consumeOAuthLogin({
        ...first,
        browserNonce: second.browserNonce,
        redirectUri,
      })
    ).toBeNull();
    expect(await consumeOAuthLogin({ ...first, redirectUri })).not.toBeNull();
  });

  it("rejects a different canonical redirect before consumption", async () => {
    const login = await beginOAuthLogin(redirectUri, "/");
    expect(
      await consumeOAuthLogin({
        ...login,
        redirectUri: "https://other.test/api/oauth/callback",
      })
    ).toBeNull();
    expect(await consumeOAuthLogin({ ...login, redirectUri })).not.toBeNull();
  });

  it("rejects state at its expiry boundary", async () => {
    const login = await beginOAuthLogin(redirectUri, "/");
    vi.setSystemTime(new Date(Date.now() + OAUTH_STATE_MAX_AGE_MS));
    expect(await consumeOAuthLogin({ ...login, redirectUri })).toBeNull();
  });

  it.each([
    "//evil.test",
    "/%2fevil.test",
    "/api/oauth/callback",
    "/my-bookings?x=%250d",
  ])(
    "normalizes unsafe initiation targets and rejects tampered stored targets: %s",
    async target => {
      const login = await beginOAuthLogin(redirectUri, target);
      expect(await consumeOAuthLogin({ ...login, redirectUri })).toEqual({
        redirectUri,
        returnTo: "/",
      });
      const tampered = await beginOAuthLogin(redirectUri, "/");
      fixture.sqlite
        .prepare(
          "UPDATE oauth_login_states SET returnTo = ? WHERE stateHash = ?"
        )
        .run(target, hash(tampered.state));
      expect(await consumeOAuthLogin({ ...tampered, redirectUri })).toBeNull();
    }
  );

  it("fails start and consume closed if storage is unavailable", async () => {
    const login = await beginOAuthLogin(redirectUri, "/");
    mocks.getDb.mockReturnValue(null);
    await expect(beginOAuthLogin(redirectUri, "/")).rejects.toBeInstanceOf(
      OAuthStateUnavailableError
    );
    await expect(
      consumeOAuthLogin({ ...login, redirectUri })
    ).rejects.toBeInstanceOf(OAuthStateUnavailableError);
  });
});

describe("expired OAuth login-state purge on the start path", () => {
  const seed = (stateHash: string, expiresAt: string, consumedAt?: string) =>
    fixture.insert(oauthLoginStates, {
      stateHash,
      browserNonceHash: hash(`${stateHash}-nonce`),
      redirectUri,
      returnTo: "/",
      expiresAt,
      consumedAt: consumedAt ?? null,
    });
  const storedHashes = () =>
    (fixture.rows(oauthLoginStates) as Array<{ stateHash: string }>)
      .map(row => row.stateHash)
      .sort();

  it("deletes unconsumable states and keeps every consumable one", async () => {
    const pending = await beginOAuthLogin(redirectUri, "/checkout/700");
    seed("expired-long-ago", "2026-11-05 11:00:00");
    seed("expired-consumed", "2026-11-05 11:59:59", "2026-11-05 11:55:00");
    // consumeOAuthLogin rejects expiresAt <= now, so the boundary row is dead.
    seed("expires-at-now", "2026-11-05 12:00:00");
    seed("expires-in-a-second", "2026-11-05 12:00:01");

    const next = await beginOAuthLogin(redirectUri, "/");

    expect(storedHashes()).toEqual(
      [hash(pending.state), hash(next.state), "expires-in-a-second"].sort()
    );
    expect(await consumeOAuthLogin({ ...pending, redirectUri })).toEqual({
      redirectUri,
      returnTo: "/checkout/700",
    });
    expect(await consumeOAuthLogin({ ...next, redirectUri })).toEqual({
      redirectUri,
      returnTo: "/",
    });
  });

  it("bounds the rows one start deletes and drains a backlog over later starts", async () => {
    const backlog = OAUTH_STATE_PURGE_BATCH + 5;
    for (let index = 0; index < backlog; index++)
      seed(`expired-${String(index).padStart(4, "0")}`, "2026-11-05 11:00:00");
    const expiredCount = () =>
      storedHashes().filter(stateHash => stateHash.startsWith("expired-"))
        .length;

    await beginOAuthLogin(redirectUri, "/");
    expect(expiredCount()).toBe(5);
    const deletes = fixture.queries.filter(query =>
      /^delete from `oauth_login_states`/i.test(query.sql)
    );
    expect(deletes).toHaveLength(1);

    const login = await beginOAuthLogin(redirectUri, "/");
    expect(expiredCount()).toBe(0);
    expect(fixture.rows(oauthLoginStates)).toHaveLength(2);
    expect(await consumeOAuthLogin({ ...login, redirectUri })).not.toBeNull();
  });

  it.each([
    [
      "key SELECT",
      () =>
        mocks.getDb.mockReturnValue(
          new Proxy(fixture.db, {
            get: (target, key, receiver) =>
              key === "select"
                ? () => {
                    throw new Error("Connection lost during purge read");
                  }
                : Reflect.get(target, key, receiver),
          })
        ),
    ],
    [
      "DELETE",
      () =>
        fixture.sqlite.exec(
          `CREATE TRIGGER purge_lock BEFORE DELETE ON oauth_login_states
           BEGIN SELECT RAISE(ABORT, 'Lock wait timeout exceeded'); END`
        ),
    ],
  ])(
    "still issues a consumable login when the purge %s fails",
    async (_stage, breakPurge) => {
      seed("expired-long-ago", "2026-11-05 11:00:00");
      breakPurge();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const login = await beginOAuthLogin(redirectUri, "/checkout/700");
        expect(warn).toHaveBeenCalledWith(
          "[OAuth] Expired login-state purge failed"
        );
        // The purge really failed: the expired row stays beside the new one.
        expect(storedHashes()).toEqual(
          [hash(login.state), "expired-long-ago"].sort()
        );
        mocks.getDb.mockReturnValue(fixture.db);
        expect(await consumeOAuthLogin({ ...login, redirectUri })).toEqual({
          redirectUri,
          returnTo: "/checkout/700",
        });
      } finally {
        warn.mockRestore();
      }
    }
  );
});
