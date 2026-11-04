import { getDb } from "../db";
import { redisCacheService } from "./redis-cache.service";
import { logger } from "../_core/logger";
import {
  resolveStripeTransport,
  StripeConfigurationError,
} from "../_core/stripe-transport";

export interface HealthStatus {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
  checks: {
    database: CheckResult;
    stripe: CheckResult;
    cache: CheckResult;
  };
}

export interface CheckResult {
  status: "pass" | "fail";
  mode?: "configuration" | "mock";
  responseTime?: number;
  error?: string;
}

/**
 * Check database connectivity
 */
export async function checkDatabase(): Promise<CheckResult> {
  const startTime = Date.now();
  try {
    const db = await getDb();
    if (!db) {
      return {
        status: "fail",
        error: "Database connection not available",
      };
    }

    // Simple query to test connection
    await db.execute("SELECT 1");

    return {
      status: "pass",
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      status: "fail",
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}

/**
 * Check the selected Stripe transport. Open mode retains configuration-only
 * validation; isolated mode probes the same validated internal mock origin
 * used by the SDK. A mock pass is not acceptance of the real Stripe provider.
 */
export const STRIPE_MOCK_HEALTH_TIMEOUT_MS = 1500;
const STRIPE_MOCK_HEALTH_MAX_BYTES = 64 * 1024;

export async function checkStripe(): Promise<CheckResult> {
  const startTime = Date.now();
  const mode =
    process.env.AIS_PROVIDER_BOUNDARY?.trim() === "isolated"
      ? "mock"
      : "configuration";
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    const transport = resolveStripeTransport(key);
    if (transport.mode === "mock") {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        STRIPE_MOCK_HEALTH_TIMEOUT_MS
      );
      try {
        const response = await fetch(`${transport.origin}/v1/balance`, {
          method: "GET",
          headers: { Authorization: `Bearer ${key?.trim() ?? ""}` },
          redirect: "error",
          signal: controller.signal,
        });
        if (response.status !== 200 || !response.body)
          return {
            status: "fail",
            mode,
            error: "STRIPE_MOCK_INVALID_RESPONSE",
          };

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > STRIPE_MOCK_HEALTH_MAX_BYTES)
              return {
                status: "fail",
                mode,
                error: "STRIPE_MOCK_RESPONSE_TOO_LARGE",
              };
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        const balance: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8")
        );
        if (
          !balance ||
          typeof balance !== "object" ||
          !("object" in balance) ||
          balance.object !== "balance" ||
          !("livemode" in balance) ||
          balance.livemode !== false ||
          !("available" in balance) ||
          !Array.isArray(balance.available) ||
          !("pending" in balance) ||
          !Array.isArray(balance.pending)
        )
          return {
            status: "fail",
            mode,
            error: "STRIPE_MOCK_INVALID_RESPONSE",
          };
        return { status: "pass", mode, responseTime: Date.now() - startTime };
      } catch {
        return {
          status: "fail",
          mode,
          responseTime: Date.now() - startTime,
          error: controller.signal.aborted
            ? "STRIPE_MOCK_TIMEOUT"
            : "STRIPE_MOCK_UNAVAILABLE",
        };
      } finally {
        clearTimeout(timer);
        // Cancel any unread body on non-200, oversized or malformed responses.
        controller.abort();
      }
    }
    // Check if Stripe key is configured
    if (!key) {
      return {
        status: "fail",
        mode,
        error: "Stripe API key not configured",
      };
    }

    // We don't actually call Stripe API to avoid rate limits
    // Just verify the key format
    const keyFormat = /^sk_(test|live)_[a-zA-Z0-9]{24,}$/;
    if (!keyFormat.test(key)) {
      return {
        status: "fail",
        mode,
        error: "Invalid Stripe API key format",
      };
    }

    return {
      status: "pass",
      mode,
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      status: "fail",
      mode,
      responseTime: Date.now() - startTime,
      error:
        error instanceof StripeConfigurationError
          ? error.reason
          : "STRIPE_CONFIGURATION_INVALID",
    };
  }
}

/**
 * Check cache (Redis) connectivity
 * Note: Cache failures are not critical - the system can operate with memory fallback
 */
export async function checkCache(): Promise<CheckResult> {
  try {
    const health = await redisCacheService.healthCheck();

    if (health.status === "ok") {
      return {
        status: "pass",
        responseTime: health.redis.latency,
      };
    } else if (health.status === "degraded") {
      // Degraded means Redis is down but memory fallback is working
      return {
        status: "pass",
        error: "Redis unavailable, using memory fallback",
      };
    } else {
      return {
        status: "fail",
        error: health.redis.error || "Cache unavailable",
      };
    }
  } catch (error) {
    return {
      status: "fail",
      error: error instanceof Error ? error.message : "Unknown cache error",
    };
  }
}

/**
 * Perform all health checks
 */
export async function performHealthChecks(): Promise<HealthStatus> {
  const [database, stripe, cache] = await Promise.all([
    checkDatabase(),
    checkStripe(),
    checkCache(),
  ]);

  // Determine overall health status
  // - healthy: all critical services (database, stripe) are up
  // - degraded: critical services up but cache is down (can still function)
  // - unhealthy: any critical service is down
  const criticalHealthy =
    database.status === "pass" && stripe.status === "pass";
  const cacheHealthy = cache.status === "pass";

  let status: "healthy" | "unhealthy" | "degraded";
  if (criticalHealthy && cacheHealthy) {
    status = "healthy";
  } else if (criticalHealthy && !cacheHealthy) {
    status = "degraded";
  } else {
    status = "unhealthy";
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    checks: {
      database,
      stripe,
      cache,
    },
  };
}

/**
 * Check if system is ready to accept traffic (readiness probe)
 * Returns true only if all critical services are available
 */
let lastReadinessState: string | undefined;
export async function isReady(): Promise<boolean> {
  const health = await performHealthChecks();
  const dependencies = {
    database: health.checks.database.status,
    stripe: health.checks.stripe.status,
    cache: health.checks.cache.status,
  };
  const state = JSON.stringify(dependencies);
  if (health.status !== "healthy" && state !== lastReadinessState) {
    // Operator logs identify the failed dependency without credentials, raw
    // driver errors, or a public expansion of the readiness response.
    logger.warn({ dependencies }, "Readiness dependencies are not ready");
  }
  lastReadinessState = state;
  return health.status === "healthy";
}

/**
 * Check if system is alive (liveness probe)
 * Returns true if the process is running, even if some services are down
 */
export function isAlive(): boolean {
  return true; // If this function runs, the process is alive
}
