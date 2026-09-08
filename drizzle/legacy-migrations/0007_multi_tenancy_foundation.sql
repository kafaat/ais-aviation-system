-- Migration: Multi-Tenancy Foundation (Phase 0)
-- Description:
--   * tenants: the airlines onboarded onto the AIS SaaS platform.
--   * users.tenantId: link each user to its tenant (nullable for backward
--     compatibility and for platform/super-admin users).
--   This establishes the tenancy mechanism (table + user link). Scoping of
--   transactional tables and the tenant-aware query layer follow in later steps.
-- Date: 2026-05-29

-- ============================================================================
-- tenants
-- ============================================================================

CREATE TABLE IF NOT EXISTS `tenants` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `airlineCode` VARCHAR(3),
  `status` ENUM('active', 'suspended', 'pending') NOT NULL DEFAULT 'active',
  `contactEmail` VARCHAR(320),
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `tenants_slug_idx` (`slug`),
  KEY `tenants_status_idx` (`status`)
);

-- ============================================================================
-- users.tenantId
-- ============================================================================

ALTER TABLE `users`
  ADD COLUMN `tenantId` INT NULL AFTER `openId`;

CREATE INDEX `users_tenant_idx` ON `users` (`tenantId`);
