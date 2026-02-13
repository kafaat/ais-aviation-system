import { publicProcedure, router } from "../_core/trpc";
import { performHealthChecks, isReady, isAlive } from "../services/health.service";

/**
 * Health check router
 * Provides endpoints for monitoring system health
 */
export const healthRouter = router({
  /**
   * Comprehensive health check
   * Returns detailed status of all system components
   */
  check: publicProcedure.query(async () => {
    return await performHealthChecks();
  }),

  /**
   * Readiness probe
   * Returns true if system is ready to accept traffic
   * Used by Kubernetes/load balancers to determine if pod should receive traffic
   */
  ready: publicProcedure.query(async () => {
    const ready = await isReady();
    return { ready };
  }),

  /**
   * Liveness probe
   * Returns true if system process is running
   * Used by Kubernetes to determine if pod should be restarted
   */
  live: publicProcedure.query(() => {
    const alive = isAlive();
    return { alive };
  }),
});
