-- Read-only counts. Deficiency columns overlap by design.
SELECT
  services.code AS serviceCode,
  ba.status,
  COUNT(*) AS totalItems,
  SUM(ba.fundedAt IS NULL) AS missingFundedAt,
  SUM(ba.fundingReference IS NULL) AS missingFundingReference,
  SUM(ba.weightSnapshotGrams IS NULL) AS missingWeightSnapshot,
  SUM(ba.passengerId IS NULL) AS missingPassenger,
  SUM(ba.scopeState = 'unresolved') AS missingScope,
  SUM(services.weightGrams IS NULL) AS catalogWeightUndefined,
  SUM(ba.metadata IS NOT NULL AND NOT JSON_VALID(ba.metadata)) AS invalidLegacyMetadata
FROM booking_ancillaries AS ba
INNER JOIN ancillary_services AS services
  ON services.id = ba.ancillaryServiceId
WHERE services.category = 'baggage'
GROUP BY services.code, ba.status
ORDER BY totalItems DESC, services.code, ba.status;
