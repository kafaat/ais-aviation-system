-- Migration: AI Governance (tenant cost attribution + white-box decision overrides)
-- Description:
--   * ai_gateway_log: add tenantId + feature so every LLM call's cost can be
--     attributed per airline tenant and per product feature ("know where every
--     cent goes"). Required foundation for per-tenant AI cost budgets.
--   * agent_decisions: add tenantId + human override/rollback trail so AI
--     decisions are correctable and auditable (white-box memory).
-- Date: 2026-05-29
-- Note: columns are nullable / defaulted so existing rows and inserts keep working.

-- ============================================================================
-- ai_gateway_log: tenant + feature cost attribution
-- ============================================================================

ALTER TABLE `ai_gateway_log`
  ADD COLUMN `tenantId` INT NULL,
  ADD COLUMN `feature` VARCHAR(100) NULL;

CREATE INDEX `ai_gw_tenant_idx` ON `ai_gateway_log` (`tenantId`);
CREATE INDEX `ai_gw_feature_idx` ON `ai_gateway_log` (`feature`);

-- ============================================================================
-- agent_decisions: tenant isolation + human override / rollback trail
-- ============================================================================

ALTER TABLE `agent_decisions`
  ADD COLUMN `tenantId` INT NULL,
  ADD COLUMN `overridden` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `overriddenBy` INT NULL,
  ADD COLUMN `overrideReason` TEXT NULL,
  ADD COLUMN `overriddenAt` TIMESTAMP NULL,
  ADD COLUMN `supersededBy` INT NULL;

CREATE INDEX `agent_dec_tenant_idx` ON `agent_decisions` (`tenantId`);
CREATE INDEX `agent_dec_overridden_idx` ON `agent_decisions` (`overridden`);
