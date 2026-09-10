// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";
export const responseContracts = {
  prometheus: z.string(),
  json: z.record(z.string(), structuredValue),
  summary: z.object({
    timestamp: z.string(),
    uptime: z.object({ seconds: outputNumber, formatted: z.string() }),
    http: z.object({
      totalRequests: outputNumber,
      errorRequests: outputNumber,
      errorRate: outputNumber,
      avgResponseTimeMs: outputNumber,
    }),
    database: z.object({
      totalQueries: outputNumber,
      errors: outputNumber,
      errorRate: outputNumber,
    }),
    memory: z.object({
      heapUsedMb: outputNumber,
      heapTotalMb: outputNumber,
      rssMb: outputNumber,
      heapUsagePercent: outputNumber,
    }),
    activeConnections: outputNumber,
  }),
  reset: z.object({ success: z.boolean(), message: z.string() }),
  category: z.union([
    z.object({
      category: z.string(),
      metrics: z.object({
        requestDuration: z.record(
          z.string(),
          z.object({
            sum: outputNumber,
            count: outputNumber,
            avg: outputNumber,
          })
        ),
        requestsTotal: z.record(z.string(), outputNumber),
        queryDuration: z.undefined().optional(),
        queriesTotal: z.undefined().optional(),
        memory: z.undefined().optional(),
        cpu: z.undefined().optional(),
        uptime: z.undefined().optional(),
        eventLoopLag: z.undefined().optional(),
        note: z.undefined().optional(),
      }),
    }),
    z.object({
      category: z.string(),
      metrics: z.object({
        queryDuration: z.record(
          z.string(),
          z.object({
            sum: outputNumber,
            count: outputNumber,
            avg: outputNumber,
          })
        ),
        queriesTotal: z.record(z.string(), outputNumber),
        requestDuration: z.undefined().optional(),
        requestsTotal: z.undefined().optional(),
        memory: z.undefined().optional(),
        cpu: z.undefined().optional(),
        uptime: z.undefined().optional(),
        eventLoopLag: z.undefined().optional(),
        note: z.undefined().optional(),
      }),
    }),
    z.object({
      category: z.string(),
      metrics: z.object({
        memory: z.object({
          heapUsed: outputNumber,
          heapTotal: outputNumber,
          rss: outputNumber,
          external: outputNumber,
        }),
        cpu: z.object({ user: outputNumber, system: outputNumber }),
        uptime: outputNumber,
        eventLoopLag: outputNumber,
        requestDuration: z.undefined().optional(),
        requestsTotal: z.undefined().optional(),
        queryDuration: z.undefined().optional(),
        queriesTotal: z.undefined().optional(),
        note: z.undefined().optional(),
      }),
    }),
    z.object({
      category: z.string(),
      metrics: z.object({
        note: z.string(),
        requestDuration: z.undefined().optional(),
        requestsTotal: z.undefined().optional(),
        queryDuration: z.undefined().optional(),
        queriesTotal: z.undefined().optional(),
        memory: z.undefined().optional(),
        cpu: z.undefined().optional(),
        uptime: z.undefined().optional(),
        eventLoopLag: z.undefined().optional(),
      }),
    }),
  ]),
};
