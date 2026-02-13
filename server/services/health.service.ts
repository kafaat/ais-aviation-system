import { getDb } from "../db";

export interface HealthStatus {
  status: "healthy" | "unhealthy";
  timestamp: string;
  checks: {
    database: CheckResult;
    stripe: CheckResult;
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
export async function checkStripe(): Promise<CheckResult> {
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
 * Perform all health checks
 */
export async function performHealthChecks(): Promise<HealthStatus> {
  const [database, stripe] = await Promise.all([
    checkDatabase(),
    checkStripe(),
  ]);

  const allHealthy = database.status === "pass" && stripe.status === "pass";

  return {
    status: allHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    checks: {
      database,
      stripe,
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
