-- Migration: Add P0 Critical Tables for Production Readiness
-- Date: 2026-01-26
-- Description: Adds idempotency, stripe events, financial ledger, and refresh tokens

-- 1. Add idempotencyKey to bookings table
ALTER TABLE bookings ADD COLUMN idempotencyKey VARCHAR(255) UNIQUE;
CREATE INDEX bookings_idempotency_key_idx ON bookings(idempotencyKey);

-- 2. Create stripe_events table for webhook de-duplication
CREATE TABLE stripe_events (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  apiVersion VARCHAR(20),
  data TEXT NOT NULL,
  processed BOOLEAN DEFAULT FALSE NOT NULL,
  processedAt TIMESTAMP,
  error TEXT,
  retryCount INT DEFAULT 0 NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX stripe_events_type_idx (type),
  INDEX stripe_events_processed_idx (processed),
  INDEX stripe_events_created_at_idx (createdAt)
);

-- 3. Create financial_ledger table for audit trail
CREATE TABLE financial_ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bookingId INT,
  userId INT,
  type ENUM('charge', 'refund', 'partial_refund', 'fee', 'adjustment') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'SAR' NOT NULL,
  stripeEventId VARCHAR(255),
  stripePaymentIntentId VARCHAR(255),
  stripeChargeId VARCHAR(255),
  stripeRefundId VARCHAR(255),
  description TEXT,
  metadata TEXT,
  balanceBefore DECIMAL(10, 2),
  balanceAfter DECIMAL(10, 2),
  transactionDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX financial_ledger_booking_id_idx (bookingId),
  INDEX financial_ledger_user_id_idx (userId),
  INDEX financial_ledger_type_idx (type),
  INDEX financial_ledger_stripe_event_id_idx (stripeEventId),
  INDEX financial_ledger_transaction_date_idx (transactionDate)
);

-- 4. Create refresh_tokens table for mobile auth
CREATE TABLE refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  token VARCHAR(500) NOT NULL UNIQUE,
  deviceInfo TEXT,
  ipAddress VARCHAR(45),
  expiresAt TIMESTAMP NOT NULL,
  revokedAt TIMESTAMP,
  lastUsedAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX refresh_tokens_user_id_idx (userId),
  INDEX refresh_tokens_token_idx (token),
  INDEX refresh_tokens_expires_at_idx (expiresAt)
);

-- 5. Add foreign key constraints
ALTER TABLE financial_ledger 
  ADD CONSTRAINT fk_financial_ledger_booking 
  FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL;

ALTER TABLE financial_ledger 
  ADD CONSTRAINT fk_financial_ledger_user 
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE refresh_tokens 
  ADD CONSTRAINT fk_refresh_tokens_user 
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE;
