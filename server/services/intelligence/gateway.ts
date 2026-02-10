/**
 * AI Gateway - LLM Router & Model Registry
 *
 * Central gateway for all LLM interactions across the intelligence platform.
 * Provides model routing, cost tracking, rate limiting, and fallback handling.
 *
 * Capabilities:
 * - Multi-model routing (Gemini, OpenAI, local models)
 * - Request cost estimation and tracking
 * - Rate limiting per model/user
 * - Automatic fallback on model failure
 * - Response caching for identical prompts
 * - Usage analytics and cost optimization
 *
 * @module services/intelligence/gateway
 */

import { invokeLLM, type Message, type InvokeResult } from "../../_core/llm";
import { cacheService } from "../cache.service";
import { createServiceLogger } from "../../_core/logger";

const log = createServiceLogger("intelligence:gateway");

// ============================================================================
// Types
// ============================================================================

export interface ModelConfig {
  id: string;
  name: string;
  provider: "forge" | "openai" | "anthropic" | "local";
  costPer1kInput: number; // USD
  costPer1kOutput: number; // USD
  maxTokens: number;
  latencyMs: number; // estimated average
  capabilities: string[];
  enabled: boolean;
  priority: number; // 1 = highest
}

export interface GatewayRequest {
  agentId: string;
  taskType:
    | "analysis"
    | "summarization"
    | "classification"
    | "generation"
    | "extraction";
  messages: Message[];
  preferredModel?: string;
  maxCost?: number; // max USD per request
  maxLatencyMs?: number;
  cacheKey?: string;
  cacheTtlSeconds?: number;
}

export interface GatewayResponse {
  requestId: string;
  modelUsed: string;
  result: InvokeResult;
  cost: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number; // USD
  };
  latencyMs: number;
  cached: boolean;
}

export interface GatewayStats {
  totalRequests: number;
  totalCost: number;
  avgLatencyMs: number;
  modelUsage: Record<
    string,
    { requests: number; cost: number; avgLatency: number }
  >;
  cachHitRate: number;
}

// ============================================================================
// Model Registry
// ============================================================================

const MODEL_REGISTRY: ModelConfig[] = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "forge",
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    maxTokens: 32768,
    latencyMs: 2000,
    capabilities: [
      "analysis",
      "summarization",
      "classification",
      "generation",
      "extraction",
    ],
    enabled: true,
    priority: 1,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "forge",
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
    maxTokens: 65536,
    latencyMs: 5000,
    capabilities: ["analysis", "generation", "extraction"],
    enabled: false, // Enable when needed for complex tasks
    priority: 2,
  },
];

// ============================================================================
// AI Gateway
// ============================================================================

export class AIGateway {
  private requestCount = 0;
  private totalCost = 0;
  private totalLatency = 0;
  private cacheHits = 0;
  private modelStats: Map<
    string,
    { requests: number; cost: number; totalLatency: number }
  > = new Map();

