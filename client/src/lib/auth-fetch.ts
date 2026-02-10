/**
 * Authenticated Fetch Utility
 *
 * Provides fetch wrapper that:
 * - Automatically adds Bearer token to requests
 * - Handles token refresh on 401 errors
 * - Supports both cookie and Bearer token auth
 *
 * @version 1.0.0
 */

import { AUTH_STORAGE_KEYS, TOKEN_TIMING } from "@shared/auth.types";

// ============================================================================
// Types
// ============================================================================

interface RefreshResponse {
  result: {
    data: {
      json: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        tokenType: string;
      };
    };
  };
}

// ============================================================================
// Token Management
// ============================================================================

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

/**
 * Get stored access token
 */
export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
  } catch {
    return null;
  }
}

/**
 * Get stored refresh token
 */
export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
  } catch {
    return null;
  }
}

/**
 * Check if access token is expired or expiring soon
 */
export function isTokenExpired(): boolean {
  try {
    const expiresAt = localStorage.getItem(AUTH_STORAGE_KEYS.TOKEN_EXPIRES_AT);
    if (!expiresAt) return true;

    const expiresAtMs = parseInt(expiresAt, 10);
    return Date.now() >= expiresAtMs - TOKEN_TIMING.REFRESH_BUFFER_MS;
  } catch {
    return true;
  }
}

/**
 * Store new tokens
 */
function storeTokens(
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): void {
  try {
    const expiresAt = Date.now() + expiresIn * 1000;
    localStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    localStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
    localStorage.setItem(
      AUTH_STORAGE_KEYS.TOKEN_EXPIRES_AT,
      expiresAt.toString()
    );
  } catch (error) {
    console.error("[Auth] Failed to store tokens:", error);
  }
}

/**
 * Clear all stored tokens
 */
export function clearTokens(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(AUTH_STORAGE_KEYS.TOKEN_EXPIRES_AT);
    localStorage.removeItem(AUTH_STORAGE_KEYS.USER);
  } catch (error) {
    console.error("[Auth] Failed to clear tokens:", error);
  }
}

/**
 * Refresh the access token using the refresh token
 * Implements request deduplication to avoid multiple simultaneous refresh calls
 */
export function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    return Promise.resolve(null);
  }

  // If already refreshing, wait for that request
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;

  refreshPromise = (async () => {
    try {
      const response = await fetch("/api/trpc/auth.refreshToken", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          json: {
            refreshToken,
            deviceInfo: {
              userAgent: navigator.userAgent,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Token refresh failed");
      }

      const data: RefreshResponse = await response.json();
      const tokens = data.result.data.json;

      // Store new tokens
      storeTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);

      console.info("[Auth] Token refreshed successfully");
      return tokens.accessToken;
    } catch (error) {
      console.error("[Auth] Token refresh failed:", error);
      // Clear tokens on refresh failure
      clearTokens();
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Get a valid access token, refreshing if necessary
 */
export function getValidAccessToken(): Promise<string | null> {
  const accessToken = getAccessToken();

  if (!accessToken) {
    return Promise.resolve(null);
  }

  if (isTokenExpired()) {
    return refreshAccessToken();
  }

  return Promise.resolve(accessToken);
}

// ============================================================================
// Authenticated Fetch
// ============================================================================

export interface AuthFetchOptions extends RequestInit {
  /**
   * Skip adding auth header (for public endpoints)
   */
  skipAuth?: boolean;

  /**
   * Retry on 401 after refreshing token
   */
  retryOn401?: boolean;
}

/**
 * Fetch wrapper that automatically handles authentication
 *
 * Features:
 * - Adds Bearer token if available
 * - Falls back to cookie auth (credentials: include)
 * - Refreshes token on 401 and retries request
 *
 * @example
 * const response = await authFetch('/api/protected-endpoint', {
 *   method: 'POST',
 *   body: JSON.stringify({ data: 'value' }),
 * });
 */
export async function authFetch(
  url: string,
  options: AuthFetchOptions = {}
): Promise<Response> {
  const { skipAuth = false, retryOn401 = true, ...fetchOptions } = options;

  // Build headers
  const headers = new Headers(fetchOptions.headers);

  // Add auth header if we have a token and auth is not skipped
  if (!skipAuth) {
    const accessToken = getAccessToken();
    if (accessToken && !isTokenExpired()) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  // Make request with credentials included (for cookie fallback)
  const response = await fetch(url, {
    ...fetchOptions,
    headers,
    credentials: "include",
  });

  // Handle 401 Unauthorized
  if (response.status === 401 && retryOn401 && !skipAuth) {
    // Try to refresh token
    const newAccessToken = await refreshAccessToken();

    if (newAccessToken) {
      // Retry request with new token
      headers.set("Authorization", `Bearer ${newAccessToken}`);

      return fetch(url, {
        ...fetchOptions,
        headers,
        credentials: "include",
      });
    }

    // Refresh failed, dispatch auth error event
    window.dispatchEvent(new CustomEvent("auth:unauthorized"));
  }

  return response;
}

// ============================================================================
// tRPC Link Helper
// ============================================================================

/**
 * Custom fetch function for tRPC that handles authentication
 * Use this in the httpBatchLink configuration
 */
export function createAuthenticatedFetch() {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);

    // Add Bearer token if available
    const accessToken = getAccessToken();
    if (accessToken && !isTokenExpired()) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    // Make request
    const response = await globalThis.fetch(input, {
      ...init,
      headers,
      credentials: "include",
    });

    // Handle 401 - try token refresh
    if (response.status === 401) {
      const newAccessToken = await refreshAccessToken();

      if (newAccessToken) {
        // Retry with new token
        headers.set("Authorization", `Bearer ${newAccessToken}`);
        return globalThis.fetch(input, {
          ...init,
          headers,
          credentials: "include",
        });
      }

      // Dispatch event for UI to handle
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }

    return response;
  };
}

// ============================================================================
// Event Listeners
// ============================================================================

/**
 * Listen for authentication errors
 * Useful for redirecting to login page
 *
 * @example
 * onAuthError(() => {
 *   window.location.href = '/login';
 * });
 */
export function onAuthError(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener("auth:unauthorized", handler);
  return () => window.removeEventListener("auth:unauthorized", handler);
}
