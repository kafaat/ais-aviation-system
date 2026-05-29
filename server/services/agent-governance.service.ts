/**
 * Agent Governance Service
 *
 * Operational governance for the AI/agent layer:
 *  1. Cost attribution — persist every LLM gateway call with tenant + feature
 *     so AI spend can be answered to the cent per airline tenant and feature
 *     ("know where every cent goes").
 *  2. White-box decisions — record agent decisions and allow a human to
 *     override / roll them back with a full audit trail.
 *
 * Backed by the `ai_gateway_log` and `agent_decisions` tables.
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { aiGatewayLog, agentDecisions } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// 1. AI cost attribution
// ---------------------------------------------------------------------------

export interface AiUsageEntry {
  requestId: string;
  modelId: string;
  agentId?: string;
  taskType?: string;
  /** Airline tenant the call is billed to (null = system/unattributed). */
  tenantId?: number | null;
  /** Product feature, e.g. "ai-chat", "ai-pricing". */
  feature?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  /** Cost in USD (decimal). */
  costUsd?: number;
  latencyMs?: number;
  cached?: boolean;
  error?: string | null;
}

/**
 * Persist a single LLM gateway call. Best-effort: callers on the hot path
 * should not let a logging failure break the request, so this swallows DB
 * errors (still surfaced via console) rather than throwing.
 */
export async function recordAiUsage(entry: AiUsageEntry): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db.insert(aiGatewayLog).values({
      requestId: entry.requestId,
      modelId: entry.modelId,
      agentId: entry.agentId,
      taskType: entry.taskType,
      tenantId: entry.tenantId ?? null,
      feature: entry.feature ?? null,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costUsd: entry.costUsd != null ? entry.costUsd.toFixed(6) : null,
      latencyMs: entry.latencyMs,
      cached: entry.cached ?? false,
      error: entry.error ?? null,
    });
  } catch (err) {
    console.error("[agent-governance] failed to record AI usage", err);
  }
}

export interface CostBreakdownFilter {
  tenantId?: number;
  feature?: string;
  from?: Date;
  to?: Date;
}

export interface CostBreakdownRow {
  tenantId: number | null;
  feature: string | null;
  calls: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * Aggregate AI spend grouped by (tenant, feature). This is the query behind a
 * per-airline AI cost dashboard and budget alerting.
 */
export async function getAiCostBreakdown(
  filter: CostBreakdownFilter = {}
): Promise<CostBreakdownRow[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const conditions = [];
  if (filter.tenantId != null)
    conditions.push(eq(aiGatewayLog.tenantId, filter.tenantId));
  if (filter.feature != null)
    conditions.push(eq(aiGatewayLog.feature, filter.feature));
  if (filter.from) conditions.push(gte(aiGatewayLog.createdAt, filter.from));
  if (filter.to) conditions.push(lte(aiGatewayLog.createdAt, filter.to));

  const rows = await db
    .select({
      tenantId: aiGatewayLog.tenantId,
      feature: aiGatewayLog.feature,
      calls: sql<number>`count(*)`,
      totalCostUsd: sql<string>`coalesce(sum(${aiGatewayLog.costUsd}), 0)`,
      totalInputTokens: sql<number>`coalesce(sum(${aiGatewayLog.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`coalesce(sum(${aiGatewayLog.outputTokens}), 0)`,
    })
    .from(aiGatewayLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(aiGatewayLog.tenantId, aiGatewayLog.feature)
    .orderBy(desc(sql`coalesce(sum(${aiGatewayLog.costUsd}), 0)`));

  return rows.map(r => ({
    tenantId: r.tenantId ?? null,
    feature: r.feature ?? null,
    calls: Number(r.calls),
    totalCostUsd: Number(r.totalCostUsd),
    totalInputTokens: Number(r.totalInputTokens),
    totalOutputTokens: Number(r.totalOutputTokens),
  }));
}

// ---------------------------------------------------------------------------
// 2. White-box agent decisions (override / rollback)
// ---------------------------------------------------------------------------

/**
 * Override (roll back / correct) an agent decision. Records who did it, why,
 * and optionally which decision now supersedes it — the human-in-the-loop
 * correction that prevents the agent from repeating a bad decision.
 */
export async function overrideAgentDecision(
  decisionId: number,
  input: { overriddenBy: number; reason: string; supersededBy?: number }
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [existing] = await db
    .select({ id: agentDecisions.id })
    .from(agentDecisions)
    .where(eq(agentDecisions.id, decisionId))
    .limit(1);

  if (!existing) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Agent decision not found",
    });
  }

  await db
    .update(agentDecisions)
    .set({
      overridden: true,
      overriddenBy: input.overriddenBy,
      overrideReason: input.reason,
      overriddenAt: new Date(),
      supersededBy: input.supersededBy ?? null,
    })
    .where(eq(agentDecisions.id, decisionId));
}
