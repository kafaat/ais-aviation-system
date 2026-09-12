// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";
export const responseContracts = {
  getBriefing: z.object({
    generatedAt: z.date(),
    period: z.string(),
    executionTimeMs: outputNumber,
    overallHealth: z.enum(["critical", "excellent", "good", "fair", "poor"]),
    healthScore: outputNumber,
    economics: z.object({
      summary: z.string(),
      summaryAr: z.string(),
      profitMargin: z.union([z.null(), outputNumber]),
      trend: z.string(),
      keyMetrics: z.record(z.string(), z.union([z.null(), outputNumber])),
    }),
    operations: z.object({
      summary: z.string(),
      summaryAr: z.string(),
      otp: outputNumber.nullable(),
      alerts: z.array(
        z.object({
          type: z.enum([
            "capacity",
            "maintenance",
            "delay_cascade",
            "crew_shortage",
            "weather",
          ]),
          severity: z.enum(["critical", "warning", "info", "action_required"]),
          message: z.string(),
          affectedFlights: z.array(outputNumber),
          suggestedAction: z.string(),
        })
      ),
    }),
    fraud: z.object({
      summary: z.string(),
      summaryAr: z.string(),
      blockedTransactions: outputNumber,
      savedAmount: outputNumber,
      riskLevel: z.enum(["high", "medium", "low", "critical"]),
    }),
    pricing: z.object({
      summary: z.string(),
      summaryAr: z.string(),
      revenueImpact: outputNumber,
      activeOptimizations: outputNumber,
    }),
    topRecommendations: z.array(
      z.object({
        id: z.string(),
        type: z.enum([
          "pricing",
          "marketing",
          "operations",
          "fraud",
          "economics",
          "inventory",
        ]),
        severity: z.enum(["critical", "warning", "info", "action_required"]),
        title: z.string(),
        titleAr: z.string(),
        description: z.string(),
        descriptionAr: z.string(),
        action: z.string(),
        impact: z.object({
          metric: z.string(),
          currentValue: outputNumber,
          projectedValue: outputNumber,
          change: outputNumber,
          unit: z.string(),
        }),
        autoApplicable: z.boolean(),
        expiresAt: z.union([z.undefined(), z.date()]).optional(),
      })
    ),
    agentResults: z.array(
      z.object({
        agentId: z.string(),
        agentName: z.string(),
        timestamp: z.date(),
        executionTimeMs: outputNumber,
        status: z.enum(["completed", "failed", "running", "timeout", "idle"]),
        confidence: outputNumber,
        confidenceLevel: z.enum(["high", "medium", "low", "very_high"]),
        data: structuredValue,
        reasoning: z.array(z.string()),
        recommendations: z.array(
          z.object({
            id: z.string(),
            type: z.enum([
              "pricing",
              "marketing",
              "operations",
              "fraud",
              "economics",
              "inventory",
            ]),
            severity: z.enum([
              "critical",
              "warning",
              "info",
              "action_required",
            ]),
            title: z.string(),
            titleAr: z.string(),
            description: z.string(),
            descriptionAr: z.string(),
            action: z.string(),
            impact: z.object({
              metric: z.string(),
              currentValue: outputNumber,
              projectedValue: outputNumber,
              change: outputNumber,
              unit: z.string(),
            }),
            autoApplicable: z.boolean(),
            expiresAt: z.union([z.undefined(), z.date()]).optional(),
          })
        ),
        errors: z.union([z.undefined(), z.array(z.string())]).optional(),
      })
    ),
  }),
  getEconomics: z.object({
    agentId: z.string(),
    agentName: z.string(),
    timestamp: z.date(),
    executionTimeMs: outputNumber,
    status: z.enum(["completed", "failed", "running", "timeout", "idle"]),
    confidence: outputNumber,
    confidenceLevel: z.enum(["high", "medium", "low", "very_high"]),
    data: z.object({
      dataQuality: z
        .union([
          z.undefined(),
          z.object({
            missing: z.array(z.string()),
            revenueAllocation: z.string(),
          }),
        ])
        .optional(),
      totalRevenue: z.union([z.null(), outputNumber]),
      totalCost: z.union([z.null(), outputNumber]),
      operatingProfit: z.union([z.null(), outputNumber]),
      netMargin: z.union([z.null(), outputNumber]),
      roi: z.union([z.null(), outputNumber]),
      routes: z.array(
        z.object({
          routeId: z.string(),
          origin: z.string(),
          destination: z.string(),
          metrics: z.object({
            rask: z.union([z.null(), outputNumber]),
            cask: z.union([z.null(), outputNumber]),
            yield: z.union([z.null(), outputNumber]),
            loadFactor: outputNumber,
            breakEvenLoadFactor: z.union([z.null(), outputNumber]),
            profitMargin: z.union([z.null(), outputNumber]),
            contributionMargin: z.union([z.null(), outputNumber]),
          }),
          trend: z.enum(["unknown", "improving", "stable", "declining"]),
          measured: z
            .union([
              z.undefined(),
              z.object({
                flights: outputNumber,
                availableSeats: outputNumber,
                bookedSeats: outputNumber,
                revenue: z.union([z.null(), outputNumber]),
              }),
            ])
            .optional(),
          forecast: z.object({
            nextMonth: z.union([z.null(), outputNumber]),
            nextQuarter: z.union([z.null(), outputNumber]),
            confidence: outputNumber,
          }),
        })
      ),
      unprofitableRoutes: z.array(
        z.object({
          routeId: z.string(),
          origin: z.string(),
          destination: z.string(),
          metrics: z.object({
            rask: z.union([z.null(), outputNumber]),
            cask: z.union([z.null(), outputNumber]),
            yield: z.union([z.null(), outputNumber]),
            loadFactor: outputNumber,
            breakEvenLoadFactor: z.union([z.null(), outputNumber]),
            profitMargin: z.union([z.null(), outputNumber]),
            contributionMargin: z.union([z.null(), outputNumber]),
          }),
          trend: z.enum(["unknown", "improving", "stable", "declining"]),
          measured: z
            .union([
              z.undefined(),
              z.object({
                flights: outputNumber,
                availableSeats: outputNumber,
                bookedSeats: outputNumber,
                revenue: z.union([z.null(), outputNumber]),
              }),
            ])
            .optional(),
          forecast: z.object({
            nextMonth: z.union([z.null(), outputNumber]),
            nextQuarter: z.union([z.null(), outputNumber]),
            confidence: outputNumber,
          }),
        })
      ),
      topPerformers: z.array(
        z.object({
          routeId: z.string(),
          origin: z.string(),
          destination: z.string(),
          metrics: z.object({
            rask: z.union([z.null(), outputNumber]),
            cask: z.union([z.null(), outputNumber]),
            yield: z.union([z.null(), outputNumber]),
            loadFactor: outputNumber,
            breakEvenLoadFactor: z.union([z.null(), outputNumber]),
            profitMargin: z.union([z.null(), outputNumber]),
            contributionMargin: z.union([z.null(), outputNumber]),
          }),
          trend: z.enum(["unknown", "improving", "stable", "declining"]),
          measured: z
            .union([
              z.undefined(),
              z.object({
                flights: outputNumber,
                availableSeats: outputNumber,
                bookedSeats: outputNumber,
                revenue: z.union([z.null(), outputNumber]),
              }),
            ])
            .optional(),
          forecast: z.object({
            nextMonth: z.union([z.null(), outputNumber]),
            nextQuarter: z.union([z.null(), outputNumber]),
            confidence: outputNumber,
          }),
        })
      ),
      recommendations: z.array(
        z.object({
          id: z.string(),
          type: z.enum([
            "pricing",
            "marketing",
            "operations",
            "fraud",
            "economics",
            "inventory",
          ]),
          severity: z.enum(["critical", "warning", "info", "action_required"]),
          title: z.string(),
          titleAr: z.string(),
          description: z.string(),
          descriptionAr: z.string(),
          action: z.string(),
          impact: z.object({
            metric: z.string(),
            currentValue: outputNumber,
            projectedValue: outputNumber,
            change: outputNumber,
            unit: z.string(),
          }),
          autoApplicable: z.boolean(),
          expiresAt: z.union([z.undefined(), z.date()]).optional(),
        })
      ),
    }),
    reasoning: z.array(z.string()),
    recommendations: z.array(
      z.object({
        id: z.string(),
        type: z.enum([
          "pricing",
          "marketing",
          "operations",
          "fraud",
          "economics",
          "inventory",
        ]),
        severity: z.enum(["critical", "warning", "info", "action_required"]),
        title: z.string(),
        titleAr: z.string(),
        description: z.string(),
        descriptionAr: z.string(),
        action: z.string(),
        impact: z.object({
          metric: z.string(),
          currentValue: outputNumber,
          projectedValue: outputNumber,
          change: outputNumber,
          unit: z.string(),
        }),
        autoApplicable: z.boolean(),
        expiresAt: z.union([z.undefined(), z.date()]).optional(),
      })
    ),
    errors: z.union([z.undefined(), z.array(z.string())]).optional(),
  }),
  assessFraud: z.object({
    agentId: z.string(),
    agentName: z.string(),
    timestamp: z.date(),
    executionTimeMs: outputNumber,
    status: z.enum(["completed", "failed", "running", "timeout", "idle"]),
    confidence: outputNumber,
    confidenceLevel: z.enum(["high", "medium", "low", "very_high"]),
    data: z.object({
      bookingId: z.union([z.undefined(), outputNumber]).optional(),
      userId: z.union([z.undefined(), outputNumber]).optional(),
      riskScore: outputNumber,
      riskLevel: z.enum(["high", "medium", "low", "critical"]),
      signals: z.array(
        z.object({
          signalType: z.string(),
          weight: outputNumber,
          description: z.string(),
          value: structuredValue,
        })
      ),
      recommendation: z.enum(["review", "approve", "block"]),
      reasoning: z.string(),
    }),
    reasoning: z.array(z.string()),
    recommendations: z.array(
      z.object({
        id: z.string(),
        type: z.enum([
          "pricing",
          "marketing",
          "operations",
          "fraud",
          "economics",
          "inventory",
        ]),
        severity: z.enum(["critical", "warning", "info", "action_required"]),
        title: z.string(),
        titleAr: z.string(),
        description: z.string(),
        descriptionAr: z.string(),
        action: z.string(),
        impact: z.object({
          metric: z.string(),
          currentValue: outputNumber,
          projectedValue: outputNumber,
          change: outputNumber,
          unit: z.string(),
        }),
        autoApplicable: z.boolean(),
        expiresAt: z.union([z.undefined(), z.date()]).optional(),
      })
    ),
    errors: z.union([z.undefined(), z.array(z.string())]).optional(),
  }),
  predictDelay: z.object({
    agentId: z.string(),
    agentName: z.string(),
    timestamp: z.date(),
    executionTimeMs: outputNumber,
    status: z.enum(["completed", "failed", "running", "timeout", "idle"]),
    confidence: outputNumber,
    confidenceLevel: z.enum(["high", "medium", "low", "very_high"]),
    data: z.object({
      flightId: outputNumber,
      flightNumber: z.string(),
      scheduledDeparture: z.date(),
      predictedDelayMinutes: outputNumber.nullable(),
      basis: z.enum(["observed", "partner_estimate", "unavailable"]),
      evidenceId: outputNumber.nullable(),
      sourceId: z.string().nullable(),
      fresh: z.boolean(),
      confidence: outputNumber,
      factors: z.array(
        z.object({
          factor: z.string(),
          contribution: outputNumber,
          description: z.string(),
        })
      ),
      recommendation: z.string(),
    }),
    reasoning: z.array(z.string()),
    recommendations: z.array(
      z.object({
        id: z.string(),
        type: z.enum([
          "pricing",
          "marketing",
          "operations",
          "fraud",
          "economics",
          "inventory",
        ]),
        severity: z.enum(["critical", "warning", "info", "action_required"]),
        title: z.string(),
        titleAr: z.string(),
        description: z.string(),
        descriptionAr: z.string(),
        action: z.string(),
        impact: z.object({
          metric: z.string(),
          currentValue: outputNumber,
          projectedValue: outputNumber,
          change: outputNumber,
          unit: z.string(),
        }),
        autoApplicable: z.boolean(),
        expiresAt: z.union([z.undefined(), z.date()]).optional(),
      })
    ),
    errors: z.union([z.undefined(), z.array(z.string())]).optional(),
  }),
  getDisruptionForecast: z.object({
    agentId: z.string(),
    agentName: z.string(),
    timestamp: z.date(),
    executionTimeMs: outputNumber,
    status: z.enum(["completed", "failed", "running", "timeout", "idle"]),
    confidence: outputNumber,
    confidenceLevel: z.enum(["high", "medium", "low", "very_high"]),
    data: z.array(
      z.object({
        date: z.date(),
        severity: z.enum(["none", "minor", "moderate", "severe"]),
        affectedFlights: outputNumber,
        causes: z.array(z.string()),
        recommendations: z.array(
          z.object({
            id: z.string(),
            type: z.enum([
              "pricing",
              "marketing",
              "operations",
              "fraud",
              "economics",
              "inventory",
            ]),
            severity: z.enum([
              "critical",
              "warning",
              "info",
              "action_required",
            ]),
            title: z.string(),
            titleAr: z.string(),
            description: z.string(),
            descriptionAr: z.string(),
            action: z.string(),
            impact: z.object({
              metric: z.string(),
              currentValue: outputNumber,
              projectedValue: outputNumber,
              change: outputNumber,
              unit: z.string(),
            }),
            autoApplicable: z.boolean(),
            expiresAt: z.union([z.undefined(), z.date()]).optional(),
          })
        ),
      })
    ),
    reasoning: z.array(z.string()),
    recommendations: z.array(
      z.object({
        id: z.string(),
        type: z.enum([
          "pricing",
          "marketing",
          "operations",
          "fraud",
          "economics",
          "inventory",
        ]),
        severity: z.enum(["critical", "warning", "info", "action_required"]),
        title: z.string(),
        titleAr: z.string(),
        description: z.string(),
        descriptionAr: z.string(),
        action: z.string(),
        impact: z.object({
          metric: z.string(),
          currentValue: outputNumber,
          projectedValue: outputNumber,
          change: outputNumber,
          unit: z.string(),
        }),
        autoApplicable: z.boolean(),
        expiresAt: z.union([z.undefined(), z.date()]).optional(),
      })
    ),
    errors: z.union([z.undefined(), z.array(z.string())]).optional(),
  }),
  getGatewayStats: z.object({
    totalRequests: outputNumber,
    totalCost: outputNumber,
    avgLatencyMs: outputNumber,
    modelUsage: z.record(
      z.string(),
      z.object({
        requests: outputNumber,
        cost: outputNumber,
        avgLatency: outputNumber,
      })
    ),
    cachHitRate: outputNumber,
  }),
  getModels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      provider: z.enum(["local", "forge", "openai", "anthropic"]),
      costPer1kInput: outputNumber,
      costPer1kOutput: outputNumber,
      maxTokens: outputNumber,
      latencyMs: outputNumber,
      capabilities: z.array(z.string()),
      enabled: z.boolean(),
      priority: outputNumber,
    })
  ),
  getStatus: z.object({
    config: z.object({
      agents: z.object({
        economics: z.object({
          enabled: z.boolean(),
          timeoutMs: outputNumber,
          cacheTtlMs: outputNumber,
          priority: outputNumber,
        }),
        fraud: z.object({
          enabled: z.boolean(),
          timeoutMs: outputNumber,
          cacheTtlMs: outputNumber,
          priority: outputNumber,
        }),
        operations: z.object({
          enabled: z.boolean(),
          timeoutMs: outputNumber,
          cacheTtlMs: outputNumber,
          priority: outputNumber,
        }),
        pricing: z.object({
          enabled: z.boolean(),
          timeoutMs: outputNumber,
          cacheTtlMs: outputNumber,
          priority: outputNumber,
        }),
      }),
      briefingCacheTtlMs: outputNumber,
      maxConcurrentAgents: outputNumber,
    }),
    running: z.boolean(),
    agents: z.record(z.string(), z.boolean()),
  }),
  updateConfig: z.object({
    success: z.boolean(),
    config: z.object({
      agents: z.object({
        economics: z.object({
          enabled: z.boolean(),
          timeoutMs: outputNumber,
          cacheTtlMs: outputNumber,
          priority: outputNumber,
        }),
        fraud: z.object({
          enabled: z.boolean(),
          timeoutMs: outputNumber,
          cacheTtlMs: outputNumber,
          priority: outputNumber,
        }),
        operations: z.object({
          enabled: z.boolean(),
          timeoutMs: outputNumber,
          cacheTtlMs: outputNumber,
          priority: outputNumber,
        }),
        pricing: z.object({
          enabled: z.boolean(),
          timeoutMs: outputNumber,
          cacheTtlMs: outputNumber,
          priority: outputNumber,
        }),
      }),
      briefingCacheTtlMs: outputNumber,
      maxConcurrentAgents: outputNumber,
    }),
  }),
};
