-- Read-only Phase 0 inventory. Presence of funding fields is not proof that
-- their referenced financial path completed; that verification is Phase 1.
WITH baggage_rows AS (
  SELECT
    ba.id,
    ba.bookingId,
    ba.passengerId,
    ba.status,
    ba.fundedAt,
    ba.fundingReference,
    ba.weightSnapshotGrams,
    ba.segmentId,
    ba.scopeState,
    ba.metadata,
    ba.createdAt,
    services.code AS serviceCode,
    services.weightGrams AS catalogWeightGrams
  FROM booking_ancillaries AS ba
  INNER JOIN ancillary_services AS services
    ON services.id = ba.ancillaryServiceId
  WHERE services.category = 'baggage'
), classified AS (
  SELECT
    baggage_rows.*,
    CASE
      WHEN JSON_VALID(metadata)
      THEN JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.flightId'))
      ELSE NULL
    END AS metadataFlightId,
    JSON_MERGE_PRESERVE(
      JSON_ARRAY(),
      IF(fundedAt IS NULL, JSON_ARRAY('missing_funded_at'), JSON_ARRAY()),
      IF(fundingReference IS NULL, JSON_ARRAY('missing_funding_reference'), JSON_ARRAY()),
      IF(weightSnapshotGrams IS NULL, JSON_ARRAY('missing_weight_snapshot'), JSON_ARRAY()),
      IF(passengerId IS NULL, JSON_ARRAY('missing_passenger'), JSON_ARRAY()),
      IF(scopeState = 'unresolved', JSON_ARRAY('missing_scope'), JSON_ARRAY()),
      IF(scopeState = 'specific_segment' AND segmentId IS NULL,
        JSON_ARRAY('invalid_specific_segment_scope'), JSON_ARRAY()),
      IF(scopeState <> 'specific_segment' AND segmentId IS NOT NULL,
        JSON_ARRAY('unexpected_segment_for_scope'), JSON_ARRAY()),
      IF(scopeState = 'all_segments', JSON_ARRAY('unapproved_all_segments_scope'), JSON_ARRAY()),
      IF(status <> 'active', JSON_ARRAY('status_not_active'), JSON_ARRAY()),
      IF(weightSnapshotGrams <= 0, JSON_ARRAY('invalid_weight_snapshot'), JSON_ARRAY())
    ) AS entitlementReasons,
    IF(catalogWeightGrams IS NULL,
      JSON_ARRAY('catalog_weight_undefined'), JSON_ARRAY()) AS catalogNotes,
    JSON_MERGE_PRESERVE(
      JSON_ARRAY(),
      IF(metadata IS NOT NULL AND NOT JSON_VALID(metadata),
        JSON_ARRAY('invalid_legacy_metadata'), JSON_ARRAY())
    ) AS dataNotes
  FROM baggage_rows
)
SELECT *
FROM classified
WHERE JSON_LENGTH(entitlementReasons) > 0
   OR JSON_LENGTH(catalogNotes) > 0
   OR JSON_LENGTH(dataNotes) > 0
ORDER BY createdAt DESC, id DESC;