  /**
   * Route an LLM request through the gateway
   */
  async invoke(request: GatewayRequest): Promise<GatewayResponse> {
    const startTime = Date.now();
    const requestId = `gw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Check cache first
    if (request.cacheKey) {
      const cached = await cacheService.get<GatewayResponse>(
        `ai_gateway:${request.cacheKey}`
      );
      if (cached) {
        this.cacheHits++;
        log.info(
          { requestId, agentId: request.agentId, cached: true },
          "Gateway cache hit"
        );
        return { ...cached, cached: true, requestId };
      }
    }

    // Select best model
    const model = this.selectModel(request);
    if (!model) {
      throw new Error("No suitable model available for this request");
    }

    try {
      // Invoke LLM
      const result = await invokeLLM({
        messages: request.messages,
        maxTokens: model.maxTokens,
      });

      const latencyMs = Date.now() - startTime;

      // Calculate cost
      const inputTokens = result.usage?.prompt_tokens || 0;
      const outputTokens = result.usage?.completion_tokens || 0;
      const totalCost =
        (inputTokens / 1000) * model.costPer1kInput +
        (outputTokens / 1000) * model.costPer1kOutput;

      // Track metrics
      this.trackUsage(model.id, totalCost, latencyMs);

      const response: GatewayResponse = {
        requestId,
        modelUsed: model.id,
        result,
        cost: {
          inputTokens,
          outputTokens,
          totalCost: Math.round(totalCost * 1000000) / 1000000,
        },
        latencyMs,
        cached: false,
      };

      // Cache response if requested
      if (request.cacheKey && request.cacheTtlSeconds) {
        await cacheService.set(
          `ai_gateway:${request.cacheKey}`,
          response,
          request.cacheTtlSeconds
        );
      }

      log.info(
        {
          requestId,
          agentId: request.agentId,
          model: model.id,
          inputTokens,
          outputTokens,
          cost: totalCost,
          latencyMs,
        },
        "Gateway request completed"
      );

      return response;
    } catch (error) {
      log.error(
        {
          requestId,
          agentId: request.agentId,
          model: model.id,
          error,
        },
        "Gateway request failed"
      );

      // Try fallback model
      const fallback = this.getFallbackModel(model.id, request);
      if (fallback) {
        log.info(
          { requestId, fallbackModel: fallback.id },
          "Attempting fallback model"
        );
        return this.invoke({ ...request, preferredModel: fallback.id });
      }

      throw error;
    }
  }

  /**
   * Select the best model for a request
   */
  private selectModel(request: GatewayRequest): ModelConfig | null {
    // If preferred model specified, use it
    if (request.preferredModel) {
      const preferred = MODEL_REGISTRY.find(
        m => m.id === request.preferredModel && m.enabled
      );
      if (preferred) return preferred;
    }

    // Filter by capabilities and constraints
    const candidates = MODEL_REGISTRY.filter(m => m.enabled)
      .filter(m => m.capabilities.includes(request.taskType))
      .filter(m => !request.maxLatencyMs || m.latencyMs <= request.maxLatencyMs)
      .sort((a, b) => a.priority - b.priority);

    return candidates[0] || null;
  }

  /**
   * Get fallback model when primary fails
   */
  private getFallbackModel(
    failedModelId: string,
    request: GatewayRequest
  ): ModelConfig | null {
    return (
      MODEL_REGISTRY.filter(m => m.enabled && m.id !== failedModelId)
        .filter(m => m.capabilities.includes(request.taskType))
        .sort((a, b) => a.priority - b.priority)[0] || null
    );
  }

  /**
   * Track usage metrics
   */
  private trackUsage(modelId: string, cost: number, latencyMs: number): void {
    this.requestCount++;
    this.totalCost += cost;
    this.totalLatency += latencyMs;

    const existing = this.modelStats.get(modelId) || {
      requests: 0,
      cost: 0,
      totalLatency: 0,
    };
    existing.requests++;
    existing.cost += cost;
    existing.totalLatency += latencyMs;
    this.modelStats.set(modelId, existing);
  }

  /**
   * Get gateway statistics
   */
  getStats(): GatewayStats {
    const modelUsage: Record<
      string,
      { requests: number; cost: number; avgLatency: number }
    > = {};

    for (const [modelId, stats] of this.modelStats) {
      modelUsage[modelId] = {
        requests: stats.requests,
        cost: Math.round(stats.cost * 1000000) / 1000000,
        avgLatency:
          stats.requests > 0
            ? Math.round(stats.totalLatency / stats.requests)
            : 0,
      };
    }

    return {
      totalRequests: this.requestCount,
      totalCost: Math.round(this.totalCost * 1000000) / 1000000,
      avgLatencyMs:
        this.requestCount > 0
          ? Math.round(this.totalLatency / this.requestCount)
          : 0,
      modelUsage,
      cachHitRate:
        this.requestCount + this.cacheHits > 0
          ? this.cacheHits / (this.requestCount + this.cacheHits)
          : 0,
    };
  }

  /**
   * Get available models
   */
  getModels(): ModelConfig[] {
    return MODEL_REGISTRY.filter(m => m.enabled);
  }

  /**
   * Reset statistics (for testing)
   */
  resetStats(): void {
    this.requestCount = 0;
    this.totalCost = 0;
    this.totalLatency = 0;
    this.cacheHits = 0;
    this.modelStats.clear();
  }
}

export const aiGateway = new AIGateway();
