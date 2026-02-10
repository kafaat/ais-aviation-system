import { getDb } from "../db";
import { redisCacheService } from "./redis-cache.service";

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
 * Check Stripe API connectivity
 */
export function checkStripe(): CheckResult {
  const startTime = Date.now();
  try {
    // Check if Stripe key is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      return {
        status: "fail",
        error: "Stripe API key not configured",
      };
    }

    // We don't actually call Stripe API to avoid rate limits
    // Just verify the key format
    const keyFormat = /^sk_(test|live)_[a-zA-Z0-9]{24,}$/;
    if (!keyFormat.test(process.env.STRIPE_SECRET_KEY)) {
      return {
        status: "fail",
        error: "Invalid Stripe API key format",
      };
    }

    return {
      status: "pass",
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      status: "fail",
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown Stripe error",
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
export async function isReady(): Promise<boolean> {
  const health = await performHealthChecks();
  return health.status === "healthy";
}

/**
 * Check if system is alive (liveness probe)
 * Returns true if the process is running, even if some services are down
 */
export function isAlive(): boolean {
  return true; // If this function runs, the process is alive
}
