import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  performHealthChecks,
  isReady,
  isAlive,
} from "../services/health.service";

/**
 * Health check router
 * Provides endpoints for monitoring system health
 */
export const healthRouter = router({
  /**
   * Comprehensive health check
   * Returns detailed status of all system components
   */
  check: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/health",
        tags: ["Health"],
        summary: "Comprehensive health check",
        description:
          "Returns detailed status of all system components including database, cache, external services, and system resources. Use this for detailed diagnostics.",
      },
    })
    .query(async () => {
      return await performHealthChecks();
    }),

  /**
   * Readiness probe
   * Returns true if system is ready to accept traffic
   * Used by Kubernetes/load balancers to determine if pod should receive traffic
   */
  ready: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/health/ready",
        tags: ["Health"],
        summary: "Readiness probe",
        description:
          "Kubernetes readiness probe endpoint. Returns true if the system is ready to accept traffic. Used by load balancers to determine if the pod should receive requests.",
      },
    })
    .output(z.object({ ready: z.boolean() }))
    .query(async () => {
      const ready = await isReady();
      return { ready };
    }),

  /**
   * Liveness probe
   * Returns true if system process is running
   * Used by Kubernetes to determine if pod should be restarted
   */
  live: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/health/live",
        tags: ["Health"],
        summary: "Liveness probe",
        description:
          "Kubernetes liveness probe endpoint. Returns true if the system process is running. Used by Kubernetes to determine if the pod should be restarted.",
      },
    })
    .output(z.object({ alive: z.boolean() }))
    .query(() => {
      const alive = isAlive();
      return { alive };
    }),
});
