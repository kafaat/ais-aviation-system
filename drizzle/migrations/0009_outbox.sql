-- Migration: Transactional Outbox (Phase 1 — event-driven foundation)
-- Description:
--   Domain events are written here in the SAME transaction as the business
--   change; a relay then publishes pending rows to the message bus and marks
--   them published. Solves the dual-write problem (no lost/phantom events).
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS `outbox` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `eventId` VARCHAR(64) NOT NULL,
  `aggregateType` VARCHAR(64) NOT NULL,
  `aggregateId` VARCHAR(64) NOT NULL,
  `eventType` VARCHAR(100) NOT NULL,
  `tenantId` INT,
  `payload` JSON NOT NULL,
  `status` ENUM('pending', 'published', 'failed') NOT NULL DEFAULT 'pending',
  `attempts` INT NOT NULL DEFAULT 0,
  `lastError` TEXT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `publishedAt` TIMESTAMP NULL,
  UNIQUE KEY `outbox_event_id_idx` (`eventId`),
  KEY `outbox_status_idx` (`status`, `createdAt`),
  KEY `outbox_aggregate_idx` (`aggregateType`, `aggregateId`),
  KEY `outbox_tenant_idx` (`tenantId`)
);
