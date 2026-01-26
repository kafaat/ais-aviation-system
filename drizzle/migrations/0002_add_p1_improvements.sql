-- Migration: Add P1 Improvements (Redis, Queue, Observability)
-- Date: 2026-01-26
-- Description: Adds idempotency_requests table for enhanced idempotency

-- 1. Create idempotency_requests table
CREATE TABLE idempotency_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope VARCHAR(100) NOT NULL,
  idempotencyKey VARCHAR(255) NOT NULL,
  userId INT,
  requestHash VARCHAR(64) NOT NULL,
  status ENUM('STARTED', 'COMPLETED', 'FAILED') DEFAULT 'STARTED' NOT NULL,
  responseJson TEXT,
  errorMessage TEXT,
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idempotency_scope_user_key_idx (scope, userId, idempotencyKey),
  INDEX idempotency_scope_key_idx (scope, idempotencyKey),
  INDEX idempotency_status_idx (status),
  INDEX idempotency_expires_at_idx (expiresAt)
);

-- 2. Add unique constraint for idempotency
-- Note: MySQL doesn't support partial unique indexes like Postgres
-- So we create a compound index instead
CREATE UNIQUE INDEX idempotency_unique_idx 
ON idempotency_requests(scope, COALESCE(userId, 0), idempotencyKey);
