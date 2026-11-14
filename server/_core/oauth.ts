import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { getMfaSettings, createMfaChallenge } from "../services/mfa.service";
import { SESSION_MAX_AGE_MS } from "../services/mobile-auth-v2.service";
import {
  beginOAuthLogin,
  consumeOAuthLogin,
  OAuthStateUnavailableError,
  OAUTH_STATE_MAX_AGE_MS,
} from "../services/oauth-login-state.service";
import {
  rateLimitService,
  type RateLimitTier,
} from "../services/rate-limit.service";
import { getOAuthConfiguration } from "./oauth-config";
import { ENV } from "./env";

/**
 * Each anonymous start stores a row, so it is quota-bound per client IP. The
 * window matches the state lifetime and is fixed, not sliding: it reopens when
 * its first row expires, so one IP holds fewer than twice this many live rows
 * (one window's late rows plus a full next window).
 */
export const OAUTH_START_RATE_LIMIT: RateLimitTier = {
  name: "oauthStart",
  requestsPerWindow: 20,
  windowMs: OAUTH_STATE_MAX_AGE_MS,
};

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/start", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      // Express applies only explicitly trusted proxy hops to req.ip.
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const limit = await rateLimitService.checkRateLimit(
        `ip:${ip}`,
        OAUTH_START_RATE_LIMIT,
        `strict:${OAUTH_START_RATE_LIMIT.name}`
      );
      for (const [key, value] of Object.entries(
        rateLimitService.getRateLimitHeaders(limit)
      ))
        res.setHeader(key, value);
      if (!limit.allowed) {
        res.status(429).json({ error: "Too many login attempts" });
        return;
      }
      const configuration = getOAuthConfiguration();
      const { state, browserNonce } = await beginOAuthLogin(
        configuration.redirectUri,
        getQueryParam(req, "returnTo")
      );
      const loginUrl = new URL(configuration.portalLoginUrl);
      loginUrl.searchParams.set("appId", ENV.appId);
      loginUrl.searchParams.set("redirectUri", configuration.redirectUri);
      loginUrl.searchParams.set("state", state);
      loginUrl.searchParams.set("type", "signIn");
      res.cookie(configuration.nonceCookieName, browserNonce, {
        ...configuration.nonceCookieOptions,
        maxAge: OAUTH_STATE_MAX_AGE_MS,
      });
      res.redirect(302, loginUrl.toString());
    } catch {
      // Configuration and storage failures cannot produce an unbound login.
      console.error("[OAuth] Login initiation unavailable");
      res.status(503).json({ error: "OAuth login unavailable" });
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    let configuration: ReturnType<typeof getOAuthConfiguration>;
    try {
      configuration = getOAuthConfiguration();
    } catch {
      res.status(503).json({ error: "OAuth login unavailable" });
      return;
    }

    try {
      const browserNonce = parseCookieHeader(req.headers.cookie ?? "")[
        configuration.nonceCookieName
      ];
      const login = await consumeOAuthLogin({
        state,
        browserNonce,
        redirectUri: configuration.redirectUri,
      });
      if (!login) {
        res.status(400).json({ error: "Invalid or expired OAuth login state" });
        return;
      }
      res.clearCookie(
        configuration.nonceCookieName,
        configuration.nonceCookieOptions
      );
      const { returnTo } = login;
      const tokenResponse = await sdk.exchangeCodeForToken(
        code,
        login.redirectUri
      );
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const user = await db.getUserByOpenId(userInfo.openId);
      if (!user) throw new Error("OAuth user synchronization failed");
      if ((await getMfaSettings(user.id))?.isEnabled) {
        const challenge = await createMfaChallenge(user.id);
        const query = new URLSearchParams({ mfaChallenge: challenge });
        if (returnTo !== "/") query.set("returnTo", returnTo);
        res.redirect(302, `/login?${query}`);
        return;
      }

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: SESSION_MAX_AGE_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: SESSION_MAX_AGE_MS,
      });

      res.redirect(302, returnTo);
    } catch (error) {
      // Axios errors can contain authorization codes/tokens in request data.
      // Do not log the provider error or request query/cookies.
      console.error("[OAuth] Callback failed");
      res.status(error instanceof OAuthStateUnavailableError ? 503 : 500).json({
        error: "OAuth callback failed",
      });
    }
  });
}
