-- Migration: Outbox relay claim/lock
-- Description:
--   Adds a 'processing' status and a `lockedAt` timestamp so a relay worker
--   can atomically CLAIM a batch of pending events before publishing them.
--   Without this, running the relay on several app instances could publish
--   the same event more than once (status was only updated after publishing).
--   Stale claims (worker crashed mid-publish) are reclaimed after a timeout.
-- Date: 2026-09-06

ALTER TABLE `outbox`
  MODIFY COLUMN `status` ENUM('pending', 'processing', 'published', 'failed') NOT NULL DEFAULT 'pending',
  ADD COLUMN `lockedAt` TIMESTAMP NULL AFTER `createdAt`;
