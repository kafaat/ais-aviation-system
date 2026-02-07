/**
 * Production Enhancements Service
 *
 * - Circuit Breaker for external service calls
 * - Request timeout management
 * - Graceful shutdown handler
 * - Health metrics collection
 */

import { type Server } from "http";

// ============================================================================
// Circuit Breaker
// ============================================================================

export enum CircuitState {
  CLOSED = "CLOSED", // Normal operation
  OPEN = "OPEN", // Failures exceeded threshold, requests rejected
  HALF_OPEN = "HALF_OPEN", // Testing if service recovered
}

interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // ms before trying again (half-open)
  monitorWindow: number; // ms window to count failures
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  openedAt: number;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

const DEFAULT_CB_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  monitorWindow: 60000, // 1 minute
};

/**
 * Execute a function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  serviceName: string,
  fn: () => Promise<T>,
  options: Partial<CircuitBreakerOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_CB_OPTIONS, ...options };
  let state = circuitBreakers.get(serviceName);

  if (!state) {
    state = {
      state: CircuitState.CLOSED,
      failures: 0,
      lastFailureAt: 0,
      lastSuccessAt: 0,
      openedAt: 0,
    };
    circuitBreakers.set(serviceName, state);
  }

  const now = Date.now();

  // Check if circuit should transition from OPEN to HALF_OPEN
  if (
    state.state === CircuitState.OPEN &&
    now - state.openedAt > opts.resetTimeout
  ) {
    state.state = CircuitState.HALF_OPEN;
  }

  // Reject if circuit is open
  if (state.state === CircuitState.OPEN) {
    throw new Error(
      `Circuit breaker OPEN for ${serviceName}. Service unavailable.`
    );
  }

  try {
    const result = await fn();

    // Success - reset circuit
    state.failures = 0;
    state.lastSuccessAt = now;
    if (state.state === CircuitState.HALF_OPEN) {
      state.state = CircuitState.CLOSED;
    }

    return result;
  } catch (error) {
    // Reset failure count if last failure was outside monitor window
    if (
      state.lastFailureAt > 0 &&
      now - state.lastFailureAt > opts.monitorWindow
    ) {
      state.failures = 0;
    }

    state.failures++;
    state.lastFailureAt = now;

    // Open circuit if threshold exceeded
    if (state.failures >= opts.failureThreshold) {
      state.state = CircuitState.OPEN;
      state.openedAt = now;
      console.error(
        `[CircuitBreaker] Circuit OPENED for ${serviceName} after ${state.failures} failures`
      );
    }

    throw error;
  }
}

/**
 * Get circuit breaker status for monitoring
 */
export function getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
  const status: Record<string, CircuitBreakerState> = {};
  circuitBreakers.forEach((state, name) => {
    status[name] = { ...state };
  });
  return status;
}

// ============================================================================
// Request Timeout
// ============================================================================

/**
 * Execute a function with a timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 30000,
  label: string = "operation"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

let isShuttingDown = false;

/**
 * Check if the server is shutting down
 */
export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown(
  server: Server,
  cleanup?: () => Promise<void>
): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.info(
      `[Shutdown] Received ${signal}. Starting graceful shutdown...`
    );

    // Stop accepting new connections
    server.close(async () => {
      console.info("[Shutdown] Server closed. Running cleanup...");

      try {
        if (cleanup) {
          await cleanup();
        }
        console.info("[Shutdown] Cleanup complete. Exiting.");
        process.exit(0);
      } catch (error) {
        console.error("[Shutdown] Cleanup failed:", error);
        process.exit(1);
      }
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      console.error("[Shutdown] Forced exit after timeout");
      process.exit(1);
    }, 30000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// ============================================================================
// Health Metrics
// ============================================================================

interface HealthMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  circuitBreakers: Record<string, CircuitBreakerState>;
  timestamp: string;
}

/**
 * Get health metrics for monitoring/Prometheus
 */
export function getHealthMetrics(): HealthMetrics {
  return {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    circuitBreakers: getCircuitBreakerStatus(),
    timestamp: new Date().toISOString(),
  };
}
