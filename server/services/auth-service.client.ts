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

  constructor() {
    this.client = axios.create({
      baseURL: AUTH_SERVICE_URL,
      timeout: 5000,
      headers: {
        "Content-Type": "application/json",
        // The auth service answers password questions for any email; only
        // this backend may ask. Optional until every deployment sets it.
        ...(process.env.AUTH_SERVICE_TOKEN
          ? { "X-Auth-Service-Token": process.env.AUTH_SERVICE_TOKEN }
          : {}),
      },
    });

    log.info({ url: AUTH_SERVICE_URL }, "Auth service client initialized");
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
