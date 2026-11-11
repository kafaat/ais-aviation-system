/**
 * Intelligence Kernel - Central Agent Orchestrator
 *
 * The brain of the AIS Autonomous Intelligence Platform (AAIP).
 * Coordinates all intelligence agents, produces unified briefings,
 * and manages the agent lifecycle.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────┐
 * │              Intelligence Kernel                  │
 * │  ┌───────────┐ ┌──────────┐ ┌───────────────┐   │
 * │  │ Economics  │ │  Fraud   │ │  Operations   │   │
 * │  │   Agent    │ │  Agent   │ │    Agent      │   │
 * │  └───────────┘ └──────────┘ └───────────────┘   │
 * │  ┌───────────────────────────────────────────┐   │
 * │  │            AI Gateway                      │   │
 * │  │     (LLM Router + Model Registry)         │   │
 * │  └───────────────────────────────────────────┘   │
 * └─────────────────────────────────────────────────┘
 *
 * @module services/intelligence/kernel
 */

import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createServiceLogger } from "../../_core/logger";
import { cacheService } from "../cache.service";
import { economicsAgent } from "./economics.agent";
import { fraudAgent } from "./fraud.agent";
import { operationsAgent } from "./operations.agent";
import { aiGateway } from "./gateway";
import type {
  IntelligenceContext,
  IntelligenceBriefing,
  IntelligenceConfig,
  AgentResult,
  AgentRecommendation,
  FraudRiskLevel,
  OperationalAlert,
} from "./types";

const log = createServiceLogger("intelligence:kernel");

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: IntelligenceConfig = {
  agents: {
    economics: {
      enabled: true,
      timeoutMs: 30000,
      cacheTtlMs: 5 * 60 * 1000, // 5 minutes
      priority: 2,
    },
    fraud: {
      enabled: true,
      timeoutMs: 10000,
      cacheTtlMs: 1 * 60 * 1000, // 1 minute (fraud needs fresher data)
      priority: 1,
    },
    operations: {
      enabled: true,
      timeoutMs: 20000,
      cacheTtlMs: 2 * 60 * 1000, // 2 minutes
      priority: 1,
    },
    pricing: {
      enabled: true,
      timeoutMs: 15000,
      cacheTtlMs: 5 * 60 * 1000,
      priority: 2,
    },
  },
  briefingCacheTtlMs: 3 * 60 * 1000, // 3 minutes
  maxConcurrentAgents: 4,
};

const BRIEFING_CACHE_KEY = "intelligence:briefing";

// ============================================================================
// Intelligence Kernel
// ============================================================================

export class IntelligenceKernel {
  private config: IntelligenceConfig;
  private isRunning = false;

  constructor(config?: Partial<IntelligenceConfig>) {
    this.config = structuredClone({ ...DEFAULT_CONFIG, ...config });
  }

