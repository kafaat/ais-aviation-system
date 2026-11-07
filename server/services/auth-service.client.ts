/**
 * Auth Service Client
 * HTTP client for communicating with the FastAPI auth microservice.
 * Handles user registration and password verification.
 */
import axios, { AxiosInstance } from "axios";
import { z } from "zod";
import { createServiceLogger } from "../_core/logger";
import { withCircuitBreaker } from "./production.service";

const log = createServiceLogger("auth-service-client");

const CIRCUIT_NAME = "auth-service";

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:8000";

/** Example-file values; mirrored in auth-service/config.py. */
const INSECURE_SERVICE_TOKENS = new Set([
  "change_me",
  "change-me",
  "changeme",
  "auth_service_token",
  "auth-service-token",
  "your-auth-service-token",
  "local-development-auth-service-token-not-for-production",
  "placeholder",
  "secret",
  "token",
]);
export const AUTH_SERVICE_TOKEN_MIN_LENGTH = 32;

/**
 * Why the configured service credential cannot be used, or null when it can.
 * Production requires an explicit random value of at least 32 characters;
 * development and test may start without one, but the client suppresses
 * password-bearing requests locally; no mode accepts a placeholder.
 */
export function authServiceCredentialProblem(
  value: string | undefined,
  production: boolean = process.env.NODE_ENV === "production"
): string | null {
  const token = value?.trim() ?? "";
  if (!token) {
    return production
      ? "AUTH_SERVICE_TOKEN is required in production: set the same random value (at least 32 characters) on every Node API replica and on the auth service"
      : null;
  }
  if (/\s/.test(token)) return "AUTH_SERVICE_TOKEN must not contain whitespace";
  if (token && !/^[\x21-\x7e]+$/.test(token))
    return "AUTH_SERVICE_TOKEN must use printable ASCII characters";
  if (INSECURE_SERVICE_TOKENS.has(token.toLowerCase()))
    return "AUTH_SERVICE_TOKEN must not be a placeholder value";
  if (
    token.length >= AUTH_SERVICE_TOKEN_MIN_LENGTH &&
    new Set(token).size === 1
  )
    return "AUTH_SERVICE_TOKEN must not use a repeated-character value";
  if (production && token.length < AUTH_SERVICE_TOKEN_MIN_LENGTH)
    return `AUTH_SERVICE_TOKEN must be at least ${AUTH_SERVICE_TOKEN_MIN_LENGTH} characters in production`;
  return null;
}

/**
 * Startup gate for the web process: a production deployment whose
 * AUTH_SERVICE_TOKEN is absent, blank, a placeholder or short must not serve
 * logins at all, because the auth service would answer every request 401 and
 * the failure would otherwise surface only as "invalid credentials".
 */
export function assertAuthServiceCredential(): void {
  const problem = authServiceCredentialProblem(process.env.AUTH_SERVICE_TOKEN);
  if (problem) throw new Error(`[security] ${problem}`);
}

interface AuthServiceUser {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  role: string;
}

interface AuthServiceResponse {
  success: boolean;
  user?: AuthServiceUser;
  message?: string;
}

const authResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    user: z.object({
      id: z.number().int().positive(),
      openId: z.string().min(1),
      name: z.string().nullable(),
      email: z.string().nullable(),
      role: z.string().min(1),
    }),
    message: z.string().nullish(),
  }),
  z.object({ success: z.literal(false), message: z.string().nullish() }),
]);

class AuthServiceClient {
  private client: AxiosInstance;
  /** Set when the configured credential is unusable; no request is sent. */
  private readonly credentialProblem: string | null;

  constructor() {
    const token = process.env.AUTH_SERVICE_TOKEN?.trim() ?? "";
    // Development may boot with an absent token for diagnostics, but it must
    // never transmit a registration/login password to an uncredentialed
    // service. FastAPI would reject the request, so refuse it locally first.
    this.credentialProblem = token
      ? authServiceCredentialProblem(token)
      : "AUTH_SERVICE_TOKEN is not configured; auth requests are disabled";
    this.client = axios.create({
      baseURL: AUTH_SERVICE_URL,
      timeout: 5000,
      headers: {
        "Content-Type": "application/json",
        // The auth service answers password questions for any email; only
        // this backend may ask, so the credential travels on every call.
        ...(token && !this.credentialProblem
          ? { "X-Auth-Service-Token": token }
          : {}),
      },
    });

    if (this.credentialProblem)
      log.error(
        { url: AUTH_SERVICE_URL },
        `Auth service client has no usable credential: ${this.credentialProblem}`
      );
    log.info(
      { url: AUTH_SERVICE_URL, credential: Boolean(token) },
      "Auth service client initialized"
    );
  }

  /**
   * Execute an auth-service HTTP call behind a circuit breaker.
   *
   * - A response from the service (incl. business errors like 4xx) means the
   *   service is reachable, so it is returned and does NOT trip the breaker.
   * - A network error / timeout (no response) is rethrown so the breaker counts
   *   it; once the breaker is OPEN, calls fast-fail instead of hanging on the
   *   5s timeout. Either way callers get a graceful `unavailable` response and
   *   this method never throws.
   */
  private async call(
    op: string,
    request: () => Promise<{ data: unknown }>
  ): Promise<AuthServiceResponse> {
    if (this.credentialProblem) {
      // Never send a password to the auth service under a credential the
      // service is going to refuse; fail closed with the generic message.
      log.error({ op }, this.credentialProblem);
      return { success: false, message: "Auth service unavailable" };
    }
    try {
      return await withCircuitBreaker(CIRCUIT_NAME, async () => {
        try {
          const { data } = await request();
          const response = authResponseSchema.safeParse(data);
          if (!response.success)
            return { success: false, message: "Invalid auth service response" };
          return {
            ...response.data,
            message: response.data.message ?? undefined,
          };
        } catch (error) {
          // The service answers failures with a structured body; anything
          // without one is a network/timeout error the breaker should count.
          if (axios.isAxiosError(error) && error.response) {
            // An HTTP error can never authenticate, even if its body contains
            // a stale or malformed success response.
            const response = authResponseSchema.safeParse(error.response.data);
            return {
              success: false,
              message:
                response.success && !response.data.success
                  ? (response.data.message ?? "Authentication failed")
                  : "Auth service unavailable",
            };
          }
          throw error;
        }
      });
    } catch (error) {
      log.error(
        { op, error: error instanceof Error ? error.message : error },
        "Auth service call failed"
      );
      return { success: false, message: "Auth service unavailable" };
    }
  }

  /**
   * Register a new user with email and password
   */
  register(
    email: string,
    password: string,
    name?: string
  ): Promise<AuthServiceResponse> {
    return this.call("register", () =>
      this.client.post<unknown>("/auth/register", {
        email,
        password,
        name,
      })
    );
  }

  /**
   * Verify user credentials (login)
   */
  login(email: string, password: string): Promise<AuthServiceResponse> {
    return this.call("login", () =>
      this.client.post<unknown>("/auth/login", { email, password })
    );
  }

  /**
   * Verify password for a user
   */
  verifyPassword(
    email: string,
    password: string
  ): Promise<AuthServiceResponse> {
    return this.call("verifyPassword", () =>
      this.client.post<unknown>("/auth/verify-password", {
        email,
        password,
      })
    );
  }

  /**
   * Check if the auth service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const { data } = await this.client.get("/auth/health");
      return data?.status === "healthy";
    } catch {
      return false;
    }
  }
}

export const authServiceClient = new AuthServiceClient();
