import { responseContracts } from "../contracts/agent-governance";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  getAiCostBreakdown,
  overrideAgentDecision,
} from "../services/agent-governance.service";

/**
 * Agent Governance Router
 * AI cost attribution (per tenant/feature) + white-box decision overrides.
 * Admin/ops only.
 */
export const agentGovernanceRouter = router({
  /**
   * AI spend broken down by tenant and feature ("where did every cent go?").
   */
  getAiCostBreakdown: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/agent-governance/ai-cost",
        tags: ["Agent Governance", "Admin"],
        summary: "AI cost breakdown by tenant/feature",
        description:
          "Aggregate LLM gateway spend grouped by tenant and feature over an optional time window.",
        protect: true,
      },
    })
    .input(
      z
        .object({
          tenantId: z.number().int().positive().optional(),
          feature: z.string().max(100).optional(),
          from: z.date().optional(),
          to: z.date().optional(),
        })
        .optional()
    )
    .output(responseContracts["getAiCostBreakdown"])
    .query(async ({ input }) => {
      return await getAiCostBreakdown(input ?? {});
    }),

  /**
   * Annotate an agent decision (does not reverse a business transaction) (white-box, human-in-the-loop).
   */
  overrideDecision: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/agent-governance/override-decision",
        tags: ["Agent Governance", "Admin"],
        summary: "Override an agent decision",
        description:
          "Mark an agent decision as overridden by a human, recording the reason and an optional superseding decision id.",
        protect: true,
      },
    })
    .input(
      z.object({
        decisionId: z.number().int().positive(),
        reason: z.string().min(1).max(2000),
        supersededBy: z.number().int().positive().optional(),
      })
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await overrideAgentDecision(input.decisionId, {
        overriddenBy: ctx.user.id,
        reason: input.reason,
        supersededBy: input.supersededBy,
      });
      return { success: true };
    }),
});
