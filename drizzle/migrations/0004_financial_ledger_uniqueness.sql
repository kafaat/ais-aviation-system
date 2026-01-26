-- Migration: 0004_financial_ledger_uniqueness
-- Description: Add unique constraint to prevent duplicate ledger entries
-- Date: 2026-01-26
-- 
-- ✅ يمنع تكرار القيود المالية لنفس الحجز ونفس النوع ونفس stripe_payment_intent_id
-- ✅ يسمح بـ NULL في stripe_payment_intent_id (للقيود اليدوية)
-- ✅ يستخدم partial index للأداء

-- ============================================================================
-- 1. Add unique constraint on financial_ledger
-- ============================================================================

-- For MySQL: Use unique index with specific columns
-- Note: MySQL doesn't support partial indexes, so we use a composite unique index

-- First, check if there are any duplicates and clean them up
-- This query finds duplicates (run manually if needed):
-- SELECT booking_id, type, stripe_payment_intent_id, COUNT(*) as cnt
-- FROM financial_ledger 
-- WHERE stripe_payment_intent_id IS NOT NULL
-- GROUP BY booking_id, type, stripe_payment_intent_id 
-- HAVING cnt > 1;

-- Add unique index (will fail if duplicates exist)
-- For entries WITH stripe_payment_intent_id
ALTER TABLE `financial_ledger` 
ADD UNIQUE INDEX `idx_ledger_unique_stripe_entry` (
  `booking_id`, 
  `type`, 
  `stripe_payment_intent_id`
);

-- ============================================================================
-- 2. Add index for reconciliation queries
-- ============================================================================

-- Index for finding pending payments by date
CREATE INDEX IF NOT EXISTS `idx_payments_pending_created` 
ON `payments` (`status`, `created_at`)
WHERE `status` = 'pending';

-- Index for finding unprocessed stripe events
CREATE INDEX IF NOT EXISTS `idx_stripe_events_unprocessed` 
ON `stripe_events` (`processed`, `created_at`)
WHERE `processed` = false;

-- ============================================================================
-- 3. Add missing columns if not exist
-- ============================================================================

-- Add correlation_id to financial_ledger for tracking
-- ALTER TABLE `financial_ledger` 
-- ADD COLUMN IF NOT EXISTS `correlation_id` VARCHAR(64) NULL;

-- ============================================================================
-- Notes:
-- ============================================================================
-- 
-- 1. This migration adds a unique constraint to prevent duplicate ledger entries
--    for the same booking + type + stripe_payment_intent_id combination.
--
-- 2. The constraint allows multiple entries with NULL stripe_payment_intent_id
--    (for manual adjustments).
--
-- 3. Before running this migration, ensure there are no duplicate entries.
--    Use the query above to check.
--
-- 4. If duplicates exist, they must be resolved manually before migration.
--
-- Rollback:
-- ALTER TABLE `financial_ledger` DROP INDEX `idx_ledger_unique_stripe_entry`;
-- DROP INDEX `idx_payments_pending_created` ON `payments`;
-- DROP INDEX `idx_stripe_events_unprocessed` ON `stripe_events`;
