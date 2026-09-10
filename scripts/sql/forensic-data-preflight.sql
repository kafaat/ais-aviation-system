-- READ ONLY. Run after reviewed migrations, before enabling affected channels.
-- Identifiers only: no passenger names, documents, credentials or card data.
-- Do not automatically repair ownership, historical seat deductions or collected funds.
START TRANSACTION READ ONLY;
SELECT 'booking_missing_owner_or_tenant' AS finding, id, userId, tenantId
FROM bookings WHERE userId = 0 OR tenantId IS NULL ORDER BY id LIMIT 200;
SELECT 'agency_without_owner' AS finding, id, ownerUserId
FROM travel_agents WHERE ownerUserId IS NULL ORDER BY id LIMIT 200;
SELECT 'passenger_count_mismatch' AS finding, b.id, b.numberOfPassengers, COUNT(p.id) AS storedPassengers
FROM bookings b LEFT JOIN passengers p ON p.bookingId = b.id
GROUP BY b.id, b.numberOfPassengers HAVING storedPassengers <> b.numberOfPassengers LIMIT 200;
SELECT 'segment_reservation_mismatch' AS finding, b.id, b.seatsReserved, COUNT(s.id) AS segments, SUM(s.seatsReserved) AS reservedSegments
FROM bookings b JOIN booking_segments s ON s.bookingId = b.id
WHERE b.paymentStatus = 'paid' AND b.status = 'confirmed'
GROUP BY b.id, b.seatsReserved HAVING reservedSegments <> segments OR b.seatsReserved = 0 LIMIT 200;
SELECT 'missing_segment_allocation' AS finding, bookingId, id AS segmentId
FROM booking_segments WHERE segmentAmount IS NULL ORDER BY bookingId LIMIT 200;
SELECT 'invoice_ancillary_inconsistency' AS finding, b.id, b.totalAmount, SUM(a.totalPrice) AS ancillaryAmount
FROM bookings b JOIN booking_ancillaries a ON a.bookingId = b.id AND a.status = 'active'
GROUP BY b.id, b.totalAmount HAVING ancillaryAmount > b.totalAmount LIMIT 200;
SELECT 'booking_flight_tenant_mismatch' AS finding, b.id, b.tenantId, f.tenantId AS flightTenant
FROM bookings b JOIN flights f ON f.id = b.flightId
WHERE NOT (b.tenantId <=> f.tenantId) ORDER BY b.id LIMIT 200;
SELECT 'unlinked_legacy_hold' AS finding, id, flightId, userId, expiresAt
FROM seat_holds WHERE inventoryLockId IS NULL AND status = 'active' ORDER BY id LIMIT 200;
SELECT 'collected_funds_under_review' AS finding, paymentIntentId, bookingId, targetId, amount, refundedAmount
FROM payment_receipts WHERE settlementStatus = 'review_required' ORDER BY createdAt LIMIT 200;
COMMIT;
