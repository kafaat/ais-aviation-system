/**
 * Auth Context - JWT Token Management for React
 *
 * Provides:
 * - Token storage (localStorage)
 * - Automatic token refresh before expiry
 * - Login/logout functionality
 * - Auth state management
 *
 * @version 1.0.0
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import {
  AUTH_STORAGE_KEYS,
  TOKEN_TIMING,
  type LoginResponse,
  type RefreshTokenResponse,
} from "@shared/auth.types";

// ============================================================================
// Types
// ============================================================================

export interface AuthUser {
  id: number;
  name: string | null;
  email: string | null;
  role: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  accessToken: string | null;
  error: string | null;
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAllDevices: () => Promise<void>;
  refreshToken: () => Promise<string | null>;
  getAccessToken: () => string | null;
  clearError: () => void;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================================
// Storage Helpers
// ============================================================================

function getStoredTokens() {
  try {
    const accessToken = localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
    const refreshToken = localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
    const expiresAt = localStorage.getItem(AUTH_STORAGE_KEYS.TOKEN_EXPIRES_AT);
    const userJson = localStorage.getItem(AUTH_STORAGE_KEYS.USER);
    const user = userJson ? JSON.parse(userJson) : null;

    return {
      accessToken,
      refreshToken,
      expiresAt: expiresAt ? parseInt(expiresAt, 10) : null,
      user,
    };
  } catch {
    return { accessToken: null, refreshToken: null, expiresAt: null, user: null };
  }
}

function storeTokens(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  user: AuthUser
) {
  try {
    const expiresAt = Date.now() + expiresIn * 1000;
    localStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    localStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
    localStorage.setItem(AUTH_STORAGE_KEYS.TOKEN_EXPIRES_AT, expiresAt.toString());
    localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(user));
  } catch (error) {
    console.error("[Auth] Failed to store tokens:", error);
  }
}

function clearStoredTokens() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(AUTH_STORAGE_KEYS.TOKEN_EXPIRES_AT);
    localStorage.removeItem(AUTH_STORAGE_KEYS.USER);
  } catch (error) {
    console.error("[Auth] Failed to clear tokens:", error);
  }
}

function isTokenExpiringSoon(expiresAt: number | null): boolean {
  if (!expiresAt) return true;
  return Date.now() >= expiresAt - TOKEN_TIMING.REFRESH_BUFFER_MS;
}

// ============================================================================
// API Calls
// ============================================================================

const API_BASE = "/api/trpc";

async function apiLogin(
  email: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/auth.login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: {
        email,
        password,
        deviceInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
        },
      },
    }),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error?.message || "Login failed");
  }

  return data.result.data.json;
}

async function apiRefreshToken(
  refreshTokenValue: string
): Promise<RefreshTokenResponse> {
  const response = await fetch(`${API_BASE}/auth.refreshToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: {
        refreshToken: refreshTokenValue,
        deviceInfo: {
          userAgent: navigator.userAgent,
        },
      },
    }),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error?.message || "Token refresh failed");
  }

  return data.result.data.json;
}

async function apiLogout(refreshTokenValue: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth.logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: { refreshToken: refreshTokenValue },
      }),
    });
  } catch {
    // Ignore logout errors
  }
}

// ============================================================================
// Provider
// ============================================================================

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    accessToken: null,
    error: null,
  });

  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isRefreshingRef = useRef(false);

  // Initialize auth state from storage
  useEffect(() => {
    const stored = getStoredTokens();

    if (stored.accessToken && stored.refreshToken && stored.user) {
      // Check if token is expired or expiring soon
      if (isTokenExpiringSoon(stored.expiresAt)) {
        // Token is expired, try to refresh
        refreshTokenInternal(stored.refreshToken).catch(() => {
          // Refresh failed, clear tokens
          clearStoredTokens();
          setState({
            isAuthenticated: false,
            isLoading: false,
            user: null,
            accessToken: null,
            error: null,
          });
        });
      } else {
        // Token is valid
        setState({
          isAuthenticated: true,
          isLoading: false,
          user: stored.user,
          accessToken: stored.accessToken,
          error: null,
        });

        // Schedule refresh
        scheduleTokenRefresh(stored.expiresAt!);
      }
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }

    // Cleanup
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  // Schedule automatic token refresh
  const scheduleTokenRefresh = useCallback((expiresAt: number) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    const timeUntilRefresh = expiresAt - Date.now() - TOKEN_TIMING.REFRESH_BUFFER_MS;

    if (timeUntilRefresh > 0) {
      refreshTimerRef.current = setTimeout(() => {
        const stored = getStoredTokens();
        if (stored.refreshToken) {
          refreshTokenInternal(stored.refreshToken).catch(console.error);
        }
      }, timeUntilRefresh);
    }
  }, []);

  // Internal refresh token function
  const refreshTokenInternal = useCallback(
    async (refreshTokenValue: string): Promise<string | null> => {
      if (isRefreshingRef.current) {
        // Already refreshing, wait and return current token
        return state.accessToken;
      }

      isRefreshingRef.current = true;

      try {
        const response = await apiRefreshToken(refreshTokenValue);
        const stored = getStoredTokens();

        // Store new tokens
        storeTokens(
          response.accessToken,
          response.refreshToken,
          response.expiresIn,
          stored.user!
        );

        // Update state
        setState(prev => ({
          ...prev,
          accessToken: response.accessToken,
          error: null,
        }));

        // Schedule next refresh
        const expiresAt = Date.now() + response.expiresIn * 1000;
        scheduleTokenRefresh(expiresAt);

        return response.accessToken;
      } catch (error) {
        console.error("[Auth] Token refresh failed:", error);
        // Clear auth state on refresh failure
        clearStoredTokens();
        setState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          accessToken: null,
          error: "Session expired. Please login again.",
        });
        return null;
      } finally {
        isRefreshingRef.current = false;
      }
    },
    [state.accessToken, scheduleTokenRefresh]
  );

  // Login function
  const login = useCallback(
    async (email: string, password: string) => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        const response = await apiLogin(email, password);

        // Store tokens
        storeTokens(
          response.accessToken,
          response.refreshToken,
          response.expiresIn,
          response.user
        );

        // Update state
        setState({
          isAuthenticated: true,
          isLoading: false,
          user: response.user,
          accessToken: response.accessToken,
          error: null,
        });

        // Schedule token refresh
        const expiresAt = Date.now() + response.expiresIn * 1000;
        scheduleTokenRefresh(expiresAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Login failed";
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: message,
        }));
        throw error;
      }
    },
    [scheduleTokenRefresh]
  );

  // Logout function
  const logout = useCallback(async () => {
    const stored = getStoredTokens();

    // Clear timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    // Call logout API if we have a refresh token
    if (stored.refreshToken) {
      await apiLogout(stored.refreshToken);
    }

    // Clear storage
    clearStoredTokens();

    // Update state
    setState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      accessToken: null,
      error: null,
    });
  }, []);

  // Logout from all devices
  const logoutAllDevices = useCallback(async () => {
    const stored = getStoredTokens();

    if (!stored.accessToken) {
      throw new Error("Not authenticated");
    }

    try {
      const response = await fetch(`${API_BASE}/auth.logoutAllDevices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${stored.accessToken}`,
        },
        body: JSON.stringify({ json: {} }),
      });

      if (!response.ok) {
        throw new Error("Failed to logout from all devices");
      }

      // Clear local session
      await logout();
    } catch (error) {
      console.error("[Auth] Logout all devices failed:", error);
      throw error;
    }
  }, [logout]);

  // Get current access token (with refresh if needed)
  const refreshToken = useCallback(async (): Promise<string | null> => {
    const stored = getStoredTokens();

    if (!stored.refreshToken) {
      return null;
    }

    if (isTokenExpiringSoon(stored.expiresAt)) {
      return refreshTokenInternal(stored.refreshToken);
    }

    return stored.accessToken;
  }, [refreshTokenInternal]);

  // Get access token synchronously (returns current token without refresh)
  const getAccessToken = useCallback((): string | null => {
    return getStoredTokens().accessToken;
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    logoutAllDevices,
    refreshToken,
    getAccessToken,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}

// ============================================================================
// Token Getter for tRPC/Fetch
// ============================================================================

/**
 * Get the current access token for API requests.
 * This can be used outside of React components.
 */
export function getAuthToken(): string | null {
  return getStoredTokens().accessToken;
}

/**
 * Check if user is authenticated (has valid tokens stored)
 */
export function isAuthenticated(): boolean {
  const stored = getStoredTokens();
  return !!(stored.accessToken && stored.refreshToken && !isTokenExpiringSoon(stored.expiresAt));
}
