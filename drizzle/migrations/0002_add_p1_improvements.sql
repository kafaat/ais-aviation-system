-- Migration: Add P1 Improvements (Redis, Queue, Observability)
-- Date: 2026-01-26
-- Description: Adds idempotency_requests table for enhanced idempotency

-- 1. Create idempotency_requests table
CREATE TABLE IF NOT EXISTS idempotency_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  
  -- Idempotency key and scope
  scope VARCHAR(100) NOT NULL,
  idempotencyKey VARCHAR(255) NOT NULL,
  
  -- User/tenant context (nullable for webhooks)
  userId INT DEFAULT NULL,
  
  -- Request hash to detect payload changes
  requestHash VARCHAR(64) NOT NULL,
  
  -- Processing status
  status ENUM('STARTED', 'COMPLETED', 'FAILED') DEFAULT 'STARTED' NOT NULL,
  
  -- Response storage
  responseJson TEXT DEFAULT NULL,
  errorMessage TEXT DEFAULT NULL,
  
  -- Timestamps
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  -- Indexes for performance
  INDEX idempotency_scope_user_key_idx (scope, userId, idempotencyKey),
  INDEX idempotency_scope_key_idx (scope, idempotencyKey),
  INDEX idempotency_status_idx (status),
  INDEX idempotency_expires_at_idx (expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Add unique constraint for idempotency
-- For user-scoped requests
ALTER TABLE idempotency_requests 
ADD UNIQUE INDEX idempotency_unique_user_idx (scope, userId, idempotencyKey);

-- Note: For webhook requests (userId is NULL), we rely on the regular index
-- MySQL doesn't support partial unique indexes like Postgres
-- The application logic handles NULL userId cases separately
