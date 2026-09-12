import { AXIOS_TIMEOUT_MS, COOKIE_NAME } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import axios, { type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import {
  mobileAuthServiceV2,
  SESSION_MAX_AGE_MS,
} from "../services/mobile-auth-v2.service";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";
// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  sid: string;
  openId: string;
  appId: string;
  name: string;
};

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

/** Field the OAuth service may return that the generated response type omits. */
type PlatformHints = { platforms?: unknown };

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    console.info("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }

  private decodeState(state: string): string {
    // Both atob (base64 decode) and URL parsing can throw on malformed input,
    // so wrap everything in a single try-catch for a clean error message.
    let redirectUri: string;
    try {
      redirectUri = atob(state);
      const url = new URL(redirectUri);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.pathname.endsWith("/api/oauth/callback")
      ) {
        throw new Error("Invalid redirect URI in OAuth state");
      }
    } catch {
      throw new Error("Invalid redirect URI in OAuth state");
    }

    return redirectUri;
  }

  async getTokenByCode(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };

    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload
    );

    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      }
    );

    return data;
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(client: AxiosInstance = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(
    platforms: unknown,
    fallback: string | null | undefined
  ): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(
      platforms.filter((p): p is string => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (
      set.has("REGISTERED_PLATFORM_MICROSOFT") ||
      set.has("REGISTERED_PLATFORM_AZURE")
    )
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod(
      (data as PlatformHints).platforms,
      data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string; sessionId?: string } = {}
  ): Promise<string> {
    let sid = options.sessionId;
    if (!sid) {
      const user = await db.getUserByOpenId(openId);
      if (!user) throw ForbiddenError("User not found");
      // This path rejects enrolled accounts until a factor-bound login completes.
      sid = (await mobileAuthServiceV2.login(user.id)).sessionId;
    }
    const user = await mobileAuthServiceV2.authenticateSession(sid);
    if (user.openId !== openId)
      throw ForbiddenError("Session identity mismatch");
    return this.signSession(
      { sid, openId, appId: ENV.appId, name: options.name || "" },
      options
    );
  }

  signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const expiresInMs = Math.min(
      options.expiresInMs ?? SESSION_MAX_AGE_MS,
      SESSION_MAX_AGE_MS
    );
    return new SignJWT({ ...payload, purpose: "web-session" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("ais-aviation")
      .setAudience(ENV.appId)
      .setIssuedAt()
      .setExpirationTime(Math.floor((Date.now() + expiresInMs) / 1000))
      .sign(this.getSessionSecret());
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<SessionPayload | null> {
    if (!cookieValue) return null;
    try {
      const { payload } = await jwtVerify(
        cookieValue,
        this.getSessionSecret(),
        {
          algorithms: ["HS256"],
          issuer: "ais-aviation",
          audience: ENV.appId,
        }
      );
      const { sid, openId, appId, name, purpose } = payload;
      if (
        !isNonEmptyString(openId) ||
        appId !== ENV.appId ||
        typeof name !== "string" ||
        typeof sid !== "string" ||
        !/^[a-f0-9]{64}$/.test(sid) ||
        purpose !== "web-session"
      )
        return null;
      return { sid, openId, appId, name };
    } catch {
      return null;
    }
  }

  async revokeRequestSession(req: Request): Promise<void> {
    const value = this.parseCookies(req.headers.cookie).get(COOKIE_NAME);
    const session = await this.verifySession(value);
    if (session) await mobileAuthServiceV2.revokeFamily(session.sid);
  }

  async getUserInfoWithJwt(
    jwtToken: string
  ): Promise<GetUserInfoWithJwtResponse> {
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };

    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );

    const loginMethod = this.deriveLoginMethod(
      (data as PlatformHints).platforms,
      data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  async authenticateRequest(req: Request): Promise<User> {
    // Regular authentication flow
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const user = await mobileAuthServiceV2.authenticateSession(session.sid);
    if (user.openId !== session.openId)
      throw ForbiddenError("Session identity mismatch");
    return user;
  }
}

export const sdk = new SDKServer();
