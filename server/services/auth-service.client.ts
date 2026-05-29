/**
 * Auth Service Client
 * HTTP client for communicating with the FastAPI auth microservice.
 * Handles user registration and password verification.
 */
import axios, { AxiosInstance } from "axios";
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

class AuthServiceClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: AUTH_SERVICE_URL,
      timeout: 5000,
      headers: { "Content-Type": "application/json" },
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
    request: () => Promise<{ data: AuthServiceResponse }>
  ): Promise<AuthServiceResponse> {
    try {
      return await withCircuitBreaker(CIRCUIT_NAME, async () => {
        try {
          const { data } = await request();
          return data;
        } catch (error: any) {
          if (error.response?.data) {
            return error.response.data as AuthServiceResponse;
          }
          throw error; // network/timeout -> let the breaker count it
        }
      });
    } catch (error: any) {
      log.error({ op, error: error?.message }, "Auth service call failed");
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
      this.client.post<AuthServiceResponse>("/auth/register", {
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
      this.client.post<AuthServiceResponse>("/auth/login", { email, password })
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
      this.client.post<AuthServiceResponse>("/auth/verify-password", {
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
