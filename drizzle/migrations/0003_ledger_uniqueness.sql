-- Migration: Add Ledger Uniqueness Constraints
-- Version: 0003
-- Date: 2026-01-26
-- Description: Prevent duplicate financial entries by adding unique constraints

-- ============================================================================
-- LEDGER UNIQUENESS CONSTRAINTS
-- ============================================================================
-- 
-- Problem: Multiple Stripe events can represent the same financial transaction:
-- - checkout.session.completed
-- - payment_intent.succeeded
-- - charge.succeeded
-- 
-- Without uniqueness constraints, we might record duplicate ledger entries.
-- 
-- Solution: Add unique constraints on (type, stripe_*_id) combinations
-- ============================================================================

-- Add unique constraint for charges (based on payment_intent_id + type)
-- This prevents duplicate charge entries from different events
ALTER TABLE financial_ledger 
ADD UNIQUE INDEX uq_ledger_pi_type (type, stripePaymentIntentId);

-- Add unique constraint for charges (based on charge_id + type)
-- This handles cases where we have charge_id but not payment_intent_id
ALTER TABLE financial_ledger 
ADD UNIQUE INDEX uq_ledger_charge_type (type, stripeChargeId);

-- Add unique constraint for refunds (based on refund_id + type)
-- This prevents duplicate refund entries
ALTER TABLE financial_ledger 
ADD UNIQUE INDEX uq_ledger_refund_type (type, stripeRefundId);

-- ============================================================================
-- IDEMPOTENCY REQUESTS UNIQUENESS
-- ============================================================================
-- 
-- Add unique constraint on (scope, userId, idempotencyKey)
-- This is the core idempotency constraint
-- ============================================================================

-- Add unique constraint for idempotency
-- Note: MySQL allows multiple NULLs in unique index, which is what we want
-- for webhook idempotency (userId = NULL)
ALTER TABLE idempotency_requests 
ADD UNIQUE INDEX uq_idempotency_scope_user_key (scope, userId, idempotencyKey);

-- ============================================================================
-- STRIPE EVENTS IMPROVEMENTS
-- ============================================================================

-- Add receivedAt column if not exists
ALTER TABLE stripe_events 
ADD COLUMN IF NOT EXISTS receivedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Add index for retry queries (processed=false, retryCount < limit)
ALTER TABLE stripe_events 
ADD INDEX idx_stripe_events_retry (processed, retryCount);

-- ============================================================================
-- REFRESH TOKENS IMPROVEMENTS
-- ============================================================================

-- Add tokenHash column for secure storage (if not exists)
-- Note: We'll migrate existing tokens in application code
ALTER TABLE refresh_tokens 
ADD COLUMN IF NOT EXISTS tokenHash VARCHAR(64);

-- Add unique index on tokenHash
ALTER TABLE refresh_tokens 
ADD UNIQUE INDEX uq_refresh_token_hash (tokenHash);

-- Add index for cleanup queries
ALTER TABLE refresh_tokens 
ADD INDEX idx_refresh_tokens_expires (expiresAt);

-- ============================================================================
-- BOOKINGS IMPROVEMENTS
-- ============================================================================

-- Add idempotencyKey column if not exists
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS idempotencyKey VARCHAR(255);

-- Add unique index on idempotencyKey (per user)
ALTER TABLE bookings 
ADD UNIQUE INDEX uq_booking_idempotency (userId, idempotencyKey);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these after migration to verify constraints are in place:
-- 
-- SHOW INDEX FROM financial_ledger WHERE Key_name LIKE 'uq_%';
-- SHOW INDEX FROM idempotency_requests WHERE Key_name LIKE 'uq_%';
-- SHOW INDEX FROM stripe_events WHERE Key_name LIKE 'idx_%';
-- SHOW INDEX FROM refresh_tokens WHERE Key_name LIKE 'uq_%';
-- SHOW INDEX FROM bookings WHERE Key_name LIKE 'uq_%';
-- ============================================================================
