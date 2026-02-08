/**
 * Auth Service Client
 * HTTP client for communicating with the FastAPI auth microservice.
 * Handles user registration and password verification.
 */
import axios, { AxiosInstance } from "axios";
import { createServiceLogger } from "../_core/logger";

const log = createServiceLogger("auth-service-client");

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
   * Register a new user with email and password
   */
  async register(
    email: string,
    password: string,
    name?: string
  ): Promise<AuthServiceResponse> {
    try {
      const { data } = await this.client.post<AuthServiceResponse>(
        "/auth/register",
        { email, password, name }
      );
      return data;
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data as AuthServiceResponse;
      }
      log.error({ error: error.message }, "Auth service register failed");
      return { success: false, message: "Auth service unavailable" };
    }
  }

  /**
   * Verify user credentials (login)
   */
  async login(email: string, password: string): Promise<AuthServiceResponse> {
    try {
      const { data } = await this.client.post<AuthServiceResponse>(
        "/auth/login",
        { email, password }
      );
      return data;
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data as AuthServiceResponse;
      }
      log.error({ error: error.message }, "Auth service login failed");
      return { success: false, message: "Auth service unavailable" };
    }
  }

  /**
   * Verify password for a user
   */
  async verifyPassword(
    email: string,
    password: string
  ): Promise<AuthServiceResponse> {
    try {
      const { data } = await this.client.post<AuthServiceResponse>(
        "/auth/verify-password",
        { email, password }
      );
      return data;
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data as AuthServiceResponse;
      }
      log.error({ error: error.message }, "Auth service verify failed");
      return { success: false, message: "Auth service unavailable" };
    }
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