  /**
   * Generate a comprehensive intelligence briefing
   * Runs all enabled agents in parallel and combines results
   */
  async generateBriefing(
    context: IntelligenceContext
  ): Promise<IntelligenceBriefing> {
    const startTime = Date.now();

    const config = structuredClone(this.config);
    const normalizedIds = (ids?: number[]) =>
      [...new Set(ids ?? [])].sort((a, b) => a - b);
    // Request IDs are tracing identities, not data scope. Principal and all
    // supported filters/configuration must partition shared cached results.
    const cacheKey = `${BRIEFING_CACHE_KEY}:${createHash("sha256")
      .update(
        JSON.stringify({
          userId: context.userId ?? null,
          timeHorizon: context.timeHorizon,
          flightIds: normalizedIds(context.scope.flightIds),
          routeIds: normalizedIds(context.scope.routeIds),
          airlineIds: normalizedIds(context.scope.airlineIds),
          dateRange: context.scope.dateRange ?? null,
          config,
        })
      )
      .digest("hex")}`;
    const cached = await cacheService.get<IntelligenceBriefing>(cacheKey);
    if (cached) {
      log.info({ event: "briefing_cache_hit" }, "Returning cached briefing");
      return cached;
    }

    this.isRunning = true;
    log.info(
      { requestId: context.requestId, event: "briefing_start" },
      "Generating intelligence briefing"
    );

    // Disabled agents are never invoked. Bound parallel work by configuration.
    const tasks: Array<() => Promise<AgentResult | null>> = [
      () =>
        config.agents.economics.enabled
          ? this.runWithTimeout(
              () => economicsAgent.analyze(context),
              config.agents.economics.timeoutMs
            )
          : Promise.resolve(null),
      () =>
        config.agents.fraud.enabled
          ? this.runWithTimeout(
              () => fraudAgent.getOverview(context),
              config.agents.fraud.timeoutMs
            )
          : Promise.resolve(null),
      () =>
        config.agents.operations.enabled
          ? this.runWithTimeout(
              () => operationsAgent.getOperationalHealth(context),
              config.agents.operations.timeoutMs
            )
          : Promise.resolve(null),
    ];
    const settled: PromiseSettledResult<AgentResult | null>[] = [];
    const concurrency = Math.max(
      1,
      Math.min(tasks.length, Math.floor(config.maxConcurrentAgents) || 1)
    );
    for (let offset = 0; offset < tasks.length; offset += concurrency) {
      settled.push(
        ...(await Promise.allSettled(
          tasks.slice(offset, offset + concurrency).map(run => run())
        ))
      );
    }
    const [economicsResult, fraudResult, operationsResult] = settled;

    // Extract results with fallbacks
    const economics = this.extractResult(economicsResult, "economics");
    const fraud = this.extractResult(fraudResult, "fraud");
    const operations = this.extractResult(operationsResult, "operations");

    // Collect all agent results for the briefing
    const agentResults: AgentResult[] = [];
    if (economics) agentResults.push(economics);
    if (fraud) agentResults.push(fraud);
    if (operations) agentResults.push(operations);

    // Collect and rank all recommendations
    const allRecommendations: AgentRecommendation[] = [
      ...(economics?.recommendations || []),
      ...(fraud?.recommendations || []),
      ...(operations?.recommendations || []),
    ];

    // Sort by severity: critical > action_required > warning > info
    const severityOrder: Record<string, number> = {
      critical: 0,
      action_required: 1,
      warning: 2,
      info: 3,
    };
    allRecommendations.sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
    );

    // Build briefing
    const executionTimeMs = Date.now() - startTime;

    // Calculate overall health score
    const healthScore = this.calculateHealthScore(economics, fraud, operations);
    const overallHealth = this.getHealthLabel(healthScore);

    // Economics summary
    const economicsData = economics?.data as
      | {
          netMargin?: number | null;
          unprofitableRoutes?: unknown[];
          routes?: unknown[];
        }
      | undefined;
    const profitMargin = economicsData?.netMargin ?? null;
    const economicsTrend =
      profitMargin == null
        ? "Insufficient operating-cost data"
        : profitMargin > 15
          ? "Strong profitability"
          : profitMargin > 5
            ? "Healthy margins"
            : profitMargin > 0
              ? "Thin margins"
              : "Loss-making";

    // Fraud summary
    const fraudData = fraud?.data as
      | {
          blockedTransactions?: number;
          savedAmount?: number;
          riskDistribution?: Record<FraudRiskLevel, number>;
        }
      | undefined;
    const blockedTransactions = fraudData?.blockedTransactions ?? 0;
    const savedAmount = fraudData?.savedAmount ?? 0;
    const fraudRiskLevel: FraudRiskLevel =
      blockedTransactions > 50
        ? "high"
        : blockedTransactions > 20
          ? "medium"
          : "low";

    // Operations summary
    const opsData = operations?.data as
      | {
          otp?: number | null;
          alerts?: OperationalAlert[];
        }
      | undefined;
    const otp = opsData?.otp ?? null;
    const opsAlerts = opsData?.alerts ?? [];

