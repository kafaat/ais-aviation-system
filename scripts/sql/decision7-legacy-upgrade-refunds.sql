-- Decision 7 (#327) pre-deploy check: legacy upgrade refunds. Read only.
-- SELECT statements inside a READ ONLY transaction that is rolled back; it
-- writes nothing and reconciles nothing. Identifiers only; the upgrade intent
-- is reported as a SHA-256 hash, as in forensic-data-preflight.sql.
--
-- Finds bookings left in the legacy state that decision 7 documents. Before
-- it, a cancellation refunded the original payment intent alone. Such a
-- booking is cancelled and its payment status is refunded, and its original
-- `booking` receipt is fully refunded. Yet an applied `modification` receipt
-- on another intent (an upgrade collected on its own intent) still holds
-- money that was never returned. Each row is one such upgrade receipt; refer
-- it to reconciliation before deploying. No rows: no booking is in this state.
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION READ ONLY;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'decision7_legacy_upgrade_refund' AS finding, COUNT(DISTINCT bookingId) AS bookings, COUNT(*) AS receipts, COALESCE(SUM(upgradeHeld), 0) AS heldAmount FROM (SELECT b.id AS bookingId, m.amount - m.refundedAmount AS upgradeHeld FROM bookings b JOIN payment_receipts r ON r.paymentIntentId = b.stripePaymentIntentId JOIN payment_receipts m ON m.bookingId = b.id WHERE b.status = 'cancelled' AND b.paymentStatus = 'refunded' AND r.bookingId = b.id AND r.kind = 'booking' AND r.refundedAmount >= r.amount AND m.kind = 'modification' AND m.settlementStatus = 'applied' AND m.paymentIntentId <> b.stripePaymentIntentId AND m.refundedAmount < m.amount) findings;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'decision7_legacy_upgrade_refund' AS finding, bookingId, upgradeIntentHash, upgradeCollected, upgradeRefunded, upgradeHeld FROM (SELECT b.id AS bookingId, SHA2(m.paymentIntentId, 256) AS upgradeIntentHash, m.amount AS upgradeCollected, m.refundedAmount AS upgradeRefunded, m.amount - m.refundedAmount AS upgradeHeld FROM bookings b JOIN payment_receipts r ON r.paymentIntentId = b.stripePaymentIntentId JOIN payment_receipts m ON m.bookingId = b.id WHERE b.status = 'cancelled' AND b.paymentStatus = 'refunded' AND r.bookingId = b.id AND r.kind = 'booking' AND r.refundedAmount >= r.amount AND m.kind = 'modification' AND m.settlementStatus = 'applied' AND m.paymentIntentId <> b.stripePaymentIntentId AND m.refundedAmount < m.amount) findings ORDER BY bookingId, upgradeIntentHash LIMIT 200;
ROLLBACK;