    const briefing: IntelligenceBriefing = {
      generatedAt: new Date(),
      period: context.scope.dateRange
        ? `${context.scope.dateRange.start.toISOString()} – ${context.scope.dateRange.end.toISOString()}`
        : `Analysis horizon: ${context.timeHorizon}`,
      executionTimeMs,
      overallHealth,
      healthScore,
      economics: {
        summary: !config.agents.economics.enabled
          ? "Economics agent disabled"
          : profitMargin == null
            ? "Profitability is unavailable until operating costs are integrated."
            : `Net margin: ${profitMargin}%. ${economicsData?.unprofitableRoutes?.length || 0} routes below threshold.`,
        summaryAr: !config.agents.economics.enabled
          ? "وكيل الاقتصاد معطل"
          : profitMargin == null
            ? "الربحية غير متاحة حتى ربط تكاليف التشغيل الفعلية."
            : `هامش الربح الصافي: ${profitMargin}%. ${economicsData?.unprofitableRoutes?.length || 0} خطوط أقل من الحد الأدنى.`,
        profitMargin,
        trend: economicsTrend,
        keyMetrics: {
          totalRoutes: (economicsData?.routes as unknown[])?.length ?? 0,
          unprofitableRoutes:
            (economicsData?.unprofitableRoutes as unknown[])?.length ?? 0,
          netMargin: profitMargin,
        },
      },
      operations: {
        summary: !config.agents.operations.enabled
          ? "Operations agent disabled"
          : otp === null
            ? "Departure OTP unavailable: source observations are missing."
            : `OTP: ${otp}%. ${opsAlerts.length} active alerts.`,
        summaryAr: !config.agents.operations.enabled
          ? "وكيل العمليات معطل"
          : otp === null
            ? "الأداء في الوقت المحدد غير متاح: بيانات الرصد مفقودة."
            : `الأداء في الوقت المحدد: ${otp}%. ${opsAlerts.length} تنبيهات نشطة.`,
        otp,
        alerts: opsAlerts,
      },
      fraud: {
        summary: !config.agents.fraud.enabled
          ? "Fraud agent disabled"
          : !fraud
            ? "Fraud analysis unavailable"
            : `${blockedTransactions} blocked transactions. SAR ${savedAmount.toFixed(2)} saved.`,
        summaryAr: !config.agents.fraud.enabled
          ? "وكيل الاحتيال معطل"
          : !fraud
            ? "تحليل الاحتيال غير متاح"
            : `${blockedTransactions} معاملة محظورة. وفورات ${savedAmount.toFixed(2)} ريال.`,
        blockedTransactions,
        savedAmount,
        riskLevel: fraudRiskLevel,
      },
      pricing: {
        summary: config.agents.pricing.enabled
          ? "Pricing advisory only; no pricing agent executed in this briefing"
          : "Pricing agent disabled",
        summaryAr: config.agents.pricing.enabled
          ? "التسعير استشاري فقط؛ لم يُنفذ وكيل تسعير في هذا الملخص"
          : "وكيل التسعير معطل",
        revenueImpact: 0,
        activeOptimizations: 0,
      },
      topRecommendations: allRecommendations.slice(0, 10),
      agentResults,
    };

    // Cache the briefing
    await cacheService.set(
      cacheKey,
      briefing,
      config.briefingCacheTtlMs / 1000
    );

    this.isRunning = false;

    log.info(
      {
        event: "briefing_complete",
        executionTimeMs,
        healthScore,
        overallHealth,
        agentCount: agentResults.length,
        recommendationCount: allRecommendations.length,
      },
      `Intelligence briefing generated: ${overallHealth} (${healthScore}/100)`
    );

    return briefing;
  }

  /**
   * Assess fraud for a specific booking
   */
  assessBookingFraud(
    bookingId: number,
    userId: number,
    context: IntelligenceContext
  ) {
    this.requireEnabled("fraud");
    return fraudAgent.assessBooking(bookingId, userId, context);
  }

  /**
   * Predict delay for a specific flight
   */
  predictFlightDelay(flightId: number, context: IntelligenceContext) {
    this.requireEnabled("operations");
    return operationsAgent.predictDelay(flightId, context);
  }

  /**
   * Get disruption forecast
   */
  getDisruptionForecast(context: IntelligenceContext) {
    this.requireEnabled("operations");
    return operationsAgent.forecastDisruptions(context);
  }

  /**
   * Get economics analysis
   */
  getEconomicsAnalysis(context: IntelligenceContext) {
    this.requireEnabled("economics");
    return economicsAgent.analyze(context);
  }

  /**
   * Get AI Gateway statistics
   */
  getGatewayStats() {
    return aiGateway.getStats();
  }

  /**
   * Get available AI models
   */
  getAvailableModels() {
    return aiGateway.getModels();
  }

  /**
   * Get current configuration
   */
  getConfig(): IntelligenceConfig {
    return structuredClone(this.config);
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<IntelligenceConfig>): void {
    this.config = structuredClone({ ...this.config, ...updates });
    log.info(
      { event: "config_updated" },
      "Intelligence kernel configuration updated"
    );
  }

  /**
   * Check if the kernel is currently running
   */
  getStatus(): { running: boolean; agents: Record<string, boolean> } {
    return {
      running: this.isRunning,
      agents: {
        economics: this.config.agents.economics.enabled,
        fraud: this.config.agents.fraud.enabled,
        operations: this.config.agents.operations.enabled,
        pricing: this.config.agents.pricing.enabled,
      },
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private requireEnabled(agent: keyof IntelligenceConfig["agents"]): void {
    if (!this.config.agents[agent].enabled) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${agent} agent is disabled`,
      });
    }
  }

  private runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Agent timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }

  private extractResult<T>(
    settledResult: PromiseSettledResult<AgentResult<T> | null>,
    agentName: string
  ): AgentResult<T> | null {
    if (settledResult.status === "fulfilled") {
      return settledResult.value;
    }

    log.error(
      {
        agent: agentName,
        error: settledResult.reason,
        event: "agent_failed",
      },
      `Agent ${agentName} failed in briefing`
    );

    return null;
  }

  private calculateHealthScore(
    economics: AgentResult | null,
    fraud: AgentResult | null,
    operations: AgentResult | null
  ): number {
    let score = 50; // Base score
    let factorCount = 0;

    // Economics contribution (30%)
    if (
      economics?.status === "completed" &&
      (economics.data as { netMargin?: number | null })?.netMargin != null
    ) {
      const data = economics.data as { netMargin?: number } | undefined;
      const margin = data?.netMargin ?? 0;
      const econScore =
        margin > 20
          ? 100
          : margin > 10
            ? 85
            : margin > 5
              ? 70
              : margin > 0
                ? 50
                : 20;
      score += (econScore - 50) * 0.3;
      factorCount++;
    }

    // Operations contribution (40%)
    if (operations?.status === "completed") {
      const data = operations.data as
        { otp?: number | null; cancellationRate?: number | null } | undefined;
      const otp = data?.otp ?? 0;
      const cancelRate = data?.cancellationRate ?? 0;
      const opsScore =
        otp > 90 && cancelRate < 2
          ? 100
          : otp > 85
            ? 85
            : otp > 75
              ? 65
              : otp > 60
                ? 45
                : 20;
      score += (opsScore - 50) * 0.4;
      factorCount++;
    }

    // Fraud contribution (30%)
    if (fraud?.status === "completed") {
      const data = fraud.data as { blockedTransactions?: number } | undefined;
      const blocked = data?.blockedTransactions ?? 0;
      const fraudScore =
        blocked < 5 ? 95 : blocked < 20 ? 80 : blocked < 50 ? 60 : 30;
      score += (fraudScore - 50) * 0.3;
      factorCount++;
    }

    // If no agents succeeded, return low score
    if (factorCount === 0) return 25;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private getHealthLabel(score: number): IntelligenceBriefing["overallHealth"] {
    if (score >= 85) return "excellent";
    if (score >= 70) return "good";
    if (score >= 55) return "fair";
    if (score >= 35) return "poor";
    return "critical";
  }
}

// Export singleton instance
export const intelligenceKernel = new IntelligenceKernel();
